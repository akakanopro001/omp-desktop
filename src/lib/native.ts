import type { ConnectionProfile, GatewayCapabilities, RuntimeCandidate, WorkspaceFile } from "./omp/protocol";

/**
 * The shell boundary.
 *
 * Hermes Desktop resolves a runnable backend in Electron, owns native
 * filesystem/git/window capability there, and exposes a narrow preload bridge to
 * the renderer. This module is that narrow bridge: the renderer only ever talks
 * to `NativeBridge`, and when no preload bridge is present it falls back to the
 * bundled browser runtime (the demo workspace plus localStorage), so the same
 * panes run in both hosts.
 */

/** One of the four omp entry points, as the shell resolved it on this machine. */
export interface RuntimeEntryPoint {
  id: string;
  name: string;
  command: string;
  detail: string;
  supported: boolean;
}

/** The result of a one-shot `omp -p "…" --mode text` run. */
export interface OneShotResult {
  ok: boolean;
  code?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
}

export interface NativeBridge {
  kind: "electron" | "browser";
  label: string;
  describe(): string;
  resolveRuntime(): Promise<RuntimeCandidate[]>;
  probeGateway(profile: ConnectionProfile): Promise<GatewayCapabilities>;
  entryPoints?(): Promise<RuntimeEntryPoint[]>;
  runOneShot?(payload: { prompt: string; model?: string; timeoutMs?: number }): Promise<OneShotResult>;
  listFiles(root: string): Promise<WorkspaceFile[]>;
  readFile(path: string): Promise<string | undefined>;
  writeFile(path: string, content: string): Promise<void>;
  gitStatus(root: string): Promise<{ path: string; status: string }[]>;
  gitLog(root: string): Promise<{ hash: string; subject: string; author: string; at: number }[]>;
  copyToClipboard(text: string): Promise<void>;
  pickFolder(): Promise<string | null>;
  setWindowTitle(title: string): Promise<void>;
}

export interface ElectronShellApi {
  version: string;
  runtime: {
    resolve(payload?: unknown): Promise<RuntimeCandidate[]>;
    start(): Promise<unknown>;
    state(): Promise<Record<string, unknown>>;
    handshake(): Promise<Record<string, unknown> | null>;
    probe(url: string, token?: string, headers?: Record<string, string>): Promise<GatewayCapabilities>;
    entryPoints(refresh?: boolean): Promise<RuntimeEntryPoint[]>;
    oneShot(payload: { prompt: string; model?: string; timeoutMs?: number }): Promise<OneShotResult>;
    command(type: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
  };
  fs: {
    list(root: string): Promise<WorkspaceFile[]>;
    read(path: string): Promise<string | undefined>;
    write(path: string, content: string): Promise<void>;
  };
  git: {
    status(root: string): Promise<{ path: string; status: string }[]>;
    log(root: string): Promise<{ hash: string; subject: string; author: string; at: number }[]>;
  };
  clipboard: { write(text: string): Promise<void> };
  dialog: { pickFolder(): Promise<string | null> };
  window: { setTitle(title: string): Promise<void> };
}

declare global {
  interface Window {
    ompNative?: ElectronShellApi;
  }
}

export function hasShell(): boolean {
  return typeof window !== "undefined" && Boolean(window.ompNative);
}

export function electronBridge(api: ElectronShellApi): NativeBridge {
  return {
    kind: "electron",
    label: `Electron shell ${api.version}`,
    describe: () => "Packaged shell: local filesystem, git and window capability, agent runtime resolved in the main process.",
    resolveRuntime: () => api.runtime.resolve(),
    entryPoints: () => api.runtime.entryPoints(),
    runOneShot: (payload) => api.runtime.oneShot(payload),
    probeGateway: (profile) =>
      api.runtime.probe(
        profile.url ?? "",
        profile.authMode === "token" ? "stored" : undefined,
        Object.fromEntries((profile.headers ?? []).map((header) => [header.name, header.value])),
      ),
    listFiles: (root) => api.fs.list(root),
    readFile: (path) => api.fs.read(path),
    writeFile: (path, content) => api.fs.write(path, content),
    gitStatus: (root) => api.git.status(root),
    gitLog: (root) => api.git.log(root),
    copyToClipboard: (text) => api.clipboard.write(text),
    pickFolder: () => api.dialog.pickFolder(),
    setWindowTitle: (title) => api.window.setTitle(title),
  };
}

export interface BrowserBridgeHooks {
  files(): WorkspaceFile[];
  read(path: string): string | undefined;
  write(path: string, content: string): void;
  status(root: string): { path: string; status: string }[];
  log(root: string): { hash: string; subject: string; author: string; at: number }[];
  candidates(): RuntimeCandidate[];
  capabilities(profile: ConnectionProfile): GatewayCapabilities;
  title?: (title: string) => void;
}

export function browserBridge(hooks: BrowserBridgeHooks): NativeBridge {
  return {
    kind: "browser",
    label: "Bundled browser runtime",
    describe: () => "No preload bridge detected: the workspace, git and language services run in-process in the renderer.",
    resolveRuntime: async () => hooks.candidates(),
    probeGateway: async (profile) => hooks.capabilities(profile),
    listFiles: async () => hooks.files(),
    readFile: async (path) => hooks.read(path),
    writeFile: async (path, content) => hooks.write(path, content),
    gitStatus: async (root) => hooks.status(root),
    gitLog: async (root) => hooks.log(root),
    copyToClipboard: async (text) => {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    },
    pickFolder: async () => null,
    setWindowTitle: async (title) => hooks.title?.(title),
  };
}
