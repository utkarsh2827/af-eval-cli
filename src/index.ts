import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { spawnSync } from 'child_process';
import { z } from "zod";
import { AppFunctionToMcpToolConverter } from "./AppFunctionToMcpToolConverter.js";
import { ZodSchemaGenerator } from "./ZodConverter.js";

const PACKAGE_NAME = process.argv[2];

if (!PACKAGE_NAME) {
    console.error("Usage: node build/index.js <package_name>");
    process.exit(1);
}

/**
 * Recursively flattens ADB response based on the expected output schema.
 * Handles the case where ADB wraps values in single-element arrays.
 */
function flattenWithSchema(data: any, schema: any): any {
    if (!schema) {
        // Fallback to basic flattening if no schema is provided
        if (Array.isArray(data)) {
            if (data.length === 1) {
                return flattenWithSchema(data[0], null);
            }
            return data.map(item => flattenWithSchema(item, null));
        } else if (typeof data === 'object' && data !== null) {
            const newObj: any = {};
            for (const [key, value] of Object.entries(data)) {
                newObj[key] = flattenWithSchema(value, null);
            }
            return newObj;
        }
        return data;
    }

    // If schema says it's an array, ensure we return an array
    if (schema.type === 'array') {
        const list = Array.isArray(data) ? data : [data];
        // Special case: ADB often returns [ [item1, item2] ] for arrays.
        // If we have an array of size 1, and its only element is also an array,
        // it's likely double-wrapped.
        if (list.length === 1 && Array.isArray(list[0]) && schema.items?.type !== 'array') {
            return list[0].map((item: any) => flattenWithSchema(item, schema.items));
        }
        return list.map(item => flattenWithSchema(item, schema.items));
    }

    // If schema says it's an object, flatten the wrapper array if present
    if (schema.type === 'object') {
        const obj = (Array.isArray(data) && data.length === 1) ? data[0] : data;
        if (typeof obj !== 'object' || obj === null) return obj;

        const result: any = {};
        for (const [key, value] of Object.entries(obj)) {
            const propSchema = schema.properties?.[key];
            result[key] = flattenWithSchema(value, propSchema);
        }
        return result;
    }

    // Primitive types (string, number, boolean, etc.)
    if (Array.isArray(data) && data.length === 1) {
        return data[0];
    }
    return data;
}

const server = new McpServer({
    name: "af-eval-cli",
    version: "1.0.0",
    // TODO: Read from adb.
    description: `
    You are a precise Task Management Agent. Your sole purpose is to convert user requests into tool calls for the 'com.google.gemini.app.notes' package.

    Follow these strict operational rules:
    1. ACTION OVER CONVERSATION: If the user's request can be mapped to a tool, call the tool immediately. Do not ask for permission, do not confirm, and do not ask for clarification unless the request is completely nonsensical.
    2. DATE & TIME HANDLING: If a user provides a date (e.g., '2024-01-01') without a specific time, use that date as-is for the 'modifiedAfter' parameter. Never ask for a "more specific time."
    3. RECURRENCE MAPPING: 
    - If the user says "do not repeat" or "one-time," set 'recurrenceSchedule' to "none".
    - If the user specifies "weekly" or "monthly," use those exact strings ("weekly", "monthly").
    4. PARAMETER EXTRACTION:
    - For 'findTasks': Map "limit" or "latest X" to 'maxCount'.
    - For 'createTask': Extract the 'title' and 'content' concisely. If no title is clear, use the first few words of the task.
    5. NO REDUNDANCY: Do not ask "how would you like to schedule it" if the user has already provided a scheduling instruction (including "no repeat").
`.trim(),
});

async function initialize() {
    try {
        console.error(`[Startup] Fetching functions for ${PACKAGE_NAME}...`);

        // 1. Get raw metadata
        const adbList = spawnSync('adb', ['shell', 'cmd', 'app_function', 'list-app-functions'], {
            encoding: 'utf8',
            maxBuffer: 10 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        if (adbList.error) throw adbList.error;
        if (adbList.status !== 0) throw new Error(`ADB list failed with status ${adbList.status}: ${adbList.stderr}`);

        const rawOutput = adbList.stdout;
        const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON found in ADB output");
        const data = JSON.parse(jsonMatch[0]);

        // 2. Convert to tools
        const converter = new AppFunctionToMcpToolConverter(data, PACKAGE_NAME);
        const tools = converter.getMcpTools();

        // 3. Register
        for (const tool of tools) {
            server.registerTool(
                tool.name,
                {
                    description: tool.description,
                    inputSchema: ZodSchemaGenerator.create(
                        tool.inputSchema.properties,
                        tool.inputSchema.required
                    ),
                },
                async (params: any) => {
                    try {
                        // 1. Extract the actual inner params object
                        const actualParams = params || {};

                        // 2. Stringify it to get valid JSON: {"title":"Executed From MCP"}
                        const paramsJson = JSON.stringify(actualParams);

                        // 3. Escape the double quotes for the remote shell: {\"title\":\"Executed From MCP\"}
                        // This prevents the Android shell from thinking the quote ends the argument.
                        const escapedParams = paramsJson.replace(/"/g, '\\"');

                        console.error(`[Exec] Sending to ADB: ${escapedParams}`);

                        const adbExec = spawnSync('adb', [
                            'shell',
                            'cmd',
                            'app_function',
                            'execute-app-function',
                            '--package', PACKAGE_NAME,
                            '--function', tool.id,
                            '--parameters', `"${escapedParams}"` // Wrap the escaped JSON in double quotes
                        ], {
                            encoding: 'utf8',
                            stdio: ['ignore', 'pipe', 'pipe']
                        });

                        if (adbExec.error) throw adbExec.error;

                        console.error(`[Exec] Exit Code: ${adbExec.status}`);
                        if (adbExec.stderr) console.error(`[Exec] Stderr: ${adbExec.stderr}`);

                        const stdout = adbExec.stdout || "";
                        let cleanOutput = stdout.trim() || "No output received from ADB";

                        // Try to extract and refine JSON from stdout
                        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            try {
                                const parsed = JSON.parse(jsonMatch[0]);

                                // ADB responses wrap the actual return value in "androidAppfunctionsReturnValue"
                                let rawValue = parsed.androidAppfunctionsReturnValue;

                                // Apply smart flattening based on the tool's outputSchema
                                let refined = flattenWithSchema(rawValue, tool.outputSchema);

                                cleanOutput = JSON.stringify(refined, null, 2);
                            } catch (e) {
                                console.error("[Exec] Failed to parse output JSON:", e);
                            }
                        }

                        return {
                            content: [{ type: "text", text: cleanOutput }],
                            isError: adbExec.status !== 0
                        };
                    } catch (error: any) {
                        console.error(`Execution failed for ${tool.name}:`, error);
                        return {
                            content: [{ type: "text" as const, text: `Error: ${error.message}` }],
                            isError: true
                        };
                    }
                }
            );
        }

        console.error(`[Startup] Registered ${tools.length} tools.`);

        // 4. Connect after tools are ready
        const transport = new StdioServerTransport();
        await server.connect(transport);

    } catch (error) {
        console.error("Initialization failed:", error);
        process.exit(1);
    }
}

initialize();