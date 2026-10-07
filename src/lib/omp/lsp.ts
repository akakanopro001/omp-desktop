import type { Diagnostic } from "./protocol";
import type { Workspace } from "./vfs";
import { declaredNames, resolveModule, collectImports } from "./evaluator";

/**
 * Code intelligence.
 *
 * The packaged app talks to real language servers through the `lsp` tool
 * (workspace/willRenameFiles included). The bundled runtime keeps the visible
 * contract: diagnostics, document symbols and workspace renames are computed
 * against the same files the agent edits, so the LSP pane reacts to every write.
 */

const LINT_IGNORED = [/\/index\.ts$/, /\/cli\.ts$/, /\/scripts\//];

export function diagnosticsFor(workspace: Workspace, root: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const files = workspace.paths(root).filter((path) => /\.(ts|tsx|js|jsx)$/.test(path));

  for (const path of files) {
    const source = workspace.read(path);
    if (source === undefined) continue;

    // ts(2307) / ts(2305) — module resolution against the live workspace
    for (const imported of collectImports(source)) {
      const resolved = resolveModule(path, imported.specifier, workspace);
      if (imported.specifier.startsWith(".") && !resolved) {
        const line = lineOf(source, imported.specifier);
        diagnostics.push({
          path,
          line,
          column: 1,
          severity: "error",
          message: `Cannot find module '${imported.specifier}' or its corresponding type declarations.`,
          source: "ts",
          code: "2307",
        });
        continue;
      }
      if (!resolved) continue;
      const target = workspace.read(resolved) ?? "";
      for (const name of imported.names) {
        if (!declaredNames(target).includes(name)) {
          diagnostics.push({
            path,
            line: lineOf(source, name),
            column: 1,
            severity: "error",
            message: `Module '"${imported.specifier}"' has no exported member '${name}'.`,
            source: "ts",
            code: "2305",
          });
        }
      }
    }

    // ts(6133) — declared but never read
    const declarationPattern = /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/g;
    let declaration = declarationPattern.exec(source);
    while (declaration) {
      const name = declaration[1];
      const uses = countWord(source, name);
      if (uses <= 1) {
        diagnostics.push({
          path,
          line: lineOf(source, name),
          column: 1,
          severity: "warning",
          message: `'${name}' is declared but its value is never read.`,
          source: "ts",
          code: "6133",
        });
      }
      declaration = declarationPattern.exec(source);
    }

    // ts(6133) — imported but never used
    for (const imported of collectImports(source)) {
      for (const name of imported.names) {
        if (countWord(source, name) <= 1) {
          diagnostics.push({
            path,
            line: lineOf(source, name),
            column: 1,
            severity: "warning",
            message: `'${name}' is declared but its value is never read.`,
            source: "ts",
            code: "6133",
          });
        }
      }
    }

    // biome — unexpected console statement
    if (!LINT_IGNORED.some((pattern) => pattern.test(path))) {
      const rows = source.split("\n");
      rows.forEach((row, index) => {
        if (/console\.(log|debug|info)\(/.test(row)) {
          diagnostics.push({
            path,
            line: index + 1,
            column: 1,
            severity: "warning",
            message: "Unexpected console statement.",
            source: "biome",
            code: "lint/suspicious/noConsoleLog",
          });
        }
      });
    }
  }

  return diagnostics.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}

function lineOf(source: string, needle: string): number {
  const index = source.indexOf(needle);
  if (index === -1) return 1;
  return source.slice(0, index).split("\n").length;
}

function countWord(source: string, word: string): number {
  const pattern = new RegExp(`(^|[^\\w$])${word.replace(/[$]/g, "\\$")}(?![\\w$])`, "g");
  return (source.match(pattern) ?? []).length;
}

export interface DocumentSymbol {
  name: string;
  kind: "function" | "const" | "type" | "class";
  line: number;
  exported: boolean;
}

export function symbolsFor(workspace: Workspace, path: string): DocumentSymbol[] {
  const source = workspace.read(path);
  if (source === undefined) return [];
  const symbols: DocumentSymbol[] = [];
  const pattern = /(?:^|\n)\s*(export\s+)?(?:async\s+)?(function|const|let|class|interface|type)\s+([A-Za-z_$][\w$]*)/g;
  let match = pattern.exec(source);
  while (match) {
    const kindWord = match[2];
    symbols.push({
      name: match[3],
      kind: kindWord === "function" ? "function" : kindWord === "const" || kindWord === "let" ? "const" : kindWord === "class" ? "class" : "type",
      line: source.slice(0, match.index).split("\n").length,
      exported: Boolean(match[1]),
    });
    match = pattern.exec(source);
  }
  return symbols;
}

export interface RenameResult {
  files: { path: string; before: string; after: string }[];
  occurrences: number;
}

/** Workspace-wide rename through the same path a language server takes. */
export function renameSymbol(workspace: Workspace, symbol: string, next: string, root?: string): RenameResult {
  const files: RenameResult["files"] = [];
  let occurrences = 0;
  for (const path of workspace.paths(root)) {
    const before = workspace.read(path);
    if (before === undefined) continue;
    const pattern = new RegExp(`(^|[^\\w$])${symbol.replace(/[$]/g, "\\$")}(?![\\w$])`, "g");
    const matches = before.match(pattern)?.length ?? 0;
    if (matches === 0) continue;
    occurrences += matches;
    files.push({ path, before, after: before.replace(pattern, `$1${next}`) });
  }
  return { files, occurrences };
}

export function formatDiagnostics(diagnostics: Diagnostic[], root: string): string {
  if (diagnostics.length === 0) return "no diagnostics";
  return diagnostics
    .map((diagnostic) => {
      const rel = diagnostic.path.startsWith(`${root}/`) ? diagnostic.path.slice(root.length + 1) : diagnostic.path;
      const tag = diagnostic.severity === "error" ? "error" : "warning";
      return `${rel}:${diagnostic.line}:${diagnostic.column} - ${tag} ${diagnostic.code ?? ""} ${diagnostic.message} [${diagnostic.source}]`;
    })
    .join("\n");
}
