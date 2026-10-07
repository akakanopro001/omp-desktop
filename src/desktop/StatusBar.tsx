import { Badge } from "@/components/ui/primitives";
import { Hint } from "@/components/ui/tooltip";
import { diagnosticsFor } from "@/lib/omp/lsp";
import { notify, openSettings, useDesktop, workspace } from "@/lib/omp/state";
import { cn } from "./format";
import { AlertTriangle, Check, CircleDot, Cpu, GitBranch, ShieldCheck, Users } from "lucide-react";
import { useMemo } from "react";

export function StatusBar({ root }: { root: string }) {
  const desktop = useDesktop();
  const session = desktop.session;

  const diagnostics = useMemo(() => {
    void desktop.fsVersion;
    return diagnosticsFor(workspace, root);
  }, [root, desktop.fsVersion]);

  const status = useMemo(() => {
    void desktop.fsVersion;
    return workspace.status(root);
  }, [root, desktop.fsVersion]);

  const todoDone = session?.todos.filter((todo) => todo.status === "completed").length ?? 0;
  const todoTotal = session?.todos.length ?? 0;
  const runningAgents = session?.subagents.filter((agent) => agent.status === "running").length ?? 0;

  const tones: Record<string, string> = {
    info: "border-hairline text-muted-foreground",
    ok: "border-ok/40 text-ok",
    warn: "border-warn/40 text-warn",
    danger: "border-destructive/40 text-destructive",
  };

  return (
    <footer className="relative flex h-7 shrink-0 items-center gap-3 border-t border-hairline surface-chrome px-3 font-mono text-2xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <Cpu className="size-3" />
        {workspace.snapshot().length} files
      </span>
      <span className="flex items-center gap-1.5">
        <GitBranch className="size-3" />
        {status.length} changed
      </span>
      <button className="flex items-center gap-1.5 hover:text-foreground" onClick={() => openSettings("tools")}>
        {diagnostics.length === 0 ? <Check className="size-3 text-ok" /> : <AlertTriangle className="size-3 text-warn" />}
        {diagnostics.length} diagnostic(s)
      </button>
      {todoTotal > 0 && (
        <span className="flex items-center gap-1.5">
          <CircleDot className={cn("size-3", todoDone === todoTotal ? "text-ok" : "text-flux")} />
          todos {todoDone}/{todoTotal}
        </span>
      )}
      {runningAgents > 0 && (
        <span className="flex items-center gap-1.5 text-flux">
          <Users className="size-3" />
          {runningAgents} worker(s) live
        </span>
      )}
      <Hint label="Stream rules armed in Settings → Stream rules">
        <button className="flex items-center gap-1.5 hover:text-foreground" onClick={() => openSettings("rules")}>
          <ShieldCheck className="size-3" />
          {desktop.settings.streamRules.filter((rule) => rule.enabled).length} rule(s) armed
        </button>
      </Hint>
      <span className="ml-auto flex items-center gap-1.5">
        <CircleDot className={cn("size-3", session?.status === "running" ? "animate-pulse text-flux" : "text-muted-foreground")} />
        {session?.status ?? "idle"}
      </span>
      <span>{desktop.settings.memory.backend} memory</span>

      <div className="pointer-events-none absolute bottom-8 right-3 flex flex-col items-end gap-1.5">
        {desktop.notices.map((notice) => (
          <button
            key={notice.id}
            onClick={() => notify("notice dismissed", "info")}
            className={cn("pointer-events-auto rounded border bg-popover px-2.5 py-1.5 text-left font-mono text-2xs shadow-lg", tones[notice.tone])}
          >
            {notice.text}
          </button>
        ))}
      </div>
      <Badge tone="muted" className="hidden lg:inline-flex">
        Alt+A hub
      </Badge>
    </footer>
  );
}
