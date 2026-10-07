import type { GitCommit, GitStatusEntry, WorkspaceFile } from "./protocol";
import { lineHash } from "./hashline";

/**
 * The workspace VFS.
 *
 * In the packaged app a project folder is a real directory owned by the shell;
 * in the browser runtime the same shape is served from this in-memory VFS so the
 * renderer, the agent loop, the diff pane and the file browser all operate on
 * one source of truth. Files carry a line-hash index so hashline anchors and
 * stale-anchor rejection work identically in both runtimes.
 */

export interface FolderState {
  path: string;
  branch: string;
  kind: "primary" | "repo" | "worktree";
  head: GitCommit[];
  index: Map<string, string>;
}

export class Workspace {
  private files = new Map<string, WorkspaceFile>();
  private folders = new Map<string, FolderState>();

  constructor(seed?: { files: { path: string; content: string }[]; folders?: FolderState[] }) {
    if (seed) {
      seed.files.forEach((file) => this.plant(file.path, file.content));
      seed.folders?.forEach((folder) => this.folders.set(folder.path, folder));
    }
  }

  /** Seed a file without marking it dirty (used for the initial checkout). */
  plant(path: string, content: string) {
    this.files.set(normalize(path), { path: normalize(path), content, updatedAt: Date.now(), dirty: false });
  }

  registerFolder(folder: FolderState) {
    this.folders.set(folder.path, folder);
    folder.index = new Map(folder.index);
  }

  folders_(): FolderState[] {
    return [...this.folders.values()];
  }

  folder(path: string): FolderState | undefined {
    const target = normalize(path);
    return [...this.folders.values()].find((folder) => target === folder.path || target.startsWith(`${folder.path}/`));
  }

  paths(prefix?: string): string[] {
    const target = prefix ? normalize(prefix).replace(/\/$/, "") : undefined;
    return [...this.files.keys()]
      .filter((path) => (target ? path === target || path.startsWith(`${target}/`) : true))
      .sort();
  }

  read(path: string): string | undefined {
    return this.files.get(normalize(path))?.content;
  }

  exists(path: string): boolean {
    const target = normalize(path);
    return this.files.has(target) || [...this.files.keys()].some((path_) => path_.startsWith(`${target}/`));
  }

  write(path: string, content: string) {
    const target = normalize(path);
    const previous = this.files.get(target);
    this.files.set(target, {
      path: target,
      content,
      updatedAt: Date.now(),
      dirty: previous?.dirty ?? true,
    });
  }

  writeDirty(path: string, content: string) {
    const target = normalize(path);
    this.files.set(target, { path: target, content, updatedAt: Date.now(), dirty: true });
  }

  remove(path: string) {
    this.files.delete(normalize(path));
  }

  file(path: string): WorkspaceFile | undefined {
    return this.files.get(normalize(path));
  }

  snapshot(): WorkspaceFile[] {
    return [...this.files.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Annotated read output: `12:4f3a1c│line text`. */
  anchored(path: string, from = 1, to?: number): string {
    const content = this.read(path);
    if (content === undefined) return `error: no such file: ${path}`;
    const rows = content.split("\n");
    const end = Math.min(rows.length, to ?? rows.length);
    return rows
      .slice(from - 1, end)
      .map((text, offset) => `${from + offset}:${lineHash(text)}\u2502${text}`)
      .join("\n");
  }

  grep(pattern: string, options?: { glob?: string; ignoreCase?: boolean; limit?: number }) {
    const flags = options?.ignoreCase ? "gi" : "g";
    let matcher: RegExp;
    try {
      matcher = new RegExp(pattern, flags);
    } catch {
      matcher = new RegExp(escapeRegex(pattern), flags);
    }
    const limit = options?.limit ?? 80;
    const hits: { path: string; line: number; text: string }[] = [];
    for (const file of this.snapshot()) {
      if (options?.glob && !globMatch(file.path, options.glob)) continue;
      file.content.split("\n").forEach((text, index) => {
        if (hits.length >= limit) return;
        matcher.lastIndex = 0;
        if (matcher.test(text)) hits.push({ path: file.path, line: index + 1, text });
      });
      if (hits.length >= limit) break;
    }
    return hits;
  }

  glob(pattern: string): string[] {
    return this.paths().filter((path) => globMatch(path, pattern));
  }

  /** Working-tree status derived from the diff against the checkout index. */
  status(folderPath?: string): GitStatusEntry[] {
    const entries: GitStatusEntry[] = [];
    const folder = folderPath ? this.folder(folderPath) : undefined;
    const inside = (path: string) => (folder ? path === folder.path || path.startsWith(`${folder.path}/`) : true);
    for (const file of this.snapshot()) {
      if (!inside(file.path)) continue;
      const recorded = this.indexGet(file.path);
      if (recorded === undefined) {
        entries.push({ path: file.path, status: "untracked" });
      } else if (recorded !== file.content) {
        entries.push({ path: file.path, status: "modified" });
      }
    }
    if (folder) {
      for (const [path, content] of folder.index) {
        if (!this.files.has(path)) entries.push({ path, status: "deleted" });
        void content;
      }
    }
    return entries;
  }

  private indexGet(path: string) {
    for (const folder of this.folders.values()) {
      if (folder.index.has(path)) return folder.index.get(path);
    }
    return undefined;
  }

  commit(subject: string, author = "omp agent <agent@omp.sh>", folderPath?: string): GitCommit {
    const folder = folderPath ? this.folder(folderPath) : this.folders_()[0];
    const status = this.status(folder?.path);
    status.forEach((entry) => {
      const content = this.files.get(entry.path);
      if (folder && content) folder.index.set(entry.path, content.content);
    });
    const commit: GitCommit = { hash: randomHash(), subject, author, at: Date.now() };
    folder?.head.unshift(commit);
    return commit;
  }

  fileSize(path: string): number {
    return this.read(path)?.length ?? 0;
  }

  reset(seed: { files: { path: string; content: string }[] }) {
    this.files.clear();
    seed.files.forEach((file) => this.plant(file.path, file.content));
  }
}

export function normalize(path: string): string {
  const cleaned = path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  return cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
}

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function globMatch(path: string, pattern: string): boolean {
  const regex = new RegExp(`^${pattern.split("/").map(globSegment).join("/")}$`);
  return regex.test(path.replace(/^\//, "")) || regex.test(path);
}

function globSegment(segment: string): string {
  if (segment === "**") return ".*";
  return segment
    .replace(/[.+^${}()|[\]\\?]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/\\\?/g, "[^/]");
}

function randomHash(): string {
  return Math.random().toString(16).slice(2, 9);
}

export function relativePath(path: string, root: string): string {
  const target = normalize(path);
  const base = normalize(root).replace(/\/$/, "");
  return target.startsWith(`${base}/`) ? target.slice(base.length + 1) : target.replace(/^\//, "");
}

export function joinPath(root: string, relative: string): string {
  if (relative.startsWith("/")) return normalize(relative);
  return normalize(`${root.replace(/\/$/, "")}/${relative}`);
}

/** Directory tree for the file browser. */
export interface TreeDir {
  name: string;
  path: string;
  dirs: TreeDir[];
  files: { name: string; path: string; size: number; dirty: boolean }[];
}

export function buildTree(workspace: Workspace, root: string): TreeDir {
  const base = normalize(root).replace(/\/$/, "");
  const tree: TreeDir = { name: base.split("/").filter(Boolean).pop() ?? base, path: base, dirs: [], files: [] };
  const dirs = new Map<string, TreeDir>([[base, tree]]);

  const ensure = (path: string): TreeDir => {
    const existing = dirs.get(path);
    if (existing) return existing;
    const parent = ensure(path.slice(0, path.lastIndexOf("/")) || base);
    const dir: TreeDir = { name: path.split("/").filter(Boolean).pop() ?? path, path, dirs: [], files: [] };
    parent.dirs.push(dir);
    parent.dirs.sort((a, b) => a.name.localeCompare(b.name));
    dirs.set(path, dir);
    return dir;
  };

  for (const path of workspace.paths(base)) {
    if (path === base) continue;
    const parent = path.slice(0, path.lastIndexOf("/"));
    const dir = parent === base ? tree : ensure(parent);
    const file = workspace.file(path);
    dir.files.push({ name: path.split("/").pop() ?? path, path, size: file?.content.length ?? 0, dirty: Boolean(file?.dirty) });
  }
  tree.files.sort((a, b) => a.name.localeCompare(b.name));
  return tree;
}

function seedFile(path: string, content: string) {
  return { path, content: content.replace(/^\n/, "") };
}

const PI_LAB_ROOT = "/work/pi-lab";
const PI_WEB_ROOT = "/work/pi-web";

/**
 * The bundled workspace. Files are real: the bundled runtime evaluates them, so
 * `bun test` in the terminal pane fails for a real reason and passes for a real
 * reason after the agent's anchored edit.
 */
export const DEMO_SEED: { files: { path: string; content: string }[]; folders: FolderState[] } = {
  files: [
    seedFile(
      `${PI_LAB_ROOT}/README.md`,
      `# pi-lab

Small playground we use to compare π estimators, plus the CLI our docs render.

## Commands

\`\`\`sh
bun test          # estimator + formatting suites
bun run accuracy  # compare estimators across term counts
\`\`\`

## Estimators

| estimator | formula                        | terms for 1e-5 | notes              |
| --------- | ------------------------------ | -------------- | ------------------ |
| leibniz   | 4·Σ (-1)^n / (2n+1)            | ~1e6           | alternating series |
| machin    | 16·atan(1/5) − 4·atan(1/239)   | ~12            | converges fast     |

Accuracy last reviewed by hand in \`docs/ACCURACY.md\`.
`,
    ),
    seedFile(
      `${PI_LAB_ROOT}/AGENTS.md`,
      `# pi-lab agent notes

## Rules

- Never edit a test expectation to make a suite pass. Fix the estimator.
- Route every printed value through \`src/format.ts\` so the docs stay in sync.
- Keep the public surface of \`src/index.ts\` stable: \`estimatePi\` and \`report\`.
- Prefer anchored hashline edits; this repo is edited by several people.

## Layout

- \`src/leibniz.ts\` — alternating series estimator
- \`src/machin.ts\` — Machin-like estimator (fast path)
- \`src/format.ts\` — number formatting used by the CLI and docs
- \`src/index.ts\` — CLI surface
- \`scripts/accuracy.ts\` — comparison table
`,
    ),
    seedFile(
      `${PI_LAB_ROOT}/package.json`,
      `{
  "name": "pi-lab",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "bun test",
    "accuracy": "bun run scripts/accuracy.ts",
    "typecheck": "tsc --noEmit"
  }
}
`,
    ),
    seedFile(
      `${PI_LAB_ROOT}/tsconfig.json`,
      `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true
  },
  "include": ["src", "test", "scripts"]
}
`,
    ),
    seedFile(
      `${PI_LAB_ROOT}/src/leibniz.ts`,
      `/**
 * π via the Leibniz alternating series:
 *   π = 4 · Σ (-1)^n / (2n + 1)
 *
 * Convergence is slow — the truncation error after N terms is about 1/N once the
 * partial sum is scaled by 4, so 1e6 terms buy ~1e-6. Keep the estimator honest;
 * the suite pins it.
 */
export function leibnizPi(terms: number): number {
  let sum = 0;
  const scale = 4;
  for (let i = 0; i < terms; i += 1) {
    sum += 1 / (2 * i + 1);
  }
  console.log("leibnizPi debug", sum, scale);
  return sum * 4;
}
`,
    ),
    seedFile(
      `${PI_LAB_ROOT}/src/machin.ts`,
      `/**
 * Machin-like formula with a fast-converging arctangent series:
 *   π = 16·atan(1/5) − 4·atan(1/239)
 */
export function machinPi(terms: number): number {
  return 16 * atanSeries(1 / 5, terms) - 4 * atanSeries(1 / 239, terms);
}

function atanSeries(x: number, terms: number): number {
  let sum = 0;
  let power = x;
  for (let term = 0; term < terms; term += 1) {
    const sign = term % 2 === 0 ? 1 : -1;
    sum += (sign * power) / (2 * term + 1);
    power *= x * x;
  }
  return sum;
}
`,
    ),
    seedFile(
      `${PI_LAB_ROOT}/src/format.ts`,
      `import { machinPi } from "./machin";

/** Fixed-point rendering used by the CLI, the README table and the docs. */
export function formatPi(value: number, digits = 6): string {
  return value.toFixed(digits);
}

/** Distance from the reference value, in scientific notation. */
export function formatDelta(value: number, reference: number): string {
  const delta = Math.abs(value - reference);
  return delta.toExponential(2);
}
`,
    ),
    seedFile(
      `${PI_LAB_ROOT}/src/index.ts`,
      `import { leibnizPi } from "./leibniz";
import { machinPi } from "./machin";
import { formatDelta, formatPi } from "./format";

export type Estimator = "leibniz" | "machin";

export function estimatePi(estimator: Estimator, terms: number): number {
  if (estimator === "machin") return machinPi(terms);
  return leibnizPi(terms);
}

export function report(estimator: Estimator, terms: number): string {
  const value = estimatePi(estimator, terms);
  return \`\${estimator}(\${terms}) = \${formatPi(value)} (Δ \${formatDelta(value, Math.PI)})\`;
}
`,
    ),
    seedFile(
      `${PI_LAB_ROOT}/test/pi.test.ts`,
      `import { leibnizPi } from "../src/leibniz";
import { machinPi } from "../src/machin";
import { formatDelta, formatPi } from "../src/format";

test("leibnizPi converges within 1e-5 over 1e6 terms", () => {
  expect(Math.abs(leibnizPi(1_000_000) - Math.PI) < 1e-5).toBe(true);
});

test("machinPi matches Math.PI within 1e-12", () => {
  expect(Math.abs(machinPi(12) - Math.PI) < 1e-12).toBe(true);
});

test("formatPi renders six decimals", () => {
  expect(formatPi(Math.PI)).toBe("3.141593");
});

test("formatDelta reports scientific notation", () => {
  expect(formatDelta(0, 1e-9)).toBe("1.00e-9");
});
`,
    ),
    seedFile(
      `${PI_LAB_ROOT}/test/cli.test.ts`,
      `import { estimatePi, report } from "../src/index";

test("estimatePi routes both estimators", () => {
  const fast = Math.abs(estimatePi("machin", 12) - Math.PI);
  expect(fast < 1e-12).toBe(true);
});

test("report includes the estimator, terms and delta", () => {
  const line = report("machin", 12);
  expect(line.startsWith("machin(12) = 3.141593")).toBe(true);
});
`,
    ),
    seedFile(
      `${PI_LAB_ROOT}/scripts/accuracy.ts`,
      `import { formatDelta } from "../src/format";
import { leibnizPi } from "../src/leibniz";
import { machinPi } from "../src/machin";

const termCounts = [10, 100, 1_000, 100_000, 1_000_000];

console.log("terms      leibniz         machin");
for (const terms of termCounts) {
  const rows = [
    String(terms).padEnd(10),
    formatDelta(leibnizPi(terms), Math.PI).padEnd(15),
    formatDelta(machinPi(terms), Math.PI),
  ];
  console.log(rows.join(""));
}
`,
    ),
    seedFile(
      `${PI_LAB_ROOT}/docs/ACCURACY.md`,
      `# Accuracy notes

| estimator | terms | error        |
| --------- | ----- | ------------ |
| leibniz   | 1e6   | ~1.0e-06     |
| machin    | 12    | ~1e-15       |

The visible leibniz error is 1/N once the partial sum is scaled by 4: the raw
alternating series carries about 1/(4N) after N terms. The suite pins the 1e-5
window at 1e6 terms, which leaves a 10x margin. Leibniz is retained because the
alternating series is the one our onboarding docs walk through; it is never used
for the fast path.
`,
    ),
    seedFile(
      `${PI_WEB_ROOT}/README.md`,
      `# pi-web

Thin viewer that renders the pi-lab accuracy table in the browser.
`,
    ),
    seedFile(
      `${PI_WEB_ROOT}/package.json`,
      `{
  "name": "pi-web",
  "private": true,
  "type": "module"
}
`,
    ),
    seedFile(
      `${PI_WEB_ROOT}/src/server.ts`,
      `import { renderPage } from "./routes";

export function serve(port: number): string {
  return \`listening on \${port}\\n\${renderPage()}\`;
}
`,
    ),
    seedFile(
      `${PI_WEB_ROOT}/src/routes.ts`,
      `export function renderPage(): string {
  return "<h1>pi-lab accuracy</h1>";
}
`,
    ),
    seedFile(
      `${PI_WEB_ROOT}/src/view.ts`,
      `export function table(headers: string[]): string {
  return \`<tr>\${headers.map((cell) => \`<th>\${cell}</th>\`).join("")}</tr>\`;
}
`,
    ),
  ],
  folders: [
    {
      path: PI_LAB_ROOT,
      branch: "main",
      kind: "primary",
      head: [
        { hash: "a41c9de", subject: "docs: record estimator accuracy", author: "ada <ada@pi-lab.dev>", at: Date.now() - 1000 * 60 * 60 * 26 },
        { hash: "71bb2f0", subject: "feat: add machin fast path", author: "ada <ada@pi-lab.dev>", at: Date.now() - 1000 * 60 * 60 * 51 },
        { hash: "0d3c118", subject: "chore: scaffold pi-lab", author: "ada <ada@pi-lab.dev>", at: Date.now() - 1000 * 60 * 60 * 74 },
      ],
      index: new Map(),
    },
    {
      path: PI_WEB_ROOT,
      branch: "feature/accuracy-view",
      kind: "repo",
      head: [
        { hash: "9f0aa31", subject: "feat: render accuracy table", author: "lin <lin@pi-web.dev>", at: Date.now() - 1000 * 60 * 60 * 12 },
      ],
      index: new Map(),
    },
  ],
};

export function createDemoWorkspace(): Workspace {
  const workspace = new Workspace();
  DEMO_SEED.files.forEach((file) => workspace.plant(file.path, file.content));
  DEMO_SEED.folders.forEach((folder) => {
    const snapshot = new Map<string, string>();
    workspace
      .paths(folder.path)
      .forEach((path) => snapshot.set(path, workspace.read(path) ?? ""));
    workspace.registerFolder({ ...folder, index: snapshot });
  });
  return workspace;
}

export const PRIMARY_FOLDER = PI_LAB_ROOT;
export const SECONDARY_FOLDER = PI_WEB_ROOT;
