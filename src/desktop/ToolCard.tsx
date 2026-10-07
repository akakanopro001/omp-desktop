import { Badge, Button } from "@/components/ui/primitives";
import { TOOL_SPECS } from "@/lib/omp/catalog";
import type { Subagent, ToolBlock, ToolCall, TodoItem } from "@/lib/omp/protocol";
import { cn, formatDuration, relativeTimeText, shortPath, truncate } from "./format";
import { DiffView } from "./DiffView";
import { openFile } from "@/lib/omp/state";
import {
  AlertTriangle,
  Bug,
  Check,
  CircleDashed,
  Cpu,
  FileCode,
  FileSearch,
  Hammer,
  ListChecks,
  Loader2,
  MemoryStick,
  Play,
  Search,
  ShieldAlert,
  Terminal,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";

const TOOL_ICON: Record<string, typeof FileCode> = {
  read: FileCode,
  write: Hammer,
  edit: Hammer,
  ast_edit: Hammer,
  ast_grep: Search,
  grep: Search,
  glob: FileSearch,
  bash: Terminal,
  eval: Cpu,
  lsp: Bug,
  debug: Bug,
  security_scan: ShieldAlert,
  task: Users,
  wait: CircleDashed,
  todo: ListChecks,
  ask: AlertTriangle,
  browser: Play,
  computer: Cpu,
  web_search: Search,
  github: FileSearch,
  retain: MemoryStick,
  recall: MemoryStick,
  reflect: MemoryStick,
  memory_edit: MemoryStick,
  learn: MemoryStick,
  manage_skill: MemoryStick,
};

const GROUP_TONE: Record<string, "muted" | "ember" | "flux" | "warn" | "ok"> = {
  files: "ember",
  runtime: "warn",
  intelligence: "flux",
  coordination: "ok",
  desktop: "muted",
  memory: "flux",
};

export function ToolCard({ call, dense = false }: { call: ToolCall; dense?: boolean }) {
  const spec = TOOL_SPECS.find((entry) => entry.name === call.name);
  const Icon = TOOL_ICON[call.name] ?? Hammer;
  const duration = call.endedAt ? formatDuration(call.endedAt - call.startedAt) : undefined;

  return (
    <div className={cn("group rounded-md border border-hairline bg-panel/70", dense && "bg-panel/40")}>
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <StatusGlyph status={call.status} />
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <Badge tone={GROUP_TONE[spec?.group ?? "files"] ?? "muted"} className="shrink-0">
          {call.name}
        </Badge>
        <span className="min-w-0 flex-1 truncate font-mono text-2xs text-foreground/90">{call.target ?? call.summary}</span>
        {duration && <span className="shrink-0 font-mono text-2xs text-muted-foreground/70">{duration}</span>}
        {call.status === "proposed" && (
          <Badge tone="warn" className="shrink-0">
            proposed
          </Badge>
        )}
      </div>

      {call.blocks.length > 0 && (
        <div className="space-y-2 border-t border-hairline px-2.5 py-2">
          {call.blocks.map((block, index) => (
            <Block key={`${call.id}-${index}`} block={block} />
          ))}
        </div>
      )}
    </div>
  );
}

function StatusGlyph({ status }: { status: ToolCall["status"] }) {
  if (status === "running") return <Loader2 className="size-3.5 shrink-0 animate-spin text-flux" />;
  if (status === "error") return <X className="size-3.5 shrink-0 text-destructive" />;
  if (status === "proposed") return <CircleDashed className="size-3.5 shrink-0 text-warn" />;
  return <Check className="size-3.5 shrink-0 text-ok" />;
}

function Block({ block }: { block: ToolBlock }) {
  switch (block.type) {
    case "text":
      return <p className="whitespace-pre-wrap text-xs text-foreground/90">{block.text}</p>;

    case "code":
      return <CodeBlock code={block.code} language={block.language} caption={block.caption} />;

    case "diff":
      return (
        <div className="space-y-2">
          {block.files.map((file) => (
            <DiffView key={file.path} diff={file} compact />
          ))}
        </div>
      );

    case "hits":
      return (
        <div className="overflow-hidden rounded border border-hairline">
          <div className="border-b border-hairline bg-secondary/40 px-2.5 py-1 font-mono text-2xs text-muted-foreground">
            {block.hits.length} hit(s) for /{block.query}/
          </div>
          <div className="max-h-52 overflow-auto">
            {block.hits.map((hit) => (
              <button
                key={`${hit.path}:${hit.line}`}
                onClick={() => openFile(hit.path)}
                className="flex w-full items-start gap-2 px-2.5 py-1 text-left hover:bg-secondary/50"
              >
                <span className="shrink-0 font-mono text-2xs text-ember">
                  {shortPath(hit.path, 26)}:{hit.line}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground">{hit.text.trim()}</span>
              </button>
            ))}
          </div>
        </div>
      );

    case "paths":
      return (
        <div className="flex max-h-44 flex-wrap gap-1 overflow-auto">
          {block.paths.map((path) => (
            <button
              key={path}
              onClick={() => openFile(path)}
              className="rounded border border-hairline bg-secondary/40 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground hover:border-ember/40 hover:text-ember"
            >
              {shortPath(path, 30)}
            </button>
          ))}
        </div>
      );

    case "diagnostics":
      return (
        <div className="overflow-hidden rounded border border-hairline">
          {block.server && (
            <div className="border-b border-hairline bg-secondary/40 px-2.5 py-1 font-mono text-2xs text-muted-foreground">{block.server}</div>
          )}
          {block.diagnostics.length === 0 ? (
            <div className="px-2.5 py-2 font-mono text-2xs text-ok">0 diagnostics</div>
          ) : (
            block.diagnostics.map((diagnostic) => (
              <button
                key={`${diagnostic.path}:${diagnostic.line}:${diagnostic.code}`}
                onClick={() => openFile(diagnostic.path)}
                className="flex w-full items-start gap-2 border-b border-hairline/60 px-2.5 py-1.5 text-left last:border-b-0 hover:bg-secondary/40"
              >
                <span
                  className={cn(
                    "shrink-0 font-mono text-2xs uppercase",
                    diagnostic.severity === "error" ? "text-destructive" : diagnostic.severity === "warning" ? "text-warn" : "text-muted-foreground",
                  )}
                >
                  {diagnostic.severity}
                </span>
                <span className="shrink-0 font-mono text-2xs text-ember">
                  {shortPath(diagnostic.path, 24)}:{diagnostic.line}
                </span>
                <span className="min-w-0 flex-1 text-2xs text-foreground/90">{diagnostic.message}</span>
                <span className="shrink-0 font-mono text-2xs text-muted-foreground/70">{diagnostic.source}</span>
              </button>
            ))
          )}
        </div>
      );

    case "subagents":
      return (
        <div className="space-y-1.5">
          {block.agents.map((agent) => (
            <SubagentRow key={agent.id} agent={agent} />
          ))}
        </div>
      );

    case "todos":
      return <TodoList items={block.items} />;

    case "memory":
      return (
        <div className="rounded border border-flux/30 bg-flux/5 px-2.5 py-2">
          <p className="font-mono text-2xs text-flux">{block.action}</p>
          <ul className="mt-1 space-y-1">
            {block.facts.map((fact) => (
              <li key={fact} className="text-2xs text-foreground/90">
                · {fact}
              </li>
            ))}
          </ul>
        </div>
      );

    case "note": {
      const tones = {
        info: "border-hairline bg-secondary/40 text-foreground/90",
        ok: "border-ok/30 bg-ok/5 text-foreground/90",
        warn: "border-warn/40 bg-warn/5 text-foreground/90",
        danger: "border-destructive/40 bg-destructive/5 text-foreground/90",
      } as const;
      return (
        <div className={cn("rounded border px-2.5 py-2", tones[block.tone])}>
          <p className="text-xs font-medium">{block.title}</p>
          {block.body && <p className="mt-1 whitespace-pre-wrap font-mono text-2xs text-muted-foreground">{block.body}</p>}
        </div>
      );
    }

    case "terminal":
      return (
        <div className="overflow-hidden rounded border border-hairline bg-chrome">
          <div className="flex items-center gap-2 border-b border-hairline px-2.5 py-1">
            <Terminal className="size-3 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-mono text-2xs text-foreground">$ {block.command}</span>
            <span className={cn("shrink-0 font-mono text-2xs", block.exitCode === 0 ? "text-ok" : "text-destructive")}>exit {block.exitCode}</span>
          </div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-2.5 py-2 font-mono text-[11px] leading-5 text-foreground/90">
            {[block.stdout, block.stderr].filter(Boolean).join("\n") || "(no output)"}
          </pre>
        </div>
      );

    default:
      return null;
  }
}

export function CodeBlock({ code, language, caption }: { code: string; language?: string; caption?: string }) {
  const [expanded, setExpanded] = useState(false);
  const rows = code.split("\n");
  const clipped = !expanded && rows.length > 22;
  return (
    <div className="overflow-hidden rounded border border-hairline bg-chrome/70">
      {caption && <div className="border-b border-hairline px-2.5 py-1 font-mono text-2xs text-muted-foreground">{caption}</div>}
      <pre className="max-h-[420px] overflow-auto px-2.5 py-2 font-mono text-[11px] leading-5 text-foreground/90">
        {clipped ? `${rows.slice(0, 22).join("\n")}\n…` : code}
      </pre>
      {(clipped || language === "markdown") && (
        <div className="flex items-center justify-between border-t border-hairline px-2.5 py-1">
          <span className="font-mono text-2xs text-muted-foreground/70">{language ?? "text"}</span>
          <Button variant="ghost" size="sm" onClick={() => setExpanded((prev) => !prev)}>
            {expanded ? "collapse" : `expand · ${rows.length} lines`}
          </Button>
        </div>
      )}
    </div>
  );
}

function TodoList({ items }: { items: TodoItem[] }) {
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item.id} className="flex items-start gap-2">
          <span
            className={cn(
              "mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border",
              item.status === "completed" ? "border-ok/50 bg-ok/20 text-ok" : item.status === "in_progress" ? "border-flux/50 bg-flux/20" : "border-hairline",
            )}
          >
            {item.status === "completed" ? <Check className="size-2.5" /> : item.status === "in_progress" ? <Loader2 className="size-2.5 animate-spin text-flux" /> : null}
          </span>
          <span className={cn("text-2xs", item.status === "completed" ? "text-muted-foreground line-through" : "text-foreground/90")}>{item.text}</span>
          {item.phase && <span className="ml-auto shrink-0 font-mono text-2xs text-muted-foreground/60">{item.phase}</span>}
        </li>
      ))}
    </ul>
  );
}

export function SubagentRow({ agent }: { agent: Subagent }) {
  const tone =
    agent.status === "done" ? "ok" : agent.status === "running" ? "flux" : agent.status === "killed" ? "danger" : agent.status === "parked" ? "warn" : "muted";
  return (
    <div className="rounded border border-hairline bg-secondary/25 px-2.5 py-1.5">
      <div className="flex items-center gap-2">
        <Users className="size-3.5 text-muted-foreground" />
        <span className="font-mono text-2xs text-foreground">{agent.name}</span>
        <Badge tone={tone as "ok" | "flux" | "danger" | "warn" | "muted"}>{agent.status}</Badge>
        <span className="ml-auto font-mono text-2xs text-muted-foreground/70">
          {agent.toolCalls} calls · {relativeTimeText(agent.durationMs)} · ${agent.costUsd.toFixed(3)}
        </span>
      </div>
      <p className="mt-1 text-2xs text-muted-foreground">{truncate(agent.task, 150)}</p>
      {agent.isolatedWorktree && <p className="mt-0.5 font-mono text-2xs text-muted-foreground/60">worktree {agent.isolatedWorktree}</p>}
      {agent.findings.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {agent.findings.map((finding) => (
            <li key={finding} className="text-2xs text-foreground/90">
              · {finding}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
