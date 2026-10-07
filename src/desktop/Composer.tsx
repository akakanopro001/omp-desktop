import { Badge, Button, Kbd, Textarea } from "@/components/ui/primitives";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ALL_MODELS, AGENT_MODES, MAGIC_KEYWORDS, PROVIDERS, SLASH_COMMANDS, modelLabel } from "@/lib/omp/catalog";
import type { AgentMode, Session } from "@/lib/omp/protocol";
import { settings, updateSession, workspace, enterProject, projects } from "@/lib/omp/state";
import { abortTurn, runSuggestion } from "./actions";
import { cn, formatCost, formatTokens, shortPath } from "./format";
import { CircleStop, CornerDownLeft, Cpu, Paperclip, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export function Composer({ session, running }: { session: Session; running: boolean }) {
  const [text, setText] = useState("");
  const [commandIndex, setCommandIndex] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const settingsValue = useSettings();

  const commandQuery = text.startsWith("/") && !text.includes(" ") ? text : null;
  const matches = useMemo(
    () => (commandQuery ? SLASH_COMMANDS.filter((command) => command.command.startsWith(commandQuery)) : []),
    [commandQuery],
  );

  useEffect(() => {
    setCommandIndex(0);
  }, [commandQuery]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(220, node.scrollHeight)}px`;
  }, [text]);

  const submit = async (value?: string) => {
    const prompt = (value ?? text).trim();
    if (!prompt) return;
    setText("");
    setHistory((prev) => [prompt, ...prev.slice(0, 30)]);
    setHistoryIndex(null);
    await runSuggestion(prompt);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (matches.length > 0 && commandQuery) {
        const chosen = matches[commandIndex] ?? matches[0];
        setText(`${chosen.command} `);
        return;
      }
      void submit();
      return;
    }
    if (event.key === "Tab" && matches.length > 0) {
      event.preventDefault();
      setCommandIndex((prev) => (prev + 1) % matches.length);
      return;
    }
    if (event.key === "ArrowDown" && matches.length > 0) {
      event.preventDefault();
      setCommandIndex((prev) => (prev + 1) % matches.length);
      return;
    }
    if (event.key === "ArrowUp" && matches.length > 0) {
      event.preventDefault();
      setCommandIndex((prev) => (prev - 1 + matches.length) % matches.length);
      return;
    }
    if (event.key === "ArrowUp" && !text.includes("\n")) {
      if (history.length === 0) return;
      event.preventDefault();
      const next = historyIndex === null ? 0 : Math.min(history.length - 1, historyIndex + 1);
      setHistoryIndex(next);
      setText(history[next]);
      return;
    }
    if (event.key === "ArrowDown" && historyIndex !== null) {
      event.preventDefault();
      const next = historyIndex - 1;
      if (next < 0) {
        setHistoryIndex(null);
        setText("");
      } else {
        setHistoryIndex(next);
        setText(history[next]);
      }
      return;
    }
    if (event.key === "Escape" && running) {
      event.preventDefault();
      abortTurn();
    }
  };

  const files = workspace.paths().slice(0, 400);

  return (
    <div className="border-t border-hairline bg-chrome/70 px-4 py-3">
      <div className="mx-auto w-full max-w-3xl">
        {matches.length > 0 && (
          <div className="mb-2 overflow-hidden rounded-md border border-hairline bg-popover shadow-lg">
            <div className="border-b border-hairline px-3 py-1.5 mono-label">session controls</div>
            <div className="max-h-56 overflow-auto">
              {matches.map((command, index) => (
                <button
                  key={command.command}
                  onMouseEnter={() => setCommandIndex(index)}
                  onClick={() => {
                    setText(`${command.command} `);
                    ref.current?.focus();
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-1.5 text-left transition-colors",
                    index === commandIndex ? "bg-secondary/70" : "hover:bg-secondary/40",
                  )}
                >
                  <span className="w-24 shrink-0 font-mono text-2xs text-ember">{command.command}</span>
                  <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">{command.summary}</span>
                  <span className="shrink-0 font-mono text-2xs text-muted-foreground/50">{command.group}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-lg border border-hairline bg-panel/80 focus-within:border-ember/40">
          <Textarea
            ref={ref}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={running ? "turn in progress — Esc aborts" : "Ask for a change, or type / for session controls"}
            className="min-h-[42px] resize-none border-0 bg-transparent px-3 py-2.5 text-xs focus-visible:ring-0"
          />

          <div className="flex items-center gap-1.5 border-t border-hairline px-2 py-1.5">
            <ModePicker session={session} />
            <ModelPicker session={session} />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <Paperclip className="size-3" /> attach
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="max-h-72 overflow-auto">
                <DropdownMenuLabel>workspace files</DropdownMenuLabel>
                {files.map((path) => (
                  <DropdownMenuItem key={path} onSelect={() => setText((prev) => `${prev}${prev.endsWith(" ") || prev === "" ? "" : " "}${path} `)}>
                    <span className="truncate font-mono text-2xs">{shortPath(path, 40)}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <Zap className="size-3" /> keywords
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>magic keywords · prose only</DropdownMenuLabel>
                {MAGIC_KEYWORDS.map((keyword) => (
                  <DropdownMenuItem key={keyword.keyword} onSelect={() => setText((prev) => `${keyword.keyword} ${prev}`.trim())}>
                    <div className="flex flex-col">
                      <span className="font-mono text-2xs text-ember">{keyword.keyword}</span>
                      <span className="text-2xs text-muted-foreground">{keyword.summary}</span>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <span className="ml-1 font-mono text-2xs text-muted-foreground/70">
              ctx {formatTokens(session.usage.promptTokens)} · {formatCost(session.usage.costUsd)}
            </span>

            {settingsValue.advisor.enabled && (
              <Badge tone="warn" className="ml-1">
                <ShieldCheck className="size-2.5" /> advisor
              </Badge>
            )}
            {session.mode === "plan" && <Badge tone="flux">read-only</Badge>}

            <div className="ml-auto flex items-center gap-1.5">
              <span className="hidden items-center gap-1 font-mono text-2xs text-muted-foreground/70 sm:flex">
                <Kbd>Enter</Kbd> send
                <Kbd>Shift+Enter</Kbd> newline
              </span>
              {running ? (
                <Button variant="destructive" size="sm" onClick={abortTurn}>
                  <CircleStop className="size-3" /> stop
                </Button>
              ) : (
                <Button size="sm" onClick={() => void submit()} disabled={text.trim().length === 0}>
                  <CornerDownLeft className="size-3" /> send
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="mt-1.5 flex items-center gap-2 px-1">
          {session.projectId ? (
            <span className="font-mono text-2xs text-muted-foreground/60">
              project · {projects.get().find((project) => project.id === session.projectId)?.name ?? "—"}
            </span>
          ) : (
            <button
              onClick={() => {
                const first = projects.get()[0];
                if (first) enterProject(first.id);
              }}
              className="font-mono text-2xs text-ember hover:underline"
            >
              detached chat — enter a project
            </button>
          )}
          <span className="ml-auto flex items-center gap-1 font-mono text-2xs text-muted-foreground/60">
            <Sparkles className="size-2.5" /> {modelLabel(session.model)}
          </span>
        </div>
      </div>
    </div>
  );
}

function useSettings() {
  const [, force] = useState(0);
  useEffect(() => settings.subscribe(() => force((value) => value + 1)), []);
  return settings.get();
}

function ModePicker({ session }: { session: Session }) {
  const spec = AGENT_MODES.find((mode) => mode.id === session.mode) ?? AGENT_MODES[1];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="font-mono">
          <Cpu className="size-3" /> {spec.name}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>turn mode</DropdownMenuLabel>
        {AGENT_MODES.map((mode) => (
          <DropdownMenuItem key={mode.id} onSelect={() => updateSession(session.id, (entry) => ({ ...entry, mode: mode.id as AgentMode }))}>
            <div className="flex flex-col">
              <span className="font-mono text-2xs text-foreground">{mode.name}</span>
              <span className="text-2xs text-muted-foreground">{mode.detail}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ModelPicker({ session }: { session: Session }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="max-w-[190px] truncate font-mono">
          {modelLabel(session.model)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-80 overflow-auto">
        <DropdownMenuLabel>models · grouped by provider</DropdownMenuLabel>
        {PROVIDERS.map((provider) => (
          <div key={provider.id}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-muted-foreground/70">
              {provider.name} · {provider.auth}
            </DropdownMenuLabel>
            {provider.models.map((model) => (
              <DropdownMenuItem key={model.selector} onSelect={() => updateSession(session.id, (entry) => ({ ...entry, model: model.selector }))}>
                <span className="font-mono text-2xs text-foreground">{model.name}</span>
                <span className="ml-auto font-mono text-2xs text-muted-foreground/60">{model.tags[0] ?? model.api}</span>
              </DropdownMenuItem>
            ))}
          </div>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-muted-foreground/70">{ALL_MODELS.length} models · {PROVIDERS.length} providers</DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { modelLabel };
