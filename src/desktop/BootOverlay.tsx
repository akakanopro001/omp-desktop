import { Badge, Button, Input, Label } from "@/components/ui/primitives";
import { AGENT_MODES, DEFAULT_MODEL, PROVIDERS } from "@/lib/omp/catalog";
import type { AgentMode } from "@/lib/omp/protocol";
import { bootDesktop, completeOnboarding, useDesktop } from "@/lib/omp/state";
import { cn } from "./format";
import { AlertTriangle, Check, Loader2, Terminal } from "lucide-react";
import { useState } from "react";
import { motion } from "framer-motion";

export function BootOverlay() {
  const desktop = useDesktop();
  const [model, setModel] = useState(desktop.settings.modelRoles.default ?? DEFAULT_MODEL);
  const [mode, setMode] = useState<AgentMode>("agent");
  const [folder, setFolder] = useState("/work/pi-lab");

  const state = desktop.boot;
  if (state.stage === "ready") return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/95 px-6 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="w-full max-w-3xl overflow-hidden rounded-xl border border-hairline bg-panel shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-hairline px-5 py-3.5 radial-ember">
          <span className="font-mono text-2xl leading-none text-ember">π</span>
          <div>
            <h1 className="text-sm font-semibold tracking-tight">Oh My Pi Desktop</h1>
            <p className="font-mono text-2xs text-muted-foreground">
              {state.stage === "onboarding" ? "first run · pick a provider and model" : "resolving a runnable agent runtime"}
            </p>
          </div>
          <Badge tone={state.stage === "damaged" ? "danger" : "flux"} className="ml-auto">
            {state.stage}
          </Badge>
        </div>

        <div className="grid gap-5 p-5 md:grid-cols-2">
          <div>
            <p className="mono-label">boot stages</p>
            <ol className="mt-2 space-y-1.5">
              {state.stages.map((stage) => (
                <li key={stage.id} className="flex items-start gap-2 rounded border border-hairline px-2.5 py-1.5">
                  {stage.state === "active" ? (
                    <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-flux" />
                  ) : stage.state === "done" ? (
                    <Check className="mt-0.5 size-3.5 shrink-0 text-ok" />
                  ) : stage.state === "failed" ? (
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                  ) : (
                    <span className="mt-1.5 size-2 shrink-0 rounded-full border border-hairline" />
                  )}
                  <div className="min-w-0">
                    <p className={cn("text-2xs", stage.state === "pending" ? "text-muted-foreground" : "text-foreground")}>{stage.label}</p>
                    {stage.detail && <p className="truncate font-mono text-2xs text-muted-foreground/70">{stage.detail}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div>
            <p className="mono-label">runtime resolution order</p>
            <div className="mt-2 space-y-1.5">
              {state.candidates.map((candidate) => (
                <div key={candidate.kind} className="rounded border border-hairline px-2.5 py-1.5">
                  <div className="flex items-center gap-2">
                    <Badge tone={candidate.state === "ok" ? "ok" : candidate.state === "probing" ? "flux" : "muted"}>{candidate.state}</Badge>
                    <span className="truncate font-mono text-2xs text-foreground">{candidate.label}</span>
                  </div>
                  {candidate.command && <p className="mt-0.5 font-mono text-2xs text-muted-foreground/70">{candidate.command}</p>}
                </div>
              ))}
              {state.candidates.length === 0 && <p className="text-2xs text-muted-foreground">probing…</p>}
            </div>

            <p className="mono-label mt-4">gateway capabilities</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {state.capabilities
                ? Object.entries(state.capabilities)
                    .filter(([key]) => key !== "auth")
                    .map(([key, value]) => (
                      <Badge key={key} tone={value ? "ok" : "muted"}>
                        {key} {value ? "✓" : "—"}
                      </Badge>
                    ))
                : <span className="font-mono text-2xs text-muted-foreground">not probed yet</span>}
            </div>
          </div>
        </div>

        {state.stage === "onboarding" && (
          <div className="border-t border-hairline p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>default model</Label>
                <select
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  className="mt-1.5 h-8 w-full rounded border border-hairline bg-background px-2 font-mono text-2xs text-foreground outline-none"
                >
                  {PROVIDERS.map((provider) => (
                    <optgroup key={provider.id} label={`${provider.name} · ${provider.auth}`}>
                      {provider.models.map((entry) => (
                        <option key={entry.selector} value={entry.selector}>
                          {entry.name} — {entry.selector}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <Label className="mt-3 block">turn mode</Label>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  {AGENT_MODES.map((entry) => (
                    <button
                      key={entry.id}
                      onClick={() => setMode(entry.id)}
                      className={cn(
                        "rounded border px-2 py-1.5 text-left",
                        mode === entry.id ? "border-ember/40 bg-ember/5" : "border-hairline hover:bg-secondary/40",
                      )}
                    >
                      <span className="font-mono text-2xs text-foreground">{entry.name}</span>
                      <p className="text-2xs text-muted-foreground">{entry.detail}</p>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label>default project folder</Label>
                <Input className="mt-1.5" value={folder} onChange={(event) => setFolder(event.target.value)} />
                <p className="mt-1.5 text-2xs text-muted-foreground">
                  Bare chats stay detached until you enter a project; this folder is what the tools fall back to. Everything below it is readable by
                  the agent, and destructive tools stay gated behind approval.
                </p>
                <div className="mt-3 rounded border border-hairline bg-chrome px-2.5 py-2">
                  <p className="flex items-center gap-1.5 font-mono text-2xs text-muted-foreground">
                    <Terminal className="size-3" /> omp --mode rpc --stdio
                  </p>
                  <p className="mt-1 font-mono text-2xs text-muted-foreground/70">
                    JSON-RPC + WebSocket gateway · sessions, file browser, LSP and the subagent roster are all served from here
                  </p>
                </div>
                <Button className="mt-3 w-full" onClick={() => completeOnboarding({ model, mode, projectFolder: folder })}>
                  Start the workspace
                </Button>
              </div>
            </div>
          </div>
        )}

        {state.stage === "damaged" && (
          <div className="border-t border-hairline p-5">
            <div className="flex items-start gap-2 rounded border border-destructive/40 bg-destructive/5 px-3 py-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
              <div>
                <p className="text-xs text-foreground">{state.error ?? "The bundled payload is unusable."}</p>
                <p className="mt-1 text-2xs text-muted-foreground">
                  The app reports damage instead of adopting an arbitrary <span className="font-mono">omp</span> on PATH. Point it at a checkout with
                  OMP_DESKTOP_OMP_ROOT, or install the CLI and run <span className="font-mono">omp desktop</span>.
                </p>
              </div>
            </div>
            <Button className="mt-3" onClick={() => void bootDesktop()}>
              Retry resolution
            </Button>
          </div>
        )}

        <div className="flex items-center gap-2 border-t border-hairline px-5 py-2.5">
          <span className="font-mono text-2xs text-muted-foreground">{state.statusLine}</span>
          <span className="ml-auto font-mono text-2xs text-muted-foreground/60">boot log · ~/.omp/desktop.log</span>
        </div>
      </motion.div>
    </div>
  );
}
