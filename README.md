# Oh My Pi Desktop

A desktop shell for the **oh-my-pi** (`omp`) coding agent, built on the architecture of **Hermes Agent Desktop**.

Same agent, same skills, same memory as the terminal — in a window with a streaming transcript, live tool cards, hash-anchored edits, language servers, a steerable subagent roster, side-by-side previews and a file browser. No terminal required, but nothing is hidden from it either.

> This repository ships the desktop surface. The agent itself is [`oh-my-pi`](https://github.com/can1357/oh-my-pi) by Stencil Labs (a fork of [Pi](https://github.com/badlogic/pi-mono) by Mario Zechner). The shell/renderer/agent split, the runtime resolution ladder and the soft workspace switch follow Hermes Agent Desktop by Nous Research.

---

## Quickstart

```sh
bun install
bun run dev          # the workspace in this repo — bundled runtime, no install needed
```

Open the landing page at `/` and launch the workspace, or go straight to `/app`.

To run it as a real desktop app:

```sh
bun add -d electron
bun run desktop:dev
```

The Electron shell resolves an `omp` runtime, boots it headless (`omp --mode rpc --no-ui`), speaks omp's own RPC transport and hands the renderer native filesystem, git, clipboard and window capability behind a narrow preload bridge.

### Environment variables

Only the packaged shell reads these; the browser runtime needs none of them.

| variable | meaning |
| --- | --- |
| `OMP_HOME` | user-data home for the shell and the agent (default `~/.omp`) |
| `OMP_DESKTOP_DEV_URL` | load the window from a running dev server instead of `dist/` |
| `OMP_DESKTOP_OMP` | explicit runtime command (deployment override) |
| `OMP_DESKTOP_OMP_ROOT` | explicit checkout root (source-root override) |
| `OMP_DESKTOP_WORKSPACE` | sandbox root the shell's filesystem/git bridge refuses to escape |
| `OMP_DESKTOP_MODE` | gateway transport: `rpc` (default) or `rpc-ui` |
| `OMP_DESKTOP_GATEWAY_PORT` | `/status` port for the bundled payload (0 disables; upstream runtimes never receive it) |
| `OMP_DESKTOP_VERIFY_OUT` | directory for the self-test report, screenshots and log |
| `OMP_DESKTOP_VERIFY_TIMEOUT` | watchdog budget for the self-test in ms (default 75000) |
| `OMP_DESKTOP_VERBOSE` | mirror the shell log to stdout |

Secrets (provider keys, gateway tokens) are supplied through Settings → Providers / Connections and are stored by the shell keychain — never written into a transcript or a repo file.

### Scripts

| script | what it does |
| --- | --- |
| `bun run dev` | Vite dev server (browser runtime) |
| `bun run build` | static production build into `dist/` |
| `bun run typecheck` | `tsc -b --noEmit` |
| `bun run desktop:dev` | packaged shell (requires `electron` installed) |
| `bun run desktop:verify` | headless shell self-test: runtime resolve, RPC handshake, entry points, one-shot run, DOM probes, screenshots (Linux wraps it in `xvfb-run`) |
| `bun run icons` | regenerate `build/icon.png` + multi-size `build/icon.ico` |
| `bun run desktop:dist` | installer + portable packaging into `release/` (requires `electron-builder`) |
| `bun run desktop:dist:win` | the two Windows artifacts |
| `bun run desktop:runtime:win` | fetch + checksum-verify `omp-windows-x64.exe` into the bundled payload |

### Verifying the packaged shell

```sh
bun install
bun add -d electron          # downloads the Electron runtime
bun run build                # renderer bundle into dist/
bun run desktop:verify       # xvfb-run + electron, exits 0 on success
```

The self-test boots the real shell against a throwaway profile, so first-run onboarding is exercised every time, and it asserts the whole chain:

1. the runtime ladder resolves a candidate (log line `runtime probe bundled-payload: usable`) and the highest-priority candidate is probed before anything lower is considered,
2. the gateway is spawned as a child process (`omp --mode rpc --no-ui`) and answers over omp's own transport: the `ready` frame arrives, protocol **v2 is negotiated** (turning on lossless `rpc_chunk` reassembly), and `get_state` / `get_available_commands` / `get_available_models` come back (`gateway handshake ok: omp 18.7.0 … over rpc v2 — 7 models, 33 commands`),
3. all four entry points are classified against the resolved runtime (`omp --help`) and the one-shot entry point is **actually run**: `omp -p "…" --mode text` to exit 0,
4. the renderer mounts `/app`, the onboarding overlay is present at load and completes, and the shell shows its title bar, rail tabs and composer,
5. the landing route renders through the same packaged window,
6. the preload bridge is reachable from the renderer and can read the live runtime state (pid, handshake, capabilities),
7. an HTTP `/status` sweep of the spawned payload matches the connection probe in Settings → Connections.

Artifacts land in `verify-output/`: `report.json` (every probe above), `desktop.png` and `landing.png` (full-window captures), and `desktop.log` (the shell log, also appended to `~/.omp/logs/desktop.log`). The command exits non-zero and writes the failure list if any step fails, and a watchdog reports a hang instead of blocking forever.

**Linux prerequisites** for a headless run:

```sh
apt-get install -y xvfb libgtk-3-0 libnss3 libasound2 libatk-bridge2.0-0 libcups2 \
  libdrm2 libgbm1 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libpango-1.0-0 libcairo2 libatspi2.0-0 libxss1 fonts-liberation
```

Running as root (or in CI containers) also needs `--no-sandbox`, which `desktop:verify` already passes.

### The bundled payload

`resources/omp-runtime/bin/omp` (and `omp.exe` on Windows) is the payload the resolver prefers. In a packaged build it is the self-contained release binary from [`can1357/oh-my-pi`](https://github.com/can1357/oh-my-pi/releases), fetched and checksum-verified by `scripts/fetch-omp-runtime.mjs`. The checked-in stub implements the **same surface** so the shell can be verified without a network install or a provider key:

* `--version`, `--help` (entry-point discovery),
* `omp -p "<prompt>" --mode text|json` — the one-shot entry point,
* `omp --mode rpc [--no-ui]` — the real transport: a `ready` frame advertising protocol v1/v2, `{ type: "response", command, success, data }` replies, `negotiate_protocol` to v2, `get_state` / `get_available_commands` / `get_available_models` / `get_available_thinking_levels` / `prompt` / `abort` / `new_session` / `set_model` / `set_todos` / `set_subagent_subscription` / subagent commands, streamed `agent_start` / `message_update` / `message_end` / `agent_end`, a `prompt_result` completion frame and `session_settled`,
* `omp --mode acp` — the ACP entry point,
* stdin-close shutdown that drains the session and exits 0, exactly as upstream documents,
* an optional HTTP `/status` gateway for the connection panel (the bundled payload only; upstream `omp` has no such flag and never receives it).

Swap in the real binary and nothing else changes — the shell already speaks its protocol.

---

## Architecture — three boundaries

Nothing leaks across a boundary: the shell resolves the runtime, the renderer owns interaction state, the agent owns execution.

| boundary | lives in | owns |
| --- | --- | --- |
| **Shell** | `desktop-shell/main.cjs`, `desktop-shell/preload.cjs`, `src/lib/native.ts` | runtime resolution + probe, gateway lifecycle, logs, filesystem, git, clipboard, dialogs, window title |
| **Renderer** | `src/desktop/**`, `src/lib/omp/state.ts` | routes, panes, transcripts, todos, diffs, settings, command palette, soft workspace switch |
| **Agent** | `src/lib/omp/engine.ts`, `src/lib/omp/recipes.ts`, `src/lib/omp/*` | the agent loop, tool execution, code intelligence, memory, subagent fan-out |

The renderer only ever talks to a `NativeBridge` (`src/lib/native.ts`). When no preload bridge is present, it falls back to the **bundled browser runtime** (`src/lib/omp/vfs.ts` + `evaluator.ts` + `shell.ts` + `lsp.ts`), which implements the same contract in-process — including a working JavaScript-subset evaluator so `bun test` in the terminal pane fails for a real reason and passes for a real reason.

### Runtime resolution order

Each candidate is probed before use, and a damaged bundled payload is **reported, never silently replaced** by whatever `omp` happens to be on `PATH`:

1. bundled payload (`resources/omp-runtime/bin/omp`, or `omp.exe` on Windows)
2. `OMP_DESKTOP_OMP` deployment override
3. `OMP_DESKTOP_OMP_ROOT` source-root override (TypeScript checkout, run through `bun`)
4. development checkout (`packages/coding-agent`)
5. an `omp` installed on `PATH` (npm/bun global install, Homebrew, release binary)
6. managed install (`~/.omp/agent/bin`)

Then capabilities are read straight from the session (`get_state`, `get_available_commands`, `get_available_models` — no websocket server is claimed, because omp's transport is stdio JSON lines) and the workspace is indexed. First run adds onboarding: pick a provider + model, a turn mode, and a default project folder.

### State ownership

* `src/lib/omp/state.ts` holds every atom: settings, projects, sessions, connections, boot state, UI state, diffs, notices, filesystem version.
* Agent events (`AgentEvent`) are reduced into the active session by `applyAgentEvent`; renderer effects (model changes, pane focus, attached diffs, stream-rule hits) are applied by `applyEffects`.
* A profile or connection switch is a **soft workspace change**: gateway-bound state is wiped and repopulated while the window and any running turn stay mounted.
* State persists to one versioned localStorage key (`src/lib/persist.ts`); the packaged shell writes the equivalent to `OMP_HOME`.

---

## The agent surface

**Tools** (`src/lib/omp/catalog.ts`): `read`, `write`, `edit`, `ast_edit`, `ast_grep`, `grep`, `glob`, `bash`, `eval`, `lsp`, `debug`, `security_scan`, `task`, `wait`, `todo`, `ask`, `browser`, `computer`, `web_search`, `github`, `generate_image`, `tts`, and the memory/skill set (`retain`, `recall`, `reflect`, `memory_edit`, `learn`, `manage_skill`, `checkpoint`, `rewind`). Gated tools stay discoverable behind `xd://`.

**Session controls** (49 in `SLASH_COMMANDS`, grouped models / review / workflow / session / jobs / resources / help): `/model`, `/login`, `/logout`, `/fast`, `/slow`, `/thinking`, `/vision`, `/review`, `/annotate`, `/advisor`, `/security`, `/plan`, `/plan-review`, `/vibe`, `/goal`, `/guided-goal`, `/loop`, `/collab`, `/fresh`, `/new`, `/compact`, `/shake`, `/resume`, `/fork`, `/tree`, `/handoff`, `/export`, `/share`, `/btw`, `/todo`, `/tools`, `/schemes`, `/context`, `/usage`, `/stats`, `/jobs`, `/agents`, `/hub`, `/memory`, `/skills`, `/mcp`, `/plugins`, `/marketplace`, `/extensions`, `/ssh`, `/dirs`, `/git`, `/hotkeys`, `/changelog`, `/help`.

**Magic keywords** (prose only, never inside code spans or fences): `ultrathink`, `orchestrate`, `workflowz`.

**Turn modes**: Plan and Vibe investigate and propose but never write (`planOnly` in the turn runtime); Agent writes; Auto writes without pausing.

**Hashline edits**: models point at `line:hash│` anchors instead of retyping lines. Anchors are verified before apply — a stale anchor rejects the patch and returns a recovery region (`src/lib/omp/hashline.ts`).

**Time-traveling stream rules**: a regex match aborts the stream mid-token, injects the rule body as a system reminder and retries from the same point. Armed rules ship with the app; hits are tracked in settings.

**Subagents**: `task` fans work out into isolated worktrees. Each worker keeps its own tool surface and transcript — open Agent Hub (`Alt+A`) to read a transcript, steer a worker, or kill a stuck one.

### Feature alignment with upstream `omp`

Settings → **Capabilities** renders the whole surface, and probes it live when the packaged shell is attached. Everything below is in `src/lib/omp/catalog.ts`:

| surface | count | where |
| --- | --- | --- |
| model providers (`PROVIDER_DIRECTORY`) | 62 | frontier APIs and gateways, subscription-routed coding plans, self-hosted servers |
| roles (`ROLE_SPECS`) | 9 | `default` `smol` `slow` `plan` `commit` `vision` `task` `advisor` `tiny`, each with its launch override |
| internal schemes (`SCHEME_SPECS`) | 19 | `pr://` `issue://` `agent://` `skill://` `ssh://` `conflict://` `xd://` `proc://` `memory://` `rule://` `artifact://` `attachment://` `cfg://` `history://` `mcp://` `omp://` `vault://` `security://` `local://` — each with what it resolves and whether it is writable |
| discovery providers (`DISCOVERY_PROVIDERS`) | 19 | native `.omp`, Claude, Codex, Gemini, OpenCode, Cursor MDC, Windsurf, Cline `.clinerules`, Copilot `applyTo`, `AGENTS.md` / `CLAUDE.md`, plugin marketplaces, MCP JSON, SSH config, built-in defaults — with priorities and the paths each one reads |
| entry points (`ENTRY_POINTS`) | 4 | interactive, one-shot `-p`, RPC over stdio, ACP |
| `web_search` backends (`SEARCH_BACKENDS`) | 27 | chained in rank order, handing URLs to `read` |
| core tools (`TOOL_SPECS`) | 30 | files & search, runtime, code intelligence, coordination, desktop & web, memory & skills — `xd://` carries the discoverable rest |
| memory backends | 3 | `local`, `hindsight`, `mnemopi` (project-scoped by default) |
| TTS voices | 5 | `ara` `eve` `leo` `rex` `sal` |

Upstream behaviours that shape the UI rather than the catalog: sticky `RULES.md` always-apply rules, time-traveling stream rules that abort a stream mid-token and survive compaction, hash-anchored `edit` with stale-anchor rejection, `ast_edit` staged behind `xd://resolve`, `conflict://N` with `@theirs`/`@ours`/`@base`, GitHub as a filesystem (`read pr://1428`), and `omp commit`'s atomic dependency-ordered splits.

---

## The bundled workspace

The browser runtime seeds a real two-folder project (`/work/pi-lab` plus the `/work/pi-web` repo) so every pane has something honest to show:

```
/work/pi-lab
├── AGENTS.md              repo rules the agent reads first (no assertion relaxing, anchored edits)
├── README.md              estimator table + commands
├── package.json           test / accuracy / typecheck scripts
├── docs/ACCURACY.md       measured error per estimator
├── scripts/accuracy.ts    comparison table printed by `bun run accuracy`
├── src/leibniz.ts         alternating-series estimator with a real sign defect
├── src/machin.ts          fast Machin-like estimator
├── src/format.ts          shared formatting (holds an unused import)
├── src/index.ts           CLI surface: estimatePi, report
└── test/*.test.ts         the suite that pins the acceptance window
```

### Try this first

```
the pi tests are failing, please fix them
```

The agent reproduces (`bun test` exits 1), probes convergence numerically at 100 and 200 terms, reads `src/leibniz.ts` with anchors, shows an advisor note, previews the patch, applies it as verified hashline hunks, re-runs the suite (exits 0), runs the accuracy script, re-checks diagnostics, and retains the lesson in project-scoped memory.

Other prompts worth running: `review the working tree`, `clean up lint warnings`, `commit the change`, `explain src/leibniz.ts`, `orchestrate: survey the project before I change anything`.

---

## Verification

```sh
bun tsc -b --noEmit        # renderer + engine
node --check desktop-shell/main.cjs
```

The browser runtime is exercised end-to-end by the same code the UI uses: `runTurn` with `runCommand` produces the suite output, `applyPatch` produces the diffs, and `diagnosticsFor` produces the diagnostics shown in the panes.

---

## What needs the packaged shell

The renderer states the boundary instead of faking output:

* `computer` — window enumeration, screenshots, native input, accessibility tree, clipboard
* `browser` — Puppeteer tabs, CDP-attached apps, the Chrome relay
* `debug` — attaching a real DAP adapter
* `/collab` — publishing the session to the omp relay and printing the QR
* `/login` — OAuth device flows for account-scoped providers

Everything else (`read`, `write`, `edit`, `grep`, `glob`, `bash`, `eval`, `lsp`, `task`, `todo`, `retain`, `recall`) runs against the live workspace in both hosts.

---

## Packaging

`desktop-shell/main.cjs` is an ordinary Electron entry point: it resolves the runtime, spawns the gateway, serves `dist/` over loopback (so `/app` deep links survive in a packaged app) and exposes the preload bridge. For installers, wire `electron-builder` with `resources/omp-runtime` as `extraResources` and build per platform the way Hermes Desktop does:

```sh
bun run desktop:dist      # NSIS + portable on Windows · AppImage/deb on Linux · dmg/zip on macOS
```

### Windows: installer + portable executable

Two artifacts come out of one run, both carrying the real upstream runtime:

| artifact | what it is |
| --- | --- |
| `Oh-My-Pi-Desktop-Setup-<version>-x64.exe` | NSIS installer — per-user install, desktop and start-menu shortcuts, uninstaller, optional install directory |
| `Oh-My-Pi-Desktop-Portable-<version>-x64.exe` | one self-contained file, no install, state in `%USERPROFILE%\.omp` |

They are produced by **`.github/workflows/desktop-windows.yml`**, a manual workflow
(`workflow_dispatch` on `windows-latest`) that:

1. fetches `omp-windows-x64.exe` from [`can1357/oh-my-pi` releases](https://github.com/can1357/oh-my-pi/releases) into `resources/omp-runtime/bin/`, verifying it against the release's `SHA256SUMS.txt` (`node scripts/fetch-omp-runtime.mjs win32-x64`),
2. typechecks, builds the renderer bundle, and packages both Windows targets,
3. boots the packaged app on the runner and runs the same self-test described below,
4. uploads the installers, the blockmap, and the unpacked app directory, and can publish a GitHub Release when the `release` input is ticked.

Run it from the Actions tab or:

```sh
gh workflow run desktop-windows.yml -f omp_version=latest -f release=true
```

Icons are generated from source by `bun run icons` (`scripts/make-icon.mjs`), which renders the tile at 4× and writes `build/icon.png` plus a multi-size `build/icon.ico` — no image toolchain required.

On Windows the resolver looks for `omp.exe` first: `resources/omp-runtime/bin/omp.exe`, then `OMP_DESKTOP_OMP`, then `OMP_DESKTOP_OMP_ROOT`, then a checkout, then whatever `omp` is on `PATH`, then `%USERPROFILE%\.omp\agent\bin`. Nothing needs WSL, and the target machine needs neither Bun nor Node.

Boot logs land in `~/.omp/logs/desktop.log` (both the Electron shell and the browser runtime write there via the settings → about panel).

---

## Credits

* **oh-my-pi (`omp`)** — Stencil Labs, fork of Pi by Mario Zechner. The agent, its tools and its surface.
* **Hermes Agent Desktop** — Nous Research. The architecture this shell follows: runtime resolution, panes, soft workspace switch, preview and settings model.
* MIT.
