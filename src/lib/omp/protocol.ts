/**
 * Wire types shared by the shell, the renderer and the agent transport.
 *
 * Mirrors the Hermes Desktop boundary split: the agent speaks JSON-RPC over a
 * WebSocket (`omp --mode rpc`), the renderer consumes normalized `AgentEvent`s,
 * and the shell never lets transport details leak into the panes.
 */

export type ModelRole =
  | "default"
  | "smol"
  | "slow"
  | "plan"
  | "commit"
  | "vision"
  | "task"
  | "advisor"
  | "tiny";

export const MODEL_ROLES: ModelRole[] = [
  "default",
  "smol",
  "slow",
  "plan",
  "commit",
  "vision",
  "task",
  "advisor",
  "tiny",
];

export interface ModelInfo {
  /** `provider/model-id` selector as omp writes it into config.yml. */
  selector: string;
  name: string;
  provider: string;
  api: ProviderApi;
  contextWindow: number;
  maxTokens: number;
  tags: string[];
  inputCostPerMTok: number;
  outputCostPerMTok: number;
}

export type ProviderApi =
  | "anthropic-messages"
  | "openai-completions"
  | "openai-responses"
  | "openai-codex-responses"
  | "azure-openai-responses"
  | "bedrock-converse-stream"
  | "google-generative-ai"
  | "google-gemini-cli"
  | "google-vertex"
  | "openrouter-decisions"
  | "typesafe";

export interface ProviderInfo {
  id: string;
  name: string;
  api: ProviderApi;
  auth: "api-key" | "oauth" | "plan" | "local" | "none";
  category: "frontier" | "coding-plan" | "local" | "custom";
  baseUrl?: string;
  envVar?: string;
  models: ModelInfo[];
}

export type ToolName =
  | "read"
  | "write"
  | "edit"
  | "ast_edit"
  | "ast_grep"
  | "grep"
  | "glob"
  | "bash"
  | "eval"
  | "lsp"
  | "debug"
  | "security_scan"
  | "task"
  | "wait"
  | "todo"
  | "ask"
  | "browser"
  | "computer"
  | "web_search"
  | "github"
  | "generate_image"
  | "tts"
  | "checkpoint"
  | "rewind"
  | "retain"
  | "recall"
  | "reflect"
  | "memory_edit"
  | "learn"
  | "manage_skill";

export interface ToolSpec {
  name: ToolName;
  group: "files" | "runtime" | "intelligence" | "coordination" | "desktop" | "memory";
  summary: string;
  destructive?: boolean;
  gated?: boolean;
  scheme?: string;
}

export interface HashAnchor {
  line: number;
  hash: string;
  text: string;
}

export interface DiffLine {
  type: "add" | "del" | "ctx";
  text: string;
  oldNo?: number;
  newNo?: number;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  before: string;
  after: string;
  hunks: DiffHunk[];
  added: number;
  removed: number;
  anchors: HashAnchor[];
  stale?: string;
}

export interface GrepHit {
  path: string;
  line: number;
  text: string;
}

export interface Diagnostic {
  path: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  source: string;
  code?: string;
}

export interface TodoItem {
  id: string;
  text: string;
  status: "pending" | "in_progress" | "completed";
  phase?: string;
}

export interface Subagent {
  id: string;
  name: string;
  task: string;
  status: "queued" | "running" | "parked" | "done" | "killed";
  toolCalls: number;
  tokens: number;
  costUsd: number;
  durationMs: number;
  findings: string[];
  transcript: TranscriptItem[];
  steering: string[];
  isolatedWorktree?: string;
}

export type ToolBlock =
  | { type: "text"; text: string }
  | { type: "code"; code: string; language?: string; caption?: string }
  | { type: "diff"; files: FileDiff[] }
  | { type: "hits"; hits: GrepHit[]; query: string }
  | { type: "paths"; paths: string[] }
  | { type: "diagnostics"; diagnostics: Diagnostic[]; server?: string }
  | { type: "subagents"; agents: Subagent[] }
  | { type: "todos"; items: TodoItem[] }
  | { type: "memory"; action: string; facts: string[] }
  | { type: "note"; tone: "info" | "warn" | "danger" | "ok"; title: string; body?: string }
  | { type: "terminal"; command: string; exitCode: number; stdout: string; stderr: string; cwd?: string };

export interface ToolCall {
  id: string;
  name: ToolName;
  /** Primary target, e.g. `src/leibniz.ts` or `pr://1428`. */
  target?: string;
  summary: string;
  status: "running" | "ok" | "error" | "proposed";
  startedAt: number;
  endedAt?: number;
  blocks: ToolBlock[];
  costUsd?: number;
  tokens?: number;
}

export interface AssistantNote {
  id: string;
  tone: "info" | "warn" | "danger";
  text: string;
}

export type TranscriptItem =
  | { kind: "user"; id: string; at: number; text: string; keywords: string[] }
  | {
      kind: "assistant";
      id: string;
      at: number;
      text: string;
      role: ModelRole;
      model: string;
      streaming?: boolean;
      notes?: AssistantNote[];
    }
  | { kind: "tool"; id: string; at: number; call: ToolCall }
  | { kind: "advisor"; id: string; at: number; severity: "note" | "concern" | "blocker"; role: ModelRole; model: string; text: string }
  | { kind: "rule"; id: string; at: number; rule: string; reason: string }
  | { kind: "system"; id: string; at: number; text: string; tone?: "info" | "warn" }
  | { kind: "error"; id: string; at: number; text: string; retryable?: boolean };

export type AgentMode = "plan" | "agent" | "auto" | "vibe";

export interface SessionUsage {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

export interface Session {
  id: string;
  title: string;
  /** `null` = detached bare chat (no project workspace). */
  projectId: string | null;
  model: string;
  role: ModelRole;
  mode: AgentMode;
  createdAt: number;
  updatedAt: number;
  status: "idle" | "running" | "aborted" | "error";
  transcript: TranscriptItem[];
  todos: TodoItem[];
  subagents: Subagent[];
  memoryFacts: string[];
  usage: SessionUsage;
  pinned?: boolean;
  worktree?: string;
}

export interface ProjectFolder {
  path: string;
  branch: string;
  kind: "primary" | "repo" | "worktree";
}

export interface Project {
  id: string;
  name: string;
  folders: ProjectFolder[];
  createdAt: number;
  defaultModel?: string;
}

/** Ordered resolution result reported by the shell for the boot overlay. */
export type RuntimeKind =
  | "bundled-payload"
  | "deployment-override"
  | "source-root-override"
  | "dev-checkout"
  | "managed-install"
  | "remote-gateway"
  | "cloud-gateway"
  | "browser-runtime";

export interface RuntimeCandidate {
  kind: RuntimeKind;
  label: string;
  detail: string;
  command?: string;
  version?: string;
  state: "pending" | "probing" | "ok" | "unusable" | "skipped";
  probe?: string;
}

export type ConnectionMode = "local" | "remote" | "cloud";

export interface ConnectionProfile {
  id: string;
  name: string;
  mode: ConnectionMode;
  url?: string;
  authMode: "none" | "token" | "oauth";
  /** Secrets are only ever marked as stored — never rendered back. */
  tokenStored?: boolean;
  headers?: { name: string; value: string }[];
  gatewayVersion?: string;
  capabilities?: GatewayCapabilities;
  lastLatencyMs?: number;
  createdAt: number;
}

export interface GatewayCapabilities {
  rpc: boolean;
  websocket: boolean;
  sessions: boolean;
  fileBrowser: boolean;
  lsp: boolean;
  debug: boolean;
  subagents: boolean;
  memory: boolean;
  browserRelay: boolean;
  computer: boolean;
  auth: "none" | "token" | "oauth";
}

export interface BootStage {
  id: string;
  label: string;
  detail?: string;
  state: "pending" | "active" | "done" | "failed" | "skipped";
}

export interface StreamRule {
  id: string;
  name: string;
  pattern: string;
  body: string;
  enabled: boolean;
  hits?: number;
}

export interface ProviderKeyState {
  providerId: string;
  stored: boolean;
  lastUsedAt?: number;
}

export interface DesktopSettings {
  theme: "dark" | "light";
  density: "compact" | "comfortable";
  transcriptFontSize: number;
  streamSpeed: "instant" | "fast" | "normal";
  modelRoles: Partial<Record<ModelRole, string>>;
  enabledModels: string[];
  advisor: { enabled: boolean; role: ModelRole; model?: string };
  memory: { backend: "local" | "hindsight" | "mnemopi"; projectScoped: boolean; autoload: boolean };
  tools: Record<string, { enabled: boolean; requiresApproval: boolean }>;
  streamRules: StreamRule[];
  providerKeys: ProviderKeyState[];
  customProviders: { id: string; baseUrl: string; api: ProviderApi; models: string[] }[];
  xdev: boolean;
  voice: boolean;
  browserRelay: boolean;
  shortcuts: Record<string, string>;
  telemetry: boolean;
  autoCompact: boolean;
}

export interface WorkspaceFile {
  path: string;
  content: string;
  updatedAt: number;
  dirty?: boolean;
}

export interface GitCommit {
  hash: string;
  subject: string;
  author: string;
  at: number;
}

export interface GitStatusEntry {
  path: string;
  status: "modified" | "added" | "deleted" | "untracked" | "conflicted";
}

/* ------------------------------------------------------------------ *
 * Transport frames
 * ------------------------------------------------------------------ */

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export type GatewayFrame = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

export interface AgentEventMeta {
  sessionId?: string;
  turnId?: string;
}

export type AgentEvent =
  | ({ type: "turn.started" } & AgentEventMeta)
  | ({ type: "text.delta"; text: string } & AgentEventMeta)
  | ({ type: "text.done"; text: string } & AgentEventMeta)
  | ({ type: "tool.started"; call: ToolCall } & AgentEventMeta)
  | ({ type: "tool.finished"; call: ToolCall } & AgentEventMeta)
  | ({ type: "advisor.note"; severity: "note" | "concern" | "blocker"; text: string; model: string } & AgentEventMeta)
  | ({ type: "rule.injected"; rule: string; reason: string } & AgentEventMeta)
  | ({ type: "todo.updated"; items: TodoItem[] } & AgentEventMeta)
  | ({ type: "subagent.updated"; agent: Subagent } & AgentEventMeta)
  | ({ type: "memory.updated"; facts: string[] } & AgentEventMeta)
  | ({ type: "usage"; usage: SessionUsage } & AgentEventMeta)
  | ({ type: "log"; level: "debug" | "info" | "warn" | "error"; text: string } & AgentEventMeta)
  | ({ type: "turn.finished"; reason: "stop" | "aborted" | "error"; error?: string } & AgentEventMeta);

export interface AgentTransport {
  readonly id: string;
  readonly label: string;
  readonly live: boolean;
  start(signal?: AbortSignal): Promise<void>;
  stop(): Promise<void>;
  createSession(input: { sessionId: string; projectId: string | null; model: string; mode: AgentMode; cwd: string }): Promise<void>;
  send(sessionId: string, prompt: string, signal: AbortSignal): AsyncIterable<AgentEvent>;
  answerAsk?(sessionId: string, askId: string, answer: string): Promise<void>;
}
