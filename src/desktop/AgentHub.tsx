import { Badge, Button } from "@/components/ui/primitives";
import type { Session, Subagent } from "@/lib/omp/protocol";
import { updateSession } from "@/lib/omp/state";
import { cn, formatCost, formatTokens } from "./format";
import { ToolCard } from "./ToolCard";
import { GitBranch, Send, Skull, Users, Zap } from "lucide-react";
import { useState } from "react";

export function AgentHub({ session }: { session: Session }) {
  const [selectedId, setSelectedId] = useState<string | null>(session.subagents[0]?.id ?? null);
  const selected = session.subagents.find((agent) => agent.id === selectedId) ?? session.subagents[0];

  if (session.subagents.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <Users className="size-5 text-muted-foreground" />
        <p className="text-xs text-foreground">No subagents in this session</p>
        <p className="max-w-sm text-2xs text-muted-foreground">
          Ask for a task with the <span className="font-mono text-ember">orchestrate</span> keyword, or run{" "}
          <span className="font-mono text-ember">/review</span> to fan out reviewers. Each worker gets its own tool surface and an isolated
          worktree when it writes.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="w-[232px] shrink-0 overflow-auto border-r border-hairline p-1.5">
        {session.subagents.map((agent) => (
          <button
            key={agent.id}
            onClick={() => setSelectedId(agent.id)}
            className={cn(
              "mb-1 flex w-full flex-col gap-1 rounded border px-2 py-1.5 text-left transition-colors",
              agent.id === selected?.id ? "border-ember/40 bg-ember/5" : "border-hairline hover:bg-secondary/40",
            )}
          >
            <div className="flex items-center gap-1.5">
              <span className={cn("size-1.5 rounded-full", statusColor(agent.status))} />
              <span className="truncate font-mono text-2xs text-foreground">{agent.name}</span>
              <Badge tone={agent.status === "done" ? "ok" : agent.status === "running" ? "flux" : "muted"} className="ml-auto">
                {agent.status}
              </Badge>
            </div>
            <span className="truncate text-2xs text-muted-foreground">{agent.task}</span>
            <span className="font-mono text-2xs text-muted-foreground/60">
              {agent.toolCalls} calls · {formatTokens(agent.tokens)} · {formatCost(agent.costUsd)}
            </span>
          </button>
        ))}
      </div>

      {selected && <AgentDetail agent={selected} sessionId={session.id} />}
    </div>
  );
}

function statusColor(status: Subagent["status"]): string {
  switch (status) {
    case "running":
      return "bg-flux animate-pulse";
    case "done":
      return "bg-ok";
    case "parked":
      return "bg-warn";
    case "killed":
      return "bg-destructive";
    default:
      return "bg-muted-foreground/40";
  }
}

function AgentDetail({ agent, sessionId }: { agent: Subagent; sessionId: string }) {
  const [steer, setSteer] = useState("");

  const send = () => {
    const text = steer.trim();
    if (!text) return;
    updateSession(sessionId, (session) => ({
      ...session,
      subagents: session.subagents.map((entry) =>
        entry.id === agent.id
          ? {
              ...entry,
              steering: [...entry.steering, text],
              transcript: [...entry.transcript, { kind: "system", id: `steer_${Date.now()}`, at: Date.now(), text: `steering · ${text}` }],
            }
          : entry,
      ),
    }));
    setSteer("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
        <Users className="size-3.5 text-ember" />
        <span className="font-mono text-xs text-foreground">{agent.name}</span>
        <Badge tone={agent.status === "done" ? "ok" : agent.status === "running" ? "flux" : "muted"}>{agent.status}</Badge>
        {agent.isolatedWorktree && (
          <span className="flex items-center gap-1 font-mono text-2xs text-muted-foreground">
            <GitBranch className="size-3" /> {agent.isolatedWorktree}
          </span>
        )}
        <span className="ml-auto font-mono text-2xs text-muted-foreground/70">
          {formatTokens(agent.tokens)} tokens · {formatCost(agent.costUsd)}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() =>
            updateSession(sessionId, (session) => ({
              ...session,
              subagents: session.subagents.map((entry) => (entry.id === agent.id ? { ...entry, status: "killed" } : entry)),
            }))
          }
        >
          <Skull className="size-3" /> kill
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
        <p className="text-2xs text-muted-foreground">{agent.task}</p>
        {agent.transcript.map((item) => {
          if (item.kind === "tool") return <ToolCard key={item.id} call={item.call} dense />;
          if (item.kind === "system")
            return (
              <p key={item.id} className="font-mono text-2xs text-muted-foreground">
                {item.text}
              </p>
            );
          return null;
        })}

        {agent.findings.length > 0 && (
          <div className="rounded border border-hairline bg-secondary/25 px-2.5 py-2">
            <p className="mono-label">findings</p>
            <ul className="mt-1 space-y-1">
              {agent.findings.map((finding) => (
                <li key={finding} className="text-2xs text-foreground/90">
                  · {finding}
                </li>
              ))}
            </ul>
          </div>
        )}

        {agent.steering.length > 0 && (
          <div className="rounded border border-flux/30 bg-flux/5 px-2.5 py-2">
            <p className="mono-label">steering history</p>
            <ul className="mt-1 space-y-1">
              {agent.steering.map((entry, index) => (
                <li key={`${entry}-${index}`} className="flex items-start gap-1.5 text-2xs text-foreground/90">
                  <Zap className="mt-0.5 size-2.5 shrink-0 text-flux" />
                  {entry}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 border-t border-hairline px-2 py-2">
        <input
          value={steer}
          onChange={(event) => setSteer(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") send();
          }}
          placeholder="steer this worker — it lands in its transcript"
          className="h-7 flex-1 rounded border border-hairline bg-background px-2 font-mono text-2xs text-foreground outline-none focus:border-ember/40"
        />
        <Button size="sm" onClick={send} disabled={steer.trim().length === 0}>
          <Send className="size-3" /> steer
        </Button>
      </div>
    </div>
  );
}
