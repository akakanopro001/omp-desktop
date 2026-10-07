import { Badge, Button } from "@/components/ui/primitives";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { FileDiff, Session, ToolCall } from "@/lib/omp/protocol";
import { runCommand } from "@/lib/omp/shell";
import { anchorsFor } from "@/lib/omp/hashline";
import { openFile, ui, workspace, fsVersion, useDesktop } from "@/lib/omp/state";
import { cn, formatDuration, shortPath } from "./format";
import { AgentHub } from "./AgentHub";
import { DiffView } from "./DiffView";
import { FileBrowser } from "./FileBrowser";
import { Markdown } from "./Transcript";
import { ToolCard } from "./ToolCard";
import { FileCode, GitCompare, LayoutPanelLeft, Play, Terminal, Users } from "lucide-react";
import { useMemo, useState } from "react";

const TABS = [
  { id: "preview", label: "preview", icon: FileCode },
  { id: "diff", label: "diff", icon: GitCompare },
  { id: "terminal", label: "terminal", icon: Terminal },
  { id: "files", label: "files", icon: LayoutPanelLeft },
  { id: "hub", label: "hub", icon: Users },
] as const;

export function PreviewPane({ session, root }: { session?: Session; root: string }) {
  const desktop = useDesktop();
  const pane = desktop.ui.pane;
  const setPane = (next: (typeof TABS)[number]["id"]) => ui.set((prev) => ({ ...prev, pane: next }));

  if (!session) {
    return (
      <section className="flex min-w-0 flex-1 items-center justify-center border-l border-hairline surface-panel">
        <p className="max-w-xs px-6 text-center text-2xs text-muted-foreground">
          No session open — create one from the rail to mount the preview, diff and hub panes.
        </p>
      </section>
    );
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col border-l border-hairline surface-panel">
      <div className="flex items-center gap-1 border-b border-hairline px-2 py-1.5">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setPane(tab.id)}
            className={cn(
              "flex items-center gap-1.5 rounded px-2 py-1 font-mono text-2xs uppercase tracking-[0.08em] transition-colors",
              pane === tab.id ? "bg-secondary/70 text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <tab.icon className="size-3" />
            {tab.label}
            {tab.id === "hub" && session.subagents.length > 0 && <span className="text-ember">{session.subagents.length}</span>}
            {tab.id === "diff" && Object.keys(desktop.diffs).length > 0 && <span className="text-warn">{Object.keys(desktop.diffs).length}</span>}
          </button>
        ))}
      </div>

      {pane === "preview" && <PreviewTab root={root} />}
      {pane === "diff" && <DiffTab session={session} root={root} />}
      {pane === "terminal" && <TerminalTab session={session} root={root} />}
      {pane === "files" && <FileBrowser root={root} />}
      {pane === "hub" && <AgentHub session={session} />}
    </section>
  );
}

function PreviewTab({ root }: { root: string }) {
  const desktop = useDesktop();
  const [showAnchors, setShowAnchors] = useState(false);
  const [runOutput, setRunOutput] = useState<{ command: string; stdout: string; stderr: string; exitCode: number; durationMs: number } | null>(null);
  const files = useMemo(() => {
    void desktop.fsVersion;
    return workspace.paths(root);
  }, [root, desktop.fsVersion]);

  const path = desktop.ui.previewPath && files.includes(desktop.ui.previewPath) ? desktop.ui.previewPath : files[0];
  const content = path ? workspace.read(path) ?? "" : "";
  const isMarkdown = path?.endsWith(".md");
  const isHtml = path?.endsWith(".html");
  const isCode = Boolean(path && /\.(ts|tsx|js|jsx|json|yml|yaml)$/.test(path));

  const rendered = useMemo(() => {
    if (!path) return "";
    if (!showAnchors || !isCode) return content;
    return anchorsFor(content)
      .map((anchor) => `${anchor.line}:${anchor.hash}│${anchor.text}`)
      .join("\n");
  }, [content, isCode, path, showAnchors]);

  if (!path) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-2xs text-muted-foreground">
        Nothing to preview in {root}. Pick a file from the files tab.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 border-b border-hairline px-2 py-1.5">
        <FilePicker files={files} path={path} />
        <Button variant="ghost" size="sm" onClick={() => setShowAnchors((prev) => !prev)} className={cn(showAnchors && "text-ember")}>
          {showAnchors ? "hide anchors" : "show anchors"}
        </Button>
        {isCode && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const relative = path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
              const result = runCommand(workspace, root, `bun run ${relative}`);
              setRunOutput({
                command: `bun run ${relative}`,
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.exitCode,
                durationMs: result.durationMs,
              });
            }}
          >
            <Play className="size-3" /> run
          </Button>
        )}
        <span className="ml-auto font-mono text-2xs text-muted-foreground/60">
          {content.split("\n").length} lines · {content.length} bytes
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {isMarkdown ? (
          <div className="px-5 py-4">
            <Markdown text={content} />
          </div>
        ) : isHtml ? (
          <iframe title="preview" srcDoc={content} className="h-full w-full border-0 bg-white" />
        ) : (
          <pre className="whitespace-pre px-3 py-2 font-mono text-[11px] leading-5 text-foreground/90">{rendered}</pre>
        )}
      </div>

      {runOutput && (
        <div className="border-t border-hairline">
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <Terminal className="size-3 text-muted-foreground" />
            <span className="font-mono text-2xs text-foreground">$ {runOutput.command}</span>
            <span className={cn("font-mono text-2xs", runOutput.exitCode === 0 ? "text-ok" : "text-destructive")}>
              exit {runOutput.exitCode} · {formatDuration(runOutput.durationMs)}
            </span>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setRunOutput(null)}>
              dismiss
            </Button>
          </div>
          <pre className="max-h-52 overflow-auto whitespace-pre-wrap px-2.5 pb-2 font-mono text-[11px] leading-5 text-foreground/90">
            {[runOutput.stdout, runOutput.stderr].filter(Boolean).join("\n") || "(no output)"}
          </pre>
        </div>
      )}
    </div>
  );
}

function FilePicker({ files, path }: { files: string[]; path: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-[260px] justify-start font-mono">
          <FileCode className="size-3" />
          <span className="truncate">{shortPath(path, 34)}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-80 overflow-auto">
        <DropdownMenuLabel>workspace files</DropdownMenuLabel>
        {files.map((file) => (
          <DropdownMenuItem key={file} onSelect={() => openFile(file)}>
            <span className="truncate font-mono text-2xs">{shortPath(file, 40)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DiffTab({ session, root }: { session: Session; root: string }) {
  const desktop = useDesktop();
  const diffList: FileDiff[] = Object.values(desktop.diffs);
  const [selected, setSelected] = useState<string | null>(null);

  const status = useMemo(() => {
    void desktop.fsVersion;
    return workspace.status(root);
  }, [root, desktop.fsVersion]);

  const active = diffList.find((diff) => diff.path === selected) ?? diffList[0];

  if (diffList.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-hairline px-3 py-2 font-mono text-2xs text-muted-foreground">
          no patches this session · working tree has {status.length} changed path(s)
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {status.map((entry) => (
            <div key={entry.path} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-secondary/40">
              <span
                className={cn(
                  "font-mono text-2xs",
                  entry.status === "modified" ? "text-warn" : entry.status === "untracked" ? "text-flux" : "text-destructive",
                )}
              >
                {entry.status === "modified" ? "M" : entry.status === "untracked" ? "U" : "D"}
              </span>
              <button onClick={() => openFile(entry.path)} className="truncate font-mono text-2xs text-foreground hover:text-ember">
                {entry.path}
              </button>
            </div>
          ))}
          {status.length === 0 && <p className="text-2xs text-muted-foreground">Working tree clean. Ask the agent for a change and its patch lands here.</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-hairline px-2 py-1.5">
        {diffList.map((diff) => (
          <button
            key={diff.path}
            onClick={() => setSelected(diff.path)}
            className={cn(
              "shrink-0 rounded px-2 py-1 font-mono text-2xs transition-colors",
              active?.path === diff.path ? "bg-secondary/70 text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {shortPath(diff.path, 22)} <span className="text-ok">+{diff.added}</span> <span className="text-destructive">-{diff.removed}</span>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">{active && <DiffView diff={active} />}</div>
      <div className="border-t border-hairline px-3 py-1.5 font-mono text-2xs text-muted-foreground/70">
        session {session.id.slice(0, 14)} · patches verified against content-hash anchors before apply
      </div>
    </div>
  );
}

function TerminalTab({ session, root }: { session: Session; root: string }) {
  const calls: ToolCall[] = session.transcript
    .filter((item): item is { kind: "tool"; id: string; at: number; call: ToolCall } => item.kind === "tool")
    .map((item) => item.call)
    .filter((call) => call.blocks.some((block) => block.type === "terminal"));

  const log = useMemo(() => {
    const folder = workspace.folder(root);
    return folder?.head ?? [];
  }, [root]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
        <Terminal className="size-3.5 text-muted-foreground" />
        <span className="font-mono text-2xs text-foreground">workspace shell · {root}</span>
        <Badge tone="muted" className="ml-auto">
          {calls.length} command(s) this session
        </Badge>
      </div>
      <div className="min-h-0 flex-1 space-y-2.5 overflow-auto p-3">
        {calls.length === 0 && (
          <p className="text-2xs text-muted-foreground">
            No shell runs yet. Ask for “run the tests” and every command lands here with its real exit code.
          </p>
        )}
        {calls.map((call) => (
          <ToolCard key={call.id} call={call} dense />
        ))}
      </div>
      <div className="border-t border-hairline px-3 py-2">
        <p className="mono-label">recent commits</p>
        <div className="mt-1 space-y-0.5">
          {log.map((commit) => (
            <div key={commit.hash} className="flex items-center gap-2">
              <span className="font-mono text-2xs text-ember">{commit.hash}</span>
              <span className="min-w-0 flex-1 truncate text-2xs text-foreground/90">{commit.subject}</span>
              <span className="shrink-0 font-mono text-2xs text-muted-foreground/60">{commit.author.split(" ")[0]}</span>
            </div>
          ))}
          {log.length === 0 && <p className="text-2xs text-muted-foreground">No commits in this folder.</p>}
        </div>
      </div>
    </div>
  );
}
