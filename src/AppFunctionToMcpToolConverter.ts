/**
 * MCP-compliant Tool definition
 */
interface McpTool {
    name: string;
    id: string; // The raw functionId (e.g. "Namespace#method")
    description: string;
    inputSchema: {
        type: "object";
        properties: Record<string, any>;
        required: string[];
    };
    outputSchema?: Record<string, any>;
}

/**
 * Android AppFunction Metadata Interfaces
 */
interface DataTypeMetadata {
    type: number[];
    isNullable: boolean[];
    dataTypeReference?: string[];
    properties?: Array<{
        name: string[];
        dataTypeMetadata: DataTypeMetadata[];
    }>;
    required?: string[];
    itemType?: DataTypeMetadata[];
}

interface DataTypeDefinition {
    name: string[];
    dataTypeMetadata: DataTypeMetadata[];
}

interface AppFunctionStaticMetadata {
    functionId: string[];
    parameters: Array<{
        name: string[];
        isRequired: boolean[];
        dataTypeMetadata: DataTypeMetadata[];
    }>;
    response: Array<{
        valueType: DataTypeMetadata[];
    }>;
    description: string[];
}

/**
 * Type Mapping Constants
 */
const TYPE_MAP: Record<number, string> = {
    0: "null",
    1: "boolean",
    2: "string", // Bytes
    3: "object",
    4: "number", // Double
    5: "number", // Float
    6: "integer", // Long
    7: "integer", // Int
    8: "string",
    10: "array",
    11: "object", // Reference
};

export class AppFunctionToMcpToolConverter {
    private typeRegistry: Record<string, DataTypeMetadata> = {};
    private tools: McpTool[] = [];

    constructor(private rawData: any, private packageName: string) {
        this.initialize();
    }

    private initialize(): void {
        const packageEntries = this.rawData[this.packageName];
        if (!Array.isArray(packageEntries)) {
            throw new Error(`Package ${this.packageName} not found in input data.`);
        }

        // 1. Populate Shared Type Registry from Component Metadata
        const componentKey = `AppFunctionComponentMetadataDocument-${this.packageName}`;
        const componentMeta = packageEntries.find((entry) => entry[componentKey]);

        if (componentMeta) {
            const dataTypes: DataTypeDefinition[] = componentMeta[componentKey].dataTypes;
            dataTypes.forEach((dt) => {
                this.typeRegistry[dt.name[0]] = dt.dataTypeMetadata[0];
            });
        }

        // 2. Map Static Metadata to MCP Tools
        const staticKey = `AppFunctionStaticMetadata-${this.packageName}`;
        packageEntries.forEach((entry) => {
            if (entry[staticKey]) {
                this.tools.push(this.convertToMcpTool(entry[staticKey]));
            }
        });
    }

    /**
     * Recursively resolves the metadata tree into a JSON Schema
     */
    private resolveToSchema(metadata: DataTypeMetadata): any {
        const typeCode = metadata.type[0];

        // Reference Resolution
        if (typeCode === 11 && metadata.dataTypeReference) {
            const refName = metadata.dataTypeReference[0];
            const registryEntry = this.typeRegistry[refName];
            if (!registryEntry) {
                return { type: "object", description: `Ref unresolved: ${refName}` };
            }
            return this.resolveToSchema(registryEntry);
        }

        // Array Resolution
        if (typeCode === 10 && metadata.itemType) {
            return {
                type: "array",
                items: this.resolveToSchema(metadata.itemType[0]),
            };
        }

        // Object Resolution
        if (typeCode === 3) {
            const schema: any = { type: "object", properties: {} };

            if (metadata.properties) {
                metadata.properties.forEach((prop) => {
                    const propName = prop.name[0];
                    schema.properties[propName] = this.resolveToSchema(prop.dataTypeMetadata[0]);
                });
            }

            if (metadata.required && metadata.required.length > 0) {
                schema.required = metadata.required;
            }

            return schema;
        }

        // Primitive Fallback
        return { type: TYPE_MAP[typeCode] || "string" };
    }

    private convertToMcpTool(staticMeta: AppFunctionStaticMetadata): McpTool {
        const rawId = staticMeta.functionId[0];

        // Convert "Namespace#method" to "method" or "Namespace_method"
        const toolName = rawId.includes("#")
            ? rawId.split("#")[1]
            : rawId.replace(/\./g, "_");

        const inputProperties: Record<string, any> = {};
        const inputRequired: string[] = [];

        staticMeta.parameters.forEach((param) => {
            const name = param.name[0];
            inputProperties[name] = this.resolveToSchema(param.dataTypeMetadata[0]);
            if (param.isRequired[0]) {
                inputRequired.push(name);
            }
        });

        const outputSchema = staticMeta.response?.[0]?.valueType?.[0]
            ? this.resolveToSchema(staticMeta.response[0].valueType[0])
            : undefined;

        return {
            name: toolName,
            id: rawId,
            description: staticMeta.description[0],
            inputSchema: {
                type: "object",
                properties: inputProperties,
                required: inputRequired,
            },
            outputSchema,
        };
    }

    public getMcpTools(): McpTool[] {
        return this.tools;
    }
}