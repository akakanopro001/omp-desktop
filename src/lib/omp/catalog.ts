import type { ModelInfo, ModelRole, ProviderInfo, StreamRule, ToolSpec } from "./protocol";

/**
 * The catalog is the renderer's copy of what the agent runtime publishes over
 * RPC (`omp models`, `omp tools`, `/help`). It is data-only so the settings
 * overlay can render providers, roles, tools and rules while the gateway is
 * still booting.
 */

function model(
  selector: string,
  name: string,
  provider: string,
  contextWindow: number,
  maxTokens: number,
  tags: string[],
  inCost: number,
  outCost: number,
): ModelInfo {
  return {
    selector,
    name,
    provider,
    api: providerApiFor(provider),
    contextWindow,
    maxTokens,
    tags,
    inputCostPerMTok: inCost,
    outputCostPerMTok: outCost,
  };
}

function providerApiFor(provider: string): ModelInfo["api"] {
  switch (provider) {
    case "anthropic":
      return "anthropic-messages";
    case "google":
      return "google-generative-ai";
    case "bedrock":
      return "bedrock-converse-stream";
    case "vertex":
      return "google-vertex";
    case "codex":
      return "openai-codex-responses";
    default:
      return "openai-completions";
  }
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    api: "anthropic-messages",
    auth: "oauth",
    category: "frontier",
    envVar: "ANTHROPIC_API_KEY",
    models: [
      model("anthropic/opus-4.6-1m", "Opus 4.6 (1M)", "anthropic", 1_000_000, 64_000, ["reasoning", "long-context"], 5, 25),
      model("anthropic/sonnet-4.7", "Sonnet 4.7", "anthropic", 200_000, 64_000, ["balanced"], 3, 15),
      model("anthropic/haiku-4.6", "Haiku 4.6", "anthropic", 200_000, 32_000, ["fast", "smol"], 0.8, 4),
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    api: "openai-responses",
    auth: "api-key",
    category: "frontier",
    envVar: "OPENAI_API_KEY",
    models: [
      model("openai/gpt-5.5", "GPT-5.5", "openai", 400_000, 128_000, ["reasoning"], 1.25, 10),
      model("openai/gpt-5.5-mini", "GPT-5.5 mini", "openai", 400_000, 64_000, ["fast", "smol"], 0.25, 2),
    ],
  },
  {
    id: "codex",
    name: "OpenAI Codex",
    api: "openai-codex-responses",
    auth: "oauth",
    category: "coding-plan",
    models: [model("openai-codex/gpt-5.5", "GPT-5.5 (Codex)", "codex", 400_000, 128_000, ["coding-plan"], 0, 0)],
  },
  {
    id: "google",
    name: "Google Gemini",
    api: "google-generative-ai",
    auth: "api-key",
    category: "frontier",
    envVar: "GEMINI_API_KEY",
    models: [
      model("google/gemini-3-pro", "Gemini 3 Pro", "google", 1_000_000, 65_000, ["long-context", "vision"], 1.25, 10),
      model("google/gemini-3-flash", "Gemini 3 Flash", "google", 1_000_000, 65_000, ["fast", "vision"], 0.3, 2.5),
    ],
  },
  {
    id: "xai",
    name: "xAI",
    api: "openai-completions",
    auth: "api-key",
    category: "frontier",
    envVar: "XAI_API_KEY",
    models: [
      model("xai/grok-5", "Grok 5", "xai", 512_000, 64_000, ["reasoning"], 3, 15),
      model("xai/grok-4-fast", "Grok 4 Fast", "xai", 2_000_000, 32_000, ["fast", "smol"], 0.2, 0.5),
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    api: "openai-completions",
    auth: "api-key",
    category: "frontier",
    envVar: "DEEPSEEK_API_KEY",
    models: [model("deepseek/deepseek-v4", "DeepSeek V4", "deepseek", 256_000, 32_000, ["cheap"], 0.28, 1.1)],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    api: "openai-completions",
    auth: "api-key",
    category: "frontier",
    envVar: "OPENROUTER_API_KEY",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [
      model("openrouter/sonoma-sky", "Sonoma Sky", "openrouter", 400_000, 64_000, ["gateway"], 1, 4),
      model("openrouter/auto", "Auto router", "openrouter", 200_000, 32_000, ["gateway", "smol"], 0.5, 2),
    ],
  },
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    api: "openai-completions",
    auth: "oauth",
    category: "coding-plan",
    models: [model("github-copilot/gpt-5.5", "Copilot GPT-5.5", "github-copilot", 128_000, 32_000, ["coding-plan"], 0, 0)],
  },
  {
    id: "zai",
    name: "Z.AI / GLM Coding Plan",
    api: "openai-completions",
    auth: "plan",
    category: "coding-plan",
    models: [model("zai/glm-5-coding", "GLM-5 Coding", "zai", 200_000, 64_000, ["coding-plan", "cheap"], 0, 0)],
  },
  {
    id: "ollama",
    name: "Ollama",
    api: "openai-completions",
    auth: "local",
    category: "local",
    baseUrl: "http://127.0.0.1:11434/v1",
    models: [
      model("ollama/qwen3-coder:32b", "Qwen3 Coder 32B", "ollama", 128_000, 16_000, ["local", "smol"], 0, 0),
      model("ollama/devstral:24b", "Devstral 24B", "ollama", 128_000, 16_000, ["local", "smol"], 0, 0),
    ],
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    api: "openai-completions",
    auth: "local",
    category: "local",
    baseUrl: "http://127.0.0.1:1234/v1",
    models: [model("lmstudio/gpt-oss-120b", "GPT-OSS 120B", "lmstudio", 131_072, 16_000, ["local"], 0, 0)],
  },
];

export const DEFAULT_MODEL = "anthropic/opus-4.6-1m";

export const DEFAULT_ROLE_MODELS: Record<ModelRole, string> = {
  default: "anthropic/opus-4.6-1m",
  smol: "xai/grok-4-fast",
  slow: "anthropic/opus-4.6-1m",
  plan: "google/gemini-3-pro",
  commit: "anthropic/haiku-4.6",
  vision: "google/gemini-3-pro",
  task: "anthropic/sonnet-4.7",
  advisor: "openai/gpt-5.5",
  tiny: "openai/gpt-5.5-mini",
};

export const ALL_MODELS: ModelInfo[] = PROVIDERS.flatMap((provider) => provider.models);

export function findModel(selector: string): ModelInfo | undefined {
  return ALL_MODELS.find((candidate) => candidate.selector === selector);
}

export function modelLabel(selector: string): string {
  return findModel(selector)?.name ?? selector;
}

export const TOOL_SPECS: ToolSpec[] = [
  { name: "read", group: "files", summary: "Read files, dirs, archives, SQLite, PDFs, URLs and omp:// schemes through one path." },
  { name: "write", group: "files", summary: "Create or overwrite a file, archive entry or SQLite row.", destructive: true },
  { name: "edit", group: "files", summary: "Hashline patches with content-hash anchors and stale-anchor recovery.", destructive: true },
  { name: "ast_edit", group: "files", summary: "Structural rewrites previewed before apply (ast-grep).", destructive: true },
  { name: "ast_grep", group: "files", summary: "Structural code queries across tree-sitter grammars." },
  { name: "grep", group: "files", summary: "Regex over files, globs, diffs and internal URL schemes." },
  { name: "glob", group: "files", summary: "Glob-based path lookup." },
  { name: "bash", group: "runtime", summary: "Workspace shell — in-process coreutils, survive-across-calls sessions, optional PTY.", destructive: true },
  { name: "eval", group: "runtime", summary: "Persistent Python and JavaScript cells with tool re-entry.", destructive: true },
  { name: "lsp", group: "intelligence", summary: "Diagnostics, navigation, symbols, renames, code actions and raw requests." },
  { name: "debug", group: "intelligence", summary: "Drive a DAP session — breakpoints, stepping, threads, stack, variables.", destructive: true },
  { name: "security_scan", group: "intelligence", summary: "Plan and run native security reviews.", gated: true },
  { name: "task", group: "coordination", summary: "Fan out subagents in parallel, optionally workspace-isolated." },
  { name: "wait", group: "coordination", summary: "Block until the next background result, peer message or steering interrupt." },
  { name: "todo", group: "coordination", summary: "Ordered mutations over the session todo list with phase tracking." },
  { name: "ask", group: "coordination", summary: "Structured follow-up questions for interactive runs." },
  { name: "browser", group: "desktop", summary: "Puppeteer tabs over headless Chromium, CDP-attached apps, or your own Chrome via the relay.", destructive: true },
  { name: "computer", group: "desktop", summary: "Persistent JS against the host desktop: windows, screenshots, native input, AX tree, clipboard.", destructive: true },
  { name: "web_search", group: "desktop", summary: "One query across configured providers, returning answer plus citations." },
  { name: "github", group: "desktop", summary: "GitHub CLI ops — repo, PR, issues, code search, Actions run-watch.", gated: true },
  { name: "generate_image", group: "desktop", summary: "Generate or edit raster images.", gated: true },
  { name: "tts", group: "desktop", summary: "Text-to-speech with five built-in voices, WAV or MP3.", gated: true },
  { name: "checkpoint", group: "memory", summary: "Mark conversation state for a later collapse-and-report.", gated: true },
  { name: "rewind", group: "memory", summary: "Prune exploratory context, keep a concise report.", gated: true },
  { name: "retain", group: "memory", summary: "Queue durable facts into the active memory bank.", gated: true },
  { name: "recall", group: "memory", summary: "Search the memory bank for raw memories.", gated: true },
  { name: "reflect", group: "memory", summary: "Synthesize an answer over the memory bank.", gated: true },
  { name: "memory_edit", group: "memory", summary: "Update, forget or invalidate stored memories by id.", gated: true },
  { name: "learn", group: "memory", summary: "Capture a reusable lesson; optionally promote it into a managed skill." },
  { name: "manage_skill", group: "memory", summary: "Create, update or delete an isolated managed skill." },
];

export const DEFAULT_DISABLED_TOOLS = ["github", "security_scan", "generate_image", "tts", "checkpoint", "rewind"];

export const SLASH_COMMANDS: { command: string; summary: string; group: string }[] = [
  { command: "/model", summary: "Swap the active model mid-session, or assign a model to a role.", group: "models" },
  { command: "/login", summary: "Attach a provider account to the running session; /logout detaches it.", group: "models" },
  { command: "/fast", summary: "Toggle fast mode on the active model.", group: "models" },
  { command: "/slow", summary: "Toggle slow (deep reasoning) mode on the active model.", group: "models" },
  { command: "/thinking", summary: "Set or cycle the thinking effort level.", group: "models" },
  { command: "/vision", summary: "Point the vision role at another model.", group: "models" },
  { command: "/advisor", summary: "Pair a reviewer model that reads every turn and injects notes inline.", group: "review" },
  { command: "/review", summary: "Spawn reviewer subagents; issues ranked P0–P3 with a ship verdict.", group: "review" },
  { command: "/annotate", summary: "Pin notes to lines, a reply, a file or quoted text before the next prompt.", group: "review" },
  { command: "/security", summary: "Plan and run native security reviews, then read the findings.", group: "review" },
  { command: "/plan", summary: "Enter plan mode — read-only investigation, a written proposal, no writes.", group: "workflow" },
  { command: "/plan-review", summary: "Re-read the active plan with the reviewer subagents before you approve it.", group: "workflow" },
  { command: "/vibe", summary: "Enter Vibe mode — direct persistent workers with a read-only toolset.", group: "workflow" },
  { command: "/goal", summary: "Create, resume, pause or drop a goal with a token budget.", group: "workflow" },
  { command: "/guided-goal", summary: "Run a goal step by step, confirming each phase with you.", group: "workflow" },
  { command: "/loop", summary: "Repeat a prompt or command on an interval.", group: "workflow" },
  { command: "/collab", summary: "Put the live session on a relay and hand back a link and QR.", group: "session" },
  { command: "/fresh", summary: "Reset provider stream state (stale cache, wedged stream) without touching the transcript.", group: "session" },
  { command: "/new", summary: "Start a new session; /clear clears the transcript of this one.", group: "session" },
  { command: "/compact", summary: "Collapse the transcript into a summarized mental model.", group: "session" },
  { command: "/shake", summary: "Local reduction: replace eligible tool results with recoverable artifact:// references.", group: "session" },
  { command: "/resume", summary: "Resume a recent session by id or from a picker.", group: "session" },
  { command: "/fork", summary: "Branch the transcript so an experiment cannot touch the main line.", group: "session" },
  { command: "/tree", summary: "Show the session tree with its branches.", group: "session" },
  { command: "/handoff", summary: "Generate a handoff document for the next session.", group: "session" },
  { command: "/export", summary: "Write the session out; /import reads one back in.", group: "session" },
  { command: "/share", summary: "Share the transcript as a link.", group: "session" },
  { command: "/btw", summary: "Ask a side question on the live context without disturbing the main turn.", group: "session" },
  { command: "/todo", summary: "Show or edit the session todo list.", group: "session" },
  { command: "/tools", summary: "Pin the active tool set for this session.", group: "session" },
  { command: "/schemes", summary: "List the internal schemes (pr://, issue://, agent:// …) readable by every FS tool.", group: "session" },
  { command: "/context", summary: "Show what is in context: files, rules, memory and their token cost.", group: "session" },
  { command: "/usage", summary: "Token and cost usage for this session.", group: "session" },
  { command: "/stats", summary: "Session statistics: turns, tools, spend, timings.", group: "session" },
  { command: "/jobs", summary: "Background jobs and project services; read proc:// for the same view.", group: "jobs" },
  { command: "/agents", summary: "Bundled task agents and the rosters subagents are drawn from.", group: "jobs" },
  { command: "/hub", summary: "Agent Hub: live transcript, steer, revive or kill a subagent.", group: "jobs" },
  { command: "/memory", summary: "Inspect the memory bank, backend and project scope.", group: "resources" },
  { command: "/skills", summary: "List, search, install or update managed skills.", group: "resources" },
  { command: "/mcp", summary: "Manage MCP servers and the tools they contribute.", group: "resources" },
  { command: "/plugins", summary: "Enable, disable or reload plugins.", group: "resources" },
  { command: "/marketplace", summary: "Discover and install marketplace content.", group: "resources" },
  { command: "/extensions", summary: "Loaded extensions and what each one contributes.", group: "resources" },
  { command: "/ssh", summary: "Manage ssh:// hosts used as remote paths.", group: "resources" },
  { command: "/dirs", summary: "Extra working directories for this session.", group: "resources" },
  { command: "/git", summary: "Working tree status, branches and the commits behind them.", group: "resources" },
  { command: "/hotkeys", summary: "Show the active keybindings.", group: "help" },
  { command: "/changelog", summary: "What changed in this version of the agent.", group: "help" },
  { command: "/help", summary: "Show every session control and magic keyword.", group: "help" },
];

export const MAGIC_KEYWORDS: { keyword: string; summary: string }[] = [
  { keyword: "ultrathink", summary: "Request careful multi-step reasoning at the highest supported thinking effort." },
  { keyword: "orchestrate", summary: "Run substantial independent work through parallel subagents, verifying each phase." },
  { keyword: "workflowz", summary: "Build a deterministic multi-subagent workflow with the active task tool." },
];

/**
 * Every internal scheme the FS-shaped tools resolve, in the order upstream
 * documents them. `read`, `grep`, `glob` and `write` accept these wherever they
 * accept a path, so a PR, a subagent's findings, a merge conflict and a skill
 * file are all just files.
 */
export const INTERNAL_SCHEMES = [
  "pr://",
  "issue://",
  "agent://",
  "skill://",
  "ssh://",
  "conflict://",
  "xd://",
  "proc://",
  "memory://",
  "rule://",
  "artifact://",
  "attachment://",
  "cfg://",
  "history://",
  "mcp://",
  "omp://",
  "vault://",
  "security://",
  "local://",
];

export const SCHEME_SPECS: { scheme: string; name: string; detail: string; writable: boolean }[] = [
  { scheme: "pr://", name: "Pull requests", detail: "`read pr://1428` returns the same shape as a file read; `grep` walks a diff like a directory.", writable: false },
  { scheme: "issue://", name: "Issues", detail: "Issue bodies, comments and labels through the read path.", writable: false },
  { scheme: "agent://", name: "Subagents", detail: "`agent://<id>/findings.0.path` pulls a field out of a subagent's typed result; `write agent://<id>` steers it, `agent://all` broadcasts.", writable: true },
  { scheme: "skill://", name: "Skills", detail: "Read and author managed skills in place.", writable: true },
  { scheme: "ssh://", name: "Remote paths", detail: "Read, grep and edit on another host as if it were mounted.", writable: true },
  { scheme: "conflict://", name: "Merge conflicts", detail: "Each conflict is one URL. Write @theirs, @ours or @base to conflict://N — or bulk-conflict://*.", writable: true },
  { scheme: "xd://", name: "Discoverable tools", detail: "`read xd://` lists rarely used tools; `write xd://<tool>` runs one. `write xd://resolve` accepts a staged ast_edit, `xd://reject` drops it.", writable: true },
  { scheme: "proc://", name: "Background jobs", detail: "`read proc://` lists jobs and project services; `write proc://<name>` sends input, `proc://<name>/kill` stops one.", writable: true },
  { scheme: "memory://", name: "Memory bank", detail: "The curated memory files the agent keeps between sessions.", writable: true },
  { scheme: "rule://", name: "Rules", detail: "Every discovered rule, including ones inherited from other tools' config formats.", writable: false },
  { scheme: "artifact://", name: "Artifacts", detail: "Full output captured outside the transcript when a tool result was truncated.", writable: false },
  { scheme: "attachment://", name: "Attachments", detail: "Images and files attached to a session message.", writable: false },
  { scheme: "cfg://", name: "Settings", detail: "Read and write configuration entries with the same edit tools.", writable: true },
  { scheme: "history://", name: "Session history", detail: "`history://<id>` is a concise transcript for a live, parked or retained subagent; `history://current/full:1-200` walks the main transcript.", writable: false },
  { scheme: "mcp://", name: "MCP servers", detail: "Servers and the tools they contribute, reconciled against the active tool policy.", writable: false },
  { scheme: "omp://", name: "Runtime", detail: "Runtime introspection — sessions, providers, models, capabilities.", writable: false },
  { scheme: "vault://", name: "Secrets", detail: "The credential vault, referenced by name so keys never enter a transcript.", writable: true },
  { scheme: "security://", name: "Security scans", detail: "Scan plans and findings from the security_scan tool.", writable: false },
  { scheme: "local://", name: "Session root", detail: "The calling session's own root, used by external tool bridges.", writable: true },
];

export const MEMORY_BACKENDS = [
  { id: "local", name: "Local", detail: "Project-scoped SQLite bank on this machine." },
  { id: "hindsight", name: "Hindsight", detail: "Self-hosted service with the same recall surface." },
  { id: "mnemopi", name: "Mnemopi", detail: "Managed bank with shared team scope." },
] as const;

export const SKILLS = [
  {
    id: "hashline-patch",
    name: "hashline-patch",
    summary: "Always prefer anchored hashline edits over retyping lines; verify anchors before apply.",
    source: "learned",
    uses: 34,
  },
  {
    id: "bun-test-loop",
    name: "bun-test-loop",
    summary: "Run the narrowest failing test first, then widen to the suite before reporting done.",
    source: "learned",
    uses: 12,
  },
  {
    id: "aggressive-search",
    name: "aggressive-search",
    summary: "Before writing a helper, grep the workspace for an existing one and reuse it.",
    source: "bundled",
    uses: 51,
  },
  {
    id: "pi-accuracy",
    name: "pi-accuracy",
    summary: "Never edit a test expectation to make a suite pass — fix the estimator instead.",
    source: "managed",
    uses: 9,
    managed: true,
  },
];

export const DEFAULT_STREAM_RULES: StreamRule[] = [
  {
    id: "rule-debug-log",
    name: "debug-log-leftovers",
    pattern: "console\\.(log|debug|info)\\(",
    body: "Debug logging stays out of src/**. Route printed values through src/format.ts instead of leaving a log behind.",
    enabled: true,
    hits: 0,
  },
  {
    id: "rule-box-leak",
    name: "box-leak",
    pattern: "Box::leak|\\bprocess\\.exit\\(",
    body: "Don't reach for process-level escape hatches in production code paths — solve it in the call site.",
    enabled: true,
    hits: 1,
  },
  {
    id: "rule-test-expect",
    name: "test-expectations",
    pattern: "expect\\([^)]*\\)\\.toBe\\([^)]*\\)\\s*;?\\s*//\\s*(fix|relax|loosen)",
    body: "Never relax an assertion to make a suite pass. Fix the implementation, or ask before changing the contract.",
    enabled: true,
    hits: 2,
  },
  {
    id: "rule-lockfile",
    name: "lockfiles",
    pattern: "\\.lockb?$|\\.lockb$",
    body: "Lockfiles are excluded from analysis — edit package.json and let the package manager rewrite the lock.",
    enabled: false,
    hits: 0,
  },
];

export const DEFAULT_SHORTCUTS: Record<string, string> = {
  "composer.submit": "Enter",
  "composer.newline": "Shift+Enter",
  "composer.abort": "Esc",
  "palette.open": "Cmd/Ctrl+K",
  "session.new": "Cmd/Ctrl+N",
  "session.fresh": "Cmd/Ctrl+Shift+R",
  "settings.open": "Cmd/Ctrl+,",
  "hub.toggle": "Alt+A",
  "preview.toggle": "Cmd/Ctrl+\\",
  "model.cycle": "Ctrl+P",
  "files.toggle": "Cmd/Ctrl+Shift+E",
  "collab.share": "Cmd/Ctrl+Shift+C",
  "screenshot.capture": "Cmd+.",
};

export const AGENT_MODES: { id: "plan" | "agent" | "auto" | "vibe"; name: string; detail: string }[] = [
  { id: "plan", name: "Plan", detail: "Read-only investigation. The agent proposes, never writes." },
  { id: "agent", name: "Agent", detail: "Reads and writes. Destructive tools pause for approval." },
  { id: "auto", name: "Auto", detail: "Reads and writes without pausing. Use inside a trusted workspace." },
  { id: "vibe", name: "Vibe", detail: "Director mode — drive persistent workers with a read-only toolset." },
];

/**
 * The four ways into the same agent. The desktop shell drives RPC, can fire a
 * one-shot request, and hands interactive/ACP off to whatever host you like.
 */
export const ENTRY_POINTS: { id: string; name: string; command: string; detail: string }[] = [
  { id: "interactive", name: "Interactive", command: "omp", detail: "The full-screen session: streaming transcript, live tool cards, keyboard-driven." },
  { id: "oneshot", name: "One-shot", command: "omp -p \"<prompt>\" --mode text", detail: "Processes the prompt non-interactively and exits — `--mode json` streams events instead." },
  { id: "rpc", name: "RPC over stdio", command: "omp --mode rpc [--no-ui]", detail: "Line-delimited JSON commands, responses and events. This is what the desktop shell speaks." },
  { id: "acp", name: "ACP", command: "omp acp  ·  omp --mode acp", detail: "Agent Client Protocol server over stdio — run omp inside Zed and it reads the buffer you are looking at." },
];

/**
 * Discovery providers: every other tool's config format omp reads in its native
 * shape. Nothing is migrated and nothing is a "supported subset".
 */
export const DISCOVERY_PROVIDERS: { id: string; name: string; priority: number; paths: string; contributes: string }[] = [
  { id: "native", name: "Native .omp", priority: 100, paths: "~/.omp/agent/AGENTS.md · <cwd>/.omp/AGENTS.md · RULES.md", contributes: "context + sticky rules" },
  { id: "omp-plugins", name: "OMP plugins", priority: 90, paths: ".omp/plugins", contributes: "skills, commands, rules, hooks, tools, MCP" },
  { id: "claude", name: "Claude Code", priority: 80, paths: "~/.claude/CLAUDE.md · <cwd>/.claude/CLAUDE.md", contributes: "context, skills, commands, hooks" },
  { id: "agent-plugins", name: "Agent Plugins", priority: 75, paths: "plugin packages", contributes: "skills, MCP servers" },
  { id: "codex", name: "Codex", priority: 70, paths: "~/.codex/AGENTS.md", contributes: "context" },
  { id: "agents", name: "Google Antigravity", priority: 70, paths: "~/.agent/AGENTS.md · ~/.agents/AGENTS.md", contributes: "context" },
  { id: "claude-plugins", name: "Claude marketplace", priority: 70, paths: "Claude marketplace cache", contributes: "skills, commands, rules, hooks, tools, MCP" },
  { id: "gemini", name: "Gemini CLI", priority: 60, paths: "~/.gemini/GEMINI.md · <cwd>/.gemini/GEMINI.md", contributes: "context" },
  { id: "opencode", name: "OpenCode", priority: 55, paths: "~/.config/opencode/AGENTS.md", contributes: "context" },
  { id: "cursor", name: "Cursor", priority: 50, paths: ".cursor/rules/*.mdc · legacy .cursorrules", contributes: "rules (MDC frontmatter), MCP, settings" },
  { id: "windsurf", name: "Windsurf", priority: 50, paths: ".windsurf/rules/*.md · legacy .windsurfrules", contributes: "rules, MCP" },
  { id: "cline", name: "Cline", priority: 40, paths: ".clinerules", contributes: "rules" },
  { id: "github", name: "GitHub Copilot", priority: 35, paths: ".github/copilot-instructions.md · .github/instructions/**/*.instructions.md", contributes: "context, rules with applyTo globs" },
  { id: "agents-md", name: "AGENTS.md", priority: 30, paths: "AGENTS.md walking up to the repository root", contributes: "context" },
  { id: "claude-md", name: "CLAUDE.md", priority: 30, paths: "CLAUDE.md walking up to the repository root", contributes: "context" },
  { id: "vscode", name: "VS Code", priority: 25, paths: ".vscode/mcp.json", contributes: "MCP servers" },
  { id: "mcp-json", name: "MCP JSON", priority: 25, paths: ".mcp.json · ~/.config/mcp", contributes: "MCP servers" },
  { id: "ssh-json", name: "SSH config", priority: 20, paths: "~/.ssh/config", contributes: "ssh:// hosts" },
  { id: "builtin-defaults", name: "Built-in defaults", priority: 0, paths: "shipped with the agent", contributes: "default rules (overridable)" },
];

/** web_search chains these in rank order and hands whatever URLs it finds to read. */
export const SEARCH_BACKENDS = [
  "perplexity",
  "exa",
  "tavily",
  "parallel",
  "jina",
  "firecrawl",
  "kagi",
  "brave",
  "google",
  "duckduckgo",
  "startpage",
  "ecosia",
  "mojeek",
  "searxng",
  "public",
  "kimi",
  "zai",
  "synthetic",
  "tinyfish",
  "anthropic",
  "openai",
  "codex",
  "gemini",
  "ollama",
  "openrouter",
  "xai",
  "none",
] as const;

/**
 * Model providers omp can sign into. Nine roles route work by intent across
 * whichever of these you have attached; the desktop's provider panel and the
 * landing page both render this directory.
 */
export const PROVIDER_DIRECTORY: { id: string; name: string; auth: "api-key" | "oauth" | "plan" | "local"; family: "frontier" | "coding-plan" | "self-hosted"; note?: string }[] = [
  { id: "anthropic", name: "Anthropic", auth: "oauth", family: "frontier" },
  { id: "openai", name: "OpenAI", auth: "api-key", family: "frontier" },
  { id: "codex", name: "OpenAI Codex", auth: "oauth", family: "frontier" },
  { id: "google", name: "Google Gemini", auth: "api-key", family: "frontier" },
  { id: "vertex", name: "Google Vertex", auth: "api-key", family: "frontier" },
  { id: "antigravity", name: "Google Antigravity", auth: "oauth", family: "frontier" },
  { id: "xai", name: "xAI", auth: "api-key", family: "frontier" },
  { id: "supergrok", name: "SuperGrok", auth: "oauth", family: "frontier" },
  { id: "deepseek", name: "DeepSeek", auth: "api-key", family: "frontier" },
  { id: "mistral", name: "Mistral", auth: "api-key", family: "frontier" },
  { id: "groq", name: "Groq", auth: "api-key", family: "frontier" },
  { id: "cerebras", name: "Cerebras", auth: "api-key", family: "frontier" },
  { id: "fireworks", name: "Fireworks", auth: "api-key", family: "frontier" },
  { id: "together", name: "Together", auth: "api-key", family: "frontier" },
  { id: "baseten", name: "Baseten", auth: "api-key", family: "frontier" },
  { id: "deepinfra", name: "DeepInfra", auth: "api-key", family: "frontier" },
  { id: "huggingface", name: "Hugging Face", auth: "api-key", family: "frontier" },
  { id: "nvidia", name: "NVIDIA", auth: "api-key", family: "frontier" },
  { id: "meta", name: "Meta", auth: "api-key", family: "frontier" },
  { id: "bedrock", name: "Amazon Bedrock", auth: "api-key", family: "frontier" },
  { id: "azure", name: "Azure OpenAI", auth: "api-key", family: "frontier" },
  { id: "siliconflow", name: "SiliconFlow", auth: "api-key", family: "frontier" },
  { id: "gmlicloud", name: "GMI Cloud", auth: "api-key", family: "frontier" },
  { id: "coreweave", name: "CoreWeave", auth: "api-key", family: "frontier" },
  { id: "sakana", name: "Sakana AI", auth: "api-key", family: "frontier" },
  { id: "commandcode", name: "Command Code", auth: "api-key", family: "frontier" },
  { id: "charm-hyper", name: "Charm Hyper", auth: "api-key", family: "frontier" },
  { id: "stepfun", name: "StepFun", auth: "api-key", family: "frontier" },
  { id: "helmcode", name: "Helmcode", auth: "api-key", family: "frontier" },
  { id: "openrouter", name: "OpenRouter", auth: "api-key", family: "frontier" },
  { id: "synthetic", name: "Synthetic", auth: "api-key", family: "frontier" },
  { id: "vercel-gateway", name: "Vercel AI Gateway", auth: "api-key", family: "frontier" },
  { id: "cloudflare-gateway", name: "Cloudflare AI Gateway", auth: "api-key", family: "frontier" },
  { id: "wafer", name: "Wafer Serverless", auth: "api-key", family: "frontier" },
  { id: "cursor", name: "Cursor", auth: "oauth", family: "coding-plan" },
  { id: "github-copilot", name: "GitHub Copilot", auth: "oauth", family: "coding-plan" },
  { id: "gitlab-duo", name: "GitLab Duo", auth: "api-key", family: "coding-plan" },
  { id: "devin", name: "Devin", auth: "oauth", family: "coding-plan" },
  { id: "kimi-code", name: "Kimi Code", auth: "plan", family: "coding-plan" },
  { id: "moonshot", name: "Moonshot", auth: "api-key", family: "coding-plan" },
  { id: "minimax-plan", name: "MiniMax Coding Plan", auth: "plan", family: "coding-plan" },
  { id: "minimax-cn", name: "MiniMax Coding Plan CN", auth: "plan", family: "coding-plan" },
  { id: "alibaba-plan", name: "Alibaba Coding Plan", auth: "plan", family: "coding-plan" },
  { id: "qwen-portal", name: "Qwen Portal", auth: "oauth", family: "coding-plan" },
  { id: "zai", name: "Z.AI / GLM Coding Plan", auth: "plan", family: "coding-plan" },
  { id: "zhipu", name: "Zhipu Coding Plan", auth: "plan", family: "coding-plan" },
  { id: "xiaomi-mimo", name: "Xiaomi MiMo", auth: "api-key", family: "coding-plan" },
  { id: "qianfan", name: "Qianfan", auth: "api-key", family: "coding-plan" },
  { id: "umans", name: "Umans", auth: "plan", family: "coding-plan" },
  { id: "nanogpt", name: "NanoGPT", auth: "api-key", family: "coding-plan" },
  { id: "novita", name: "Novita", auth: "api-key", family: "coding-plan" },
  { id: "venice", name: "Venice", auth: "api-key", family: "coding-plan" },
  { id: "kilo", name: "Kilo", auth: "api-key", family: "coding-plan" },
  { id: "zenmux", name: "ZenMux", auth: "api-key", family: "coding-plan" },
  { id: "opencode-go", name: "OpenCode Go", auth: "api-key", family: "coding-plan" },
  { id: "opencode-zen", name: "OpenCode Zen", auth: "api-key", family: "coding-plan" },
  { id: "ollama", name: "Ollama", auth: "local", family: "self-hosted", note: "key optional" },
  { id: "ollama-cloud", name: "Ollama Cloud", auth: "api-key", family: "self-hosted" },
  { id: "lmstudio", name: "LM Studio", auth: "local", family: "self-hosted", note: "key optional" },
  { id: "llama-cpp", name: "llama.cpp", auth: "local", family: "self-hosted", note: "key optional" },
  { id: "vllm", name: "vLLM", auth: "local", family: "self-hosted", note: "key optional" },
  { id: "litellm", name: "LiteLLM", auth: "local", family: "self-hosted" },
];

/** The nine roles, and what each one is routed to. */
export const ROLE_SPECS: { role: ModelRole; name: string; detail: string; override?: string }[] = [
  { role: "default", name: "default", detail: "Normal turns." },
  { role: "smol", name: "smol", detail: "Cheap subagent fan-out.", override: "--smol" },
  { role: "slow", name: "slow", detail: "Deep reasoning when latency does not matter.", override: "--slow" },
  { role: "plan", name: "plan", detail: "Plan mode: proposals, no writes.", override: "--plan" },
  { role: "commit", name: "commit", detail: "Changelogs and commit messages." },
  { role: "vision", name: "vision", detail: "Screenshots, images and PDF pages." },
  { role: "task", name: "task", detail: "Subagents spawned by the task tool." },
  { role: "advisor", name: "advisor", detail: "The second model reviewing every turn." },
  { role: "tiny", name: "tiny", detail: "Titles, summaries and other small calls." },
];

/** Text-to-speech voices bundled for the tts tool (xAI Grok Voice). */
export const TTS_VOICES = ["ara", "eve", "leo", "rex", "sal"] as const;

/** Tools held back by default until the matching setting is enabled. */
export const GATED_TOOL_NOTE =
  "github, security_scan, generate_image, tts, checkpoint and rewind are off by default, and the memory tools follow memory.backend.";

/** The sticky rules file, and why it beats a normal context file. */
export const STICKY_RULES_NOTE =
  "RULES.md at the top of the repo becomes an always-apply rule whose full body rides every request — it keeps its hold after the visible conversation grows.";
