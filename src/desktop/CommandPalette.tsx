import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  createSession,
  enterProject,
  notify,
  openSettings,
  selectSession,
  sendPrompt,
  settings,
  ui,
  useDesktop,
} from "@/lib/omp/state";
import type { SettingsSection } from "@/lib/omp/state";
import { cn } from "./format";
import { CornerDownLeft, Search } from "lucide-react";
import { useMemo, useState } from "react";

interface PaletteAction {
  id: string;
  label: string;
  group: string;
  hint?: string;
  run: () => void | Promise<void>;
}

export function CommandPalette() {
  const desktop = useDesktop();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const actions = useMemo<PaletteAction[]>(() => {
    const list: PaletteAction[] = [
      { id: "chat.new", label: "New chat in the current project", group: "session", run: () => createSession({ detach: false }) },
      { id: "chat.detached", label: "New detached chat", group: "session", run: () => createSession({ detach: true, title: "Detached chat" }) },
      { id: "prompt.fix", label: "Ask: fix the failing tests", group: "prompt", run: () => sendPrompt("the pi tests are failing, please fix them") },
      { id: "prompt.review", label: "Ask: review the working tree", group: "prompt", run: () => sendPrompt("review the working tree") },
      { id: "prompt.cleanup", label: "Ask: clean up lint warnings", group: "prompt", run: () => sendPrompt("clean up lint warnings") },
      { id: "prompt.tests", label: "Ask: run the tests", group: "prompt", run: () => sendPrompt("run the tests") },
      { id: "prompt.commit", label: "Ask: commit the working tree", group: "prompt", run: () => sendPrompt("commit the change") },
      { id: "prompt.explain", label: "Ask: explain src/leibniz.ts", group: "prompt", run: () => sendPrompt("explain src/leibniz.ts") },
      { id: "prompt.orchestrate", label: "Ask: orchestrate a project survey", group: "prompt", run: () => sendPrompt("orchestrate: survey the project before I change anything") },
      { id: "pane.preview", label: "Pane: preview", group: "layout", run: () => ui.set((prev) => ({ ...prev, pane: "preview" })) },
      { id: "pane.diff", label: "Pane: diff", group: "layout", run: () => ui.set((prev) => ({ ...prev, pane: "diff" })) },
      { id: "pane.terminal", label: "Pane: terminal", group: "layout", run: () => ui.set((prev) => ({ ...prev, pane: "terminal" })) },
      { id: "pane.files", label: "Pane: files", group: "layout", run: () => ui.set((prev) => ({ ...prev, pane: "files" })) },
      { id: "pane.hub", label: "Pane: agent hub", group: "layout", run: () => ui.set((prev) => ({ ...prev, pane: "hub" })) },
      {
        id: "appearance.theme",
        label: `Appearance: switch to ${desktop.settings.theme === "dark" ? "light" : "dark"} theme`,
        group: "settings",
        run: () => {
          const theme = desktop.settings.theme === "dark" ? "light" : "dark";
          settings.set((prev) => ({ ...prev, theme }));
          document.documentElement.classList.toggle("dark", theme === "dark");
        },
      },
      { id: "settings.providers", label: "Settings: providers & models", group: "settings", run: () => openSettings("providers") },
      { id: "settings.connections", label: "Settings: connections", group: "settings", run: () => openSettings("connections") },
      { id: "settings.tools", label: "Settings: tools & permissions", group: "settings", run: () => openSettings("tools") },
      { id: "settings.memory", label: "Settings: memory", group: "settings", run: () => openSettings("memory") },
      { id: "settings.rules", label: "Settings: stream rules", group: "settings", run: () => openSettings("rules") },
      {
        id: "help.copy",
        label: "Copy the boot log summary to the clipboard",
        group: "help",
        run: async () => {
          await navigator.clipboard?.writeText(desktop.boot.stages.map((stage) => `${stage.state} ${stage.label}${stage.detail ? ` — ${stage.detail}` : ""}`).join("\n"));
          notify("Boot log copied", "ok");
        },
      },
    ];

    for (const session of desktop.sessions.slice(0, 8)) {
      list.push({
        id: `session.${session.id}`,
        label: `Open session: ${session.title}`,
        group: "jump",
        hint: session.mode,
        run: () => selectSession(session.id),
      });
    }

    for (const project of desktop.projects) {
      list.push({ id: `project.${project.id}`, label: `Enter project: ${project.name}`, group: "jump", run: () => enterProject(project.id) });
    }

    for (const section of ["providers", "connections", "capabilities", "tools", "skills", "rules", "memory", "shortcuts", "appearance", "about"] as SettingsSection[]) {
      list.push({ id: `section.${section}`, label: `Jump to settings → ${section}`, group: "settings", run: () => openSettings(section) });
    }

    return list;
  }, [desktop.sessions, desktop.projects, desktop.settings.theme, desktop.boot.stages]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return actions.slice(0, 40);
    return actions.filter((action) => `${action.group} ${action.label}`.toLowerCase().includes(needle)).slice(0, 40);
  }, [actions, query]);

  const run = (action: PaletteAction | undefined) => {
    if (!action) return;
    ui.set((prev) => ({ ...prev, paletteOpen: false }));
    setQuery("");
    void action.run();
  };

  return (
    <Dialog open={desktop.ui.paletteOpen} onOpenChange={(open) => ui.set((prev) => ({ ...prev, paletteOpen: open }))}>
      <DialogContent className="top-[18%] max-w-xl translate-y-0">
        <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setIndex((prev) => Math.min(filtered.length - 1, prev + 1));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setIndex((prev) => Math.max(0, prev - 1));
              }
              if (event.key === "Enter") {
                event.preventDefault();
                run(filtered[index]);
              }
            }}
            placeholder="Run a command, jump to a session, or start a prompt…"
            className="flex-1 bg-transparent font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
          />
          <span className="flex items-center gap-1 font-mono text-2xs text-muted-foreground/60">
            <CornerDownLeft className="size-3" /> run
          </span>
        </div>
        <div className="max-h-[46vh] overflow-auto p-1.5">
          {filtered.map((action, actionIndex) => (
            <button
              key={action.id}
              onMouseEnter={() => setIndex(actionIndex)}
              onClick={() => run(action)}
              className={cn(
                "flex w-full items-center gap-3 rounded px-2.5 py-1.5 text-left transition-colors",
                actionIndex === index ? "bg-secondary/70" : "hover:bg-secondary/40",
              )}
            >
              <span className="w-16 shrink-0 font-mono text-2xs text-muted-foreground/70">{action.group}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-foreground">{action.label}</span>
              {action.hint && <span className="shrink-0 font-mono text-2xs text-ember">{action.hint}</span>}
            </button>
          ))}
          {filtered.length === 0 && <p className="px-3 py-4 text-2xs text-muted-foreground">No command matches that.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
