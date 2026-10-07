import { Badge, Button } from "@/components/ui/primitives";
import type { Session, TranscriptItem } from "@/lib/omp/protocol";
import { abortTurn, runSuggestion } from "./actions";
import { useDesktop } from "@/lib/omp/state";
import { cn, formatClock, formatCost, formatTokens } from "./format";
import { ToolCard } from "./ToolCard";
import { AlertTriangle, CircleStop, Gauge, Loader2, Sparkles, User, Wand2, Zap } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

const SUGGESTIONS = [
  "the pi tests are failing, please fix them",
  "review the working tree",
  "clean up lint warnings",
  "run the tests",
  "explain src/leibniz.ts",
  "orchestrate: survey the project before I change anything",
];

export function Transcript({ session, running }: { session: Session; running: boolean }) {
  const { settings } = useDesktop();
  const endRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const pinned = useRef(true);

  const lastLength = session.transcript.length;
  useEffect(() => {
    if (!pinned.current) return;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lastLength, session.id, session.transcript[session.transcript.length - 1]]);

  const onScroll = () => {
    const node = scrollerRef.current;
    if (!node) return;
    pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120;
  };

  const streamed = useMemo(() => session.transcript.some((item) => item.kind === "assistant" && item.streaming), [session.transcript]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto"
        style={{ fontSize: `${settings.transcriptFontSize}px` }}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-5 py-5">
          {session.transcript.length === 0 && <Welcome session={session} />}
          {session.transcript.map((item) => (
            <Item key={item.id} item={item} />
          ))}
          {streamed && <span className="ml-1 inline-block h-3.5 w-1.5 animate-caret bg-ember" />}
          <div ref={endRef} />
        </div>
      </div>

      {session.status === "running" && (
        <div className="flex items-center gap-3 border-t border-hairline bg-panel/80 px-5 py-2">
          <Loader2 className="size-3.5 animate-spin text-flux" />
          <span className="font-mono text-2xs text-muted-foreground">
            turn running · {session.todos.filter((todo) => todo.status === "completed").length}/{session.todos.length} todos ·{" "}
            {session.subagents.filter((agent) => agent.status === "running").length} worker(s) active
          </span>
          <Button variant="ghost" size="sm" className="ml-auto text-destructive hover:text-destructive" onClick={abortTurn}>
            <CircleStop className="size-3" /> stop
          </Button>
        </div>
      )}

      <div className="flex items-center gap-3 border-t border-hairline bg-chrome/60 px-5 py-1.5">
        <Gauge className="size-3 text-muted-foreground" />
        <span className="font-mono text-2xs text-muted-foreground">
          ctx {formatTokens(session.usage.promptTokens)} in · {formatTokens(session.usage.completionTokens)} out
        </span>
        <span className="font-mono text-2xs text-muted-foreground/70">{formatCost(session.usage.costUsd)}</span>
        <span className="ml-auto font-mono text-2xs text-muted-foreground/70">{session.transcript.length} items</span>
      </div>
    </div>
  );
}

function Welcome({ session }: { session: Session }) {
  return (
    <div className="mt-6 rounded-lg border border-hairline bg-panel/60 p-5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-lg text-ember">π</span>
        <h2 className="text-sm font-semibold tracking-tight">
          {session.projectId ? "Project session ready" : "Detached chat"}
        </h2>
        {session.mode === "plan" && <Badge tone="warn">plan mode · read-only</Badge>}
      </div>
      <p className="mt-2 max-w-prose text-xs leading-5 text-muted-foreground">
        {session.projectId
          ? "Tools run against the project folders in this window: reads return anchored lines, edits are verified hashline patches, and bash output comes from the workspace itself."
          : "This chat has no project folder yet. Enter a project from the rail to give the agent a workspace, or keep going detached — tools fall back to the default folder."}
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            onClick={() => void runSuggestion(suggestion)}
            className="flex items-center gap-1.5 rounded-full border border-hairline bg-secondary/40 px-2.5 py-1 text-2xs text-muted-foreground transition-colors hover:border-ember/40 hover:text-ember"
          >
            {suggestion.startsWith("orchestrate") ? <Wand2 className="size-3" /> : <Sparkles className="size-3" />}
            {suggestion}
          </button>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "hashline edits", value: "anchor verified" },
          { label: "code intelligence", value: "lsp + biome" },
          { label: "subagents", value: "alt+a hub" },
          { label: "memory", value: "project scope" },
        ].map((entry) => (
          <div key={entry.label} className="rounded border border-hairline bg-chrome/50 px-2.5 py-1.5">
            <p className="mono-label">{entry.label}</p>
            <p className="mt-0.5 font-mono text-2xs text-foreground/90">{entry.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Item({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="flex flex-col items-end gap-1">
          <div className="flex max-w-[85%] items-start gap-2 rounded-lg border border-ember/25 bg-ember/[0.07] px-3 py-2">
            <User className="mt-0.5 size-3.5 shrink-0 text-ember" />
            <p className="whitespace-pre-wrap text-[1em] leading-5 text-foreground">{item.text}</p>
          </div>
          <div className="flex items-center gap-1.5">
            {item.keywords.map((keyword) => (
              <Badge key={keyword} tone="ember">
                <Zap className="size-2.5" /> {keyword}
              </Badge>
            ))}
            <span className="font-mono text-2xs text-muted-foreground/60">{formatClock(item.at)}</span>
          </div>
        </div>
      );

    case "assistant":
      return (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-ember">π</span>
            <span className="font-mono text-2xs text-muted-foreground">{item.model}</span>
            <Badge tone="muted">{item.role}</Badge>
            {item.streaming && <Loader2 className="size-3 animate-spin text-flux" />}
          </div>
          <div className="max-w-none space-y-2 border-l border-hairline pl-3">
            <Markdown text={item.text} />
          </div>
        </div>
      );

    case "tool":
      return (
        <div className="pl-0">
          <ToolCard call={item.call} />
        </div>
      );

    case "advisor":
      return (
        <div className={cn("rounded-md border px-3 py-2", item.severity === "blocker" ? "border-destructive/40 bg-destructive/5" : "border-warn/40 bg-warn/5")}>
          <div className="flex items-center gap-2">
            <AlertTriangle className={cn("size-3.5", item.severity === "blocker" ? "text-destructive" : "text-warn")} />
            <span className="font-mono text-2xs uppercase tracking-[0.1em] text-warn">
              advisor · {item.severity}
            </span>
            <span className="font-mono text-2xs text-muted-foreground">{item.model}</span>
          </div>
          <p className="mt-1 text-[1em] leading-5 text-foreground/90">{item.text}</p>
          <p className="mt-1 font-mono text-[0.85em] text-muted-foreground/70">
            read on its own context before the next tool call; the primary model sees this note and either course-corrects or explains why not
          </p>
        </div>
      );

    case "rule":
      return (
        <div className="rounded-md border border-warn/40 bg-warn/5 px-3 py-2">
          <div className="flex items-center gap-2">
            <Zap className="size-3.5 text-warn" />
            <span className="font-mono text-2xs uppercase tracking-[0.1em] text-warn">stream rule injected · {item.rule}</span>
          </div>
          <p className="mt-1 font-mono text-2xs text-muted-foreground">{item.reason}</p>
          <p className="mt-1 text-2xs text-muted-foreground/80">the stream was aborted mid-token, the rule body injected, and the turn retried from the same point</p>
        </div>
      );

    case "system":
      return (
        <div className={cn("rounded border px-3 py-1.5 font-mono text-2xs", item.tone === "warn" ? "border-warn/30 bg-warn/5 text-warn" : "border-hairline bg-secondary/30 text-muted-foreground")}>
          {item.text}
        </div>
      );

    case "error":
      return (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
          <div className="min-w-0">
            <p className="text-[1em] text-foreground/90">{item.text}</p>
            {item.retryable && <p className="mt-1 font-mono text-2xs text-muted-foreground">retry available from the composer</p>}
          </div>
        </div>
      );

    default:
      return null;
  }
}

/** Markdown-lite: headings, bullets, bold and inline code — no dependency needed. */
export function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, blockIndex) => {
        const rows = block.split("\n");
        const isList = rows.every((row) => row.trim() === "" || /^[-·]\s/.test(row.trim()));
        if (isList) {
          return (
            <ul key={blockIndex} className="space-y-1">
              {rows
                .filter((row) => row.trim() !== "")
                .map((row, rowIndex) => (
                  <li key={rowIndex} className="flex gap-2 text-[1em] leading-5 text-foreground/90">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-ember/70" />
                    <span>{inline(row.replace(/^\s*[-·]\s*/, ""))}</span>
                  </li>
                ))}
            </ul>
          );
        }
        if (/^#{1,3}\s/.test(block.trim())) {
          return (
            <h3 key={blockIndex} className="text-[1em] font-semibold uppercase tracking-[0.08em] text-foreground">
              {inline(block.replace(/^#{1,3}\s/, ""))}
            </h3>
          );
        }
        return (
          <p key={blockIndex} className="whitespace-pre-wrap text-[1em] leading-5 text-foreground/90">
            {inline(block)}
          </p>
        );
      })}
    </>
  );
}

function inline(text: string) {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let index = 0;
  let match = pattern.exec(text);
  while (match) {
    if (match.index > index) nodes.push(text.slice(index, match.index));
    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(
        <strong key={`${match.index}-b`} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      nodes.push(
        <code key={`${match.index}-c`} className="rounded border border-hairline bg-secondary/60 px-1 font-mono text-[0.88em] text-ember">
          {token.slice(1, -1)}
        </code>,
      );
    }
    index = match.index + token.length;
    match = pattern.exec(text);
  }
  if (index < text.length) nodes.push(text.slice(index));
  return nodes;
}
