import type { DiffHunk, DiffLine, FileDiff, HashAnchor } from "./protocol";

/**
 * Hashline: edit by content hash.
 *
 * The model points at anchors instead of retyping the lines it wants to change,
 * so whitespace battles and string-not-found loops stop happening. Anchors are
 * verified before a patch is applied — a stale anchor is rejected before it can
 * corrupt a file, and the caller gets a recovery snippet instead.
 */

export function lineHash(text: string): string {
  let hash = 0x811c9dc5;
  const normalized = text.trim();
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0").slice(0, 6);
}

export const ANCHOR_PREFIX = "\u2502";

export function anchorsFor(content: string): HashAnchor[] {
  return content.split("\n").map((text, index) => ({
    line: index + 1,
    hash: lineHash(text),
    text,
  }));
}

/** `12:4f3a1c│const a = 1` — the shape `read` returns for anchored files. */
export function formatAnchored(content: string, startLine = 1): string {
  const anchors = anchorsFor(content);
  return anchors
    .slice(startLine - 1)
    .map((anchor) => `${anchor.line}:${anchor.hash}${ANCHOR_PREFIX}${anchor.text}`)
    .join("\n");
}

export function anchorAt(content: string, line: number): HashAnchor | undefined {
  const anchors = anchorsFor(content);
  if (line < 1 || line > anchors.length) return undefined;
  return anchors[line - 1];
}

export interface PatchHunk {
  path?: string;
  anchor?: HashAnchor;
  search: string;
  replace: string;
}

export interface PatchResult {
  path?: string;
  stale?: string;
  hunks: PatchHunk[];
  next: string;
}

const SEARCH = /^<{5,9}\s*SEARCH(?:\s+(\d+):([0-9a-f]{4,8}))?\s*$/;
const REPLACE = /^={5,9}\s*$/;
const END = /^>{5,9}\s*(?:REPLACE)?\s*$/;

/** Parse the hashline patch format omp asks models to emit. */
export function parsePatch(patch: string): PatchResult {
  const rows = patch.split("\n");
  const hunks: PatchHunk[] = [];
  let path: string | undefined;
  let index = 0;

  while (index < rows.length) {
    const row = rows[index];
    if (!row) break;
    if (!SEARCH.test(row)) {
      if (!path && row.trim() && !row.startsWith("<")) path = row.trim();
      index += 1;
      continue;
    }
    const match = row.match(SEARCH);
    const anchorLine = match?.[1] ? Number(match[1]) : undefined;
    const anchorHash = match?.[2];
    index += 1;
    const search: string[] = [];
    while (index < rows.length && !REPLACE.test(rows[index])) {
      search.push(rows[index]);
      index += 1;
    }
    const replace: string[] = [];
    if (index < rows.length && REPLACE.test(rows[index])) {
      index += 1;
      while (index < rows.length && !END.test(rows[index])) {
        replace.push(rows[index]);
        index += 1;
      }
    }
    index += 1;
    hunks.push({
      path,
      anchor:
        anchorLine && anchorHash
          ? { line: anchorLine, hash: anchorHash, text: search[0] ?? "" }
          : undefined,
      search: search.join("\n"),
      replace: replace.join("\n"),
    });
  }

  return { path, hunks, next: "" };
}

export interface ApplyResult {
  ok: boolean;
  content: string;
  stale?: string;
  applied: number;
}

/**
 * Apply a hashline patch. Anchors are checked first: if the anchor hash no
 * longer matches the file on disk the patch is rejected outright, and the
 * rejection carries the current anchored region so the model can recover.
 */
export function applyPatch(before: string, patch: string): ApplyResult {
  const parsed = parsePatch(patch);
  let content = before;
  let applied = 0;

  for (const hunk of parsed.hunks) {
    if (hunk.anchor) {
      const current = anchorAt(content, hunk.anchor.line);
      if (!current || current.hash !== hunk.anchor.hash) {
        const rows = content.split("\n");
        const from = Math.max(0, hunk.anchor.line - 2);
        const region = rows
          .slice(from, hunk.anchor.line + 1)
          .map((text, offset) => `${from + offset + 1}:${lineHash(text)}${ANCHOR_PREFIX}${text}`)
          .join("\n");
        return {
          ok: false,
          content: before,
          applied,
          stale: [
            `stale anchor at line ${hunk.anchor.line}: expected ${hunk.anchor.hash}, found ${current?.hash ?? "eof"}`,
            "recovery region:",
            region,
          ].join("\n"),
        };
      }
    }
    const at = hunk.search ? content.indexOf(hunk.search) : -1;
    if (!hunk.search) continue;
    if (at === -1) {
      return {
        ok: false,
        content: before,
        applied,
        stale: `anchor matched but search text drifted; refusing to patch ${parsed.path ?? "file"}`,
      };
    }
    content = content.slice(0, at) + hunk.replace + content.slice(at + hunk.search.length);
    applied += 1;
  }

  return { ok: applied > 0, content, applied };
}

/** Build a hashline patch from an explicit line replacement pair. */
export function buildPatch(path: string, before: string, searchLine: number, searchText: string, replaceText: string): string {
  const anchor = anchorAt(before, searchLine);
  const header = anchor ? `<<<<<<< SEARCH ${anchor.line}:${anchor.hash}` : "<<<<<<< SEARCH";
  return [`${path}`, header, searchText, "=======", replaceText, ">>>>>>> REPLACE"].join("\n");
}

function contextLines(rows: DiffLine[], radius = 3): DiffLine[] {
  const keep = new Set<number>();
  rows.forEach((row, index) => {
    if (row.type === "ctx") return;
    for (let cursor = index - radius; cursor <= index + radius; cursor += 1) {
      if (cursor >= 0 && cursor < rows.length) keep.add(cursor);
    }
  });
  return rows.filter((_, index) => keep.has(index));
}

function toHunks(rows: DiffLine[]): DiffHunk[] {
  const kept = contextLines(rows);
  const hunks: DiffHunk[] = [];
  let current: DiffLine[] = [];
  let lastOld = 0;

  const flush = () => {
    if (current.length === 0) return;
    const added = current.filter((row) => row.type === "add").length;
    const removed = current.filter((row) => row.type === "del").length;
    const first = current[0];
    hunks.push({
      header: `@@ -${first.oldNo ?? first.newNo ?? 1},${removed + 1} +${first.newNo ?? first.oldNo ?? 1},${added + 1} @@`,
      lines: current,
    });
    current = [];
  };

  kept.forEach((row) => {
    const oldNo = row.oldNo ?? lastOld;
    if (current.length > 0 && oldNo - lastOld > 1) flush();
    current.push(row);
    lastOld = oldNo;
  });
  flush();
  return hunks;
}

/** Line diff (LCS) producing the hunks the Diff pane renders. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const rows: DiffLine[] = [];

  if (a.length * b.length > 400_000) {
    a.forEach((text, index) => rows.push({ type: "del", text, oldNo: index + 1 }));
    b.forEach((text, index) => rows.push({ type: "add", text, newNo: index + 1 }));
    return rows;
  }

  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push({ type: "ctx", text: a[i], oldNo: i + 1, newNo: j + 1 });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      rows.push({ type: "del", text: a[i], oldNo: i + 1 });
      i += 1;
    } else {
      rows.push({ type: "add", text: b[j], newNo: j + 1 });
      j += 1;
    }
  }
  while (i < a.length) {
    rows.push({ type: "del", text: a[i], oldNo: i + 1 });
    i += 1;
  }
  while (j < b.length) {
    rows.push({ type: "add", text: b[j], newNo: j + 1 });
    j += 1;
  }
  return rows;
}

export function buildFileDiff(path: string, before: string, after: string): FileDiff {
  const rows = diffLines(before, after);
  return {
    path,
    before,
    after,
    hunks: toHunks(rows),
    added: rows.filter((row) => row.type === "add").length,
    removed: rows.filter((row) => row.type === "del").length,
    anchors: anchorsFor(after),
  };
}

export function unifiedDiffText(diff: FileDiff): string {
  const head = [`--- a/${diff.path}`, `+++ b/${diff.path}`];
  const body = diff.hunks.flatMap((hunk) => [
    hunk.header,
    ...hunk.lines.map((line) => `${line.type === "add" ? "+" : line.type === "del" ? "-" : " "}${line.text}`),
  ]);
  return [...head, ...body].join("\n");
}
