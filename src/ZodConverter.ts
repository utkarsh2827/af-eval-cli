import { z, ZodTypeAny } from "zod";

export class ZodSchemaGenerator {
    /**
     * Converts the tool's inputSchema into a living ZodObject
     */
    static create(properties: Record<string, any>, requiredKeys: string[]): z.ZodObject<any> {
        const shape: Record<string, ZodTypeAny> = {};

        for (const [key, definition] of Object.entries(properties)) {
            const isRequired = requiredKeys.includes(key);
            shape[key] = this.mapDefinitionToZod(definition, isRequired);
        }

        return z.object(shape);
    }

    private static mapDefinitionToZod(def: any, isRequired: boolean = true): ZodTypeAny {
        let zodType: ZodTypeAny;

        switch (def.type) {
            case "string":
                zodType = z.string();
                break;
            case "number":
            case "float":
            case "double":
                zodType = z.number();
                break;
            case "integer":
            case "long":
            case "int":
                zodType = z.number().int();
                break;
            case "boolean":
                zodType = z.boolean();
                break;
            case "array":
                zodType = z.array(this.mapDefinitionToZod(def.items, true));
                break;
            case "object":
                zodType = this.create(def.properties || {}, def.required || []);
                break;
            case "null":
                zodType = z.null();
                break;
            default:
                zodType = z.any();
        }

        return isRequired ? zodType : zodType.optional();
    }
}