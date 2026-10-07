import { Badge, Button } from "@/components/ui/primitives";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  activeConnectionId,
  addProject,
  createSession,
  deleteSession,
  enterProject,
  groupSessions,
  openSettings,
  renameSession,
  selectSession,
  togglePin,
  useDesktop,
} from "@/lib/omp/state";
import type { Session } from "@/lib/omp/protocol";
import { cn, formatRelative, shortPath } from "./format";
import { FileBrowser } from "./FileBrowser";
import { Boxes, CircleDot, FolderGit2, GitBranch, Layers, MessageSquare, Pin, Plus, Settings2, Terminal, Trash2 } from "lucide-react";
import { useState } from "react";

export function LeftRail() {
  const desktop = useDesktop();
  const [tab, setTab] = useState<"sessions" | "projects" | "files">("sessions");
  const groups = groupSessions(desktop.sessions, desktop.projects);
  const connection = desktop.connections.find((entry) => entry.id === desktop.activeConnectionId) ?? desktop.connections[0];
  const root =
    desktop.projects.find((entry) => entry.id === desktop.activeProjectId)?.folders.find((folder) => folder.kind === "primary")?.path ?? "/work/pi-lab";

  return (
    <aside className="flex w-[254px] shrink-0 flex-col border-r border-hairline surface-rail">
      <ConnectionSwitcher name={connection?.name ?? "Bundled omp runtime"} mode={connection?.mode ?? "local"} latency={connection?.lastLatencyMs} />

      <div className="flex items-center gap-0.5 border-b border-hairline px-1.5 py-1.5">
        {(
          [
            { id: "sessions", label: "sessions", icon: MessageSquare },
            { id: "projects", label: "projects", icon: Layers },
            { id: "files", label: "files", icon: FolderGit2 },
          ] as const
        ).map((entry) => (
          <button
            key={entry.id}
            onClick={() => setTab(entry.id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 font-mono text-2xs uppercase tracking-[0.08em] transition-colors",
              tab === entry.id ? "bg-secondary/70 text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <entry.icon className="size-3" />
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "sessions" && (
        <>
          <div className="flex items-center gap-1.5 border-b border-hairline px-2 py-1.5">
            <Button variant="ghost" size="sm" className="flex-1 justify-start" onClick={() => createSession({ detach: false })}>
              <Plus className="size-3" /> new chat
            </Button>
            <Button variant="ghost" size="icon-sm" title="Detached chat" onClick={() => createSession({ detach: true, title: "Detached chat" })}>
              <CircleDot className="size-3" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-1.5 py-1.5">
            {groups.map((group) => (
              <div key={group.project?.id ?? "detached"} className="mb-2">
                <div className="flex items-center gap-1.5 px-1.5 py-1">
                  {group.project ? <GitBranch className="size-3 text-ember/80" /> : <CircleDot className="size-3 text-muted-foreground" />}
                  <span className="truncate font-mono text-2xs text-muted-foreground">{group.project?.name ?? "detached"}</span>
                  {group.project && group.project.id !== desktop.activeProjectId && (
                    <button
                      className="ml-auto font-mono text-2xs text-muted-foreground/60 hover:text-ember"
                      onClick={() => enterProject(group.project!.id)}
                    >
                      enter
                    </button>
                  )}
                </div>
                {group.sessions.map((session) => (
                  <SessionRow key={session.id} session={session} active={session.id === desktop.activeSessionId} />
                ))}
              </div>
            ))}
            {groups.length === 0 && <p className="px-2 py-3 text-2xs text-muted-foreground">No sessions yet.</p>}
          </div>
        </>
      )}

      {tab === "projects" && (
        <div className="min-h-0 flex-1 overflow-auto px-1.5 py-2">
          {desktop.projects.map((entry) => {
            const chats = desktop.sessions.filter((session) => session.projectId === entry.id).length;
            const active = entry.id === desktop.activeProjectId;
            return (
              <div key={entry.id} className={cn("mb-2 rounded-md border px-2 py-1.5", active ? "border-ember/40 bg-ember/5" : "border-hairline")}>
                <div className="flex items-center gap-1.5">
                  <Boxes className="size-3.5 text-ember" />
                  <span className="truncate font-mono text-2xs text-foreground">{entry.name}</span>
                  <Badge tone={active ? "ember" : "muted"} className="ml-auto">
                    {entry.folders.length} folder{entry.folders.length === 1 ? "" : "s"}
                  </Badge>
                </div>
                <div className="mt-1 space-y-0.5">
                  {entry.folders.map((folder) => (
                    <div key={folder.path} className="flex items-center gap-1.5">
                      <GitBranch className="size-2.5 text-muted-foreground" />
                      <span className="truncate font-mono text-2xs text-muted-foreground">{shortPath(folder.path, 26)}</span>
                      <span className="ml-auto shrink-0 font-mono text-2xs text-muted-foreground/60">{folder.branch}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 flex items-center gap-1">
                  <Button variant="outline" size="sm" onClick={() => enterProject(entry.id)} disabled={active}>
                    {active ? "active" : "enter project"}
                  </Button>
                  <span className="ml-auto font-mono text-2xs text-muted-foreground/60">{chats} chat(s)</span>
                </div>
              </div>
            );
          })}
          <AddProjectButton />
        </div>
      )}

      {tab === "files" && <FileBrowser root={root} />}

      <div className="border-t border-hairline p-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-start font-mono">
              <Settings2 className="size-3" /> settings
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start">
            <DropdownMenuLabel>desktop settings</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => openSettings("providers")}>providers &amp; models</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openSettings("connections")}>connections</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openSettings("tools")}>tools &amp; permissions</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openSettings("memory")}>memory</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openSettings("rules")}>stream rules</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openSettings("shortcuts")}>keyboard shortcuts</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openSettings("appearance")}>appearance</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => openSettings("about")}>about &amp; boot log</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}

function AddProjectButton() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("/work/");

  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setOpen(true)}>
        <Plus className="size-3" /> add project
      </Button>
    );
  }

  return (
    <div className="mt-1 space-y-1.5 rounded-md border border-hairline p-2">
      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="project name"
        className="w-full rounded border border-hairline bg-background px-1.5 py-1 font-mono text-2xs text-foreground outline-none focus:border-ember/40"
      />
      <input
        value={folder}
        onChange={(event) => setFolder(event.target.value)}
        placeholder="/path/to/folder"
        className="w-full rounded border border-hairline bg-background px-1.5 py-1 font-mono text-2xs text-foreground outline-none focus:border-ember/40"
      />
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          onClick={() => {
            if (!name.trim() || !folder.trim()) return;
            addProject(name.trim(), folder.trim());
            setName("");
            setOpen(false);
          }}
        >
          create
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          cancel
        </Button>
      </div>
    </div>
  );
}

function ConnectionSwitcher({ name, mode, latency }: { name: string; mode: string; latency?: number }) {
  const desktop = useDesktop();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 border-b border-hairline px-2.5 py-2 text-left hover:bg-secondary/40">
          <span className={cn("size-1.5 shrink-0 rounded-full", mode === "local" ? "bg-ok" : "bg-flux")} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-mono text-2xs text-foreground">{name}</span>
            <span className="block font-mono text-2xs text-muted-foreground/70">
              {mode} gateway{latency !== undefined ? ` · ${latency}ms` : ""}
            </span>
          </span>
          <Terminal className="size-3 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[250px]">
        <DropdownMenuLabel>connections</DropdownMenuLabel>
        {desktop.connections.map((entry) => (
          <DropdownMenuItem key={entry.id} onSelect={() => activeConnectionId.set(entry.id)}>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-2xs text-foreground">{entry.name}</span>
              <span className="block truncate font-mono text-2xs text-muted-foreground/70">
                {entry.mode} · {entry.authMode}
                {entry.url ? ` · ${entry.url}` : ""}
              </span>
            </span>
            {entry.id === desktop.activeConnectionId && <span className="text-ember">●</span>}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openSettings("connections")}>manage connections…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SessionRow({ session, active }: { session: Session; active: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);

  return (
    <div
      className={cn(
        "group mb-0.5 flex cursor-pointer items-start gap-1.5 rounded px-1.5 py-1.5 transition-colors",
        active ? "bg-secondary/70" : "hover:bg-secondary/40",
      )}
      onClick={() => selectSession(session.id)}
    >
      <span
        className={cn(
          "mt-1 size-1.5 shrink-0 rounded-full",
          session.status === "running" ? "animate-pulse bg-flux" : session.pinned ? "bg-ember" : "bg-muted-foreground/40",
        )}
      />
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              renameSession(session.id, draft);
              setEditing(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                renameSession(session.id, draft);
                setEditing(false);
              }
              if (event.key === "Escape") setEditing(false);
            }}
            className="w-full rounded border border-ember/40 bg-background px-1 font-mono text-2xs text-foreground outline-none"
          />
        ) : (
          <p
            onDoubleClick={() => {
              setDraft(session.title);
              setEditing(true);
            }}
            className={cn("truncate text-2xs", active ? "text-foreground" : "text-foreground/80")}
          >
            {session.title}
          </p>
        )}
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className="font-mono text-2xs text-muted-foreground/60">{formatRelative(session.updatedAt)}</span>
          <span className="font-mono text-2xs text-muted-foreground/50">{session.mode}</span>
          {!session.projectId && <span className="font-mono text-2xs text-muted-foreground/50">detached</span>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          className="rounded p-0.5 text-muted-foreground hover:text-ember"
          title="Pin"
          onClick={(event) => {
            event.stopPropagation();
            togglePin(session.id);
          }}
        >
          <Pin className="size-3" />
        </button>
        <button
          className="rounded p-0.5 text-muted-foreground hover:text-destructive"
          title="Delete"
          onClick={(event) => {
            event.stopPropagation();
            deleteSession(session.id);
          }}
        >
          <Trash2 className="size-3" />
        </button>
      </div>
    </div>
  );
}
