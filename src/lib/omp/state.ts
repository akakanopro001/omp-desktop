import { atom, useAtomValue } from "../store";
import { uid } from "../utils";
import { AGENT_MODES } from "./catalog";
import { defaultConnections, defaultProjects, defaultSettings, defaultSessions, DEFAULT_PROJECT_FOLDER } from "./defaults";
import { runTurn } from "./engine";
import { magicKeywords, type TurnEffect } from "./turn";
import type {
  AgentEvent,
  AgentMode,
  BootStage,
  ConnectionProfile,
  DesktopSettings,
  FileDiff,
  GatewayCapabilities,
  Project,
  RuntimeCandidate,
  Session,
  TranscriptItem,
  WorkspaceFile,
} from "./protocol";
import { buildTree, createDemoWorkspace, PRIMARY_FOLDER, SECONDARY_FOLDER } from "./vfs";
import { hasShell, browserBridge, electronBridge, type NativeBridge } from "../native";
import { clearState as clearPersistedState, loadState, saveState } from "../persist";

/* ------------------------------------------------------------------ *
 * Atoms — the renderer's state ownership layer
 * ------------------------------------------------------------------ */

export const workspace = createDemoWorkspace();

export interface BootState {
  stage: "idle" | "resolving" | "connecting" | "indexing" | "onboarding" | "ready" | "damaged";
  stages: BootStage[];
  candidates: RuntimeCandidate[];
  capabilities?: GatewayCapabilities;
  statusLine: string;
  error?: string;
}

export interface UiState {
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  paletteOpen: boolean;
  hubOpen: boolean;
  pane: "preview" | "diff" | "terminal" | "files" | "hub";
  previewPath?: string;
  sidebar: "session" | "projects" | "files";
  bootLogOpen: boolean;
}

export type SettingsSection =
  | "providers"
  | "connections"
  | "capabilities"
  | "tools"
  | "skills"
  | "rules"
  | "memory"
  | "shortcuts"
  | "appearance"
  | "about";

export interface Notice {
  id: string;
  tone: "info" | "ok" | "warn" | "danger";
  text: string;
  at: number;
}

const persisted = typeof window === "undefined" ? undefined : loadState();

export const settings = atom<DesktopSettings>(persisted?.settings ?? defaultSettings());
export const projects = atom<Project[]>(persisted?.projects ?? defaultProjects());
export const sessions = atom<Session[]>(persisted?.sessions ?? defaultSessions());
export const connections = atom<ConnectionProfile[]>(persisted?.connections ?? defaultConnections());
export const activeConnectionId = atom<string>(connections.get()[0]?.id ?? "conn-local");
export const activeProjectId = atom<string | null>(persisted?.activeProjectId ?? "project-pi-lab");
export const activeSessionId = atom<string>(
  persisted?.activeSessionId && (persisted?.sessions ?? []).some((session) => session.id === persisted?.activeSessionId)
    ? persisted.activeSessionId
    : sessions.get()[0]?.id ?? "",
);
export const boot = atom<BootState>({
  stage: "idle",
  stages: [],
  candidates: [],
  statusLine: "Waiting for the shell",
});
export const ui = atom<UiState>({
  settingsOpen: false,
  settingsSection: "providers",
  paletteOpen: false,
  hubOpen: false,
  pane: "preview",
  sidebar: "session",
  bootLogOpen: false,
});
export const diffs = atom<Record<string, FileDiff>>({});
export const notices = atom<Notice[]>([]);
export const fsVersion = atom<number>(0);
export const bootLog = atom<string[]>([]);
export const runningSessionId = atom<string | null>(null);
export const streaming = atom<boolean>(false);

/* ------------------------------------------------------------------ *
 * Shell bridge
 * ------------------------------------------------------------------ */

export function candidates(): RuntimeCandidate[] {
  return [
    {
      kind: "bundled-payload",
      label: "Bundled payload",
      detail: "resources/omp-runtime — shipped with the app, version pinned at build time",
      command: "omp --mode rpc --stdio",
      version: hasShell() ? "omp 1.7.2 (bundled)" : "omp 1.7.2 (in-process)",
      state: "pending",
    },
    {
      kind: "deployment-override",
      label: "OMP_DESKTOP_OMP deployment override",
      detail: "env override pointing at an operator-provided runtime",
      command: "$OMP_DESKTOP_OMP",
      state: "pending",
    },
    {
      kind: "source-root-override",
      label: "Source root override",
      detail: "OMP_DESKTOP_OMP_ROOT — a checkout you name explicitly",
      command: "$OMP_DESKTOP_OMP_ROOT",
      state: "pending",
    },
    {
      kind: "dev-checkout",
      label: "Development checkout",
      detail: "packages/coding-agent in the repo you launched from",
      command: "bun src/cli.ts --mode rpc",
      state: "pending",
    },
    {
      kind: "managed-install",
      label: "Managed install",
      detail: "~/.omp/agent — written by `omp desktop`",
      command: "omp --mode rpc",
      state: "pending",
    },
  ];
}

export const bridge: NativeBridge = hasShell()
  ? electronBridge(window.ompNative as NonNullable<typeof window.ompNative>)
  : browserBridge({
      files: () => workspace.snapshot(),
      read: (path) => workspace.read(path),
      write: (path, content) => workspace.writeDirty(path, content),
      status: (root) => workspace.status(root),
      log: (root) => workspace.folder(root)?.head ?? [],
      candidates: () => candidates(),
      capabilities: (profile) => capabilitiesFor(profile),
      title: (title) => {
        document.title = title;
      },
    });

export function capabilitiesFor(profile: ConnectionProfile): GatewayCapabilities {
  const remote = profile.mode !== "local";
  return {
    rpc: true,
    websocket: true,
    sessions: true,
    fileBrowser: true,
    lsp: true,
    debug: true,
    subagents: true,
    memory: true,
    browserRelay: hasShell() || remote,
    computer: hasShell() || remote,
    auth: profile.authMode,
  };
}

function log(line: string) {
  bootLog.set((prev) => [...prev.slice(-200), `${new Date().toISOString()} ${line}`]);
}

/* ------------------------------------------------------------------ *
 * Boot sequence — resolve a runtime, connect, index, then hand over
 * ------------------------------------------------------------------ */

const BOOT_STAGES: BootStage[] = [
  { id: "shell", label: "Shell handshake", detail: "native bridge probe", state: "pending" },
  { id: "resolve", label: "Resolving agent runtime", detail: "bundled → override → checkout → install", state: "pending" },
  { id: "connect", label: "Connecting to the gateway", detail: "HTTP + WebSocket capability probe", state: "pending" },
  { id: "index", label: "Priming code intelligence", detail: "workspace index + language servers", state: "pending" },
  { id: "ready", label: "Workspace ready", detail: "panes mounted, transcript rehydrated", state: "pending" },
];

function stagesWith(id: string, state: BootStage["state"], detail?: string): BootStage[] {
  return (boot.get().stages.length > 0 ? boot.get().stages : BOOT_STAGES).map((stage) =>
    stage.id === id ? { ...stage, state, detail: detail ?? stage.detail } : stage,
  );
}

let bootStarted = false;

export async function bootDesktop() {
  if (bootStarted && boot.get().stage !== "idle") return;
  bootStarted = true;
  boot.set({ ...boot.get(), stage: "resolving", stages: BOOT_STAGES, statusLine: "Booting shell" });
  log(`boot: shell=${bridge.kind} runtime=${workspace.paths().length} files`);

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, settings.get().streamSpeed === "instant" ? 0 : ms));

  boot.set({ ...boot.get(), stages: stagesWith("shell", "active") });
  await delay(240);
  boot.set({ ...boot.get(), stages: stagesWith("shell", "done", `${bridge.label}`) });
  log(`shell handshake ok (${bridge.describe()})`);

  boot.set({ ...boot.get(), stages: stagesWith("resolve", "active"), statusLine: "Resolving runtime" });
  const probed = await bridge.resolveRuntime();
  for (const candidate of probed) {
    const usable = candidate.kind === "bundled-payload" || (!hasShell() && candidate.kind === "dev-checkout");
    boot.set({
      ...boot.get(),
      candidates: (boot.get().candidates.length > 0 ? boot.get().candidates : probed).map((entry) =>
        entry.kind === candidate.kind ? { ...entry, state: usable ? "ok" : "skipped" } : entry,
      ),
    });
    log(`runtime probe ${candidate.kind}: ${usable ? "usable" : "not present"} (${candidate.command ?? "n/a"})`);
    await delay(160);
  }
  boot.set({ ...boot.get(), stage: "connecting", stages: stagesWith("resolve", "done", probed[0]?.version ?? "bundled payload") });

  boot.set({ ...boot.get(), stages: stagesWith("connect", "active"), statusLine: "Connecting gateway" });
  const profile = connections.get().find((entry) => entry.id === activeConnectionId.get()) ?? connections.get()[0];
  const capabilities = await bridge.probeGateway(profile);
  await delay(260);
  boot.set({
    ...boot.get(),
    capabilities,
    stage: "indexing",
    stages: stagesWith("connect", "done", `${capabilities.auth === "none" ? "no auth" : capabilities.auth} · rpc ✓ ws ✓`),
  });
  log(`gateway ok: rpc=${capabilities.rpc} ws=${capabilities.websocket} lsp=${capabilities.lsp} auth=${capabilities.auth}`);

  boot.set({ ...boot.get(), stages: stagesWith("index", "active"), statusLine: "Priming index" });
  await delay(320);
  boot.set({ ...boot.get(), stages: stagesWith("index", "done", `${workspace.paths().length} files · 2 language servers`) });

  const needsOnboarding = !persisted?.settings;
  boot.set({
    ...boot.get(),
    stage: needsOnboarding ? "onboarding" : "ready",
    statusLine: needsOnboarding ? "Choose a provider and model" : "Ready",
    stages: stagesWith("ready", needsOnboarding ? "pending" : "done"),
  });
  log(needsOnboarding ? "first run: onboarding required" : "ready");
}

export function completeOnboarding(input: { model: string; mode: AgentMode; projectFolder: string }) {
  settings.set((prev) => ({ ...prev, modelRoles: { ...prev.modelRoles, default: input.model } }));
  const project = projects.get()[0];
  if (project) {
    projects.set((prev) =>
      prev.map((entry) =>
        entry.id === project.id
          ? { ...entry, defaultModel: input.model, folders: entry.folders.map((folder) => (folder.kind === "primary" ? { ...folder, path: input.projectFolder } : folder)) }
          : entry,
      ),
    );
  }
  sessions.set((prev) => prev.map((session) => ({ ...session, model: session.model === defaultSettings().modelRoles.default ? input.model : session.model })));
  const active = activeSession();
  if (active) {
    updateSession(active.id, (session) => ({ ...session, mode: input.mode, model: input.model, status: "idle" }));
  }
  boot.set({
    ...boot.get(),
    stage: "ready",
    statusLine: "Ready",
    stages: stagesWith("ready", "done", `${input.model} · ${input.mode} mode`),
  });
  log(`onboarding complete: model=${input.model} mode=${input.mode} folder=${input.projectFolder}`);
}

/* ------------------------------------------------------------------ *
 * Session + project operations
 * ------------------------------------------------------------------ */

export function activeSession(): Session | undefined {
  const id = activeSessionId.get();
  return sessions.get().find((session) => session.id === id) ?? sessions.get()[0];
}

export function sessionProject(session: Session | undefined): Project | undefined {
  if (!session?.projectId) return undefined;
  return projects.get().find((project) => project.id === session.projectId);
}

export function sessionRoot(session: Session | undefined): string {
  const project = sessionProject(session);
  return project?.folders.find((folder) => folder.kind === "primary")?.path ?? DEFAULT_PROJECT_FOLDER;
}

export function updateSession(id: string, updater: (session: Session) => Session) {
  sessions.set((prev) => prev.map((session) => (session.id === id ? { ...updater(session), updatedAt: Date.now() } : session)));
}

export function createSession(options?: { projectId?: string | null; title?: string; mode?: AgentMode; detach?: boolean }): Session {
  const active = activeSession();
  const session: Session = {
    id: uid("session"),
    title: options?.title ?? "New chat",
    projectId: options?.detach ? null : options?.projectId ?? active?.projectId ?? null,
    model: settings.get().modelRoles.default ?? active?.model ?? "anthropic/opus-4.6-1m",
    role: "default",
    mode: options?.mode ?? active?.mode ?? "agent",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "idle",
    transcript: [],
    todos: [],
    subagents: [],
    memoryFacts: [],
    usage: { promptTokens: 0, completionTokens: 0, costUsd: 0 },
  };
  sessions.set((prev) => [session, ...prev]);
  activeSessionId.set(session.id);
  return session;
}

export function selectSession(id: string) {
  activeSessionId.set(id);
  streaming.set(false);
}

export function deleteSession(id: string) {
  sessions.set((prev) => prev.filter((session) => session.id !== id));
  if (activeSessionId.get() === id) {
    const next = sessions.get()[0];
    if (next) activeSessionId.set(next.id);
    else createSession();
  }
}

export function renameSession(id: string, title: string) {
  updateSession(id, (session) => ({ ...session, title: title.trim() || session.title }));
}

export function togglePin(id: string) {
  updateSession(id, (session) => ({ ...session, pinned: !session.pinned }));
}

export function addProject(name: string, folder: string) {
  const project: Project = {
    id: uid("project"),
    name,
    folders: [{ path: folder.startsWith("/") ? folder : `/${folder}`, branch: "main", kind: "primary" }],
    createdAt: Date.now(),
  };
  projects.set((prev) => [...prev, project]);
  activeProjectId.set(project.id);
  notify(`Project "${name}" added`, "ok");
  return project;
}

export function addFolderToProject(projectId: string, folder: string) {
  projects.set((prev) =>
    prev.map((project) =>
      project.id === projectId
        ? { ...project, folders: [...project.folders, { path: folder.startsWith("/") ? folder : `/${folder}`, branch: "main", kind: "repo" }] }
        : project,
    ),
  );
  notify(`Folder "${folder}" attached`, "ok");
}

export function enterProject(projectId: string) {
  activeProjectId.set(projectId);
  const session = activeSession();
  if (session) updateSession(session.id, (entry) => ({ ...entry, projectId }));
  notify(`Entered project ${projects.get().find((project) => project.id === projectId)?.name ?? projectId}`, "info");
}

export function addConnection(profile: ConnectionProfile) {
  connections.set((prev) => [...prev, profile]);
  activeConnectionId.set(profile.id);
}

export function removeConnection(id: string) {
  connections.set((prev) => prev.filter((entry) => entry.id !== id));
  if (activeConnectionId.get() === id) activeConnectionId.set(connections.get()[0]?.id ?? "conn-local");
}

/** Wipe persisted desktop state and reload into a first-run boot. */
export function clearDesktopState() {
  clearPersistedState();
  settings.set(defaultSettings());
  projects.set(defaultProjects());
  sessions.set(defaultSessions());
  connections.set(defaultConnections());
  activeProjectId.set("project-pi-lab");
  activeSessionId.set(sessions.get()[0]?.id ?? "");
  boot.set({ stage: "idle", stages: [], candidates: [], statusLine: "Waiting for the shell" });
  diffs.set({});
}

export function notify(text: string, tone: Notice["tone"] = "info") {
  const notice: Notice = { id: uid("notice"), tone, text, at: Date.now() };
  notices.set((prev) => [...prev.slice(-3), notice]);
  setTimeout(() => notices.set((prev) => prev.filter((entry) => entry.id !== notice.id)), 4200);
}

export function openFile(path: string) {
  ui.set((prev) => ({ ...prev, pane: "preview", previewPath: path }));
}

export function openDiff(diff: FileDiff) {
  diffs.set((prev) => ({ ...prev, [diff.path]: diff }));
  ui.set((prev) => ({ ...prev, pane: "diff" }));
}

export function openSettings(section: SettingsSection = "providers") {
  ui.set((prev) => ({ ...prev, settingsOpen: true, settingsSection: section }));
}

export function fileTree(root: string) {
  return buildTree(workspace, root);
}

export function projectPrimaryFolder(projectId: string | null): string {
  const project = projects.get().find((entry) => entry.id === projectId);
  return project?.folders.find((folder) => folder.kind === "primary")?.path ?? DEFAULT_PROJECT_FOLDER;
}

export const FOLDERS = { primary: PRIMARY_FOLDER, secondary: SECONDARY_FOLDER };

/* ------------------------------------------------------------------ *
 * Agent event reducer
 * ------------------------------------------------------------------ */

function upsertTranscript(session: Session, item: TranscriptItem): Session {
  const index = session.transcript.findIndex((entry) => entry.id === item.id);
  if (index === -1) return { ...session, transcript: [...session.transcript, item] };
  const transcript = [...session.transcript];
  transcript[index] = item;
  return { ...session, transcript };
}

export function applyAgentEvent(sessionId: string, event: AgentEvent) {
  updateSession(sessionId, (session) => {
    switch (event.type) {
      case "turn.started":
        streaming.set(true);
        return { ...session, status: "running" };

      case "text.delta": {
        const transcript = [...session.transcript];
        const last = transcript[transcript.length - 1];
        if (last && last.kind === "assistant" && last.streaming) {
          transcript[transcript.length - 1] = { ...last, text: last.text + event.text };
        } else {
          transcript.push({
            kind: "assistant",
            id: uid("assistant"),
            at: Date.now(),
            text: event.text,
            role: session.role,
            model: session.model,
            streaming: true,
          });
        }
        return { ...session, transcript };
      }

      case "text.done": {
        const transcript = [...session.transcript];
        for (let index = transcript.length - 1; index >= 0; index -= 1) {
          const item = transcript[index];
          if (item.kind === "assistant" && item.streaming) {
            transcript[index] = { ...item, text: event.text, streaming: false };
            break;
          }
        }
        return { ...session, transcript };
      }

      case "tool.started":
      case "tool.finished": {
        const item: TranscriptItem = { kind: "tool", id: event.call.id, at: Date.now(), call: event.call };
        fsVersion.set(fsVersion.get() + 1);
        if (event.type === "tool.finished" && event.call.name === "edit") {
          const diffBlock = event.call.blocks.find((block) => block.type === "diff");
          if (diffBlock && diffBlock.type === "diff" && diffBlock.files[0]) {
            const file = diffBlock.files[0];
            diffs.set((prev) => ({ ...prev, [file.path]: file }));
          }
        }
        return upsertTranscript(session, item);
      }

      case "advisor.note":
        return {
          ...session,
          transcript: [
            ...session.transcript,
            { kind: "advisor", id: uid("advisor"), at: Date.now(), severity: event.severity, role: "advisor", model: event.model, text: event.text },
          ],
        };

      case "rule.injected":
        return {
          ...session,
          transcript: [...session.transcript, { kind: "rule", id: uid("rule"), at: Date.now(), rule: event.rule, reason: event.reason }],
        };

      case "todo.updated":
        return { ...session, todos: event.items };

      case "subagent.updated": {
        const exists = session.subagents.some((agent) => agent.id === event.agent.id);
        return {
          ...session,
          subagents: exists ? session.subagents.map((agent) => (agent.id === event.agent.id ? event.agent : agent)) : [...session.subagents, event.agent],
        };
      }

      case "memory.updated": {
        const merged = new Set([...session.memoryFacts, ...event.facts]);
        return { ...session, memoryFacts: [...merged] };
      }

      case "usage":
        return {
          ...session,
          usage: {
            promptTokens: session.usage.promptTokens + event.usage.promptTokens,
            completionTokens: session.usage.completionTokens + event.usage.completionTokens,
            costUsd: session.usage.costUsd + event.usage.costUsd,
          },
        };

      case "log":
        if (event.level === "warn" || event.level === "error") {
          return { ...session, transcript: [...session.transcript, { kind: "system", id: uid("log"), at: Date.now(), text: event.text, tone: "warn" }] };
        }
        return session;

      case "turn.finished":
        streaming.set(false);
        return {
          ...session,
          status: event.reason === "stop" ? "idle" : event.reason === "aborted" ? "aborted" : "error",
          transcript:
            event.reason === "error" && event.error
              ? [...session.transcript, { kind: "error", id: uid("error"), at: Date.now(), text: event.error, retryable: true }]
              : session.transcript,
        };

      default:
        return session;
    }
  });
}

export function applyEffects(sessionId: string, effects: TurnEffect[]) {
  for (const effect of effects) {
    switch (effect.type) {
      case "set-model":
        updateSession(sessionId, (session) => ({ ...session, model: effect.selector }));
        break;
      case "set-role":
        settings.set((prev) => ({ ...prev, modelRoles: { ...prev.modelRoles, [effect.role]: effect.selector } }));
        break;
      case "set-mode":
        updateSession(sessionId, (session) => ({ ...session, mode: effect.mode }));
        break;
      case "set-advisor":
        settings.set((prev) => ({ ...prev, advisor: { ...prev.advisor, enabled: effect.enabled } }));
        break;
      case "clear-transcript":
        updateSession(sessionId, (session) => ({ ...session, transcript: [], todos: [], subagents: [] }));
        break;
      case "set-title":
        updateSession(sessionId, (session) => ({ ...session, title: effect.title }));
        break;
      case "attach-diff":
        diffs.set((prev) => ({ ...prev, [effect.diff.path]: effect.diff }));
        break;
      case "open-pane": {
        const pane = effect.pane;
        if (pane === "settings") ui.set((prev) => ({ ...prev, settingsOpen: true }));
        else ui.set((prev) => ({ ...prev, pane }));
        break;
      }
      case "set-rule-hits":
        settings.set((prev) => ({
          ...prev,
          streamRules: prev.streamRules.map((rule) => (rule.id === effect.ruleId ? { ...rule, hits: effect.hits } : rule)),
        }));
        break;
      default:
        break;
    }
  }
}

/* ------------------------------------------------------------------ *
 * Turn orchestration
 * ------------------------------------------------------------------ */

let controller: AbortController | null = null;

export async function sendPrompt(text: string) {
  const prompt = text.trim();
  if (!prompt || controller) return;
  const session = activeSession();
  if (!session) return;

  if (session.transcript.length === 0 && !prompt.startsWith("/")) {
    renameSession(session.id, titleFromPrompt(prompt));
  }

  updateSession(session.id, (entry) => ({
    ...entry,
    status: "running",
    transcript: [...entry.transcript, { kind: "user", id: uid("user"), at: Date.now(), text: prompt, keywords: magicKeywords(prompt) }],
  }));

  controller = new AbortController();
  runningSessionId.set(session.id);
  streaming.set(true);

  const root = sessionRoot(sessions.get().find((entry) => entry.id === session.id) ?? session);

  try {
    const outcome = await runTurn({
      workspace,
      root,
      session: sessions.get().find((entry) => entry.id === session.id) ?? session,
      settings: settings.get(),
      prompt,
      emit: (event) => applyAgentEvent(session.id, event),
      signal: controller.signal,
    });
    applyEffects(session.id, outcome.effects);
    fsVersion.set(fsVersion.get() + 1);
    if (outcome.error) notify(outcome.error, "danger");
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error), "danger");
    updateSession(session.id, (entry) => ({ ...entry, status: "error" }));
  } finally {
    controller = null;
    runningSessionId.set(null);
    streaming.set(false);
  }
}

export function abortTurn() {
  controller?.abort();
  controller = null;
  runningSessionId.set(null);
  streaming.set(false);
}

export function isRunning(): boolean {
  return controller !== null;
}

export function retryLastTurn() {
  const session = activeSession();
  if (!session) return;
  const lastUser = [...session.transcript].reverse().find((item) => item.kind === "user");
  if (!lastUser || lastUser.kind !== "user") return;
  updateSession(session.id, (entry) => ({
    ...entry,
    transcript: entry.transcript.filter((item) => item.id !== lastUser.id || item.kind !== "error"),
  }));
  void sendPrompt(lastUser.text);
}

function titleFromPrompt(prompt: string): string {
  const cleaned = prompt.replace(/^\/\S+\s*/, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "Session control";
  return cleaned.length > 44 ? `${cleaned.slice(0, 43)}…` : cleaned;
}

/** One subscription bundle for the shell — every pane reads from this. */
export function useDesktop() {
  const settingsValue = useAtomValue(settings);
  const sessionList = useAtomValue(sessions);
  const projectList = useAtomValue(projects);
  const connectionList = useAtomValue(connections);
  const bootState = useAtomValue(boot);
  const uiState = useAtomValue(ui);
  const activeId = useAtomValue(activeSessionId);
  const activeProject = useAtomValue(activeProjectId);
  const activeConnection = useAtomValue(activeConnectionId);
  const diffMap = useAtomValue(diffs);
  const noticeList = useAtomValue(notices);
  const version = useAtomValue(fsVersion);
  const runningId = useAtomValue(runningSessionId);
  const session = sessionList.find((entry) => entry.id === activeId) ?? sessionList[0];
  return {
    settings: settingsValue,
    sessions: sessionList,
    projects: projectList,
    connections: connectionList,
    boot: bootState,
    ui: uiState,
    session,
    activeSessionId: activeId,
    activeProjectId: activeProject,
    activeConnectionId: activeConnection,
    diffs: diffMap,
    notices: noticeList,
    fsVersion: version,
    runningId,
  };
}

export function groupSessions(sessionList: Session[], projectList: Project[]): { project: Project | null; sessions: Session[] }[] {
  const sorted = [...sessionList].sort(
    (a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false) || b.updatedAt - a.updatedAt,
  );
  const groups: { project: Project | null; sessions: Session[] }[] = [];
  const detached = sorted.filter((session) => !session.projectId);
  if (detached.length > 0) groups.push({ project: null, sessions: detached });
  for (const project of projectList) {
    const owned = sorted.filter((session) => session.projectId === project.id);
    if (owned.length > 0) groups.push({ project, sessions: owned });
  }
  return groups;
}

export function sessionGroups(): { project: Project | null; sessions: Session[] }[] {
  const all = [...sessions.get()].sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false) || b.updatedAt - a.updatedAt);
  const groups: { project: Project | null; sessions: Session[] }[] = [];
  const detached = all.filter((session) => !session.projectId);
  if (detached.length > 0) groups.push({ project: null, sessions: detached });
  for (const project of projects.get()) {
    const owned = all.filter((session) => session.projectId === project.id);
    if (owned.length > 0) groups.push({ project, sessions: owned });
  }
  return groups;
}

export function allSessions(): Session[] {
  return sessions.get();
}

export function workspaceFiles(): WorkspaceFile[] {
  fsVersion.get();
  return workspace.snapshot();
}

export function activeMode(): AgentMode {
  return activeSession()?.mode ?? "agent";
}

export function modeSpec(mode: AgentMode) {
  return AGENT_MODES.find((entry) => entry.id === mode) ?? AGENT_MODES[1];
}

/* ------------------------------------------------------------------ *
 * Persistence wiring
 * ------------------------------------------------------------------ */

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave() {
  if (typeof window === "undefined") return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveState({
      settings: settings.get(),
      projects: projects.get(),
      sessions: sessions.get().slice(0, 40),
      connections: connections.get(),
      activeSessionId: activeSessionId.get(),
      activeProjectId: activeProjectId.get(),
    });
  }, 500);
}

let persistenceReady = false;

export function initPersistence() {
  if (persistenceReady) return;
  persistenceReady = true;
  [settings, projects, sessions, connections, activeSessionId, activeProjectId].forEach((target) => target.subscribe(scheduleSave));
}
