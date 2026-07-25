/**
 * MCP prompts for prd-gen — prompts/list + prompts/get (issue #28).
 *
 * prd-gen is almost entirely a staged pipeline, and the stages ARE the
 * product. A caller that invokes them out of order does not get an error — it
 * gets a pipeline in a wrong state. These prompts publish the ordering as
 * enumerable protocol.
 *
 * Source of truth (criterion 2): a prompt step names a tool and pulls that
 * tool's one-line summary from the live registered-tool description via
 * `summaryOf` — the SAME schema `tools/list` advertises. The prompt owns only
 * the *ordering* (the pipeline the SKILL.md / skill-config.json already
 * encode); it never hand-copies a tool's description. Three copies of one
 * ordering contract is the drift defect, not a feature.
 *
 * Per-argument `title`: the installed MCP SDK models a prompt argument as
 * name/description/required only (PromptArgumentSchema has no `title` field),
 * so the human title is folded into each argument's description. The
 * prompt-level `title` IS emitted.
 */
import type { McpServer, RegisteredPrompt } from "@modelcontextprotocol/sdk/server/mcp.js";
/** Resolves a tool's registered description, or undefined if unknown. */
export type ToolSummarySource = (toolName: string) => string | undefined;
/** Prompt name → the tools its workflow drives (for profile availability). */
export declare const PROMPT_STEP_TOOLS: Readonly<Record<string, readonly string[]>>;
export declare const PROMPT_NAMES: string[];
/**
 * Register every prompt on `server`, rendering bodies from `summaryOf`.
 * Returns the registered-prompt handles by name so the caller can gate them by
 * profile (both current prompts drive agent-facing tools, so both stay enabled
 * under every profile — the gating hook exists for future prompts).
 */
export declare function registerPrompts(server: McpServer, summaryOf: ToolSummarySource): Record<string, RegisteredPrompt>;
//# sourceMappingURL=mcp-prompts.d.ts.map