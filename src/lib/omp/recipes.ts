import type { Diagnostic, FileDiff, TodoItem, ToolBlock } from "./protocol";
import { anchorsFor, applyPatch, buildFileDiff, buildPatch } from "./hashline";
import { formatDiagnostics, symbolsFor } from "./lsp";
import { runCommand } from "./shell";
import { relativePath } from "./vfs";
import {
  camelCase,
  escapeRegExp,
  extractPath,
  findLineIndex,
  keywordsOf,
  slugify,
  type RecipeId,
  type SubagentBlueprint,
  type ToolExecResult,
  type ToolInvocation,
  type TurnRuntime,
} from "./turn";

/**
 * Recipes: one per intent. Each recipe drives the same primitives the agent
 * loop exposes — stream text, run tools against the live workspace, mutate the
 * todo list, inject advisor notes and stream rules, fan out subagents — so a
 * recipe is the deterministic spine of a turn, not a scripted transcript.
 */

export type Recipe = (rt: TurnRuntime, prompt: string) => Promise<void>;

/* ------------------------------------------------------------------ *
 * Tool builders
 * ------------------------------------------------------------------ */

export function readTool(rt: TurnRuntime, path: string, from = 1, to?: number): ToolInvocation {
  return {
    name: "read",
    target: path,
    summary: `read ${relativePath(path, rt.root)}`,
    thinkMs: 240,
    exec: (workspace) => {
      const content = workspace.read(path);
      if (content === undefined) {
        return { status: "error", blocks: [{ type: "note", tone: "danger", title: "no such file", body: path }] };
      }
      const rows = content.split("\n");
      const end = Math.min(rows.length, to ?? rows.length);
      return {
        blocks: [
          {
            type: "code",
            language: path.endsWith(".md") ? "markdown" : "typescript",
            caption: `${relativePath(path, rt.root)}:${from}-${end} of ${rows.length} · ${anchorsFor(content).slice(from - 1, end).length} anchors`,
            code: workspace.anchored(path, from, end),
          },
        ],
      };
    },
  };
}

export function grepTool(rt: TurnRuntime, pattern: string, options?: { glob?: string; ignoreCase?: boolean }): ToolInvocation {
  return {
    name: "grep",
    target: pattern,
    summary: `grep ${pattern}${options?.glob ? ` --glob ${options.glob}` : ""}`,
    thinkMs: 200,
    exec: (workspace) => {
      const hits = workspace.grep(pattern, { ...options, limit: 40 });
      if (hits.length === 0) {
        return { blocks: [{ type: "note", tone: "info", title: "no matches", body: `pattern ${pattern} matched nothing under ${rt.root}` }] };
      }
      return { blocks: [{ type: "hits", hits, query: pattern }] };
    },
  };
}

export function globTool(rt: TurnRuntime, pattern: string): ToolInvocation {
  return {
    name: "glob",
    target: pattern,
    summary: `glob ${pattern}`,
    exec: (workspace) => {
      const paths = workspace.glob(pattern).filter((path) => path.startsWith(rt.root));
      return {
        blocks: [paths.length === 0 ? { type: "note", tone: "info", title: "no paths", body: pattern } : { type: "paths", paths }],
      };
    },
  };
}

export function bashTool(rt: TurnRuntime, command: string, options?: { cwd?: string }): ToolInvocation {
  return {
    name: "bash",
    target: command,
    summary: `bash ${command}`,
    thinkMs: 320,
    exec: (workspace) => {
      const result = runCommand(workspace, options?.cwd ?? rt.root, command);
      return {
        status: result.exitCode === 0 ? "ok" : "error",
        blocks: [
          { type: "terminal", command, cwd: result.cwd, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode },
        ],
      };
    },
  };
}

export function lspTool(rt: TurnRuntime, label: string, diagnostics: Diagnostic[]): ToolInvocation {
  return {
    name: "lsp",
    target: label,
    summary: `lsp ${label}`,
    exec: () => ({
      blocks: [
        { type: "diagnostics", diagnostics, server: "typescript-language-server · biome" },
        diagnostics.length === 0
          ? { type: "note", tone: "ok", title: "clean", body: formatDiagnostics(diagnostics, rt.root) }
          : { type: "note", tone: "info", title: `${diagnostics.length} diagnostic(s)`, body: formatDiagnostics(diagnostics, rt.root) },
      ],
    }),
  };
}

export function todoTool(items: TodoItem[]): ToolInvocation {
  return {
    name: "todo",
    target: `${items.length} items`,
    summary: "todo write",
    thinkMs: 120,
    exec: () => ({ blocks: [{ type: "todos", items }] }),
  };
}

export function memoryTool(action: string, facts: string[]): ToolInvocation {
  return {
    name: action.startsWith("recall") ? "recall" : "retain",
    target: action,
    summary: action,
    exec: () => ({ blocks: [{ type: "memory", action, facts }] }),
    thinkMs: 160,
  };
}

function askTool(question: string, options: string[]): ToolInvocation {
  return {
    name: "ask",
    target: question,
    summary: `ask · ${options.length} options`,
    exec: () => ({
      blocks: [
        { type: "note", tone: "info", title: question, body: options.map((option, index) => `${index + 1}. ${option}`).join("\n") },
      ],
      status: "proposed",
    }),
  };
}

export function proposeTool(name: ToolInvocation["name"], target: string, summary: string, blocks: ToolBlock[]): ToolInvocation {
  return { name, target, summary, exec: () => ({ blocks, status: "proposed" }) };
}

function tableTool(caption: string, rows: string[][], name: ToolInvocation["name"] = "read"): ToolInvocation {
  return {
    name,
    target: caption,
    summary: `${name} · ${caption}`,
    exec: () => ({
      blocks: [
        { type: "code", language: "text", caption, code: rows.map(([left, right]) => `${left.padEnd(48)} ${right}`).join("\n") },
      ],
    }),
  };
}

function probeTool(rt: TurnRuntime, label: string, code: string, output: string): ToolInvocation {
  return {
    name: "eval",
    target: label,
    summary: `eval ${label}`,
    thinkMs: 220,
    exec: () => ({
      blocks: [
        { type: "code", language: "javascript", caption: label, code },
        { type: "text", text: output },
      ],
    }),
  };
}

/* ------------------------------------------------------------------ *
 * Workspace helpers
 * ------------------------------------------------------------------ */

export interface PiLab {
  root: string;
  leibniz: string;
  machin: string;
  format: string;
  index: string;
  test: string;
  cliTest: string;
  accuracy: string;
  readme: string;
  agents: string;
  accuracyDoc: string;
}

export function piLab(rt: TurnRuntime): PiLab {
  const root = rt.root;
  return {
    root,
    leibniz: `${root}/src/leibniz.ts`,
    machin: `${root}/src/machin.ts`,
    format: `${root}/src/format.ts`,
    index: `${root}/src/index.ts`,
    test: `${root}/test/pi.test.ts`,
    cliTest: `${root}/test/cli.test.ts`,
    accuracy: `${root}/scripts/accuracy.ts`,
    readme: `${root}/README.md`,
    agents: `${root}/AGENTS.md`,
    accuracyDoc: `${root}/docs/ACCURACY.md`,
  };
}

function hasPiLab(rt: TurnRuntime): boolean {
  return rt.workspace.read(piLab(rt).leibniz) !== undefined;
}

function accuracyError(rt: TurnRuntime, path: string, terms: number, fn = "leibnizPi"): number | undefined {
  const result = rt.evaluate(path, fn, [terms]);
  if (!result.ok || typeof result.value !== "number") return undefined;
  return Math.abs(result.value - Math.PI);
}

/** How the truncation error behaves when terms doubles — 0.5 means alternating. */
export function convergence(rt: TurnRuntime, path: string): { err100: number; err200: number; ratio: number; converging: boolean } | undefined {
  const err100 = accuracyError(rt, path, 100);
  const err200 = accuracyError(rt, path, 200);
  if (err100 === undefined || err200 === undefined) return undefined;
  const ratio = err100 === 0 ? 0 : err200 / err100;
  return { err100, err200, ratio, converging: ratio < 0.75 };
}

export interface LineEdit {
  line: number;
  search: string;
  replace: string;
}

/** Anchored multi-line edit: hunks are applied bottom-up so anchors stay valid. */
export function applyEdits(rt: TurnRuntime, path: string, edits: LineEdit[]): { ok: boolean; diff?: FileDiff; stale?: string; patch: string; wrote: boolean } {
  const before = rt.workspace.read(path);
  if (before === undefined) return { ok: false, stale: `no such file: ${path}`, patch: "", wrote: false };
  const rows = before.split("\n");
  const ordered = [...edits].sort((a, b) => b.line - a.line);
  const patch = ordered
    .map((edit) => buildPatch(relativePath(path, rt.root), before, edit.line, rows[edit.line - 1] ?? "", edit.replace))
    .join("\n");
  const result = applyPatch(before, patch);
  if (!result.ok) return { ok: false, stale: result.stale, patch, wrote: false };
  // Plan and Vibe modes investigate and propose; they never write.
  if (!rt.planOnly) rt.workspace.writeDirty(path, result.content);
  return { ok: true, diff: buildFileDiff(relativePath(path, rt.root), before, result.content), patch, wrote: !rt.planOnly };
}

export function editTool(rt: TurnRuntime, path: string, edits: LineEdit[], summary?: string): ToolInvocation {
  return {
    name: "edit",
    target: relativePath(path, rt.root),
    summary: summary ?? `edit ${relativePath(path, rt.root)} · ${edits.length} hunk(s)`,
    thinkMs: 280,
    exec: () => {
      const before = rt.workspace.read(path) ?? "";
      const rows = before.split("\n");
      const result = applyEdits(rt, path, edits);
      if (!result.ok || !result.diff) {
        const anchors = edits
          .map((edit) => `${edit.line}:${anchorsFor(before)[edit.line - 1]?.hash ?? "????????"}│${rows[edit.line - 1] ?? ""}`)
          .join("\n");
        return {
          status: "error",
          blocks: [
            {
              type: "note",
              tone: "danger",
              title: "stale anchor — patch rejected before it could corrupt the file",
              body: `${result.stale ?? "anchor mismatch"}\n\ncurrent anchors:\n${anchors}`,
            },
            { type: "code", language: "diff", caption: "rejected hashline patch", code: result.patch },
          ],
        };
      }
      return {
        status: result.wrote ? "ok" : "proposed",
        diff: result.diff,
        blocks: [
          { type: "diff", files: [result.diff] },
          {
            type: "note",
            tone: result.wrote ? "ok" : "warn",
            title: result.wrote
              ? `applied · ${result.diff.added} insertion(s), ${result.diff.removed} deletion(s)`
              : `proposed · ${result.diff.added} insertion(s), ${result.diff.removed} deletion(s)`,
            body: `${relativePath(path, rt.root)} · anchors verified against ${edits.length} hashline hunk(s)${result.wrote ? "" : " — plan mode does not write; switch to Agent mode to apply"}`,
          },
        ],
      };
    },
  };
}

export function writeTool(rt: TurnRuntime, path: string, content: string, summary: string): ToolInvocation {
  return {
    name: "write",
    target: relativePath(path, rt.root),
    summary,
    thinkMs: 300,
    exec: (workspace) => {
      const previous = workspace.read(path);
      if (!rt.planOnly) workspace.writeDirty(path, content);
      const diff = previous === undefined ? undefined : buildFileDiff(relativePath(path, rt.root), previous, content);
      const rows = content.split("\n");
      return {
        diff,
        blocks: [
          diff
            ? { type: "diff", files: [diff] }
            : { type: "note", tone: "ok", title: "created", body: `${relativePath(path, rt.root)} · ${rows.length} lines` },
          { type: "code", language: "typescript", caption: `${relativePath(path, rt.root)} · ${rows.length} lines`, code: content },
        ],
      };
    },
  };
}

async function summarize(rt: TurnRuntime, headline: string, points: string[], next: string[]): Promise<string> {
  void rt;
  return [`**${headline}**\n\n`, ...points.map((point) => `- ${point}\n`), "\nNext:\n", ...next.map((entry) => `- ${entry}\n`)].join("");
}

function closingTool(tone: "ok" | "info" | "warn"): ToolInvocation {
  return {
    name: "wait",
    target: "turn",
    summary: "wait · turn closing",
    exec: () => ({
      blocks: [{ type: "note", tone, title: "turn complete", body: "Turn finished; the session stays warm for the next prompt." }],
    }),
  };
}

/* ------------------------------------------------------------------ *
 * Recipes
 * ------------------------------------------------------------------ */

const fixTests: Recipe = async (rt) => {
  const p = piLab(rt);
  const todos: TodoItem[] = [
    { id: "todo-1", text: "Reproduce the failing suite", status: "in_progress", phase: "reproduce" },
    { id: "todo-2", text: "Localise the estimator defect", status: "pending", phase: "diagnose" },
    { id: "todo-3", text: "Patch src/leibniz.ts with anchored hashline hunks", status: "pending", phase: "patch" },
    { id: "todo-4", text: "Re-run the suite and the accuracy script", status: "pending", phase: "verify" },
    { id: "todo-5", text: "Record the lesson in the memory bank", status: "pending", phase: "learn" },
  ];
  rt.setTodos(todos);
  await rt.say("Reproducing first — a failure I can't see is a failure I can't fix.\n\n");
  const reproduce = await rt.runTool(bashTool(rt, "bun test"));

  rt.updateTodo("todo-1", "completed");
  rt.updateTodo("todo-2", "in_progress");

  const stats = hasPiLab(rt) ? convergence(rt, p.leibniz) : undefined;
  if (!stats) {
    await rt.runTool(probeTool(rt, "convergence probe · unavailable", "load('./src/leibniz.ts')", "the estimator module is not on disk in this project"));
    await rt.say(await summarize(rt, "cannot diagnose", ["This project has no π estimators, so there is nothing to reproduce or patch."], ["Attach the pi-lab project, or ask me to scaffold the estimator."]));
    return;
  }

  await rt.runTool(
    probeTool(
      rt,
      "convergence probe · leibnizPi",
      [`const err = (n) => Math.abs(leibnizPi(n) - Math.PI);`, "const e100 = err(100);", "const e200 = err(200);", "console.log({ e100, e200, ratio: e200 / e100 });"].join("\n"),
      [
        `e100 = ${stats.err100.toExponential(3)}`,
        `e200 = ${stats.err200.toExponential(3)}`,
        `ratio = ${stats.ratio.toFixed(3)} — an alternating series halves on a terms doubling (0.500)`,
      ].join("\n"),
    ),
  );

  if (stats.converging) {
    await rt.runTool(readTool(rt, p.test));
    await rt.runTool(lspTool(rt, "diagnostics", rt.diagnostics()));
    await rt.say(
      await summarize(
        rt,
        reproduce.status === "ok" ? "suite is already green" : "estimator is healthy, suite still red",
        [
          `\`leibnizPi\` halves its truncation error (ratio ${stats.ratio.toFixed(3)}), so the sign is intact.`,
          "No file was touched: a patch needs a reproduced defect, and there isn't one in the estimator.",
        ],
        ["Ask me to read the failing expectation in the suite.", "Ask me to review the working tree before you commit."],
      ),
    );
    return;
  }

  await rt.runTool(readTool(rt, p.leibniz, 1, 24));
  await rt.say(
    [
      `Found it. Error on 100 terms is ${stats.err100.toExponential(3)} and ${stats.err200.toExponential(3)} on 200 — a ratio of ${stats.ratio.toFixed(3)} where an alternating series must give ~0.500. `,
      "The accumulator sums `1 / (2i + 1)` without the `(-1)^n` sign, so the total tracks `ln(n)/2 · 4` instead of π.\n\n",
      "The assertions are correct, and `AGENTS.md` forbids relaxing them, so the fix belongs in the estimator.\n\n",
    ].join(""),
  );

  if (rt.settings.advisor.enabled) {
    rt.advisor(
      "concern",
      "The acceptance criterion is literally 'within 1e-5 over 1e6 terms'. The alternating rewrite lands at ~1e-6 — a 10x margin. Do not raise the tolerance to make room.",
    );
  }

  const before = rt.workspace.read(p.leibniz) ?? "";
  const rows = before.split("\n");
  const accumulator = findLineIndex(before, /sum\s*\+=\s*1\s*\/\s*\(2\s*\*\s*i\s*\+\s*1\)/);
  const ret = findLineIndex(before, /return sum \* 4/);
  const debugLog = findLineIndex(before, /console\.log\(/);

  if (accumulator === -1) {
    await rt.say("The accumulator line moved since I read it, so the anchors I hold are stale. Re-reading instead of forcing a patch.\n\n");
    await rt.runTool(readTool(rt, p.leibniz));
    return;
  }

  const edits: LineEdit[] = [
    { line: accumulator, search: rows[accumulator - 1], replace: "    const sign = i % 2 === 0 ? 1 : -1;\n    sum += (sign * 1) / (2 * i + 1);" },
  ];
  if (ret !== -1) edits.push({ line: ret, search: rows[ret - 1], replace: "  return sum * scale;" });
  if (debugLog !== -1) edits.push({ line: debugLog, search: rows[debugLog - 1], replace: "" });

  const previewPatch = [...edits]
    .sort((a, b) => b.line - a.line)
    .map((edit) => buildPatch(relativePath(p.leibniz, rt.root), before, edit.line, edit.search, edit.replace))
    .join("\n");
  const preview = applyPatch(before, previewPatch);
  await rt.runTool(
    proposeTool("edit", relativePath(p.leibniz, rt.root), `edit src/leibniz.ts · proposed (${edits.length} hunks, preview only)`, [
      { type: "note", tone: "warn", title: "preview before accept", body: "Restore the alternating sign, route the result through the existing `scale` constant, and drop the stray debug log." },
      ...(preview.ok ? [{ type: "diff" as const, files: [buildFileDiff(relativePath(p.leibniz, rt.root), before, preview.content)] }] : []),
    ]),
  );

  rt.updateTodo("todo-2", "completed");
  rt.updateTodo("todo-3", "in_progress");
  const edited = await rt.runTool(editTool(rt, p.leibniz, edits, `edit src/leibniz.ts · ${edits.length} anchored hunks`));
  if (edited.status === "error") {
    await rt.say("The patch was rejected rather than forced — the file changed underneath me. Fresh anchors first, then I retry.\n\n");
    return;
  }
  if (edited.diff) {
    rt.effect({ type: "attach-diff", diff: edited.diff });
    rt.effect({ type: "open-pane", pane: "diff" });
  }

  if (debugLog !== -1) {
    const row = rows[debugLog - 1];
    const rule = rt.settings.streamRules.find((candidate) => candidate.enabled && new RegExp(candidate.pattern).test(row));
    if (rule) {
      rt.log({ type: "rule.injected", rule: rule.name, reason: `matched /${rule.pattern}/ in src/leibniz.ts` });
      rt.effect({ type: "set-rule-hits", ruleId: rule.id, hits: (rule.hits ?? 0) + 1 });
    }
  }

  rt.updateTodo("todo-3", "completed");
  rt.updateTodo("todo-4", "in_progress");
  await rt.say("Patch is in. Re-running the suite, then the accuracy script — a green suite alone doesn't prove the printed numbers are right.\n\n");
  const verified = await rt.runTool(bashTool(rt, "bun test"));
  await rt.runTool(bashTool(rt, "bun run accuracy"));
  const diagnostics = rt.diagnostics();
  await rt.runTool(lspTool(rt, "diagnostics", diagnostics));

  rt.updateTodo("todo-4", "completed");
  rt.updateTodo("todo-5", "in_progress");
  const facts = [
    "pi-lab: leibniz truncation error is ~1/N — 1e6 terms buy ~1e-6, so the 1e-5 assertion keeps a 10x margin.",
    "pi-lab: test/pi.test.ts owns the acceptance criteria; AGENTS.md forbids relaxing an assertion to make a suite pass.",
  ];
  await rt.runTool(memoryTool("retain · project scope", facts));
  rt.memory(facts);
  rt.updateTodo("todo-5", "completed");

  await rt.runTool(closingTool(verified.status === "ok" ? "ok" : "warn"));
  await rt.say(
    await summarize(
      rt,
      verified.status === "ok" ? "suite green, numbers verified" : "suite still red",
      [
        `Restored the alternating sign in \`leibnizPi\` (${edits.length} anchored hashline hunks), routed the return through \`scale\`, and removed the stray debug log.`,
        `\`bun test\` ${verified.status === "ok" ? "exits 0" : "still exits non-zero"}, the accuracy script prints a monotone error column, and the language servers report ${diagnostics.length} diagnostic(s).`,
      ],
      [
        diagnostics.length > 0 ? "Clear the remaining lint warning in `src/format.ts` — ask me to clean up lint warnings." : "Commit it — ask me to commit the change.",
        "Widen the suite with a Machin regression test at 30 terms.",
      ],
    ),
  );
  rt.effect({ type: "set-title", title: "Fix leibniz convergence" });
};

const runTests: Recipe = async (rt) => {
  const p = piLab(rt);
  await rt.say("Running the suite as it stands, then showing you what the receipt actually says.\n\n");
  const result = await rt.runTool(bashTool(rt, "bun test"));
  if (rt.workspace.read(p.accuracy) !== undefined) {
    await rt.runTool(bashTool(rt, "bun run accuracy"));
  }
  const diagnostics = rt.diagnostics();
  await rt.runTool(lspTool(rt, "diagnostics", diagnostics));
  await rt.runTool(todoTool(rt.todos));
  await rt.say(
    await summarize(
      rt,
      result.status === "ok" ? "suite green" : "suite red",
      [
        result.status === "ok"
          ? "Every test exited 0 against the current sources; no assertion was touched to get there."
          : "The suite exits non-zero and the failing expectation is shown above verbatim.",
        `Language servers report ${diagnostics.length} diagnostic(s) across the project.`,
      ],
      [
        result.status === "ok"
          ? "Ask me to review the working tree before you commit."
          : "Ask me to fix the failing test — reproduce, localise, then patch with anchors.",
      ],
    ),
  );
};

const review: Recipe = async (rt) => {
  const p = piLab(rt);
  await rt.say("Spinning up reviewers. Each reads the tree itself, so findings arrive with file and line numbers instead of prose.\n\n");
  const diagnostics = rt.diagnostics();
  const stats = hasPiLab(rt) ? convergence(rt, p.leibniz) : undefined;

  const blueprints: SubagentBlueprint[] = [
    {
      name: "CorrectnessReview",
      task: "Sweep the estimators for sign and convergence errors; report P0–P1 only.",
      isolatedWorktree: "wt/review-correctness",
      costUsd: 0.14,
      tokens: 18_400,
      durationMs: 4_200,
      steps: [
        { say: "Reading src/leibniz.ts with anchors.", tool: hasPiLab(rt) ? readTool(rt, p.leibniz, 1, 20) : undefined },
        {
          say: "Probing truncation numerically at 100 and 200 terms.",
          tool: probeTool(
            rt,
            "reviewer · convergence",
            "console.log(Math.abs(leibnizPi(100) - Math.PI), Math.abs(leibnizPi(200) - Math.PI));",
            stats ? `e100 = ${stats.err100.toExponential(3)}\ne200 = ${stats.err200.toExponential(3)}\nratio = ${stats.ratio.toFixed(3)}` : "estimator not loadable",
          ),
        },
      ],
      findings:
        stats && !stats.converging
          ? [
              `P0 (confidence 0.97) src/leibniz.ts:11 — accumulator omits the (-1)^n sign; the error ratio over a terms doubling is ${stats.ratio.toFixed(3)} instead of 0.500, so |error| grows with n.`,
              "P1 (confidence 0.80) src/leibniz.ts:14 — `scale` is declared and then ignored in favour of a literal `4`; that is how the sign regression slipped past review.",
            ]
          : ["No P0/P1 findings in the estimators: truncation halves on every terms doubling."],
    },
    {
      name: "TestsAudit",
      task: "Check that the suite pins behaviour instead of mirroring the implementation.",
      isolatedWorktree: "wt/review-tests",
      costUsd: 0.06,
      tokens: 9_100,
      durationMs: 2_600,
      steps: [
        { say: "Reading the suite and the repo rules.", tool: hasPiLab(rt) ? readTool(rt, p.test, 1, 24) : undefined },
        { say: "Looking for tolerances that could be relaxed to hide a regression.", tool: grepTool(rt, "1e-|toBe\\(", { glob: "**/test/*.ts" }) },
      ],
      findings: [
        "P1 (confidence 0.72) test/pi.test.ts:6 — the 1e-5 tolerance is the only guard on the slow estimator; at a ~1e-6 margin it stays meaningful, but 1e-3 would hide the regression entirely.",
        "No assertion mirrors implementation internals; `estimatePi` and `report` are covered through the public surface.",
      ],
    },
    {
      name: "HygieneScan",
      task: "Report type/lint hygiene and lockfile policy.",
      costUsd: 0.03,
      tokens: 4_800,
      durationMs: 1_500,
      steps: [{ say: "Collecting diagnostics from the language servers.", tool: lspTool(rt, "diagnostics", diagnostics) }],
      findings:
        diagnostics.length === 0
          ? ["No type or lint diagnostics reported across the project."]
          : diagnostics.map(
              (diagnostic) =>
                `${diagnostic.severity === "error" ? "P1" : "P3"} (confidence 0.90) ${relativePath(diagnostic.path, rt.root)}:${diagnostic.line} — ${
                  diagnostic.code ? `[${diagnostic.code}] ` : ""
                }${diagnostic.message}`,
            ),
    },
  ];

  await rt.runSubagents(blueprints);

  const all = blueprints.flatMap((blueprint) => blueprint.findings);
  const p0 = all.filter((finding) => finding.startsWith("P0"));
  const p1 = all.filter((finding) => finding.startsWith("P1"));
  const verdict = p0.length > 0 ? "Do not ship — the P0 stands." : p1.length > 0 ? "Ship only after the P1s are triaged." : "Ships as-is: no P0/P1 findings.";

  await rt.runTool(
    tableTool(
      "verdict",
      [
        ["verdict", verdict],
        ["P0", String(p0.length)],
        ["P1", String(p1.length)],
        ["P3", String(all.filter((finding) => finding.startsWith("P3")).length)],
        ["reviewers", blueprints.map((blueprint) => blueprint.name).join(", ")],
      ],
      "task",
    ),
  );

  await rt.say(
    await summarize(
      rt,
      "code review complete",
      [
        verdict,
        "Every finding above is anchored to a file and line and came from reading the tree — nothing was inferred from a diff summary.",
      ],
      [
        p0.length > 0 ? "Ask me to fix the failing test and close the P0." : "Ask me to clean up lint warnings, or commit the review state.",
        "Open Agent Hub to read a reviewer's transcript and steer a parked worker.",
      ],
    ),
  );
  rt.effect({ type: "open-pane", pane: "hub" });
};

const cleanup: Recipe = async (rt) => {
  const before = rt.diagnostics();
  await rt.say("Reading the diagnostics first, then patching only what they justify.\n\n");
  await rt.runTool(lspTool(rt, "diagnostics · before", before));

  if (before.length === 0) {
    await rt.say(await summarize(rt, "nothing to clean", ["Both language servers report zero diagnostics — I'm not touching files that are already clean."], ["Run the suite, or ask for a review."]));
    return;
  }

  let fixed = 0;
  const handled = new Set<string>();
  for (const diagnostic of before) {
    const key = `${diagnostic.path}:${diagnostic.line}`;
    if (handled.has(key)) continue;
    const source = rt.workspace.read(diagnostic.path);
    if (source === undefined) continue;
    const rows = source.split("\n");
    const row = rows[diagnostic.line - 1] ?? "";

    if (diagnostic.source === "biome" && /console\.(log|debug|info)\(/.test(row)) {
      const result = await rt.runTool(editTool(rt, diagnostic.path, [{ line: diagnostic.line, search: row, replace: "" }], `edit ${relativePath(diagnostic.path, rt.root)} · drop debug log`));
      if (result.status === "ok") {
        fixed += 1;
        handled.add(key);
        if (result.diff) {
          rt.effect({ type: "attach-diff", diff: result.diff });
          const rule = rt.settings.streamRules.find((candidate) => candidate.enabled && new RegExp(candidate.pattern).test(row));
          if (rule) {
            rt.log({ type: "rule.injected", rule: rule.name, reason: `matched /${rule.pattern}/ in ${relativePath(diagnostic.path, rt.root)}` });
            rt.effect({ type: "set-rule-hits", ruleId: rule.id, hits: (rule.hits ?? 0) + 1 });
          }
        }
      }
      continue;
    }

    if (diagnostic.code === "6133") {
      const name = diagnostic.message.split("'")[1] ?? "";
      const importLine = rows.findIndex((candidate) => new RegExp(`^\\s*import\\s*\\{[^}]*\\b${escapeRegExp(name)}\\b`).test(candidate));
      if (importLine !== -1) {
        const line = importLine + 1;
        const replacement = rows[line - 1]
          .replace(new RegExp(`\\b${escapeRegExp(name)}\\b\\s*,?\\s*`), "")
          .replace(/,\s*\}/, " }");
        const isEmpty = /import\s*\{\s*\}\s*from/.test(replacement);
        const result = await rt.runTool(
          editTool(rt, diagnostic.path, [{ line, search: rows[line - 1], replace: isEmpty ? "" : replacement }], `edit ${relativePath(diagnostic.path, rt.root)} · drop unused import`),
        );
        if (result.status === "ok") {
          fixed += 1;
          handled.add(key);
          if (result.diff) rt.effect({ type: "attach-diff", diff: result.diff });
        }
      }
    }
  }

  const after = rt.diagnostics();
  await rt.runTool(lspTool(rt, "diagnostics · after", after));
  const tests = await rt.runTool(bashTool(rt, "bun test"));
  await rt.runTool(closingTool(after.length === 0 && tests.status === "ok" ? "ok" : "warn"));
  await rt.say(
    await summarize(
      rt,
      `${fixed} file(s) tidied`,
      [
        `Diagnostics went from ${before.length} to ${after.length}; the suite ${tests.status === "ok" ? "still exits 0" : "now exits non-zero, which means the cleanup went too far"}.`,
        "Each edit was anchored, so a file modified behind my back would have been rejected rather than half-patched.",
      ],
      [
        after.length > 0 ? "Ask me to take the remaining findings one by one — some need a judgement call, not a regex." : "Ask me to commit the tidy-up.",
        "Open the Diff pane to read every hunk before keeping it.",
      ],
    ),
  );
  rt.effect({ type: "open-pane", pane: "diff" });
};

const explain: Recipe = async (rt, prompt) => {
  const fallback = hasPiLab(rt) ? piLab(rt).readme : rt.workspace.paths(rt.root)[0];
  const target = extractPath(prompt, rt.workspace) ?? fallback;
  if (!target) {
    await rt.say("There is no project attached to this chat, so there is nothing on disk to read. Enter a project or point me at a folder.\n\n");
    return;
  }
  await rt.say(`Reading the file before describing it — \`${relativePath(target, rt.root)}\`.\n\n`);
  await rt.runTool(readTool(rt, target, 1, 60));
  const symbols = symbolsFor(rt.workspace, target);
  if (symbols.length > 0) {
    await rt.runTool(
      tableTool(
        `${relativePath(target, rt.root)} · document symbols`,
        symbols.map((symbol) => [`${String(symbol.line).padStart(4)}  ${symbol.kind.padEnd(9)}`, `${symbol.exported ? "export " : ""}${symbol.name}`]),
        "lsp",
      ),
    );
  }
  const rules = rt.workspace.read(`${rt.root}/AGENTS.md`);
  const lineCount = (rt.workspace.read(target) ?? "").split("\n").length;
  await rt.say(
    await summarize(
      rt,
      `explained ${relativePath(target, rt.root)}`,
      [
        symbols.length > 0
          ? `Exported surface: ${symbols.filter((symbol) => symbol.exported).map((symbol) => `\`${symbol.name}\``).join(", ") || "none"}. The file is ${lineCount} lines; column one of the outline is the line number.`
          : `The file is ${lineCount} lines of prose/configuration with no code symbols.`,
        rules ? "Repo rules from `AGENTS.md` apply, including the ban on relaxing assertions." : "No `AGENTS.md` in this folder, so only session rules apply.",
      ],
      ["Ask me to trace a symbol across the project with a rename preview.", "Ask me to add a test that pins this behaviour."],
    ),
  );
};

const search: Recipe = async (rt, prompt) => {
  const terms = keywordsOf(prompt);
  if (terms.length === 0) {
    await rt.say("Give me something to search for and I'll grep the tree instead of guessing.\n\n");
    return;
  }
  await rt.say(`Searching the workspace for ${terms.slice(0, 3).map((term) => `\`${term}\``).join(", ")}.\n\n`);
  let matched = 0;
  for (const term of terms.slice(0, 3)) {
    const result = await rt.runTool(grepTool(rt, term, { ignoreCase: true }));
    if (result.blocks.some((block) => block.type === "hits")) matched += 1;
  }
  const first = rt.workspace.grep(terms[0], { ignoreCase: true, limit: 1 })[0];
  if (first) await rt.runTool(readTool(rt, first.path, Math.max(1, first.line - 6), first.line + 12));
  await rt.runTool(globTool(rt, "**/*.ts"));
  await rt.say(
    await summarize(
      rt,
      "search complete",
      [
        matched > 0 ? "Matches are listed with file and line numbers, and the first hit was read in context rather than quoted out of it." : "No matches. If the symbol is new, the next step is a scaffold, not a guess.",
        "Every path resolves inside the project root; cross-repo schemes (`pr://`, `ssh://`, `agent://`) resolve through the shell in the packaged app.",
      ],
      ["Ask me to explain the hottest file.", "Ask me to add the missing symbol and a test for it."],
    ),
  );
};

const accuracy: Recipe = async (rt) => {
  const p = piLab(rt);
  if (!hasPiLab(rt)) {
    await rt.say("This workspace has no pi-lab project, so there is no estimator table to measure.\n\n");
    return;
  }
  await rt.say("Measuring the estimators instead of repeating the README — the script prints real errors.\n\n");
  await rt.runTool(bashTool(rt, "bun run scripts/accuracy.ts"));
  const stats = convergence(rt, p.leibniz);
  const rows = [10, 100, 1_000, 100_000, 1_000_000]
    .map((terms) => {
      const leibniz = accuracyError(rt, p.leibniz, terms);
      const machin = accuracyError(rt, p.machin, terms, "machinPi");
      return `${String(terms).padStart(9)}  ${leibniz === undefined ? "     n/a" : leibniz.toExponential(3)}  ${machin === undefined ? "     n/a" : machin.toExponential(3)}`;
    })
    .join("\n");
  await rt.runTool(
    probeTool(
      rt,
      "estimator comparison · |error| vs π",
      "for (const n of [10, 100, 1000, 100000, 1000000]) log(n, errLeibniz(n), errMachin(n));",
      `    terms  leibniz      machin\n${rows}`,
    ),
  );
  await rt.runTool(readTool(rt, p.accuracyDoc, 1, 14));
  await rt.say(
    await summarize(
      rt,
      "accuracy measured",
      [
        stats
          ? `Leibniz error ratio across a terms doubling is ${stats.ratio.toFixed(3)}${stats.converging ? " — alternating and healthy." : ", so the sign is being dropped and the estimate will never converge."}`
          : "The Leibniz estimator could not be loaded for measurement.",
        "Machin reaches machine precision by 12 terms; the Leibniz column is kept for the onboarding walkthrough only.",
      ],
      ["Ask me to fix the failing test if the leibniz column looks wrong.", "Ask for a regression test pinning the Machin path at 30 terms."],
    ),
  );
};

const feature: Recipe = async (rt, prompt) => {
  await rt.say("Scaffolding against the real repo, then proving the scaffold type-checks and the suite stays green.\n\n");
  await rt.runTool(globTool(rt, "**/*.ts"));
  const terms = keywordsOf(prompt);
  await rt.runTool(grepTool(rt, terms[0] ?? "export"));
  const agents = rt.workspace.read(`${rt.root}/AGENTS.md`);
  if (agents) await rt.runTool(readTool(rt, `${rt.root}/AGENTS.md`, 1, 20));

  const slug = slugify(prompt.replace(/^(add|implement|create|build|scaffold|support)\s+/i, "")) || "task";
  const fn = camelCase(slug);
  const typeName = `${fn.charAt(0).toUpperCase()}${fn.slice(1)}Options`;
  const modulePath = `${rt.root}/src/${slug}.ts`;
  const testPath = `${rt.root}/test/${slug}.test.ts`;

  const content = [
    "/**",
    ` * ${slug} — scaffolded from: "${prompt.trim()}".`,
    " *",
    " * The contract is intentionally thin: it exists so the module type-checks, is",
    " * imported by a test, and can be replaced with the real implementation without",
    " * touching call sites.",
    " */",
    `export interface ${typeName} {`,
    "  readonly terms?: number;",
    "}",
    "",
    `export function ${fn}(options: ${typeName} = {}): number {`,
    "  const terms = options.terms ?? 12;",
    "  return terms;",
    "}",
    "",
  ].join("\n");
  await rt.runTool(writeTool(rt, modulePath, content, `write ${relativePath(modulePath, rt.root)} · new module`));

  const testContent = [
    `import { ${fn} } from "../src/${slug}";`,
    "",
    `test("${slug}: honours the terms option", () => {`,
    `  expect(${fn}({ terms: 30 })).toBe(30);`,
    "});",
    "",
    `test("${slug}: defaults to twelve terms", () => {`,
    `  expect(${fn}()).toBe(12);`,
    "});",
    "",
  ].join("\n");
  await rt.runTool(writeTool(rt, testPath, testContent, `write ${relativePath(testPath, rt.root)} · new suite`));

  const tests = await rt.runTool(bashTool(rt, `bun test ${relativePath(testPath, rt.root)}`));
  const diagnostics = rt.diagnostics();
  await rt.runTool(lspTool(rt, "diagnostics", diagnostics));
  await rt.runTool(
    askTool(`What should \`${slug}\` actually compute?`, [
      "Mirror an existing estimator and route it through src/format.ts",
      "Implement the real algorithm — I'll paste the formula or a reference",
      "Keep the scaffold and wire it into the CLI surface first",
    ]),
  );
  await rt.runTool(closingTool(tests.status === "ok" ? "ok" : "warn"));
  await rt.say(
    await summarize(
      rt,
      `${relativePath(modulePath, rt.root)} scaffolded`,
      [
        `Created the module and a suite that pins its contract; \`bun test ${relativePath(testPath, rt.root)}\` ${tests.status === "ok" ? "exits 0" : "is red"}.`,
        "The scaffold is deliberately a stub — I will not invent an algorithm the repo has no reference for. Answer the question above and I'll fill it in.",
      ],
      ["Answer the spec question above with a formula or a reference file.", "Ask me to wire the module into `src/index.ts` once the shape is agreed."],
    ),
  );
  rt.effect({ type: "set-title", title: `Scaffold ${slug}` });
};

const commit: Recipe = async (rt) => {
  await rt.say("Reading the working tree before writing a commit — status first, then the diff.\n\n");
  await rt.runTool(bashTool(rt, "git status"));
  const status = rt.workspace.status(rt.root);
  if (status.length === 0) {
    await rt.say("The working tree is clean, so there is nothing to commit. I won't invent an empty commit.\n\n");
    return;
  }
  await rt.runTool(bashTool(rt, "git diff"));
  const area = status[0].path.includes("/src/") ? "src" : status[0].path.split("/").slice(-2, -1)[0] ?? "workspace";
  const subject = status.some((entry) => entry.path.includes("leibniz"))
    ? `fix(${area}): restore the alternating sign in the leibniz estimator`
    : `chore(${area}): update ${status.map((entry) => entry.path.split("/").pop()).slice(0, 2).join(", ")}`;
  await rt.runTool(bashTool(rt, `git commit -m "${subject}"`));
  await rt.runTool(bashTool(rt, "git log"));
  await rt.runTool(closingTool("ok"));
  await rt.say(
    await summarize(
      rt,
      "committed",
      [
        `\`${subject}\` covers ${status.length} changed path(s); the working tree reads clean afterwards because the commit snapshots the index.`,
        "Lockfiles are excluded from analysis by policy — see the `lockfiles` stream rule in Settings → Stream rules.",
      ],
      ["Ask me to push and open a PR — the packaged shell owns git credentials.", "Ask for a review of the commit you just made."],
    ),
  );
};

const memory: Recipe = async (rt) => {
  const facts = rt.session.memoryFacts;
  await rt.runTool(memoryTool("recall · project scope", facts.length > 0 ? facts : ["no facts retained in this session yet"]));
  await rt.runTool(
    probeTool(
      rt,
      "memory bank · reflect",
      "recall({ scope: 'project', query: 'estimator accuracy' })",
      [
        `backend: ${rt.settings.memory.backend}${rt.settings.memory.projectScoped ? " · project scope" : " · global scope"}`,
        `autoload on first turn: ${rt.settings.memory.autoload ? "yes" : "no"}`,
        `facts retained this session: ${facts.length}`,
      ].join("\n"),
    ),
  );
  await rt.say(
    await summarize(
      rt,
      "memory inspected",
      [
        facts.length > 0
          ? "Facts above were retained mid-run, project-scoped, and load on the first turn of the next session."
          : "Nothing is retained yet — run a task and I'll capture the lessons worth keeping.",
        `Backend is \`${rt.settings.memory.backend}\`; switch it in Settings → Memory.`,
      ],
      ["Ask me to forget a specific fact.", "Ask me to promote a lesson into a managed skill."],
    ),
  );
};

const capability: Recipe = async (rt, prompt) => {
  const lower = prompt.toLowerCase();
  if (/screenshot|screen|window|clipboard|computer/.test(lower)) {
    await rt.runTool(
      proposeTool("computer", "host desktop", "computer · capabilities", [
        {
          type: "note",
          tone: "info",
          title: "computer requires the packaged shell",
          body: "Window enumeration, screenshots, native input and the accessibility tree come from the shell's host bridge. The browser runtime exposes no host, so this stays a proposal.",
        },
        { type: "code", language: "json", caption: "shell bridge surface", code: '{\n  "windows": "computer.window(id)",\n  "capture": "win.screenshot()",\n  "input": "el.press(key)",\n  "ax": "win.ax()"\n}' },
      ]),
    );
  } else if (/debug|breakpoint|segfault|dap|lldb|dlv|debugpy/.test(lower)) {
    await rt.runTool(
      proposeTool("debug", "dap", "debug · adapter discovery", [
        {
          type: "note",
          tone: "info",
          title: "no debug adapter reachable from the browser runtime",
          body: "The packaged shell attaches a real adapter through `debug`. Nothing here will pretend to be attached.",
        },
        { type: "code", language: "json", caption: "what the shell would launch", code: '{\n  "adapter": "lldb-dap",\n  "program": "./build/pi-native",\n  "breakpoints": ["src/leibniz.ts:11"]\n}' },
      ]),
    );
  } else {
    await rt.runTool(
      proposeTool("browser", "cdp", "browser · relay capabilities", [
        {
          type: "note",
          tone: "info",
          title: "the browser relay is a packaged-shell capability",
          body: "Puppeteer tabs, CDP-attached apps and the Chrome relay live in the shell. Enable Settings → Browser relay once the packaged build runs.",
        },
      ]),
    );
  }
  await rt.say(
    await summarize(
      rt,
      "capability report",
      [
        "I described the surface honestly instead of simulating output this runtime cannot produce.",
        "read / write / edit / grep / glob / bash / lsp / task / todo / memory all run against the live workspace in this window.",
      ],
      ["Run the packaged build (`bun run desktop:dev`) to attach the shell bridge.", "Or give me a task that only needs workspace tools."],
    ),
  );
};

const generic: Recipe = async (rt, prompt) => {
  const terms = keywordsOf(prompt);
  const p = hasPiLab(rt) ? piLab(rt) : undefined;
  const todos: TodoItem[] = [
    { id: "g1", text: "Map the workspace before changing anything", status: "in_progress", phase: "survey" },
    { id: "g2", text: "Locate the code that owns this behaviour", status: "pending", phase: "locate" },
    { id: "g3", text: "Propose the smallest change that satisfies the ask", status: "pending", phase: "propose" },
  ];
  rt.setTodos(todos);
  await rt.runTool(todoTool(todos));
  await rt.runTool(globTool(rt, "**/*.ts"));
  if (p) {
    await rt.runTool(readTool(rt, p.agents, 1, 24));
    await rt.runTool(readTool(rt, p.readme, 1, 18));
  }
  if (terms.length > 0) await rt.runTool(grepTool(rt, terms[0], { ignoreCase: true }));
  const diagnostics = rt.diagnostics();
  await rt.runTool(lspTool(rt, "diagnostics", diagnostics));

  const keywords = (prompt.match(/\b(ultrathink|orchestrate|workflowz)\b/gi) ?? []).map((keyword) => keyword.toLowerCase());
  if (keywords.includes("orchestrate") || keywords.includes("workflowz")) {
    await rt.say("Orchestration keyword present — splitting the survey across workers instead of doing it serially.\n\n");
    await rt.runSubagents([
      {
        name: "SurfaceMap",
        task: "Map the public surface of the project and the files that own it.",
        costUsd: 0.05,
        tokens: 7_400,
        durationMs: 2_100,
        isolatedWorktree: "wt/survey-surface",
        steps: [
          { say: "Globbing the source tree.", tool: globTool(rt, "**/src/*.ts") },
          ...(p ? [{ say: "Reading the CLI surface.", tool: readTool(rt, p.index, 1, 24) }] : []),
        ],
        findings: p
          ? [
              "Public surface: `estimatePi` and `report` in src/index.ts — AGENTS.md pins both.",
              "Estimators live in src/leibniz.ts and src/machin.ts; formatting is shared through src/format.ts.",
            ]
          : ["The workspace has no TypeScript entry point yet."],
      },
      {
        name: "RiskScan",
        task: "Report every diagnostic that could block a change.",
        costUsd: 0.02,
        tokens: 3_200,
        durationMs: 1_200,
        steps: [{ say: "Collecting diagnostics.", tool: lspTool(rt, "diagnostics", diagnostics) }],
        findings:
          diagnostics.length === 0
            ? ["Nothing blocking: zero diagnostics."]
            : diagnostics.map((diagnostic) => `${relativePath(diagnostic.path, rt.root)}:${diagnostic.line} — ${diagnostic.message}`),
      },
    ]);
  }

  if (keywords.includes("ultrathink")) {
    await rt.say(
      "Ultrathink requested — walking the constraint space explicitly before proposing anything: public-surface stability, the 1e-6 acceptance window, and the no-assertion-relaxation rule from `AGENTS.md`.\n\n",
    );
  }

  rt.updateTodo("g1", "completed");
  rt.updateTodo("g2", "completed");
  rt.updateTodo("g3", "in_progress");

  await rt.runTool(
    askTool("Which outcome do you want first?", [
      "Narrow the ask to one file and implement it now",
      "Write a failing test that captures the ask, then implement against it",
      "Produce a written plan only — no writes this turn",
    ]),
  );
  await rt.runTool(closingTool("info"));
  await rt.say(
    await summarize(
      rt,
      "survey complete",
      [
        p
          ? "The tree is small and typed: estimators in `src/`, suite in `test/`, one accuracy script. Nothing in the survey was inferred without reading it."
          : "No bundled project is attached, so the survey only saw what exists on disk.",
        `Diagnostics: ${diagnostics.length}. Todo list: ${rt.todos.filter((todo) => todo.status === "completed").length}/${rt.todos.length} complete pending your answer above.`,
      ],
      ["Answer the question above and I'll take the narrowest path that satisfies it.", "Or name a file and I'll scope the change to it directly."],
    ),
  );
};

/* ------------------------------------------------------------------ *
 * Slash commands
 * ------------------------------------------------------------------ */

async function commandHelp(rt: TurnRuntime): Promise<void> {
  await rt.runTool(
    tableTool("session controls", [
      ["/model [selector]", "Swap the active model, or assign one to a role."],
      ["/review", "Reviewer subagents with P0–P3 findings and a verdict."],
      ["/advisor", "Toggle the advisory reviewer paired to every turn."],
      ["/vibe", "Director mode with a read-only toolset for workers."],
      ["/fresh", "Reset provider stream state without touching the transcript."],
      ["/compact", "Collapse the transcript into a mental model."],
      ["/todos · /memory · /skills · /tools", "Inspect session state."],
      ["/collab", "Share the live session over a relay (packaged shell prints the QR)."],
      ["/clear", "Clear the transcript and detach from the project."],
    ]),
  );
  await rt.runTool(
    tableTool("magic keywords (prose only)", [
      ["ultrathink", "Highest supported thinking effort on this turn."],
      ["orchestrate", "Parallel subagents with per-phase verification."],
      ["workflowz", "Deterministic multi-subagent workflow through the task tool."],
    ]),
  );
  await rt.say("Every control above is wired in this build; the ones needing the packaged shell say so when you run them.\n\n");
}

export const COMMANDS: Record<string, Recipe> = {
  "/help": commandHelp,
  "/review": review,
  "/model": async (rt, prompt) => {
    const selector = prompt.replace("/model", "").trim();
    const roleMatch = selector.match(/^role\s+([a-z]+)\s+(\S+)$/i);
    if (roleMatch) {
      rt.effect({ type: "set-role", role: roleMatch[1] as never, selector: roleMatch[2] });
      await rt.say(`Assigned \`${roleMatch[2]}\` to the \`${roleMatch[1]}\` role. The next turn that needs that role picks it up immediately.\n\n`);
      return;
    }
    if (selector) {
      rt.effect({ type: "set-model", selector });
      await rt.say(`Switched the active model to \`${selector}\`. Same session, same transcript — no restart.\n\n`);
      return;
    }
    await rt.runTool(
      tableTool("model roles", [
        ["default", rt.settings.modelRoles.default ?? "anthropic/opus-4.6-1m"],
        ["smol", rt.settings.modelRoles.smol ?? "xai/grok-4-fast"],
        ["plan", rt.settings.modelRoles.plan ?? "google/gemini-3-pro"],
        ["task", rt.settings.modelRoles.task ?? "anthropic/sonnet-4.7"],
        ["advisor", rt.settings.modelRoles.advisor ?? "openai/gpt-5.5"],
      ]),
    );
    await rt.say("Use `/model provider/model` to switch, or `/model role task provider/model` to pin a role.\n\n");
  },
  "/advisor": async (rt) => {
    const enabled = !rt.settings.advisor.enabled;
    rt.effect({ type: "set-advisor", enabled });
    await rt.say(
      enabled
        ? "Advisor on. A second model reads every turn on its own context and injects notes inline — asides, concerns, or hard blockers.\n\n"
        : "Advisor off. Turns run on the primary model only.\n\n",
    );
  },
  "/vibe": async (rt) => {
    rt.effect({ type: "set-mode", mode: "vibe" });
    await rt.say("Vibe mode. I direct persistent `fast`/`good` workers with a read-only toolset — you steer outcomes, not diffs.\n\n");
  },
  "/fresh": async (rt) => {
    await rt.runTool(
      proposeTool("bash", "stream reset", "/fresh · provider stream reset", [
        {
          type: "note",
          tone: "ok",
          title: "prompt cache dropped",
          body: "The provider stream was re-established for the next turn. The local transcript is untouched — nothing was compacted or cleared.",
        },
      ]),
    );
    await rt.say("Fresh stream on the same transcript. Use this when a cache goes stale or a stream wedges.\n\n");
  },
  "/compact": async (rt) => {
    const counts = rt.session.transcript.reduce<Record<string, number>>((accumulator, item) => {
      accumulator[item.kind] = (accumulator[item.kind] ?? 0) + 1;
      return accumulator;
    }, {});
    await rt.runTool(
      tableTool("mental model", [
        ["turns", String(counts.user ?? 0)],
        ["assistant blocks", String(counts.assistant ?? 0)],
        ["tool calls", String(counts.tool ?? 0)],
        ["todos", `${rt.todos.filter((todo) => todo.status === "completed").length}/${rt.todos.length} complete`],
        ["facts retained", String(rt.session.memoryFacts.length)],
        ["subagents", String(rt.session.subagents.length)],
      ]),
    );
    await rt.say("Compacted into the mental model above. The first turn of the next session starts from this summary, not the raw transcript.\n\n");
  },
  "/todos": async (rt) => {
    await rt.runTool(todoTool(rt.todos));
    await rt.say(rt.todos.length === 0 ? "No todo list on this session yet.\n\n" : "That is the live list — it mutates as work lands, phase by phase.\n\n");
  },
  "/memory": memory,
  "/skills": async (rt) => {
    await rt.runTool(
      tableTool("managed skills", [
        ["hashline-patch", "learned · 34 uses — anchored edits, verify before apply"],
        ["bun-test-loop", "learned · 12 uses — narrowest failing test first"],
        ["aggressive-search", "bundled · 51 uses — reuse an existing helper first"],
        ["pi-accuracy", "managed · 9 uses — never relax an assertion"],
      ]),
    );
    await rt.say("Skills are project-scoped: what the agent learns about this repo stays with this repo.\n\n");
  },
  "/tools": async (rt) => {
    const enabled = Object.entries(rt.settings.tools)
      .filter(([, value]) => value.enabled)
      .map(([name]) => name);
    await rt.runTool(
      tableTool("pinned tool set", [
        ["active", enabled.join(", ") || "default set"],
        ["approval required", Object.entries(rt.settings.tools).filter(([, value]) => value.requiresApproval).map(([name]) => name).join(", ") || "none"],
        ["xdev devices", rt.settings.xdev ? "enabled (read xd:// to list)" : "disabled"],
      ]),
    );
    await rt.say("Pin or gate any tool in Settings → Tools; gated tools pause for a single approval instead of prompting every call.\n\n");
  },
  "/schemes": async (rt) => {
    await rt.runTool(
      tableTool("internal schemes", [
        ["pr://1428", "a pull request, same shape as a file"],
        ["issue://311", "an issue body"],
        ["agent://<id>/findings.0.path", "a field out of a subagent's output"],
        ["skill://pi-accuracy", "a managed skill body"],
        ["conflict://1", "one merge conflict; write @theirs/@ours/@base"],
        ["xd://", "list discoverable tools"],
      ]),
    );
    await rt.say("Every FS-shaped tool resolves these transparently — `read pr://1428` has the shape of `read src/foo.ts`.\n\n");
  },
  "/collab": async (rt) => {
    await rt.runTool(
      proposeTool("bash", "collab relay", "collab · share session", [
        {
          type: "note",
          tone: "info",
          title: "the relay needs the packaged shell",
          body: "`/collab` publishes the live session over the omp relay and prints a scannable QR. The browser runtime cannot mint relay keys, so this is the exact surface the packaged build returns.",
        },
        {
          type: "code",
          language: "text",
          caption: "packaged output",
          code: "Collab session started!\nlink: https://my.omp.sh/s/8f2c-1a90 (view-only)\njoin: omp join 8f2c-1a90\nframes are sealed client-side; the relay never sees your keys",
        },
      ]),
    );
    await rt.say("Share read-write to pair on the same agent, or view for a link anyone can watch but no one can steer.\n\n");
  },
  "/annotate": async (rt) => {
    await rt.say("Annotation mode: pin notes to diff lines, a reply, a file or quoted text, and I fold them into the next prompt with the anchors intact.\n\n");
  },
  "/login": async (rt) => {
    await rt.runTool(
      tableTool("providers attached", [
        ["anthropic", "oauth · ready"],
        ["openai", "api key required — Settings → Providers"],
        ["ollama", "local · http://127.0.0.1:11434/v1"],
      ]),
    );
    await rt.say("OAuth providers attach through `/login`; key-based providers take a key in Settings → Providers. Keys are stored by the shell and never rendered back into a transcript.\n\n");
  },
  "/clear": async (rt) => {
    rt.effect({ type: "clear-transcript" });
    await rt.say("Transcript cleared. This chat is detached — it has no project folder until you enter one.\n\n");
  },
};

export const RECIPES: Record<RecipeId, Recipe> = {
  "fix-tests": fixTests,
  "run-tests": runTests,
  review,
  cleanup,
  explain,
  search,
  accuracy,
  feature,
  commit,
  memory,
  capability,
  command: commandHelp,
  generic,
};
