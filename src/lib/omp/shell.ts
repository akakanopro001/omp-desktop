import type { Workspace } from "./vfs";
import { normalize } from "./vfs";
import { runScript, runTest, resolveModule } from "./evaluator";
import { diagnosticsFor, formatDiagnostics } from "./lsp";

/**
 * The workspace shell.
 *
 * omp's own `bash` tool links ripgrep/glob/find and 58 coreutils into the
 * process instead of forking; this module is the browser runtime's equivalent.
 * Commands are executed against the live workspace, so their output is real —
 * an exit code of 1 means the tests genuinely failed on the current sources.
 */

export interface ShellResult {
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === quote) {
        quote = null;
        continue;
      }
      if (char === "\\" && index + 1 < input.length) {
        current += input[index + 1];
        index += 1;
        continue;
      }
      current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

export function resolvePath(cwd: string, target: string | undefined): string {
  if (!target || target === ".") return normalize(cwd);
  if (target.startsWith("/")) return normalize(target);
  if (target === "~") return normalize(cwd);
  return normalize(`${cwd}/${target}`);
}

interface Line {
  text: string;
}

export function runCommand(workspace: Workspace, cwd: string, command: string): ShellResult {
  const started = Date.now();
  const stages = command.split("|").map((stage) => stage.trim());
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  let stdin = "";

  for (const stage of stages) {
    const result = runSingle(workspace, cwd, stage, stdin);
    stdout += result.stdout;
    stderr += result.stderr;
    exitCode = result.exitCode;
    stdin = result.stdout;
    if (exitCode !== 0) break;
  }

  return {
    command,
    cwd,
    stdout: stdout.replace(/\n$/, ""),
    stderr: stderr.replace(/\n$/, ""),
    exitCode,
    durationMs: Date.now() - started,
  };
}

function runSingle(workspace: Workspace, cwd: string, stage: string, stdin: string): { stdout: string; stderr: string; exitCode: number } {
  const argv = tokenize(stage);
  if (argv.length === 0) return { stdout: "", stderr: "", exitCode: 0 };
  const [name, ...args] = argv;
  const out = (text: string) => ({ stdout: text.endsWith("\n") ? text : `${text}\n`, stderr: "", exitCode: 0 });
  const fail = (text: string, code = 1) => ({ stdout: "", stderr: `${text}\n`, exitCode: code });

  switch (name) {
    case "pwd":
      return out(cwd);

    case "echo":
      return out(args.join(" "));

    case "ls": {
      const flags = args.filter((arg) => arg.startsWith("-"));
      const targets = args.filter((arg) => !arg.startsWith("-"));
      const target = resolvePath(cwd, targets[0]);
      const long = flags.some((flag) => flag.includes("l") || flag.includes("a"));
      const children = workspace.paths(target).filter((path) => path !== target);
      const direct = new Set<string>();
      const dirs = new Set<string>();
      children.forEach((path) => {
        const rest = path.slice(target.length + 1);
        const [head, ...tail] = rest.split("/");
        if (tail.length === 0) {
          const file = workspace.file(path);
          if (long) {
            direct.add(`-rw-r--r--  1 omp  staff  ${String(file?.content.length ?? 0).padStart(6)}  ${head}`);
          } else {
            direct.add(head);
          }
        } else {
          dirs.add(`${head}/`);
        }
      });
      if (direct.size === 0 && dirs.size === 0 && workspace.read(target) !== undefined) {
        return out(target.split("/").pop() ?? target);
      }
      const rows = [...(long ? [] : dirs), ...direct].sort();
      return out(rows.join("\n"));
    }

    case "cat": {
      if (args.length === 0) return fail("cat: missing operand");
      const target = resolvePath(cwd, args[args.length - 1]);
      const content = workspace.read(target);
      if (content === undefined) return fail(`cat: ${args[args.length - 1]}: No such file or directory`);
      return out(content);
    }

    case "head":
    case "tail": {
      let count = 10;
      const rest = args.filter((arg) => {
        if (/^-n?\d+$/.test(arg)) {
          count = Number(arg.replace(/^-n?/, ""));
          return false;
        }
        return arg !== "-n";
      });
      const target = resolvePath(cwd, rest[rest.length - 1]);
      const content = workspace.read(target);
      if (content === undefined) return fail(`${name}: ${rest[rest.length - 1]}: No such file or directory`);
      const rows = content.split("\n");
      return out((name === "head" ? rows.slice(0, count) : rows.slice(-count)).join("\n"));
    }

    case "wc": {
      const targets = args.filter((arg) => !arg.startsWith("-"));
      const target = resolvePath(cwd, targets[targets.length - 1]);
      const content = workspace.read(target);
      if (content === undefined) return fail(`wc: ${targets[targets.length - 1]}: No such file or directory`);
      const rows = content.split("\n").filter((row) => row.length > 0);
      const words = content.split(/\s+/).filter(Boolean).length;
      return out(`${String(rows.length).padStart(7)} ${String(words).padStart(7)} ${String(content.length).padStart(7)} ${targets[targets.length - 1]}`);
    }

    case "grep": {
      const ignoreCase = args.some((arg) => /^-[a-z]*i/.test(arg));
      const withLine = args.some((arg) => /^-[a-z]*n/.test(arg));
      const positional = args.filter((arg) => !arg.startsWith("-"));
      const pattern = positional[0];
      if (!pattern) return fail("grep: no pattern");
      const target = positional[1] ? resolvePath(cwd, positional[1]) : cwd;
      const hits = workspace.grep(pattern, { ignoreCase, glob: undefined }).filter((hit) => hit.path.startsWith(target));
      if (hits.length === 0) return { stdout: "", stderr: "", exitCode: 1 };
      return out(
        hits
          .slice(0, 60)
          .map((hit) => `${withLine || true ? `${hit.path}:${hit.line}: ` : ""}${hit.text.trim()}`)
          .join("\n"),
      );
    }

    case "find": {
      const positional = args.filter((arg) => !arg.startsWith("-") && arg !== "-name");
      const nameIndex = args.indexOf("-name");
      const pattern = nameIndex === -1 ? "**/*" : args[nameIndex + 1].replace(/^["']|["']$/g, "");
      const root = resolvePath(cwd, positional[0] ?? ".");
      const globPattern = pattern.includes("/") ? pattern : `**/${pattern}`;
      const paths = workspace.paths(root).filter((path) => path !== root).filter((path) => matchesGlob(path.split("/").pop() ?? path, globPattern.split("/").pop() ?? pattern));
      return out(paths.join("\n"));
    }

    case "mkdir": {
      const target = resolvePath(cwd, args.filter((arg) => !arg.startsWith("-")).pop());
      workspace.plant(`${target}/.keep`, "");
      return out("");
    }

    case "touch": {
      const target = resolvePath(cwd, args[args.length - 1]);
      if (workspace.read(target) === undefined) workspace.writeDirty(target, "");
      return out("");
    }

    case "rm": {
      const recursive = args.some((arg) => /^-[a-z]*r|^-[a-z]*f/.test(arg));
      const target = resolvePath(cwd, args.filter((arg) => !arg.startsWith("-")).pop());
      const paths = workspace.paths(target);
      if (paths.length === 0) return fail(`rm: ${target}: No such file or directory`);
      if (paths.length > 1 && !recursive) return fail(`rm: ${target}: is a directory`);
      paths.forEach((path) => workspace.remove(path));
      return out("");
    }

    case "git":
      return git(workspace, cwd, args);

    case "bun":
      return bun(workspace, cwd, args);

    case "tsc":
      return typecheck(workspace, cwd);

    case "true":
      return out("");
    case "false":
      return fail("");

    default:
      if (stdin) return out(stdin);
      return fail(`brush: command not found: ${name}\n  (in-process builtins: ls cat head tail wc grep find echo pwd mkdir touch rm git bun tsc)`);
  }
}

function matchesGlob(name: string, pattern: string): boolean {
  const regex = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
  return regex.test(name);
}

function git(workspace: Workspace, cwd: string, args: string[]) {
  const folder = workspace.folder(cwd);
  const root = folder?.path ?? cwd;
  const sub = args[0] ?? "status";
  const out = (text: string) => ({ stdout: text.endsWith("\n") ? text : `${text}\n`, stderr: "", exitCode: 0 });

  if (sub === "status") {
    const rows = workspace.status(root);
    if (rows.length === 0) return out("nothing to commit, working tree clean");
    return out(
      `On branch ${folder?.branch ?? "main"}\n\n${rows
        .map((entry) => `${entry.status === "untracked" ? "??" : entry.status === "modified" ? " M" : entry.status === "deleted" ? " D" : "UU"} ${entry.path}`)
        .join("\n")}`,
    );
  }

  if (sub === "log") {
    const head = folder?.head ?? [];
    return out(head.map((commit) => `${commit.hash} ${commit.subject} — ${commit.author}, ${new Date(commit.at).toISOString().slice(0, 10)}`).join("\n") || "fatal: your current branch has no commits yet");
  }

  if (sub === "branch") {
    const folders = workspace.folders_();
    return out(folders.map((entry) => `${entry.branch === folder?.branch ? "* " : "  "}${entry.branch}`).join("\n"));
  }

  if (sub === "diff") {
    const rows = workspace.status(root);
    if (rows.length === 0) return out("");
    return out(
      rows
        .map((entry) => {
          const current = workspace.read(entry.path) ?? "";
          const head = `${entry.path} (working tree)`;
          return `diff --git a/${entry.path} b/${entry.path}\n${head}\n${current
            .split("\n")
            .slice(0, 8)
            .map((line) => `+${line}`)
            .join("\n")}`;
        })
        .join("\n\n"),
    );
  }

  if (sub === "commit") {
    const messageIndex = args.findIndex((arg) => arg === "-m");
    const subject = messageIndex === -1 ? "wip" : args.slice(messageIndex + 1).join(" ");
    const commit = workspace.commit(subject, "omp agent <agent@omp.sh>", root);
    return out(`[${folder?.branch ?? "main"} ${commit.hash}] ${subject}`);
  }

  if (sub === "add") {
    return out("");
  }

  return out(`git: '${sub}' is not a supported subcommand in the bundled runtime (status, diff, log, branch, add, commit)`);
}

function bun(workspace: Workspace, cwd: string, args: string[]) {
  const out = (text: string) => ({ stdout: text.endsWith("\n") ? text : `${text}\n`, stderr: "", exitCode: 0 });
  const [sub, ...rest] = args;

  if (sub === "test") {
    const explicit = rest.filter((arg) => !arg.startsWith("-")).map((arg) => resolvePath(cwd, arg));
    const discovered = workspace.glob("**/*.test.ts").filter((path) => path.startsWith(cwd));
    const entries = explicit.length > 0 ? explicit : discovered;
    const result = runTest(workspace, entries);
    return { stdout: result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`, stderr: result.stderr, exitCode: result.exitCode };
  }

  if (sub === "run") {
    const target = rest[0];
    if (!target) return { stdout: "", stderr: "error: expected a script or file to run\n", exitCode: 1 };
    const packageJson = workspace.read(`${cwd}/package.json`);
    if (packageJson) {
      try {
        const parsed = JSON.parse(packageJson) as { scripts?: Record<string, string> };
        const script = parsed.scripts?.[target];
        if (script) {
          return runScriptLine(workspace, cwd, script);
        }
      } catch {
        /* fall through to file execution */
      }
    }
    return runScriptLine(workspace, cwd, rest.join(" "));
  }

  if (sub === "install") {
    return out("Resolving dependencies\nSaved lockfile\n 0 packages installed [12.00ms]");
  }

  if (sub === "x") {
    return runScriptLine(workspace, cwd, rest.join(" "));
  }

  if (sub === "pm") {
    return out("bun pm v1.3.14");
  }

  return { stdout: "", stderr: `bun: '${sub ?? ""}' is not available in the bundled runtime (test, run, x, install, pm)\n`, exitCode: 1 };
}

function runScriptLine(workspace: Workspace, cwd: string, line: string) {
  const argv = tokenize(line);
  const fileArg = argv.find((arg) => /\.(ts|js|mjs|tsx)$/.test(arg)) ?? argv[argv.length - 1];
  const resolved = resolvePath(cwd, fileArg);
  const modulePath = workspace.read(resolved) !== undefined ? resolved : resolveModule(`${cwd}/entry.ts`, `./${fileArg}`, workspace);
  if (!modulePath) {
    return { stdout: "", stderr: `error: Module not found: "${fileArg}"\n`, exitCode: 1 };
  }
  const result = runScript(workspace, modulePath);
  return { stdout: result.stdout.endsWith("\n") || result.stdout === "" ? result.stdout : `${result.stdout}\n`, stderr: result.stderr, exitCode: result.exitCode };
}

function typecheck(workspace: Workspace, cwd: string) {
  const diagnostics = diagnosticsFor(workspace, cwd).filter((diagnostic) => diagnostic.source === "ts" && diagnostic.severity === "error");
  if (diagnostics.length === 0) {
    return { stdout: "", stderr: "", exitCode: 0 };
  }
  return { stdout: "", stderr: `${formatDiagnostics(diagnostics, cwd)}\n`, exitCode: 1 };
}

export function formatShellResult(result: ShellResult): string {
  const parts: string[] = [];
  if (result.stdout) parts.push(result.stdout);
  if (result.stderr) parts.push(result.stderr);
  return parts.join("\n");
}

export function discoverTestFiles(workspace: Workspace, root: string): string[] {
  return workspace.glob("**/*.test.ts").filter((path) => path.startsWith(root));
}

export function firstLine(text: string): string {
  const line = text.split("\n").find((row) => row.trim().length > 0);
  return line?.trim() ?? "";
}

export type { Line };
