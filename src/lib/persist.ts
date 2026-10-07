import type { ConnectionProfile, DesktopSettings, Project, Session } from "./omp/protocol";

/**
 * Desktop persistence.
 *
 * The packaged app writes user data to HERMES_HOME-style layout outside the app
 * bundle; the browser runtime keeps the same shape in localStorage under one
 * versioned key so a schema change can migrate instead of corrupting state.
 */

const KEY = "omp-desktop/state/v1";

export interface PersistedState {
  version: 1;
  settings: DesktopSettings;
  projects: Project[];
  sessions: Session[];
  connections: ConnectionProfile[];
  activeSessionId: string;
  activeProjectId: string | null;
  savedAt: number;
}

export function loadState(): PersistedState | undefined {
  if (typeof localStorage === "undefined") return undefined;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as PersistedState;
    if (parsed.version !== 1) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function saveState(state: Omit<PersistedState, "version" | "savedAt">) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...state, version: 1, savedAt: Date.now() }));
  } catch {
    /* quota exceeded — the session keeps running, persistence simply stops */
  }
}

export function clearState() {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(KEY);
}
