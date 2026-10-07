import { Badge, Button } from "@/components/ui/primitives";
import { TooltipProvider } from "@/components/ui/tooltip";
import { modeSpec, sessionRoot, ui, useDesktop } from "@/lib/omp/state";
import { bootDesktop, createSession, initPersistence, sendPrompt } from "@/lib/omp/state";
import { abortTurn, retryLastTurn } from "./actions";
import { cn, formatRelative } from "./format";
import { BootOverlay } from "./BootOverlay";
import { CommandPalette } from "./CommandPalette";
import { Composer } from "./Composer";
import { LeftRail } from "./LeftRail";
import { PreviewPane } from "./PreviewPane";
import { SettingsOverlay } from "./SettingsOverlay";
import { StatusBar } from "./StatusBar";
import { TitleBar } from "./TitleBar";
import { Transcript } from "./Transcript";
import { Boxes, CircleDot, GitBranch, LayoutPanelLeft, RefreshCw, Users } from "lucide-react";
import { useEffect } from "react";

export function DesktopApp() {
  const desktop = useDesktop();
  const session = desktop.session;
  const root = sessionRoot(session);

  useEffect(() => {
    initPersistence();
    void bootDesktop();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        ui.set((prev) => ({ ...prev, paletteOpen: !prev.paletteOpen }));
        return;
      }
      if (meta && event.key === ",") {
        event.preventDefault();
        ui.set((prev) => ({ ...prev, settingsOpen: !prev.settingsOpen }));
        return;
      }
      if (meta && event.key.toLowerCase() === "n") {
        event.preventDefault();
        createSession({ detach: event.shiftKey });
        return;
      }
      if (event.altKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        ui.set((prev) => ({ ...prev, pane: "hub" }));
        return;
      }
      if (meta && event.key === "\\") {
        event.preventDefault();
        ui.set((prev) => ({ ...prev, pane: prev.pane === "preview" ? "diff" : "preview" }));
        return;
      }
      if (meta && event.shiftKey && event.key.toLowerCase() === "e") {
        event.preventDefault();
        ui.set((prev) => ({ ...prev, pane: "files" }));
        return;
      }
      if (event.key === "Escape" && session?.status === "running") {
        abortTurn();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [session?.status]);

  useEffect(() => {
    document.documentElement.style.setProperty("--transcript-size", `${desktop.settings.transcriptFontSize}px`);
  }, [desktop.settings.transcriptFontSize]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full min-h-0 flex-col surface-chrome">
        <TitleBar root={root} />
        <div className="flex min-h-0 flex-1">
          <LeftRail />
          <ChatColumn root={root} />
          <PreviewPane session={session} root={root} />
        </div>
        <StatusBar root={root} />
      </div>
      <BootOverlay />
      <SettingsOverlay />
      <CommandPalette />
    </TooltipProvider>
  );
}

function ChatColumn({ root }: { root: string }) {
  const desktop = useDesktop();
  const session = desktop.session;
  if (!session) {
    return (
      <main className="flex flex-1 items-center justify-center px-6">
        <div className="text-center">
          <p className="text-xs text-muted-foreground">No session open.</p>
          <Button className="mt-3" size="sm" onClick={() => createSession({ detach: false })}>
            Start a chat
          </Button>
        </div>
      </main>
    );
  }

  const branch = root.split("/").filter(Boolean).pop() ?? "workspace";

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-hairline px-4 py-2">
        <span className="font-mono text-xs text-foreground">{session.title}</span>
        <Badge tone={session.mode === "plan" || session.mode === "vibe" ? "flux" : "muted"}>{modeSpec(session.mode).name}</Badge>
        {session.pinned && <Badge tone="ember">pinned</Badge>}
        <span className="hidden items-center gap-1.5 font-mono text-2xs text-muted-foreground/70 lg:flex">
          <GitBranch className="size-3" /> {branch}
          <span className="opacity-40">·</span>
          updated {formatRelative(session.updatedAt)}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {session.subagents.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => ui.set((prev) => ({ ...prev, pane: "hub" }))}>
              <Users className="size-3" /> hub {session.subagents.length}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => ui.set((prev) => ({ ...prev, pane: "files" }))}>
            <LayoutPanelLeft className="size-3" /> files
          </Button>
          {session.status !== "running" && session.transcript.length > 0 && (
            <Button variant="ghost" size="sm" onClick={retryLastTurn}>
              <RefreshCw className="size-3" /> retry
            </Button>
          )}
        </div>
      </div>

      {session.todos.length > 0 && (
        <div className="flex items-center gap-2 border-b border-hairline bg-panel/50 px-4 py-1.5">
          <CircleDot className={cn("size-3", session.status === "running" ? "animate-pulse text-flux" : "text-muted-foreground")} />
          <span className="font-mono text-2xs text-muted-foreground">
            {session.todos.filter((todo) => todo.status === "completed").length}/{session.todos.length} todos ·{" "}
            {session.todos.find((todo) => todo.status === "in_progress")?.text ?? "idle"}
          </span>
          <button className="ml-auto font-mono text-2xs text-muted-foreground/70 hover:text-ember" onClick={() => void sendPrompt("/todos")}>
            inspect
          </button>
        </div>
      )}

      {session.subagents.length > 0 && (
        <div className="flex items-center gap-2 border-b border-hairline bg-panel/30 px-4 py-1.5">
          <Boxes className="size-3 text-flux" />
          <span className="truncate font-mono text-2xs text-muted-foreground">
            {session.subagents.map((agent) => `${agent.name}:${agent.status}`).join(" · ")}
          </span>
          <button className="ml-auto font-mono text-2xs text-muted-foreground/70 hover:text-ember" onClick={() => ui.set((prev) => ({ ...prev, pane: "hub" }))}>
            open agent hub
          </button>
        </div>
      )}

      <Transcript session={session} running={session.status === "running"} />
      <Composer session={session} running={session.status === "running"} />
    </main>
  );
}
