#!/usr/bin/env node
/**
 * Cross-platform runner for the desktop shell's headless self-test.
 *
 * `bun run desktop:verify` boots the shell with OMP_DESKTOP_VERIFY=1, which
 * resolves the omp runtime, opens the gateway over the real RPC transport,
 * drives one-shot and the DOM, and writes verify-output/report.json.
 *
 * Linux needs a display (xvfb-run) and, when running as root in a container,
 * the Chromium sandbox has to stand down. Windows and macOS run it directly.
 *
 * Usage: node scripts/run-desktop-verify.mjs [--extra electron-args...]
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const electronBin = path.join(root, "node_modules", "electron", "dist",
  process.platform === "win32" ? "electron.exe" : "electron");

if (!existsSync(electronBin)) {
  process.stderr.write(`electron is not installed at ${electronBin} — run \`bun install\`\n`);
  process.exit(1);
}

const args = ["desktop-shell/main.cjs", ...process.argv.slice(2)];
if (process.platform === "linux" && typeof process.getuid === "function" && process.getuid() === 0) {
  args.push("--no-sandbox");
}

const command = process.platform === "linux" && spawnSync("which", ["xvfb-run"]).status === 0 ? "xvfb-run" : electronBin;
const argv = command === "xvfb-run" ? ["-a", electronBin, ...args] : args;

process.stdout.write(`[verify] ${command} ${argv.join(" ")}\n`);
const result = spawnSync(command, argv, {
  stdio: "inherit",
  env: { ...process.env, OMP_DESKTOP_VERIFY: "1" },
});

if (result.error) {
  process.stderr.write(`[verify] could not start the shell: ${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
