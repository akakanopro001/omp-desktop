import {
  DEFAULT_DISABLED_TOOLS,
  DEFAULT_ROLE_MODELS,
  DEFAULT_SHORTCUTS,
  DEFAULT_STREAM_RULES,
  ALL_MODELS,
  PROVIDERS,
  DEFAULT_MODEL,
} from "./catalog";
import type {
  ConnectionProfile,
  DesktopSettings,
  ModelRole,
  Project,
  Session,
  TodoItem,
  ToolName,
  TranscriptItem,
} from "./protocol";
import { PRIMARY_FOLDER, SECONDARY_FOLDER } from "./vfs";

const DESTRUCTIVE: ToolName[] = ["write", "edit", "ast_edit", "bash", "eval", "debug", "browser", "computer"];

export function defaultSettings(): DesktopSettings {
  const tools: DesktopSettings["tools"] = {};
  for (const name of [...DESTRUCTIVE, ...extraToolNames()]) {
    tools[name] = { enabled: !DEFAULT_DISABLED_TOOLS.includes(name), requiresApproval: DESTRUCTIVE.includes(name) };
  }
  return {
    theme: "dark",
    density: "compact",
    transcriptFontSize: 13.5,
    streamSpeed: "fast",
    modelRoles: { ...DEFAULT_ROLE_MODELS },
    enabledModels: ALL_MODELS.map((model) => model.selector),
    advisor: { enabled: true, role: "advisor" as ModelRole, model: DEFAULT_ROLE_MODELS.advisor },
    memory: { backend: "local", projectScoped: true, autoload: true },
    tools,
    streamRules: DEFAULT_STREAM_RULES.map((rule) => ({ ...rule })),
    providerKeys: PROVIDERS.filter((provider) => provider.auth === "api-key").map((provider) => ({
      providerId: provider.id,
      stored: provider.id === "anthropic" || provider.id === "openai",
    })),
    customProviders: [
      {
        id: "spark",
        baseUrl: "http://192.168.10.223:8000/v1",
        api: "openai-completions",
        models: ["minimax-m3"],
      },
    ],
    xdev: true,
    voice: false,
    browserRelay: false,
    shortcuts: { ...DEFAULT_SHORTCUTS },
    telemetry: false,
    autoCompact: true,
  };
}

function extraToolNames(): ToolName[] {
  return [
    "read",
    "grep",
    "glob",
    "lsp",
    "security_scan",
    "task",
    "wait",
    "todo",
    "ask",
    "web_search",
    "github",
    "generate_image",
    "tts",
    "checkpoint",
    "rewind",
    "retain",
    "recall",
    "reflect",
    "memory_edit",
    "learn",
    "manage_skill",
  ];
}

export function defaultProjects(): Project[] {
  return [
    {
      id: "project-pi-lab",
      name: "pi-lab",
      folders: [
        { path: PRIMARY_FOLDER, branch: "main", kind: "primary" },
        { path: SECONDARY_FOLDER, branch: "feature/accuracy-view", kind: "repo" },
      ],
      createdAt: Date.now() - 1000 * 60 * 60 * 30,
      defaultModel: DEFAULT_MODEL,
    },
  ];
}

export function defaultConnections(): ConnectionProfile[] {
  return [
    {
      id: "conn-local",
      name: "Bundled omp runtime",
      mode: "local",
      authMode: "none",
      gatewayVersion: "omp 1.7.2",
      lastLatencyMs: 4,
      createdAt: Date.now() - 1000 * 60 * 60 * 30,
      capabilities: {
        rpc: true,
        websocket: true,
        sessions: true,
        fileBrowser: true,
        lsp: true,
        debug: true,
        subagents: true,
        memory: true,
        browserRelay: false,
        computer: false,
        auth: "none",
      },
    },
    {
      id: "conn-remote",
      name: "omp gateway · lab box",
      mode: "remote",
      url: "https://omp.lab.internal:7878",
      authMode: "token",
      tokenStored: true,
      headers: [{ name: "CF-Access-Client-Id", value: "stored" }],
      gatewayVersion: "omp 1.7.2",
      lastLatencyMs: 38,
      createdAt: Date.now() - 1000 * 60 * 60 * 20,
      capabilities: {
        rpc: true,
        websocket: true,
        sessions: true,
        fileBrowser: true,
        lsp: true,
        debug: true,
        subagents: true,
        memory: true,
        browserRelay: true,
        computer: true,
        auth: "token",
      },
    },
  ];
}

function assistant(id: string, at: number, text: string, model: string): TranscriptItem {
  return { kind: "assistant", id, at, text, role: "default", model };
}

function todo(id: string, text: string, status: TodoItem["status"], phase: string): TodoItem {
  return { id, text, status, phase };
}

export function defaultSessions(): Session[] {
  const now = Date.now();
  return [
    {
      id: "session-first",
      title: "New chat",
      projectId: "project-pi-lab",
      model: DEFAULT_MODEL,
      role: "default",
      mode: "agent",
      createdAt: now,
      updatedAt: now,
      status: "idle",
      transcript: [],
      todos: [],
      subagents: [],
      memoryFacts: [],
      usage: { promptTokens: 0, completionTokens: 0, costUsd: 0 },
    },
    {
      id: "session-archive",
      title: "Machin fast path review",
      projectId: "project-pi-lab",
      model: DEFAULT_MODEL,
      role: "default",
      mode: "plan",
      createdAt: now - 1000 * 60 * 96,
      updatedAt: now - 1000 * 60 * 84,
      status: "idle",
      transcript: [
        { kind: "user", id: "u-archive", at: now - 1000 * 60 * 96, text: "review src/machin.ts before I merge it", keywords: [] },
        assistant(
          "a-archive",
          now - 1000 * 60 * 95,
          "**code review complete**\n\n- No P0/P1 findings: the arctangent series alternates correctly and reaches machine precision by 12 terms.\n- One P3: the helper `atanSeries` is not exported, so the suite cannot pin it directly — covered through `machinPi` instead.\n",
          DEFAULT_MODEL,
        ),
      ],
      todos: [todo("todo-archive", "Review the fast path", "completed", "review")],
      subagents: [],
      memoryFacts: [
        "pi-lab: machinPi reaches machine precision by 12 terms; the Leibniz path is only used for the onboarding walkthrough.",
        "pi-lab: the suite pins leibniz at 1e-5 over 1e6 terms, which matches the ~1/N truncation error of the scaled series.",
      ],
      usage: { promptTokens: 4_820, completionTokens: 1_208, costUsd: 0.05 },
    },
  ];
}

export const DEFAULT_PROJECT_FOLDER = PRIMARY_FOLDER;
