import type { Workspace } from "./vfs";

/**
 * Bundled runtime: a JavaScript-subset evaluator for the workspace.
 *
 * The packaged shell runs real `bun`/`node` against the project folder. The
 * browser runtime keeps the same contract — `bun test` and `bun run <script>`
 * execute the Linux-side sources for real — by stripping the TypeScript surface
 * (annotations, interfaces, import/export plumbing) and evaluating the module
 * graph in one scope. Async APIs are not supported here by design; the shell
 * reports that instead of pretending.
 */

export interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

const RUNTIME_BANNER = "bun test v1.3.14 (0d9b296a)";

interface Statement {
  declared: string[];
}

export function stripTypes(source: string): string {
  let out = "";
  let index = 0;
  const length = source.length;
  let parenDepth = 0;
  let pendingDeclaration = false;

  const isIdent = (char: string | undefined) => Boolean(char && /[A-Za-z0-9_$]/.test(char));

  while (index < length) {
    const char = source[index];
    const next = source[index + 1];

    // comments
    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", index);
      out += source.slice(index, end === -1 ? length : end);
      index = end === -1 ? length : end;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      out += source.slice(index, end === -1 ? length : end + 2);
      index = end === -1 ? length : end + 2;
      continue;
    }

    // strings, templates and regex-free literals
    if (char === '"' || char === "'" || char === "`") {
      let cursor = index + 1;
      while (cursor < length) {
        if (source[cursor] === "\\") {
          cursor += 2;
          continue;
        }
        if (source[cursor] === char) break;
        cursor += 1;
      }
      out += source.slice(index, cursor + 1);
      index = cursor + 1;
      continue;
    }

    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth = Math.max(0, parenDepth - 1);

    // statement-level type declarations
    const atStatementStart = /(^|[\n;{}])\s*$/.test(out);
    if (atStatementStart) {
      const rest = source.slice(index);
      const typeAlias = rest.match(/^(?:export\s+)?type\s+[A-Za-z_$][\w$]*(?:<[^>]*>)?\s*=\s*/);
      if (typeAlias) {
        const end = findTypeEnd(source, index + typeAlias[0].length);
        out += "\n";
        index = end;
        continue;
      }
      const iface = rest.match(/^(?:export\s+)?interface\s+[A-Za-z_$][\w$]*/);
      if (iface) {
        const brace = source.indexOf("{", index);
        const end = brace === -1 ? source.length : findMatch(source, brace, "{", "}");
        out += "\n";
        index = end;
        continue;
      }
      const importDecl = rest.match(/^import\s+([^;]*?)\s+from\s+["'][^"']+["'];?/);
      if (importDecl) {
        index += importDecl[0].length;
        continue;
      }
      const bareImport = rest.match(/^import\s+["'][^"']+["'];?/);
      if (bareImport) {
        index += bareImport[0].length;
        continue;
      }
      const exportHead = rest.match(/^export\s+/);
      if (exportHead && !/^export\s+(default|type|interface)/.test(rest)) {
        index += exportHead[0].length;
        continue;
      }
      const declaration = rest.match(/^(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*:/);
      if (declaration) {
        // strip the annotation, keep the declaration
        const colon = index + declaration[0].lastIndexOf(":");
        out += source.slice(index, colon);
        index = skipType(source, colon + 1);
        continue;
      }
    }

    if (char === ":" && parenDepth > 0) {
      // parameter annotation or destructured default
      const previous = out.trimEnd().slice(-1);
      if (isIdent(previous) || previous === "]" || previous === ")") {
        index = skipType(source, index + 1);
        continue;
      }
    }

    if (char === ")" && parenDepth === 0) {
      const rest = source.slice(index + 1);
      const returnType = rest.match(/^\s*:\s*[^=;{]+?(?=[={;]|\n|$)/);
      if (returnType) {
        out += ")";
        index += 1 + returnType[0].length;
        continue;
      }
    }

    if (char === "a" && /^as\s+const\b/.test(source.slice(index)) && !isIdent(source[index - 1])) {
      index += "as const".length;
      continue;
    }
    if (char === "a" && /^as\s+[A-Za-z_$][\w$.<>\[\]| ]*(?=[,;)\n])/.test(source.slice(index)) && !isIdent(source[index - 1]) && pendingDeclaration === false) {
      const match = source.slice(index).match(/^as\s+[A-Za-z_$][\w$.<>\[\]| ]*/);
      if (match) {
        index += match[0].length;
        continue;
      }
    }

    pendingDeclaration = /(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*$/.test(out) || pendingDeclaration;
    if (char === "\n") pendingDeclaration = false;
    out += char;
    index += 1;
  }

  return out;
}

function findTypeEnd(source: string, from: number): number {
  let index = from;
  let depth = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === "{" || char === "(" || char === "<" || char === "[") depth += 1;
    if (char === "}" || char === ")" || char === ">" || char === "]") depth = Math.max(0, depth - 1);
    if (char === ";" && depth === 0) return index + 1;
    if (char === "\n" && depth === 0) return index + 1;
    index += 1;
  }
  return source.length;
}

function skipType(source: string, from: number): number {
  let index = from;
  let depth = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === "{" || char === "(" || char === "<" || char === "[") depth += 1;
    if (char === "}" || char === ")" || char === ">" || char === "]") {
      if (depth === 0) return index;
      depth -= 1;
    }
    if (char === "=" && depth === 0) return index;
    if (char === "," && depth === 0) return index;
    if (char === ";" && depth === 0) return index;
    if (char === "\n" && depth === 0) return index;
    index += 1;
  }
  return source.length;
}

function findMatch(source: string, from: number, open: string, close: string): number {
  let depth = 0;
  for (let index = from; index < source.length; index += 1) {
    if (source[index] === open) depth += 1;
    if (source[index] === close) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return source.length;
}

/** POSIX-style join that collapses `.` and `..` segments. */
export function joinPath(base: string, relative: string): string {
  const segments = `${base}/${relative}`.split("/");
  const stack: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return `/${stack.join("/")}`;
}

export function resolveModule(fromPath: string, specifier: string, workspace: Workspace): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = fromPath.slice(0, fromPath.lastIndexOf("/"));
  const joined = joinPath(base, specifier);
  const candidates = [joined, `${joined}.ts`, `${joined}.tsx`, `${joined}.js`, `${joined}/index.ts`, `${joined}/index.js`];
  return candidates.find((candidate) => workspace.read(candidate) !== undefined);
}

export function collectImports(source: string): { specifier: string; names: string[] }[] {
  const found: { specifier: string; names: string[] }[] = [];
  const pattern = /import\s+(?:type\s+)?(?:([\w$]+)\s*,\s*)?(?:\{([^}]*)\}|\*\s+as\s+([\w$]+)|([\w$]+))?\s*from\s*["']([^"']+)["']/g;
  let match = pattern.exec(source);
  while (match) {
    const names: string[] = [];
    if (match[1]) names.push(match[1]);
    if (match[2]) {
      match[2]
        .split(",")
        .map((entry) => entry.trim().split(/\s+as\s+/).pop()?.trim() ?? "")
        .filter(Boolean)
        .forEach((name) => names.push(name));
    }
    if (match[3]) names.push(match[3]);
    if (match[4]) names.push(match[4]);
    found.push({ specifier: match[5], names });
    match = pattern.exec(source);
  }
  return found;
}

export function declaredNames(source: string): string[] {
  const names = new Set<string>();
  const pattern = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g;
  let match = pattern.exec(source);
  while (match) {
    names.add(match[1]);
    match = pattern.exec(source);
  }
  return [...names];
}

function topoSort(entry: string, workspace: Workspace): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (path: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    const source = workspace.read(path);
    if (source === undefined) return;
    collectImports(source).forEach((entryImport) => {
      const resolved = resolveModule(path, entryImport.specifier, workspace);
      if (resolved) visit(resolved);
    });
    order.push(path);
  };
  visit(entry);
  return order;
}

function evaluate(entry: string, workspace: Workspace, options: { capture?: boolean } = {}) {
  const modules = topoSort(entry, workspace);
  const bodies: string[] = [];
  const declared: string[] = [];
  for (const path of modules) {
    const source = workspace.read(path);
    if (source === undefined) continue;
    const stripped = stripTypes(source);
    bodies.push(`\n/* ${path} */\n${stripped}`);
    declaredNames(stripped).forEach((name) => declared.push(name));
  }
  const exportReturn = `\nreturn { ${[...new Set(declared)].map((name) => `${name}: typeof ${name} === "undefined" ? undefined : ${name}`).join(", ")} };`;
  const prelude = `"use strict";`;
  const captured: string[] = [];
  const log = (...args: unknown[]) => {
    captured.push(args.map((value) => stringify(value)).join(" "));
  };
  const scope = { console: { log, error: log, warn: log, info: log }, Math, JSON, Date, Object, Array, String, Number, Boolean };
  const names = Object.keys(scope);
  const values = names.map((name) => (scope as Record<string, unknown>)[name]);
  try {
    const factory = new Function(...names, `${prelude}\n${bodies.join("\n")}${exportReturn}`);
    const exports = factory(...values) as Record<string, unknown>;
    return { ok: true as const, exports, captured };
  } catch (error) {
    void options;
    return { ok: false as const, error: error instanceof Error ? error : new Error(String(error)), captured };
  }
}

export function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || value === null) return String(value);
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

interface TestCase {
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
  expects: number;
}

export function runTest(workspace: Workspace, entries: string[]): RunResult {
  const files = entries.filter((path) => workspace.read(path) !== undefined);
  if (files.length === 0) {
    return { ok: false, stdout: RUNTIME_BANNER, stderr: "error: no test files found", exitCode: 1 };
  }

  const out: string[] = [RUNTIME_BANNER, ""];
  let passed = 0;
  let failed = 0;
  let expects = 0;
  const started = Date.now();

  for (const file of files) {
    const source = workspace.read(file);
    if (source === undefined) continue;
    const results: TestCase[] = [];
    let suite = "";
    const declares = source.replace(/\b(test|it)\s*\(/g, "__test(");
    const stripped = stripTypes(declares)
      .replace(/^import[\s\S]*?from\s*["'][^"']+["'];?\s*$/gm, "")
      .replace(/\bimport\s*["'][^"']+["'];?\s*$/gm, "");

    const expectFactory = (received: unknown) => {
      expects += 1;
      {
        const assertions = {
          toBe(expected: unknown) {
            if (!Object.is(received, expected)) {
              throw new Error(`Expected: ${stringify(expected)}\nReceived: ${stringify(received)}`);
            }
          },
          toEqual(expected: unknown) {
            if (JSON.stringify(received) !== JSON.stringify(expected)) {
              throw new Error(`Expected: ${stringify(expected)}\nReceived: ${stringify(received)}`);
            }
          },
          toBeTruthy() {
            if (!received) throw new Error(`Expected truthy, received ${stringify(received)}`);
          },
          toBeCloseTo(expected: number, precision = 2) {
            const actual = Number(received);
            if (Math.abs(actual - expected) > 0.5 * Math.pow(10, -precision)) {
              throw new Error(`Expected ${stringify(actual)} to be close to ${stringify(expected)}`);
            }
          },
          toContain(expected: unknown) {
            const ok = typeof received === "string" && received.includes(String(expected));
            if (!ok) throw new Error(`Expected ${stringify(received)} to contain ${stringify(expected)}`);
          },
        };
        return {
          ...assertions,
          not: {
            toBe(expected: unknown) {
              if (Object.is(received, expected)) throw new Error(`Expected not to be ${stringify(expected)}`);
            },
            toBeTruthy() {
              if (received) throw new Error(`Expected falsy, received ${stringify(received)}`);
            },
          },
        };
      }
    };

    const testFn = (name: string, body: () => void) => {
      const start = Date.now();
      try {
        body();
        results.push({ name: `${suite}${name}`, passed: true, durationMs: Date.now() - start, expects: 0 });
      } catch (error) {
        results.push({
          name: `${suite}${name}`,
          passed: false,
          durationMs: Date.now() - start,
          expects: 0,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    const describeFn = (name: string, body: () => void) => {
      const previous = suite;
      suite = `${name} > `;
      try {
        body();
      } catch (error) {
        void error;
      }
      suite = previous;
    };

    try {
      const factory = new Function(
        "__test",
        "test",
        "it",
        "describe",
        "expect",
        "console",
        "Math",
        "JSON",
        "Date",
        "Object",
        "Array",
        "String",
        "Number",
        "Boolean",
        `${bodiesFor(workspace, file)}\n${stripped}`,
      );
      factory(
        testFn,
        testFn,
        testFn,
        describeFn,
        expectFactory,
        { log: () => undefined, error: () => undefined, warn: () => undefined, info: () => undefined },
        Math,
        JSON,
        Date,
        Object,
        Array,
        String,
        Number,
        Boolean,
      );
    } catch (error) {
      out.push(`${file}:`);
      out.push(`✗ failed to load module`);
      out.push(`  error: ${error instanceof Error ? error.message : String(error)}`);
      out.push("");
      failed += 1;
      continue;
    }

    out.push(`${file}:`);
    results.forEach((entry) => {
      if (entry.passed) {
        out.push(`✓ ${entry.name} [${entry.durationMs.toFixed(2)}ms]`);
        passed += 1;
      } else {
        out.push(`✗ ${entry.name}`);
        out.push(
          ...(entry.error ?? "")
            .split("\n")
            .map((line, index) => (index === 0 ? `  error: ${line}` : `  ${line}`)),
        );
        failed += 1;
      }
    });
    out.push("");
  }

  out.push(` ${passed} pass`);
  if (failed > 0) out.push(` ${failed} fail`);
  out.push(` ${expects} expect() calls`);
  out.push(`Ran ${passed + failed} tests across ${files.length} files. [${Date.now() - started}ms]`);

  return { ok: failed === 0, stdout: out.join("\n"), stderr: "", exitCode: failed === 0 ? 0 : 1 };
}

/** Dependency sources for a test file — the imported modules, exported names in scope. */
function bodiesFor(workspace: Workspace, entry: string): string {
  const modules = topoSort(entry, workspace).filter((path) => path !== entry);
  return modules
    .map((path) => {
      const source = workspace.read(path);
      if (source === undefined) return "";
      return `\n/* ${path} */\n${stripTypes(source)}`;
    })
    .join("\n");
}

/** Call one exported function from a workspace module — the runtime's `eval` hook. */
export function callExport(
  workspace: Workspace,
  path: string,
  name: string,
  args: unknown[],
): { ok: true; value: unknown } | { ok: false; error: string } {
  const result = evaluate(path, workspace);
  if (!result.ok) return { ok: false, error: result.error.message };
  const fn = (result.exports as Record<string, unknown>)[name];
  if (typeof fn !== "function") return { ok: false, error: `no exported function '${name}' in ${path}` };
  try {
    return { ok: true, value: (fn as (...callArgs: unknown[]) => unknown)(...args) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function runScript(workspace: Workspace, entry: string): RunResult {
  if (workspace.read(entry) === undefined) {
    return { ok: false, stdout: "", stderr: `error: Module not found: "${entry}"`, exitCode: 1 };
  }
  const result = evaluate(entry, workspace, { capture: true });
  if (!result.ok) {
    return { ok: false, stdout: result.captured.join("\n"), stderr: `error: ${result.error.message}`, exitCode: 1 };
  }
  return { ok: true, stdout: result.captured.join("\n"), stderr: "", exitCode: 0 };
}
