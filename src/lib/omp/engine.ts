import type { AgentEvent, ModelRole, Subagent, TodoItem, ToolCall, TranscriptItem } from "./protocol";
import { uid } from "../utils";
import { callExport } from "./evaluator";
import { diagnosticsFor } from "./lsp";
import { findModel } from "./catalog";
import { COMMANDS, RECIPES } from "./recipes";
import {
  approxTokens,
  chunkText,
  magicKeywords,
  type RecipeId,
  type SubagentBlueprint,
  type ToolInvocation,
  type TurnEffect,
  type TurnOptions,
  type TurnRuntime,
} from "./turn";

/**
 * The agent loop.
 *
 * One turn in, one stream of normalized `AgentEvent`s out. The loop owns
 * cancelation, usage accounting, tool gating, plan/vibe write-protection and
 * the subagent fan-out; the recipe owns the reasoning. That split keeps the
 * renderer ignorant of transport and the recipes ignorant of the UI.
 */

const ABORT = "omp.aborted";

class AbortedError extends Error {
  constructor() {
    super(ABORT);
    this.name = "AbortedError";
  }
}

export function classifyPrompt(prompt: string): RecipeId {
  const text = prompt.trim();
  const lower = text.toLowerCase();
  if (text.startsWith("/")) return "command";
  if (/\b(review|audit)\b/.test(lower)) return "review";
  if (/(fix|repair|make .*\b(pass|green)\b|failing|red suite|broken test)/.test(lower)) return "fix-tests";
  if (/(run|execute|rerun|re-run)\b[\s\S]*\b(tests?|suite)\b/.test(lower)) return "run-tests";
  if (/\b(lint|warnings?|unused|clean ?up|tidy)\b/.test(lower)) return "cleanup";
  if (/\bcommit\b/.test(lower)) return "commit";
  if (/(accuracy|converg|leibniz|machin|\bpi\b)/.test(lower)) return "accuracy";
  if (/(browser|screenshot|computer|clipboard|debug|breakpoint|\bdap\b|lldb|\bdlv\b|debugpy)/.test(lower)) return "capability";
  if (/(why|explain|walk me through|what does|how does|\bread\b)/.test(lower)) return "explain";
  if (/(search|find|grep|where is|locate)/.test(lower)) return "search";
  if (/(memory|remember|recall|what did you learn)/.test(lower)) return "memory";
  if (/\b(add|implement|create|build|scaffold|support|introduce)\b/.test(lower)) return "feature";
  return "generic";
}

interface RuntimeInternal extends TurnRuntime {
  usageTokens(): number;
}

export function createRuntime(options: TurnOptions): RuntimeInternal {
  const { workspace, session, settings, emit, signal } = options;
  const effects: TurnEffect[] = [];
  const todos: TodoItem[] = session.todos.map((todo) => ({ ...todo }));
  const speed = settings.streamSpeed;
  // Ids are turn-scoped: a reducer that keys by id must never merge two turns.
  const turnId = uid("turn");
  let segment = "";
  let completionTokens = 0;
  let toolSeq = 0;

  const runtime: RuntimeInternal = {
    workspace,
    root: options.root,
    session,
    settings,
    todos,
    planOnly: session.mode === "plan" || session.mode === "vibe",
    effects,
    signal,
    log: (event) => emit(event),

    async say(text) {
      segment += text;
      if (speed === "instant") {
        for (const chunk of chunkText(text, 48)) emit({ type: "text.delta", text: chunk });
      } else {
        for (const chunk of chunkText(text, speed === "fast" ? 7 : 4)) {
          emit({ type: "text.delta", text: chunk });
          await runtime.delay(speed === "fast" ? 9 : 16);
        }
      }
      completionTokens += approxTokens(text);
      emit({ type: "text.done", text: segment });
    },

    async runTool(invocation: ToolInvocation) {
      segment = "";
      const call: ToolCall = {
        id: `${turnId}_call_${++toolSeq}`,
        name: invocation.name,
        target: invocation.target,
        summary: invocation.summary,
        status: "running",
        startedAt: Date.now(),
        blocks: [],
      };
      emit({ type: "tool.started", call });
      await runtime.delay(invocation.thinkMs ?? 180);

      const gate = settings.tools[invocation.name];
      if (gate && !gate.enabled) {
        const blocks = [
          {
            type: "note" as const,
            tone: "danger" as const,
            title: `${invocation.name} is disabled`,
            body: "Enable it in Settings → Tools, or ask for a path that doesn't need it.",
          },
        ];
        emit({ type: "tool.finished", call: { ...call, status: "error", endedAt: Date.now(), blocks } });
        return { status: "error", blocks };
      }

      try {
        const result = invocation.exec(workspace);
        emit({
          type: "tool.finished",
          call: { ...call, status: result.status ?? "ok", endedAt: Date.now(), blocks: result.blocks },
        });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const blocks = [{ type: "note" as const, tone: "danger" as const, title: `${invocation.name} failed`, body: message }];
        emit({ type: "tool.finished", call: { ...call, status: "error", endedAt: Date.now(), blocks } });
        return { status: "error", blocks };
      }
    },

    setTodos(items) {
      todos.length = 0;
      items.forEach((item, index) => todos.push({ ...item, id: item.id || `todo-${index + 1}` }));
      emit({ type: "todo.updated", items: todos.map((todo) => ({ ...todo })) });
    },

    updateTodo(id, status) {
      const index = todos.findIndex((todo) => todo.id === id);
      if (index === -1) return;
      todos[index] = { ...todos[index], status };
      emit({ type: "todo.updated", items: todos.map((todo) => ({ ...todo })) });
    },

    advisor(severity, text) {
      emit({ type: "advisor.note", severity, text, model: runtime.modelFor("advisor") });
    },

    memory(facts) {
      emit({ type: "memory.updated", facts });
    },

    async runSubagents(blueprints: SubagentBlueprint[]) {
      const agents: Subagent[] = blueprints.map((blueprint, index) => ({
        id: `${turnId}_agent_${index + 1}`,
        name: blueprint.name,
        task: blueprint.task,
        status: "queued",
        toolCalls: 0,
        tokens: blueprint.tokens,
        costUsd: blueprint.costUsd,
        durationMs: blueprint.durationMs,
        findings: [],
        transcript: [],
        steering: [],
        isolatedWorktree: blueprint.isolatedWorktree,
      }));

      const call: ToolCall = {
        id: `${turnId}_call_${++toolSeq}`,
        name: "task",
        target: `${blueprints.length} subagent(s)`,
        summary: `task · fan out ${blueprints.length} worker(s)`,
        status: "running",
        startedAt: Date.now(),
        blocks: [{ type: "subagents", agents: agents.map((agent) => ({ ...agent })) }],
      };
      emit({ type: "tool.started", call });
      await runtime.delay(200);

      const push = (agent: Subagent) => {
        const index = agents.findIndex((candidate) => candidate.id === agent.id);
        if (index !== -1) agents[index] = agent;
        emit({ type: "subagent.updated", agent });
        call.blocks = [{ type: "subagents", agents: agents.map((candidate) => ({ ...candidate })) }];
        emit({ type: "tool.finished", call: { ...call, status: "running" } });
      };

      const maxSteps = Math.max(...blueprints.map((blueprint) => blueprint.steps.length), 0);
      for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
        for (let agentIndex = 0; agentIndex < blueprints.length; agentIndex += 1) {
          const blueprint = blueprints[agentIndex];
          const step = blueprint.steps[stepIndex];
          if (!step) continue;
          const agent = agents[agentIndex];
          push({ ...agent, status: "running" });
          await runtime.delay(150);

          const says: TranscriptItem = {
            kind: "system",
            id: `${agent.id}_say_${stepIndex + 1}`,
            at: Date.now(),
            text: step.say,
          };
          const toolItem: TranscriptItem | undefined = step.tool
            ? {
                kind: "tool",
                id: `${agent.id}_call_${stepIndex + 1}`,
                at: Date.now(),
                call: {
                  id: `${agent.id}_call_${stepIndex + 1}`,
                  name: step.tool.name,
                  target: step.tool.target,
                  summary: step.tool.summary,
                  status: "ok",
                  startedAt: Date.now(),
                  endedAt: Date.now(),
                  blocks: step.tool.exec(workspace).blocks,
                },
              }
            : undefined;

          push({
            ...agents[agentIndex],
            status: "running",
            toolCalls: agents[agentIndex].toolCalls + (toolItem ? 1 : 0),
            transcript: [...agents[agentIndex].transcript, says, ...(toolItem ? [toolItem] : [])],
          });
          await runtime.delay(130);
        }
      }

      blueprints.forEach((blueprint, index) => {
        push({ ...agents[index], status: "done", findings: blueprint.findings });
      });

      emit({
        type: "tool.finished",
        call: {
          ...call,
          status: "ok",
          endedAt: Date.now(),
          blocks: [{ type: "subagents", agents: agents.map((agent) => ({ ...agent })) }],
        },
      });
      await runtime.delay(110);
    },

    usage(promptTokens, completion, costUsd) {
      emit({ type: "usage", usage: { promptTokens, completionTokens: completion, costUsd } });
    },

    async delay(ms) {
      if (signal.aborted) throw new AbortedError();
      if (speed === "instant") return;
      const scaled = speed === "fast" ? ms * 0.45 : ms;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (signal.aborted) reject(new AbortedError());
          else resolve();
        }, scaled);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new AbortedError());
          },
          { once: true },
        );
      });
    },

    aborted: () => signal.aborted,

    diagnostics: () => diagnosticsFor(workspace, options.root),

    evaluate: (path, name, args) => callExport(workspace, path, name, args),

    modelFor(role?: ModelRole) {
      if (!role) return session.model;
      return settings.modelRoles[role] ?? session.model;
    },

    effect(effect) {
      effects.push(effect);
    },

    usageTokens: () => completionTokens,
  };

  return runtime;
}

export interface TurnOutcome {
  effects: TurnEffect[];
  recipe: RecipeId;
  aborted: boolean;
  error?: string;
}

export async function runTurn(options: TurnOptions): Promise<TurnOutcome> {
  const runtime = createRuntime(options);
  const promptTokens = approxTokens(options.prompt) + approxTokens(JSON.stringify(options.session.transcript.slice(-6)));
  let recipe: RecipeId = classifyPrompt(options.prompt);
  options.emit({ type: "turn.started" });

  try {
    if (recipe === "command") {
      const command = options.prompt.trim().split(/\s+/)[0];
      const handler = COMMANDS[command];
      if (handler) {
        await handler(runtime, options.prompt);
      } else {
        await runtime.say(`\`${command}\` isn't a session control in this build. Try \`/help\` for the wired set — or drop the slash and I'll treat it as a task.\n\n`);
        recipe = "generic";
      }
    } else {
      await RECIPES[recipe](runtime, options.prompt);
    }

    const keywords = magicKeywords(options.prompt);
    if (keywords.length > 0 && recipe !== "command") {
      options.emit({ type: "log", level: "info", text: `magic keywords: ${keywords.join(", ")}` });
    }

    const model = findModel(runtime.modelFor());
    const cost = model
      ? (promptTokens / 1_000_000) * model.inputCostPerMTok + (runtime.usageTokens() / 1_000_000) * model.outputCostPerMTok
      : 0;
    options.emit({ type: "usage", usage: { promptTokens, completionTokens: runtime.usageTokens(), costUsd: cost } });
    options.emit({ type: "turn.finished", reason: "stop" });
    return { effects: runtime.effects, recipe, aborted: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof AbortedError || message === ABORT) {
      options.emit({ type: "turn.finished", reason: "aborted" });
      return { effects: runtime.effects, recipe, aborted: true };
    }
    options.emit({ type: "log", level: "error", text: message });
    options.emit({ type: "turn.finished", reason: "error", error: message });
    return { effects: runtime.effects, recipe, aborted: false, error: message };
  }
}

export type { AgentEvent };
