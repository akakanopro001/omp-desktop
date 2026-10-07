#!/usr/bin/env node
/**
 * Fetch the real omp runtime binary for a target platform and place it in the
 * bundled payload directory, so a packaged build ships the upstream agent
 * instead of the offline stub.
 *
 *   node scripts/fetch-omp-runtime.mjs win32-x64
 *   node scripts/fetch-omp-runtime.mjs linux-x64
 *   node scripts/fetch-omp-runtime.mjs darwin-arm64
 *
 * The release assets are self-contained single-file binaries published at
 * https://github.com/can1357/oh-my-pi/releases (omp-windows-x64.exe and
 * friends), each with an entry in the release's SHA256SUMS.txt. We verify that
 * checksum before the binary is allowed into the payload.
 *
 * Env:
 *   OMP_RUNTIME_VERSION   release tag to fetch (default: latest)
 *   OMP_RUNTIME_MIRROR    alternative base URL for the release assets
 *   OMP_RUNTIME_SKIP      set to 1 to keep the stub and skip the download
 */

import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const REPO = "can1357/oh-my-pi";
const OUT_DIR = path.join(process.cwd(), "resources", "omp-runtime", "bin");

const TARGETS = {
  "win32-x64": { asset: "omp-windows-x64.exe", output: "omp.exe" },
  "win32-arm64": { asset: "omp-windows-arm64.exe", output: "omp.exe" },
  "linux-x64": { asset: "omp-linux-x64", output: "omp" },
  "linux-arm64": { asset: "omp-linux-arm64", output: "omp" },
  "darwin-x64": { asset: "omp-darwin-x64", output: "omp" },
  "darwin-arm64": { asset: "omp-darwin-arm64", output: "omp" },
};

const target = process.argv[2] || `${process.platform}-${process.arch}`;
const spec = TARGETS[target];
if (!spec) {
  process.stderr.write(`unknown target ${target}; expected one of ${Object.keys(TARGETS).join(", ")}\n`);
  process.exit(1);
}

if (process.env.OMP_RUNTIME_SKIP === "1") {
  process.stdout.write("[runtime] OMP_RUNTIME_SKIP=1 — keeping the bundled payload stub\n");
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });

const version = process.env.OMP_RUNTIME_VERSION || "latest";
const base =
  process.env.OMP_RUNTIME_MIRROR ||
  (version === "latest"
    ? `https://github.com/${REPO}/releases/latest/download`
    : `https://github.com/${REPO}/releases/download/${version}`);

async function download(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

process.stdout.write(`[runtime] fetching ${spec.asset} (${version}) for ${target}\n`);
let binary;
try {
  binary = await download(`${base}/${spec.asset}`);
} catch (error) {
  process.stderr.write(`[runtime] download failed: ${error.message}\n`);
  process.exit(1);
}

// Verify against the release's checksum list when it is reachable. A mismatch
// is fatal; an unreachable list is reported but does not block the build.
try {
  const sums = (await download(`${base}/SHA256SUMS.txt`)).toString("utf8");
  const line = sums
    .split("\n")
    .map((entry) => entry.trim().split(/\s+/))
    .find((entry) => entry[1] === spec.asset || entry[1] === `*${spec.asset}`);
  if (line) {
    const digest = createHash("sha256").update(binary).digest("hex");
    if (digest !== line[0]) {
      process.stderr.write(`[runtime] checksum mismatch for ${spec.asset}\n  expected ${line[0]}\n  got      ${digest}\n`);
      process.exit(1);
    }
    process.stdout.write(`[runtime] sha256 verified: ${digest}\n`);
  } else {
    process.stdout.write(`[runtime] ${spec.asset} is not listed in SHA256SUMS.txt — skipping verification\n`);
  }
} catch (error) {
  process.stdout.write(`[runtime] checksum list unavailable (${error.message}) — continuing unverified\n`);
}

const destination = path.join(OUT_DIR, spec.output);
const staging = path.join(OUT_DIR, `${spec.output}.download`);
writeFileSync(staging, binary);
if (!spec.output.endsWith(".exe")) chmodSync(staging, 0o755);
renameSync(staging, destination);

// The payload directory must not be ESM: the binaries are extensionless files
// that Node would otherwise try to parse as modules when the shell falls back
// to `node <payload> --version`.
const manifest = path.join(process.cwd(), "resources", "omp-runtime", "package.json");
if (!existsSync(manifest)) {
  writeFileSync(manifest, `${JSON.stringify({ name: "omp-runtime-payload", private: true, type: "commonjs" }, null, 2)}\n`);
}

// Record what this payload is, so the shell and the installer can report it.
writeFileSync(
  path.join(process.cwd(), "resources", "omp-runtime", "payload.json"),
  `${JSON.stringify(
    {
      target,
      asset: spec.asset,
      version,
      bytes: binary.length,
      sha256: createHash("sha256").update(binary).digest("hex"),
      fetchedAt: new Date().toISOString(),
      source: `${base}/${spec.asset}`,
    },
    null,
    2,
  )}\n`,
);

// A stale payload for another platform would confuse the resolver.
for (const [name, entry] of Object.entries(TARGETS)) {
  if (name === target) continue;
  const stale = path.join(OUT_DIR, entry.output);
  if (existsSync(stale) && entry.output !== spec.output) {
    try {
      renameSync(stale, `${stale}.stale`);
    } catch {
      /* best effort */
    }
  }
}

process.stdout.write(`[runtime] ${spec.output} ready (${(binary.length / 1e6).toFixed(1)} MB)\n`);
process.stdout.write(`[runtime] payload digest ${createHash("sha256").update(readFileSync(destination)).digest("hex").slice(0, 16)}…\n`);
