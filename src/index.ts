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

const server = new McpServer({
    name: "af-eval-cli",
    version: "1.0.0",
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

                        // Combine stdout and stderr for the LLM to see what's actually happening
                        const fullOutput = (adbExec.stdout || "");
                        const cleanOutput = fullOutput.trim() || "No output received from ADB";

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