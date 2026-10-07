import type {
  AgentEvent,
  AgentMode,
  DesktopSettings,
  Diagnostic,
  FileDiff,
  ModelRole,
  Session,
  TodoItem,
  ToolBlock,
  ToolName,
} from "./protocol";
import type { Workspace } from "./vfs";

/**
 * A turn is one user prompt running through the agent loop. The runtime hands
 * recipes a narrow, promise-based surface: stream text, run tools against the
 * live workspace, mutate todos, inject advisor notes and stream rules, fan out
 * subagents, and queue renderer effects (model changes, pane focus, diffs).
 */

export type TurnEffect =
  | { type: "set-model"; selector: string }
  | { type: "set-role"; role: ModelRole; selector: string }
  | { type: "set-mode"; mode: AgentMode }
  | { type: "set-advisor"; enabled: boolean }
  | { type: "clear-transcript" }
  | { type: "set-title"; title: string }
  | { type: "attach-diff"; diff: FileDiff }
  | { type: "open-pane"; pane: "preview" | "diff" | "terminal" | "files" | "hub" | "settings" }
  | { type: "set-rule-hits"; ruleId: string; hits: number }
  | { type: "set-plan"; plan: string[] };

export interface ToolExecResult {
  blocks: ToolBlock[];
  status?: "ok" | "error" | "proposed";
  diff?: FileDiff;
}

export interface ToolInvocation {
  name: ToolName;
  target?: string;
  summary: string;
  /** Runs against the live workspace; the blocks it returns are what the card renders. */
  exec: (workspace: Workspace) => ToolExecResult;
  /** Extra ms to stand in for model thinking before the call lands. */
  thinkMs?: number;
}

export interface SubagentBlueprint {
  name: string;
  task: string;
  isolatedWorktree?: string;
  steps: { say: string; tool?: ToolInvocation }[];
  findings: string[];
  costUsd: number;
  tokens: number;
  durationMs: number;
}

export interface TurnRuntime {
  workspace: Workspace;
  /** Primary folder of the active project (or the detached default). */
  root: string;
  session: Session;
  settings: DesktopSettings;
  todos: TodoItem[];
  /** Plan/Vibe modes investigate and propose; they never write. */
  planOnly: boolean;
  effects: TurnEffect[];
  signal: AbortSignal;
  log(event: AgentEvent): void;
  say(text: string, options?: { role?: ModelRole }): Promise<void>;
  runTool(invocation: ToolInvocation): Promise<ToolExecResult>;
  setTodos(items: TodoItem[]): void;
  updateTodo(id: string, status: TodoItem["status"]): void;
  advisor(severity: "note" | "concern" | "blocker", text: string): void;
  memory(facts: string[]): void;
  runSubagents(blueprints: SubagentBlueprint[]): Promise<void>;
  usage(promptTokens: number, completionTokens: number, costUsd: number): void;
  delay(ms: number): Promise<void>;
  aborted(): boolean;
  diagnostics(): Diagnostic[];
  evaluate(path: string, name: string, args: unknown[]): { ok: true; value: unknown } | { ok: false; error: string };
  modelFor(role?: ModelRole): string;
  effect(effect: TurnEffect): void;
}

export interface TurnOptions {
  workspace: Workspace;
  root: string;
  session: Session;
  settings: DesktopSettings;
  prompt: string;
  emit: (event: AgentEvent) => void;
  signal: AbortSignal;
}

export type RecipeId =
  | "fix-tests"
  | "run-tests"
  | "review"
  | "cleanup"
  | "explain"
  | "search"
  | "accuracy"
  | "feature"
  | "commit"
  | "memory"
  | "capability"
  | "command"
  | "generic";

/* ------------------------------------------------------------------ *
 * Shared helpers used by recipes and the engine
 * ------------------------------------------------------------------ */

export function chunkText(text: string, size = 4): string[] {
  const words = text.split(/(\s+)/);
  const chunks: string[] = [];
  let current = "";
  let count = 0;
  for (const word of words) {
    current += word;
    if (/\s/.test(word)) count += 1;
    if (count >= size) {
      chunks.push(current);
      current = "";
      count = 0;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join("-")
    .replace(/-+/g, "-")
    .slice(0, 32);
  return slug || "task";
}

export function camelCase(text: string): string {
  const parts = slugify(text).split("-").filter(Boolean);
  if (parts.length === 0) return "task";
  return parts[0] + parts.slice(1).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
}

/** Pull a workspace path out of free-form prose, if one is named. */
export function extractPath(prompt: string, workspace: Workspace): string | undefined {
  const candidates = prompt.match(/[\w./-]*[\w-]+\.(ts|tsx|js|jsx|json|md|yml|yaml|rs|py)\b/g) ?? [];
  for (const candidate of candidates) {
    if (candidate.startsWith("/") && workspace.read(candidate) !== undefined) return candidate;
    const matches = workspace.paths().filter((path) => path.endsWith(`/${candidate}`));
    if (matches.length > 0) return matches[0];
  }
  return undefined;
}

export function keywordsOf(prompt: string): string[] {
  const stop = new Set([
    "the", "a", "an", "and", "or", "for", "with", "that", "this", "from", "into", "please", "can", "you", "my",
    "our", "is", "are", "was", "were", "it", "to", "of", "in", "on", "at", "be", "do", "does", "did", "me",
    "we", "i", "then", "than", "so", "if", "but", "not", "no", "yes", "just", "before", "after", "over", "under",
  ]);
  return prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s_.-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stop.has(word))
    .slice(0, 8);
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findLineIndex(content: string, needle: string | RegExp): number {
  const rows = content.split("\n");
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (typeof needle === "string" ? row.includes(needle) : needle.test(row)) return index + 1;
  }
  return -1;
}

export function approxTokens(text: string): number {
  return Math.max(8, Math.round(text.length / 4));
}

export function magicKeywords(prompt: string): string[] {
  const withoutFences = prompt.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ");
  return ["ultrathink", "orchestrate", "workflowz"].filter((keyword) =>
    new RegExp(`(^|[^\\w\\-./])${keyword}(?![\\w\\-./])`, "i").test(withoutFences),
  );
}
