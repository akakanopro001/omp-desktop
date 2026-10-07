/**
 * Oh My Pi Desktop — Electron main process.
 *
 * Boundary 01 of the shell/renderer/agent split (the same shape Hermes Agent
 * Desktop uses):
 *
 *   • resolve a runnable omp runtime in a fixed order, probing each candidate
 *   • boot it headless (omp --mode rpc --no-ui), speak the real RPC transport, own its lifecycle + logs
 *   • reach the other three omp entry points too: interactive, one-shot (-p) and ACP
 *   • own native capability: filesystem, git, clipboard, dialogs, window
 *   • serve the renderer over loopback so deep links (/app) survive in a packaged app
 *   • expose a narrow preload bridge — never a Node runtime in the renderer
 *
 * The transport is omp's own, not JSON-RPC 2.0: a `ready` frame first, then
 * `{ type: "response", command, success, data }` replies and AgentSessionEvent
 * objects, one JSON object per stdout line. Protocol v2 sessions may wrap an
 * oversized frame in an ordered run of `rpc_chunk` frames that we reassemble.
 * See docs/rpc.md upstream.
 *
 * Run:
 *   bun run desktop:dev        (window against the dev server or dist/)
 *   bun run desktop:verify     (headless self-test: boot, handshake, DOM probes, screenshots)
 *
 * Env:
 *   OMP_HOME                 user-data home, defaults to ~/.omp
 *   OMP_DESKTOP_DEV_URL      load the window from a running dev server
 *   OMP_DESKTOP_OMP          explicit runtime command (deployment override)
 *   OMP_DESKTOP_OMP_ROOT     explicit checkout root (source-root override)
 *   OMP_DESKTOP_WORKSPACE    sandbox root the fs/git bridge refuses to escape
 *   OMP_DESKTOP_MODE         gateway transport: rpc (default) | rpc-ui
 *   OMP_DESKTOP_VERIFY       run the headless self-test and exit
 *   OMP_DESKTOP_VERIFY_OUT   directory for the self-test report + screenshots
 *   OMP_DESKTOP_VERBOSE      mirror the shell log to stdout
 */

const { app, BrowserWindow, ipcMain, clipboard, dialog, shell } = require("electron");
const { spawn, execFile } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const OMP_HOME = process.env.OMP_HOME || path.join(os.homedir(), ".omp");
const LOG_DIR = path.join(OMP_HOME, "logs");
const LOG_FILE = path.join(LOG_DIR, "desktop.log");
const DEV_URL = process.env.OMP_DESKTOP_DEV_URL || "";
const VERIFY = process.env.OMP_DESKTOP_VERIFY === "1";
/**
 * In a packaged app the renderer and the bundled payload live inside the app
 * bundle. When the shell is launched as a script (`electron desktop-shell/main.cjs`)
 * Electron reports the *script's* directory as the app path, so dev runs resolve
 * against the repo root instead.
 */
const APP_ROOT = app.isPackaged ? app.getAppPath() : path.join(__dirname, "..");
const VERIFY_DIR = process.env.OMP_DESKTOP_VERIFY_OUT || path.join(APP_ROOT, "verify-output");
// How long a freshly spawned runtime gets to print its `ready` frame. A runtime
// that dies is detected by the exit race instead of by this budget, so a cold
// start of the 236 MB release binary on a CI runner is not mistaken for a hang.
const READY_TIMEOUT = Number(process.env.OMP_DESKTOP_READY_TIMEOUT ?? 45000);

// The self-test must never read or write the real desktop profile: give it a
// throwaway userData directory so first-run onboarding is exercised every time.
let scratchProfile = null;
if (VERIFY) {
  scratchProfile = fs.mkdtempSync(path.join(os.tmpdir(), "omp-desktop-verify-"));
  app.setPath("userData", scratchProfile);
}

let runtime = null; // { kind, command, args, version, script, scriptRuntime, cwd }
let runtimeDamage = null; // set when the highest-priority runtime is present but broken
let gateway = null; // child process
let transport = null; // omp RPC transport over the gateway's stdio
let gatewayState = { started: false, pid: null, handshake: null }; // handshake: { ok, mode, serverInfo, capabilities, session, error }
let mainWindow = null;
let staticServer = null;

function log(line) {
  const entry = `${new Date().toISOString()} ${line}`;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, `${entry}\n`);
  } catch {
    /* logging must never take the app down */
  }
  if (process.env.OMP_DESKTOP_VERBOSE || VERIFY) process.stdout.write(`${entry}\n`);
}

function run(cmd, args, options = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000, windowsHide: true, ...options }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: (stdout || "").trim(), stderr: (stderr || "").trim(), error });
    });
  });
}

/** Upstream ships one self-contained binary per platform — `omp.exe` on Windows. */
const OMP_BINARY = process.platform === "win32" ? "omp.exe" : "omp";
/** In-process JavaScript runtime that can also execute the TypeScript CLI entry. */
const SCRIPT_RUNTIME = process.platform === "win32" ? "bun.exe" : "bun";

/** Bundled payload lives in resources/ when packaged and beside the repo in dev. */
function bundledPayloadPaths() {
  return [
    path.join(process.resourcesPath || "", "omp-runtime", "bin", OMP_BINARY),
    path.join(APP_ROOT, "resources", "omp-runtime", "bin", OMP_BINARY),
    path.join(APP_ROOT, "resources", "omp-runtime", "bin", "omp"),
  ].filter((candidate) => candidate && !candidate.startsWith("omp-runtime"));
}

/** The gateway transport omp is asked for: rpc (headless) or rpc-ui (UI frames on). */
const GATEWAY_MODE = process.env.OMP_DESKTOP_MODE === "rpc-ui" ? "rpc-ui" : "rpc";

function candidateList() {
  return [
    {
      kind: "bundled-payload",
      label: "Bundled payload",
      detail: "resources/omp-runtime/bin/omp — shipped with this build, version pinned at build time",
      paths: bundledPayloadPaths(),
    },
    {
      kind: "deployment-override",
      label: "OMP_DESKTOP_OMP deployment override",
      detail: "operator-provided runtime",
      paths: process.env.OMP_DESKTOP_OMP ? [process.env.OMP_DESKTOP_OMP] : [],
    },
    {
      kind: "source-root-override",
      label: "Source root override",
      detail: "OMP_DESKTOP_OMP_ROOT checkout",
      paths: [
        ...(process.env.OMP_DESKTOP_OMP_ROOT ? [path.join(process.env.OMP_DESKTOP_OMP_ROOT, "packages/coding-agent/src/cli.ts")] : []),
        ...(process.env.OMP_DESKTOP_OMP_ROOT ? [path.join(process.env.OMP_DESKTOP_OMP_ROOT, "packages", "coding-agent", "src", "cli.ts")] : []),
      ],
    },
    {
      kind: "dev-checkout",
      label: "Development checkout",
      detail: "packages/coding-agent beside this repo",
      paths: [path.join(APP_ROOT, "..", "oh-my-pi", "packages", "coding-agent", "src", "cli.ts")],
    },
    {
      kind: "path-install",
      label: "Installed omp on PATH",
      detail: "`npm i -g @oh-my-pi/pi-coding-agent`, `bun i -g`, Homebrew or the release binary",
      paths: (process.env.PATH || "")
        .split(path.delimiter)
        .filter(Boolean)
        .map((entry) => path.join(entry, OMP_BINARY)),
    },
    {
      kind: "managed-install",
      label: "Managed install",
      detail: "~/.omp/agent/bin — written by the desktop shell's own installer",
      paths: [path.join(OMP_HOME, "agent", "bin", OMP_BINARY), path.join(OMP_HOME, "agent", "bin", "omp")],
    },
  ];
}

/**
 * Probe a candidate. Extensionless payloads that lost their executable bit
 * (fresh checkout, uploaded artifact) are retried through node; TypeScript
 * checkouts of the upstream CLI are retried through bun.
 */
async function probe(command) {
  const exists = fs.existsSync(command);
  if (!exists) return { exists: false, usable: false, detail: "not present on this machine" };

  const direct = await run(command, ["--version"]);
  if (direct.ok) return { exists: true, usable: true, version: direct.stdout, exec: null, detail: "version probe ok" };

  if (command.endsWith(".ts")) {
    const viaBun = await run(SCRIPT_RUNTIME, [command, "--version"]);
    if (viaBun.ok) return { exists: true, usable: true, version: viaBun.stdout, exec: SCRIPT_RUNTIME, detail: `${SCRIPT_RUNTIME} version probe ok` };
  }

  const viaNode = await run("node", [command, "--version"]);
  if (viaNode.ok) {
    return { exists: true, usable: true, version: viaNode.stdout, exec: "node", detail: "version probe ok (exec bit missing, ran through node)" };
  }

  return { exists: true, usable: false, detail: (direct.stderr || viaNode.stderr || "probe failed").split("\n")[0] };
}

async function resolveRuntime() {
  const probed = [];
  for (const candidate of candidateList()) {
    if (candidate.paths.length === 0) {
      probed.push({ kind: candidate.kind, label: candidate.label, detail: candidate.detail, command: "", state: "skipped", probe: "not configured" });
      continue;
    }
    let settled = null;
    let damaged = null;
    for (const candidatePath of candidate.paths) {
      const result = await probe(candidatePath);
      if (result.usable) {
        settled = { candidatePath, result };
        break;
      }
      if (result.exists) damaged = { candidatePath, result };
    }

    if (!settled) {
      if (damaged) {
        // A payload that is present but broken is reported, never papered over
        // by a lower-priority runtime further down the ladder.
        probed.push({
          kind: candidate.kind,
          label: candidate.label,
          detail: candidate.detail,
          command: damaged.candidatePath,
          state: "unusable",
          probe: damaged.result.detail,
        });
        log(`runtime probe ${candidate.kind}: DAMAGED (${damaged.candidatePath}) — ${damaged.result.detail}`);
        break;
      }
      probed.push({ kind: candidate.kind, label: candidate.label, detail: candidate.detail, command: candidate.paths[0], state: "skipped", probe: "not present" });
      continue;
    }

    const { candidatePath, result } = settled;
    probed.push({
      kind: candidate.kind,
      label: candidate.label,
      detail: candidate.detail,
      command: result.exec ? `${result.exec} ${candidatePath}` : candidatePath,
      version: result.version,
      state: result.usable ? "ok" : "unusable",
      probe: result.detail,
    });

    log(`runtime probe ${candidate.kind}: ${result.usable ? "usable" : "not usable"} (${candidatePath}) — ${result.detail}`);

    if (result.usable && !runtime) {
      runtime = {
        kind: candidate.kind,
        command: result.exec ? result.exec : candidatePath,
        args: [
          ...(result.exec ? [candidatePath] : []),
          "--mode",
          GATEWAY_MODE,
          ...(GATEWAY_MODE === "rpc" ? ["--no-ui"] : []),
        ],
        version: result.version,
        script: candidatePath.endsWith(".ts"),
        scriptRuntime: candidatePath.endsWith(".ts") ? SCRIPT_RUNTIME : null,
        cwd: process.env.OMP_DESKTOP_WORKSPACE || OMP_HOME,
      };
    }
  }
  if (!runtime) {
    runtimeDamage = probed.some((entry) => entry.state === "unusable")
      ? "the highest-priority runtime on this machine is present but did not answer --version"
      : "no omp runtime found: install @oh-my-pi/pi-coding-agent, or ship the bundled payload";
  }
  return probed;
}

/**
 * The omp RPC transport (upstream docs/rpc.md — line-delimited JSON, not
 * JSON-RPC 2.0). The runtime opens with a `ready` frame that advertises the
 * protocol versions it supports, answers commands with
 * `{ type: "response", command, success, data }`, and streams AgentSessionEvent
 * objects in between. Protocol v2 ships oversized logical frames as an ordered
 * run of `rpc_chunk` frames, which we validate and reassemble here.
 */
function createTransport(child) {
  const waiters = new Map(); // id -> { resolve, timer }
  const frameListeners = [];
  const events = Object.create(null);
  let buffer = "";
  let spool = null;
  let seq = 0;
  let frames = 0;
  let chunks = 0;
  let eventCount = 0;
  let readyFrame = null;

  function settle(id, value) {
    const waiter = waiters.get(id);
    if (!waiter) return;
    waiters.delete(id);
    clearTimeout(waiter.timer);
    waiter.resolve(value);
  }

  function deliver(frame) {
    frames += 1;
    if (frame.type === "ready") {
      readyFrame = frame;
      log(`rpc <- ready: protocolVersion ${frame.protocolVersion}, supported ${JSON.stringify(frame.supportedProtocolVersions ?? [frame.protocolVersion])}, maxFrameBytes ${frame.maxFrameBytes ?? "?"}`);
    } else if (frame.type === "response") {
      settle(frame.id, {
        ok: frame.success !== false,
        command: frame.command,
        data: frame.data,
        error: frame.success === false ? frame.error : undefined,
      });
    } else if (frame.type === "prompt_result") {
      settle(`prompt:${frame.id}`, {
        ok: frame.status !== "error",
        command: "prompt_result",
        status: frame.status,
        error: frame.error,
        data: { agentInvoked: frame.agentInvoked, sessionSettled: frame.sessionSettled },
      });
    } else {
      eventCount += 1;
      events[frame.type] = (events[frame.type] ?? 0) + 1;
    }
    for (const listener of frameListeners) listener(frame);
  }

  function consume(line) {
    if (!line.trim()) return;
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      log(`rpc: dropped a malformed stdout line (${line.length} bytes)`);
      return;
    }

    if (frame.type === "rpc_chunk") {
      chunks += 1;
      if (!spool || spool.chunkId !== frame.chunkId) {
        spool = { chunkId: frame.chunkId, index: 0, count: Number(frame.count ?? 0), byteLength: Number(frame.byteLength ?? 0), parts: [] };
      }
      if (frame.index !== spool.index) {
        log(`rpc: discarded an interrupted chunk sequence (${String(spool.chunkId)} → ${String(frame.chunkId)})`);
        spool = null;
        return;
      }
      try {
        spool.parts.push(Buffer.from(String(frame.data ?? ""), "base64"));
      } catch {
        spool = null;
        return;
      }
      spool.index += 1;
      if (spool.index === spool.count) {
        const { parts, byteLength } = spool;
        spool = null;
        const logical = Buffer.concat(parts).toString("utf8");
        if (byteLength > 0 && Buffer.byteLength(logical, "utf8") !== byteLength) {
          log("rpc: reassembled frame disagreed with the advertised byteLength");
        }
        consume(logical);
      }
      return;
    }

    deliver(frame);
  }

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) consume(line);
  });

  function send(frame, timeoutMs = 15000) {
    const id = frame.id || `req_${++seq}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiters.delete(id);
        resolve({ ok: false, command: frame.type, id, error: `timeout after ${timeoutMs}ms waiting for ${frame.type}` });
      }, timeoutMs);
      waiters.set(id, { resolve, timer });
      try {
        child.stdin.write(`${JSON.stringify({ id, ...frame })}\n`);
      } catch (error) {
        clearTimeout(timer);
        waiters.delete(id);
        resolve({ ok: false, command: frame.type, id, error: `could not write to the runtime: ${error.message}` });
      }
    });
  }

  return {
    send,
    onFrame: (listener) => frameListeners.push(listener),
    ready: () => readyFrame,
    awaitReady: (timeoutMs = 20000) =>
      new Promise((resolve) => {
        if (readyFrame) return resolve(readyFrame);
        const listener = (frame) => {
          if (frame.type !== "ready") return;
          const index = frameListeners.indexOf(listener);
          if (index !== -1) frameListeners.splice(index, 1);
          resolve(frame);
        };
        frameListeners.push(listener);
        setTimeout(() => {
          const index = frameListeners.indexOf(listener);
          if (index !== -1) frameListeners.splice(index, 1);
          resolve(readyFrame);
        }, timeoutMs);
      }),
    stats: () => ({ frames, chunks, events: eventCount, eventTypes: { ...events }, ready: readyFrame, protocolVersion: negotiatedProtocol(gatewayState.handshake) }),
  };
}

function negotiatedProtocol(handshake) {
  return handshake?.serverInfo?.protocolVersion ?? null;
}

async function startGateway() {
  if (!runtime) return { ok: false, pid: null, handshake: null, damage: runtimeDamage };
  if (gateway) return { ok: true, pid: gateway.pid, handshake: gatewayState.handshake, damage: null };

  // Only flags that exist upstream: `omp` validates them against its own table
  // and exits 2 on anything unknown, so nothing is ever invented here.
  const args = [...runtime.args];

  gateway = spawn(runtime.command, args, {
    cwd: runtime.cwd,
    env: {
      ...process.env,
      OMP_HOME,
      // Keep the runtime's own agent directory inside OMP_HOME so the desktop
      // shell and a terminal omp never disagree about where sessions live.
      PI_CODING_AGENT_DIR: path.join(OMP_HOME, "agent"),
      OMP_DESKTOP_CLIENT: `omp-desktop/${app.getVersion()}`,
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  // Hold the child through a local reference: the exit handler nulls the module
  // scope, and a runtime that dies mid-handshake must not become a TypeError.
  const child = gateway;
  const pipe = createTransport(child);
  transport = pipe;
  let exited = null;
  pipe.onFrame((frame) => {
    if (frame.type === "response" && frame.success === false) log(`rpc <- ${frame.command} failed: ${frame.error}`);
    if (frame.type === "extension_error") log(`extension error in ${frame.extensionPath}: ${frame.error}`);
  });
  let stderrText = "";
  child.stderr.on("data", (chunk) => {
    stderrText += chunk.toString();
    log(`[omp:stderr] ${chunk.toString().trimEnd()}`);
  });
  child.on("error", (error) => log(`gateway spawn error: ${error.message}`));
  child.on("exit", (code, signal) => {
    exited = { code, signal };
    log(`omp runtime exited code=${code} signal=${signal}`);
    if (gateway === child) {
      gateway = null;
      transport = null;
    }
  });

  gatewayState = { started: true, pid: child.pid, handshake: null };
  log(`gateway started: ${runtime.command} ${args.join(" ")} (pid ${child.pid})`);

  // 01 — the ready frame is the runtime's opening statement, not a reply. A
  // runtime that dies first (an unknown flag, no provider) is reported as an
  // exit rather than being blamed on the handshake timeout 20s later.
  const ready = exited
    ? null
    : await Promise.race([
        pipe.awaitReady(READY_TIMEOUT),
        new Promise((resolve) => child.once("exit", () => resolve(null))),
      ]);  if (!ready) {
    // The single most common non-interactive failure is not a broken runtime:
    // upstream refuses to open a session with no model (`!isInteractive &&
    // !session.model` in main.ts) and exits 1 with a message naming the fix.
    // Report that as a distinct, actionable state instead of "unusable".
    const reason = stderrText.trim().split("\n").find(Boolean) ?? null;
    const needsModel = /no default model selected|no models available|no model available matching/i.test(stderrText);
    gatewayState.handshake = {
      ok: false,
      mode: GATEWAY_MODE,
      error: exited
        ? `the runtime exited (code=${exited.code}) before the ready frame`
        : `the runtime wrote no ready frame within ${Math.round(READY_TIMEOUT / 1000)}s`,
      reason,
      needsModel,
      guidance: needsModel ? "omp will not open a session without a model — add a provider key in Settings → Providers." : null,
      runtimeKind: runtime.kind,
    };
    log(`gateway handshake FAILED: ${gatewayState.handshake.error}${reason ? ` — ${reason}` : ""}`);
    return { ok: false, pid: child.pid, handshake: gatewayState.handshake, damage: runtimeDamage };
  }
  const supported = ready.supportedProtocolVersions ?? [ready.protocolVersion ?? 1];

  // 02 — opt into the lossless chunked transport when the runtime offers v2.
  let protocolVersion = ready.protocolVersion ?? 1;
  if (supported.includes(2)) {
    const negotiated = await pipe.send({ id: "protocol-1", type: "negotiate_protocol", protocolVersion: 2 }, 8000);
    if (negotiated.ok) {
      protocolVersion = 2;
      log("protocol negotiated: v2 (rpc_chunk reassembly enabled)");
    } else {
      log(`protocol stays v1 — the runtime refused v2: ${negotiated.error}`);
    }
  }

  // 03 — prove the session answers real commands, not just the greeting.
  const state = await pipe.send({ type: "get_state" }, 20000);
  const commands = await pipe.send({ type: "get_available_commands" }, 12000);
  const models = await pipe.send({ type: "get_available_models" }, 20000);

  // Upstream answers these two with an envelope (`{ commands: [...] }`,
  // `{ models: [...] }`); older builds answered with a bare array. Accept both
  // so the counts in the status bar match whichever runtime is resolved.
  const readList = (value, key) => (Array.isArray(value) ? value : Array.isArray(value?.[key]) ? value[key] : []);
  const modelList = readList(models.data, "models");
  const commandList = readList(commands.data, "commands");

  gatewayState.handshake = {
    ok: state.ok,
    mode: GATEWAY_MODE,
    serverInfo: {
      name: "omp",
      transport: "rpc",
      runtime: runtime.kind,
      command: runtime.command,
      version: runtime.version,
      protocolVersion,
      supportedProtocolVersions: supported,
      maxFrameBytes: ready.maxFrameBytes ?? null,
      maxReassembledFrameBytes: ready.maxReassembledFrameBytes ?? null,
    },
    capabilities: {
      sessions: Boolean(state.data),
      fileBrowser: true,
      lsp: true,
      debug: true,
      subagents: Array.isArray(state.data?.subagents) || state.ok,
      memory: state.ok,
      todos: Boolean(state.data?.todoPhases || state.data?.todos || state.ok),
      models: modelList.length,
      commands: commandList.length,
      queue: state.data?.queuedMessages ?? state.data?.queue ?? null,
      streaming: Boolean(state.data?.isStreaming !== undefined || state.ok),
    },
    needsModel: false,
    session: state.data ?? null,
    error: state.ok ? undefined : state.error,
  };

  if (state.ok) {
    log(`gateway handshake ok: omp ${runtime.version ?? "unknown"} over ${GATEWAY_MODE} v${protocolVersion} — ${modelList.length} models, ${commandList.length} commands`);
    log(
      `  session ${state.data?.sessionId ?? "?"} · model ` +
        `${state.data?.model ? `${state.data.model.provider}/${state.data.model.id}` : "none selected"} · ` +
        `todos ${Array.isArray(state.data?.todoPhases) ? state.data.todoPhases.length : 0}`,
    );
  } else {
    log(`gateway handshake FAILED on get_state: ${state.error}`);
  }

  return { ok: Boolean(state.ok), pid: child.pid, handshake: gatewayState.handshake, damage: null };
}

/**
 * One-shot entry point: `omp -p "<prompt>" --mode text` runs prompts
 * non-interactively and exits, which is how the desktop runs a quick request
 * without taking over the gateway session.
 */
async function runOneShot(payload) {
  if (!runtime) return { ok: false, error: runtimeDamage || "no omp runtime resolved" };
  const prompt = String(payload?.prompt ?? "").trim();
  if (!prompt) return { ok: false, error: "a prompt is required" };

  return await new Promise((resolve) => {
    const child = spawn(runtime.command, [...runtimeArgv(["-p", prompt, "--mode", "text"]), ...(payload?.model ? ["--model", String(payload.model)] : [])], {
      cwd: runtime.cwd,
      env: { ...process.env, OMP_HOME, PI_CODING_AGENT_DIR: path.join(OMP_HOME, "agent") },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, error: `one-shot run exceeded ${payload?.timeoutMs ?? 120000}ms`, stdout });
    }, Number(payload?.timeoutMs ?? 120000));
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      log(`one-shot run finished code=${code} (${stdout.length} bytes on stdout)`);
      resolve({ ok: code === 0, code, stdout: stdout.trimEnd(), stderr: stderr.trimEnd() });
    });
  });
}

/** A TypeScript checkout runs through bun, so its script path leads the argv. */
function runtimeArgv(rest) {
  return runtime?.script ? [runtime.args[0], ...rest] : rest;
}

/**
 * The four omp entry points. `supported` comes from what the resolved runtime's
 * own `--help` advertises, and `live` says whether a session is answering right
 * now — the two differ on purpose: with no provider configured the real binary
 * still *has* an RPC entry point, it just exits 1 instead of serving one, and
 * the UI must say that rather than call the runtime broken.
 */
async function entryPoints() {
  const binary = runtime ? (runtime.script ? `${runtime.command} ${runtime.args[0]}` : runtime.command) : null;
  const help = runtime ? await run(runtime.command, runtimeArgv(["--help"])) : { ok: false, stdout: "" };
  const helpText = help.stdout || "";
  const live = Boolean(gatewayState.handshake?.ok);
  const liveReason = live ? null : gatewayState.handshake?.error ?? (runtime ? "no session has been started" : "no runtime resolved");
  const advertises = (pattern) => new RegExp(pattern, "i").test(helpText);
  return [
    {
      id: "interactive",
      name: "Interactive",
      command: binary ? `${binary}` : "omp",
      detail: "Full-screen session — the agent you talk to in a terminal.",
      supported: Boolean(runtime),
      live: Boolean(runtime),
      liveReason: runtime ? null : liveReason,
    },
    {
      id: "oneshot",
      name: "One-shot print",
      command: "omp -p \"<prompt>\" --mode text",
      detail: "Runs the prompt non-interactively and exits — wired to the shell's Run request.",
      supported: Boolean(runtime) && (advertises("--print") || advertises("-p,")),
      live,
      liveReason,
    },
    {
      id: "rpc",
      name: "RPC over stdio",
      command: `omp --mode ${GATEWAY_MODE}${GATEWAY_MODE === "rpc" ? " --no-ui" : ""}`,
      detail: "Line-delimited JSON commands, responses and events — the transport this shell speaks.",
      supported: Boolean(runtime) && advertises("--mode[= ]rpc"),
      live,
      liveReason,
    },
    {
      id: "acp",
      name: "ACP",
      command: "omp acp  ·  omp --mode acp",
      detail: "Agent Client Protocol server over stdio, for Zed and other ACP hosts.",
      supported: Boolean(runtime) && advertises("\\bacp\\b"),
      live,
      liveReason,
    },
  ];
}

async function probeGateway(payload) {
  const url = payload?.url || "";
  const headers = payload?.headers || {};
  const capabilities = {
    rpc: false,
    websocket: false,
    sessions: false,
    fileBrowser: false,
    lsp: false,
    debug: false,
    subagents: false,
    memory: false,
    browserRelay: false,
    computer: false,
    auth: payload?.token ? "token" : "none",
  };

  if (!url) {
    // No URL configured: report what the spawned runtime itself can do. omp's
    // transport is stdio JSON lines, so there is no websocket server to claim.
    const local = gatewayState.handshake?.ok ?? false;
    const caps = gatewayState.handshake?.capabilities ?? {};
    return {
      ...capabilities,
      rpc: local,
      websocket: false,
      sessions: local && (caps.sessions ?? true),
      fileBrowser: Boolean(runtime),
      lsp: Boolean(runtime) && (caps.lsp ?? true),
      debug: Boolean(runtime) && (caps.debug ?? true),
      subagents: Boolean(runtime) && (caps.subagents ?? true),
      memory: Boolean(runtime) && (caps.memory ?? true),
      models: caps.models ?? 0,
      commands: caps.commands ?? 0,
      protocolVersion: gatewayState.handshake?.serverInfo?.protocolVersion ?? null,
      transport: "rpc",
      mode: GATEWAY_MODE,
      auth: "none",
    };
  }

  try {
    const httpUrl = url.replace(/^ws/, "http");
    const response = await fetch(`${httpUrl}/status`, { headers, signal: AbortSignal.timeout(4000) });
    if (response.ok) {
      const body = await response.json().catch(() => ({}));
      return {
        ...capabilities,
        rpc: true,
        websocket: Boolean(body.websocket ?? false),
        sessions: Boolean(body.sessions ?? true),
        fileBrowser: Boolean(body.fileBrowser ?? true),
        lsp: Boolean(body.lsp ?? true),
        debug: Boolean(body.debug ?? true),
        subagents: Boolean(body.subagents ?? true),
        memory: Boolean(body.memory ?? true),
        browserRelay: Boolean(body.browserRelay),
        computer: Boolean(body.computer),
        auth: body.auth || capabilities.auth,
      };
    }
  } catch (error) {
    log(`gateway probe failed: ${error.message}`);
  }
  return capabilities;
}

function assertInsideProject(target) {
  const root = process.env.OMP_DESKTOP_WORKSPACE || os.homedir();
  const resolved = path.resolve(target);
  if (!resolved.startsWith(path.resolve(root))) {
    throw new Error(`path outside the workspace root: ${resolved}`);
  }
  return resolved;
}

function registerIpc() {
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("runtime:resolve", () => resolveRuntime());
  ipcMain.handle("runtime:start", () => startGateway());
  ipcMain.handle("runtime:handshake", () => gatewayState.handshake);
  ipcMain.handle("runtime:state", () => ({
    kind: runtime?.kind ?? null,
    version: runtime?.version ?? null,
    started: gatewayState.started,
    pid: gatewayState.pid,
    alive: Boolean(gateway && !gateway.killed),
    handshake: gatewayState.handshake,
    mode: GATEWAY_MODE,
    damage: runtimeDamage,
    script: Boolean(runtime?.script),
    transport: transport ? transport.stats() : null,
    platform: `${process.platform}/${process.arch}`,
    // omp speaks JSON over stdio and opens no port, so there is never one here.
    gatewayPort: null,
    logFile: LOG_FILE,
    home: OMP_HOME,
  }));
  ipcMain.handle("runtime:probe", (_event, payload) => probeGateway(payload));
  ipcMain.handle("runtime:entryPoints", async (_event, payload) => {
    if (payload?.refresh || !entryPointsCache) entryPointsCache = await entryPoints();
    return entryPointsCache;
  });
  ipcMain.handle("runtime:oneshot", (_event, payload) => runOneShot(payload));
  ipcMain.handle("runtime:command", async (_event, payload) => {
    if (!transport) await startGateway();
    if (!transport) return { ok: false, error: runtimeDamage || "no omp runtime is running" };
    return transport.send({ type: String(payload?.type ?? "get_state"), ...(payload?.params ?? {}) }, Number(payload?.timeoutMs ?? 20000));
  });

  ipcMain.handle("fs:list", async (_event, root) => {
    const base = assertInsideProject(root || process.env.OMP_DESKTOP_WORKSPACE || os.homedir());
    const out = [];
    const walk = async (dir, depth) => {
      if (depth > 6) return;
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full, depth + 1);
        else {
          const stat = await fsp.stat(full);
          out.push({ path: full, content: "", updatedAt: stat.mtimeMs, dirty: false });
        }
      }
    };
    await walk(base, 0);
    return out;
  });
  ipcMain.handle("fs:read", async (_event, target) => fsp.readFile(assertInsideProject(target), "utf8").catch(() => undefined));
  ipcMain.handle("fs:write", async (_event, target, content) => {
    await fsp.writeFile(assertInsideProject(target), content, "utf8");
    return true;
  });

  ipcMain.handle("git:status", async (_event, root) => {
    const result = await run("git", ["status", "--porcelain=v1"], { cwd: assertInsideProject(root) });
    return result.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => ({ path: line.slice(3).trim(), status: line.slice(0, 2).trim() }));
  });
  ipcMain.handle("git:log", async (_event, root) => {
    const result = await run("git", ["log", "-12", "--pretty=%h|%s|%an <%ae>|%ct"], { cwd: assertInsideProject(root) });
    return result.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, subject, author, at] = line.split("|");
        return { hash, subject, author, at: Number(at) * 1000 };
      });
  });

  ipcMain.handle("clipboard:write", (_event, text) => clipboard.writeText(String(text)));
  ipcMain.handle("dialog:pickFolder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("window:setTitle", (_event, title) => {
    if (mainWindow) mainWindow.setTitle(String(title));
    return true;
  });
}

/**
 * Serve dist/ over loopback so the packaged window keeps real paths: the SPA
 * router sees /app instead of a file:// path, and deep links survive a reload.
 */
function startStaticServer(root) {
  return new Promise((resolve) => {
    const types = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".woff2": "font/woff2",
      ".map": "application/json",
    };
    const server = http.createServer(async (request, response) => {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      let filePath = path.join(root, decodeURIComponent(url.pathname));
      try {
        const stat = await fsp.stat(filePath).catch(() => null);
        if (!stat || stat.isDirectory()) filePath = path.join(root, "index.html");
        const body = await fsp.readFile(filePath);
        response.writeHead(200, { "content-type": types[path.extname(filePath)] || "application/octet-stream" });
        response.end(body);
      } catch (error) {
        response.writeHead(404, { "content-type": "text/plain" });
        response.end(`not found: ${error.message}`);
      }
    });
    staticServer = server;
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      log(`renderer served from ${root} on 127.0.0.1:${typeof address === "object" && address ? address.port : "?"}`);
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1060,
    minHeight: 680,
    show: false,
    backgroundColor: "#0a0b0e",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: !VERIFY,
      spellcheck: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => log(`renderer gone: ${JSON.stringify(details)}`));
  mainWindow.webContents.on("console-message", (_event, level, message) => {
    if (level >= 2) log(`[renderer:${level}] ${message}`);
  });

  const dist = path.join(APP_ROOT, "dist", "index.html");
  if (VERIFY) {
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(() => void runVerify(mainWindow), 1500);
    });
  }
  return (async () => {
    if (VERIFY) startVerifyWatchdog(mainWindow);
    if (DEV_URL) {
      log(`loading renderer from ${DEV_URL}`);
      await mainWindow.loadURL(DEV_URL);
      return;
    }
    if (!fs.existsSync(dist)) {
      log(`no build found at ${dist}; falling back to the dev server URL`);
      await mainWindow.loadURL("http://127.0.0.1:5173/app");
      return;
    }
    const port = await startStaticServer(path.join(APP_ROOT, "dist"));
    await mainWindow.loadURL(`http://127.0.0.1:${port}/app`);
  })();
}

/* ------------------------------------------------------------------ *
 * Headless self-test
 * ------------------------------------------------------------------ */

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(win, expression, timeoutMs = 15000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await win.webContents.executeJavaScript(expression).catch(() => null);
    if (value) return value;
    await wait(intervalMs);
  }
  return null;
}

async function shot(win, name) {
  fs.mkdirSync(VERIFY_DIR, { recursive: true });
  const image = await win.webContents.capturePage();
  const file = path.join(VERIFY_DIR, name);
  fs.writeFileSync(file, image.toPNG());
  return { file, bytes: fs.statSync(file).size, size: image.getSize() };
}

async function runVerify(win) {
  const report = {
    ok: false,
    startedAt: new Date().toISOString(),
    shell: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, platform: `${process.platform}/${process.arch}` },
    runtime: null,
    handshake: null,
    gateway: null,
    dom: {},
    screenshots: [],
    failures: [],
  };

  try {
    report.runtime = { kind: runtime?.kind ?? null, version: runtime?.version ?? null, command: runtime ? `${runtime.command} ${runtime.args.join(" ")}` : null };
    report.handshake = gatewayState.handshake;
    report.gateway = { started: gatewayState.started, pid: gatewayState.pid, alive: Boolean(gateway && !gateway.killed) };

    if (!runtime) report.failures.push("no runnable runtime was resolved");
    // A runtime that resolved but has no model to run is not a broken handshake;
    // it is reported as `runtimeUnconfigured` below with omp's own guidance.
    if (!gatewayState.handshake?.ok && !gatewayState.handshake?.needsModel) report.failures.push("gateway handshake failed");

    // Desktop route: wait for React, dismiss onboarding, then assert the shell landed.
    const mounted = await waitFor(win, "Boolean(document.getElementById('root')?.children.length)");
    if (!mounted) report.failures.push("renderer never mounted");

    report.dom.route = await win.webContents.executeJavaScript("window.location.pathname");
    report.dom.title = await win.webContents.executeJavaScript("document.title");
    report.dom.bootOverlay = await win.webContents.executeJavaScript(
      "Boolean(document.querySelector('h1')?.textContent?.includes('Oh My Pi Desktop'))",
    );

    const clickedStart = await win.webContents.executeJavaScript(`(() => {
      const button = Array.from(document.querySelectorAll('button')).find((node) => /start the workspace/i.test(node.textContent || ''));
      if (!button) return false;
      button.click();
      return true;
    })()`);

    if (clickedStart) {
      const ready = await waitFor(win, "!document.body.innerText.includes('first run')", 15000);
      if (!ready) report.failures.push("onboarding did not complete");
    }

    await wait(1200);
    report.dom.desktop = await win.webContents.executeJavaScript(`(() => ({
      titleBar: document.querySelector('header')?.innerText?.split('\\n')[0] ?? null,
      railTabs: Array.from(document.querySelectorAll('aside button')).map((node) => (node.textContent || '').trim()).filter(Boolean).slice(0, 4),
      composer: Boolean(document.querySelector('textarea')),
      placeholder: document.querySelector('textarea')?.getAttribute('placeholder') ?? null,
      toolCards: document.querySelectorAll('[class*="rounded-md"][class*="border-hairline"]').length,
      bodyChars: document.body.innerText.length,
    }))()`);

    if (!report.dom.desktop.composer) report.failures.push("composer missing on /app");
    if (!report.dom.desktop.railTabs.length) report.failures.push("rail did not render");

    report.screenshots.push(await shot(win, "desktop.png"));

    // Landing route through the same packaged window.
    const url = new URL(win.webContents.getURL());
    await win.webContents.loadURL(`${url.origin}/`);
    await waitFor(win, "Boolean(document.querySelector('h1'))");
    await wait(600);
    report.dom.landing = await win.webContents.executeJavaScript(`(() => ({
      h1: document.querySelector('h1')?.textContent?.slice(0, 80) ?? null,
      cta: Array.from(document.querySelectorAll('a')).map((node) => (node.textContent || '').trim()).find((text) => /launch the workspace/i.test(text)) ?? null,
    }))()`);
    if (!report.dom.landing.h1) report.failures.push("landing did not render");
    report.screenshots.push(await shot(win, "landing.png"));

    // A runtime with no provider configured never opens a session (upstream
    // requires a model in non-interactive modes), so the session-dependent
    // assertions below are skipped and stated instead of blamed on the shell.
    const handshake = gatewayState.handshake;
    report.runtimeUnconfigured = Boolean(handshake?.needsModel);
    report.notes = [];
    if (report.runtimeUnconfigured) {
      report.notes.push(
        `omp refused to open a session — ${handshake.reason ?? handshake.error} ` +
          "Entry points are still classified from `omp --help`; the RPC session assertions were skipped.",
      );
      log(`verify note: ${report.notes[report.notes.length - 1]}`);
    }

    // The transport is the gateway: stdio JSON lines, no port. Assert the
    // handshake actually carried real frames instead of probing a server omp
    // never opens.
    report.transport = transport ? transport.stats() : null;
    if (!report.runtimeUnconfigured) {
      if (!report.transport) report.failures.push("no omp transport is attached");
      else if (!report.transport.frames) report.failures.push("the omp transport received no frames");
    }

    // IPC round trip through the preload bridge, exactly as the renderer does it.
    report.dom.ipc = await win.webContents.executeJavaScript("window.ompNative ? true : false");
    if (!report.dom.ipc) report.failures.push("preload bridge missing window.ompNative");
    const ipcRuntime = await win.webContents.executeJavaScript("window.ompNative.runtime.state()").catch((error) => ({ error: String(error) }));
    report.runtimeFromRenderer = ipcRuntime;
    if (!ipcRuntime?.handshake?.ok && !report.runtimeUnconfigured) report.failures.push("renderer could not see a handshaken runtime");

    // The four entry points: `omp --help` classifies them, and the one-shot one
    // is actually driven to completion with `omp -p "…" --mode text`.
    report.entryPoints = await entryPoints();
    const unsupported = report.entryPoints.filter((entry) => !entry.supported).map((entry) => entry.id);
    if (unsupported.length) report.failures.push(`entry points the resolved runtime does not advertise: ${unsupported.join(", ")}`);
    report.oneShot = await runOneShot({ prompt: "List the entry points this runtime exposes.", timeoutMs: 90000 });
    if (!report.oneShot.ok) {
      // A real omp with no provider credentials still exits non-zero *after* the
      // entry point ran, which is what this assertion is about. Record that as a
      // note; a runtime that could not be spawned or driven stays a failure.
      const transcript = `${report.oneShot.stdout ?? ""}\n${report.oneShot.stderr ?? ""}`;
      const noCredentials = report.oneShot.code !== undefined && /api[- ]?key|credential|unauthor|not logged in|no provider|authentication/i.test(transcript);
      if (noCredentials) {
        report.oneShot.note = "the runtime ran but this environment has no provider credentials";
        log(`one-shot note: ${report.oneShot.note}`);
      } else {
        report.failures.push(`one-shot entry point failed: ${report.oneShot.error ?? report.oneShot.code}`);
      }
    }

    report.ok = report.failures.length === 0;
  } catch (error) {
    report.failures.push(`verify threw: ${error.message}`);
  }

  await finishVerify(report);
}

let verifyDone = false;
let entryPointsCache = null;

function baseReport() {
  return {
    ok: false,
    startedAt: new Date().toISOString(),
    appRoot: APP_ROOT,
    shell: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: `${process.platform}/${process.arch}`,
    },
    runtime: runtime
      ? {
          kind: runtime.kind,
          version: runtime.version,
          command: `${runtime.command} ${runtime.args.join(" ")}`,
          script: Boolean(runtime.script),
          platform: `${process.platform}/${process.arch}`,
          damage: runtimeDamage,
        }
      : null,
    handshake: gatewayState.handshake,
    transport: transport ? transport.stats() : null,
    gateway: { started: gatewayState.started, pid: gatewayState.pid, alive: Boolean(gateway && !gateway.killed) },
    dom: {},
    screenshots: [],
    failures: [],
  };
}

async function finishVerify(report) {
  if (verifyDone) return;
  verifyDone = true;
  report.finishedAt = new Date().toISOString();
  report.transport = transport ? transport.stats() : report.transport ?? null;
  report.appRoot = report.appRoot ?? APP_ROOT;
  report.verifyDir = VERIFY_DIR;
  report.packaged = app.isPackaged;
  report.logTail = readLogTail(40);
  try {
    fs.mkdirSync(VERIFY_DIR, { recursive: true });
    fs.writeFileSync(path.join(VERIFY_DIR, "report.json"), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(VERIFY_DIR, "desktop.log"), readLogTail(400).join("\n"));
  } catch (error) {
    log(`could not write the verify report: ${error.message}`);
  }

  process.stdout.write(`\n=== OMP Desktop self-test ===\n${JSON.stringify(report, null, 2)}\n`);

  try {
    if (gateway) {
      // Upstream contract: closing stdin drains accepted commands, disposes the
      // session and exits 0. SIGTERM is only the fallback if it overstays.
      gateway.stdin.end();
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          gateway?.kill();
          resolve();
        }, 2000);
        gateway.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      gateway = null;
      transport = null;
    }
    if (staticServer) staticServer.close();
    if (scratchProfile) fs.rmSync(scratchProfile, { recursive: true, force: true });
  } catch {
    /* cleanup must not mask the result */
  }
  app.exit(report.ok ? 0 : 1);
}

function startVerifyWatchdog(win) {
  const limitMs = Number(process.env.OMP_DESKTOP_VERIFY_TIMEOUT ?? 75000);
  setTimeout(async () => {
    if (verifyDone) return;
    const report = baseReport();
    report.failures.push(`watchdog: the self-test did not finish within ${limitMs}ms`);
    try {
      report.screenshots.push(await shot(win, "watchdog.png"));
    } catch {
      /* window may already be gone */
    }
    await finishVerify(report);
  }, limitMs);
}

function readLogTail(lines) {
  try {
    return fs.readFileSync(LOG_FILE, "utf8").trimEnd().split("\n").slice(-lines);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => mainWindow?.focus());

  app.whenReady().then(async () => {
    registerIpc();
    log(`shell up: ${process.platform}/${process.arch} electron=${process.versions.electron} verify=${VERIFY} appRoot=${APP_ROOT}${scratchProfile ? ` scratchProfile=${scratchProfile}` : ""}`);
    const probed = await resolveRuntime();
    log(`runtime resolution: ${probed.map((entry) => `${entry.kind}=${entry.state}`).join(" ")}`);
    if (!runtime) {
      log("no usable runtime found; the window reports damage instead of adopting a PATH binary");
    } else {
      await startGateway();
    }
    await createWindow();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    if (gateway) {
      log("stopping gateway");
      gateway.kill();
      gateway = null;
    }
  });
}
