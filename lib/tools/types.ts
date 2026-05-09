export type ToolScope =
  | "cos"
  | "steward"
  | "scout"
  | "outreach"
  | "marketing"
  | "sales-engineering"
  | "all";

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * A registered tool.
 *
 * - `scopes`     — which agents can use this tool. Use "all" for universal tools.
 * - `connector`  — if set, the tool is only offered when a connector with this
 *                  name has status "connected". Prevents agents calling tools for
 *                  integrations that aren't wired up.
 * - `execute`    — receives the agent's input and the tenant ID; returns a
 *                  markdown string the agent sees as the tool result.
 */
export interface RegisteredTool {
  definition: ToolDefinition;
  scopes: ToolScope[];
  connector?: string;
  execute: (input: Record<string, unknown>, tenantId: string) => Promise<string>;
}
