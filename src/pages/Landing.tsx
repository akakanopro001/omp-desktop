import { Badge, Button } from "@/components/ui/primitives";
import {
  AGENT_MODES,
  ALL_MODELS,
  DISCOVERY_PROVIDERS,
  ENTRY_POINTS,
  INTERNAL_SCHEMES,
  MAGIC_KEYWORDS,
  PROVIDER_DIRECTORY,
  ROLE_SPECS,
  SCHEME_SPECS,
  SEARCH_BACKENDS,
  SLASH_COMMANDS,
  TOOL_SPECS,
} from "@/lib/omp/catalog";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Boxes,
  Braces,
  Bug,
  Command,
  Cpu,
  GitCompare,
  Globe,
  HardDrive,
  Layers,
  MemoryStick,
  Radio,
  ShieldCheck,
  Siren,
  Sparkles,
  Terminal,
  Users,
  Workflow,
  Zap,
} from "lucide-react";

const FEATURES = [
  {
    icon: Terminal,
    title: "A transcript that shows the work",
    body: "Streaming replies, live tool activity and structured tool summaries. Reads come back anchored, bash comes back with its real exit code, and every card stays clickable.",
  },
  {
    icon: Braces,
    title: "Hashline: edits by content hash",
    body: "The model points at anchors instead of retyping lines. Edit a stale file and the anchors diverge — the patch is rejected before it corrupts anything, with a recovery snippet attached.",
  },
  {
    icon: Bug,
    title: "LSP and DAP wired into every write",
    body: "Diagnostics, symbols, renames and code actions run against the files the agent is editing, and a real debugger session can attach in the packaged shell.",
  },
  {
    icon: Users,
    title: "Subagents with an Agent Hub",
    body: "task fans work out into isolated worktrees; each worker keeps its own tool surface. Read a worker's transcript, steer it, revive a parked sibling or kill a stuck one.",
  },
  {
    icon: Layers,
    title: "Projects, folders and worktrees",
    body: "A project owns folders, repos, worktrees and sessions. Bare chats stay detached until you enter a project. Switching profiles is a soft workspace change, not a cold boot.",
  },
  {
    icon: GitCompare,
    title: "Side-by-side preview and diff",
    body: "Preview a file with its line:hash anchors, read the unified diff of every patch, and keep the shell transcript open while the agent works.",
  },
  {
    icon: MemoryStick,
    title: "Memory the agent curates",
    body: "Facts are retained mid-run, recalled later, and compressed into a mental model that loads on the first turn. Project-scoped by default — local, Hindsight or Mnemopi.",
  },
  {
    icon: Globe,
    title: "Local runtime or remote gateway",
    body: "Run the bundled runtime, or point the window at a gateway over the network. The execution boundary moves with it; transport-managed headers are stripped per connection.",
  },
];

const ARCHITECTURE = [
  {
    tag: "boundary 01",
    title: "Shell",
    body: "Resolves a runnable runtime in order — bundled payload, deployment override, source override, dev checkout, managed install — and reports damage instead of adopting an arbitrary omp on PATH. Owns filesystem, git and window capability behind a narrow preload bridge.",
  },
  {
    tag: "boundary 02",
    title: "Renderer",
    body: "Owns the routes, panes, interaction state and the transcript. State lives in atoms, so a profile or connection switch wipes gateway-bound state and repopulates skeletons without cancelling a running turn.",
  },
  {
    tag: "boundary 03",
    title: "Agent",
    body: "omp runs as a headless process behind a JSON-RPC + WebSocket gateway: sessions, file browser, language services, subagent roster and memory all come from the same surface the terminal uses.",
  },
];

export function Landing() {
  return (
    <div className="min-h-full bg-background">
      <div className="relative">
        <div className="pointer-events-none absolute inset-0 grid-noise opacity-[0.35]" />
        <div className="pointer-events-none absolute inset-0 radial-ember" />

        <header className="relative mx-auto flex w-full max-w-6xl items-center gap-3 px-6 py-5">
          <span className="font-mono text-xl leading-none text-ember">π</span>
          <span className="text-sm font-semibold tracking-tight">Oh My Pi Desktop</span>
          <Badge tone="ember" className="ml-1">
            v0.1
          </Badge>
          <nav className="ml-auto hidden items-center gap-5 font-mono text-2xs uppercase tracking-[0.12em] text-muted-foreground md:flex">
            <a className="hover:text-foreground" href="#features">features</a>
            <a className="hover:text-foreground" href="#architecture">architecture</a>
            <a className="hover:text-foreground" href="#surface">surface</a>
            <a className="hover:text-foreground" href="#providers">providers</a>
          </nav>
          <Button asChild size="sm" className="ml-3">
            <Link to="/app">
              Open the desktop <ArrowRight className="size-3" />
            </Link>
          </Button>
        </header>

        <section className="relative mx-auto grid w-full max-w-6xl items-center gap-10 px-6 pb-16 pt-8 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="mono-label">
              desktop shell · oh-my-pi agent · hermes-desktop architecture
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.05 }}
              className="mt-3 text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl"
            >
              The coding agent with the IDE wired in,
              <span className="text-ember"> in a real window.</span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.12 }}
              className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground"
            >
              Oh My Pi Desktop wraps the <span className="font-mono text-foreground">omp</span> coding agent in a native shell: streaming transcript with
              live tool cards, hash-anchored edits, language servers on every write, a subagent roster you can steer, and a remote gateway when the
              work belongs on another machine.
            </motion.p>
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <Button asChild size="lg">
                <Link to="/app">
                  Launch the workspace <ArrowRight className="size-3.5" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <a href="#architecture">How it is put together</a>
              </Button>
            </div>
            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 font-mono text-2xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="size-3 text-ok" /> anchor-verified patches
              </span>
              <span className="flex items-center gap-1.5">
                <Cpu className="size-3 text-flux" /> {TOOL_SPECS.length} built-in tools · {INTERNAL_SCHEMES.length} schemes
              </span>
              <span className="flex items-center gap-1.5">
                <Radio className="size-3 text-ember" /> {PROVIDER_DIRECTORY.length} providers · {ALL_MODELS.length} models · {ROLE_SPECS.length} roles
              </span>
            </div>
          </div>

          <HeroWindow />
        </section>
      </div>

      <section id="features" className="border-t border-hairline px-6 py-16">
        <div className="mx-auto w-full max-w-6xl">
          <SectionHeading
            label="what lands on screen"
            title="Every pane earns its space"
            body="Nothing here is a mock: the transcript, the diff, the diagnostics and the shell output all come from the workspace the agent is editing."
          />
          <div className="mt-8 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {FEATURES.map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.35, delay: index * 0.04 }}
                className="group rounded-lg border border-hairline bg-panel/60 p-4 transition-colors hover:border-ember/40"
              >
                <feature.icon className="size-4 text-ember" />
                <h3 className="mt-3 text-sm font-medium tracking-tight">{feature.title}</h3>
                <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{feature.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section id="architecture" className="border-t border-hairline bg-panel/30 px-6 py-16">
        <div className="mx-auto w-full max-w-6xl">
          <SectionHeading
            label="three boundaries"
            title="Shell, renderer, agent — nothing leaks across"
            body="The same split Hermes Desktop uses, applied to the omp agent: the shell resolves the runtime, the renderer owns interaction state, the agent owns execution."
          />
          <div className="mt-8 grid gap-3 lg:grid-cols-3">
            {ARCHITECTURE.map((entry, index) => (
              <motion.div
                key={entry.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.35, delay: index * 0.06 }}
                className="rounded-lg border border-hairline bg-background/60 p-5"
              >
                <p className="mono-label">{entry.tag}</p>
                <h3 className="mt-2 text-base font-semibold tracking-tight">{entry.title}</h3>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{entry.body}</p>
              </motion.div>
            ))}
          </div>

          <div className="mt-3 rounded-lg border border-hairline bg-background/60 p-5">
            <p className="mono-label">runtime resolution order</p>
            <ol className="mt-3 grid gap-2 font-mono text-2xs text-muted-foreground md:grid-cols-3 lg:grid-cols-6">
              {["bundled payload", "deployment override", "source override", "dev checkout", "PATH install", "managed install"].map((step, index) => (
                <li key={step} className="rounded border border-hairline px-2.5 py-2">
                  <span className="text-ember">0{index + 1}</span>
                  <p className="mt-1 text-foreground">{step}</p>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              Each candidate is probed before use. A damaged bundled payload is reported, never silently replaced by an unrelated binary on PATH.
            </p>
          </div>
        </div>
      </section>

      <section id="surface" className="border-t border-hairline px-6 py-16">
        <div className="mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-2">
          <div>
            <SectionHeading
              label="agent surface"
              title="Batteries included, nothing bolted on"
              body="Tools live in the same namespace; rarely used ones stay discoverable behind xd://."
            />
            <div className="mt-5 flex flex-wrap gap-1.5">
              {TOOL_SPECS.map((spec) => (
                <span
                  key={spec.name}
                  title={spec.summary}
                  className="rounded border border-hairline bg-panel/60 px-2 py-1 font-mono text-2xs text-muted-foreground hover:border-ember/40 hover:text-ember"
                >
                  {spec.name}
                </span>
              ))}
            </div>
            <p className="mono-label mt-6">internal schemes</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SCHEME_SPECS.map((spec) => (
                <span key={spec.scheme} title={spec.detail} className="rounded border border-hairline px-2 py-0.5 font-mono text-2xs text-flux">
                  {spec.scheme}
                </span>
              ))}
            </div>
            <p className="mono-label mt-6">four entry points</p>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {ENTRY_POINTS.map((entry) => (
                <div key={entry.id} className="rounded border border-hairline bg-panel/50 px-3 py-2">
                  <span className="text-2xs text-foreground">{entry.name}</span>
                  <p className="mt-1 font-mono text-2xs text-ember">{entry.command}</p>
                  <p className="mt-1 text-2xs text-muted-foreground">{entry.detail}</p>
                </div>
              ))}
            </div>
            <p className="mono-label mt-6">inherits {DISCOVERY_PROVIDERS.length} config formats</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {DISCOVERY_PROVIDERS.slice(0, 12).map((provider) => (
                <span key={provider.id} title={provider.paths} className="rounded border border-hairline px-2 py-0.5 font-mono text-2xs text-muted-foreground">
                  {provider.id}
                </span>
              ))}
              <span className="px-1 font-mono text-2xs text-muted-foreground/70">+{DISCOVERY_PROVIDERS.length - 12} more</span>
            </div>
          </div>

          <div>
            <SectionHeading label="session controls" title="Prompts that change how a session runs" body="Slash commands and magic keywords, wired end to end." />
            <div className="mt-5 space-y-1.5">
              {SLASH_COMMANDS.slice(0, 6).map((command) => (
                <div key={command.command} className="flex items-start gap-3 rounded border border-hairline bg-panel/50 px-3 py-2">
                  <span className="w-24 shrink-0 font-mono text-2xs text-ember">{command.command}</span>
                  <span className="text-xs text-muted-foreground">{command.summary}</span>
                </div>
              ))}
              <p className="px-1 font-mono text-2xs text-muted-foreground/70">
                + {SLASH_COMMANDS.length - 6} more session controls, and {SEARCH_BACKENDS.length} web_search backends behind them
              </p>
            </div>
            <div className="mt-3 grid gap-1.5 sm:grid-cols-3">
              {MAGIC_KEYWORDS.map((keyword) => (
                <div key={keyword.keyword} className="rounded border border-warn/40 bg-warn/5 px-3 py-2">
                  <span className="flex items-center gap-1.5 font-mono text-2xs text-warn">
                    <Zap className="size-3" /> {keyword.keyword}
                  </span>
                  <p className="mt-1 text-2xs text-muted-foreground">{keyword.summary}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
              {AGENT_MODES.map((mode) => (
                <div key={mode.id} className="rounded border border-hairline px-3 py-2">
                  <span className="font-mono text-2xs text-foreground">{mode.name}</span>
                  <p className="mt-1 text-2xs text-muted-foreground">{mode.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="providers" className="border-t border-hairline bg-panel/30 px-6 py-16">
        <div className="mx-auto w-full max-w-6xl">
          <SectionHeading
            label="routing"
            title="Mix providers per role"
            body="Frontier APIs, coding plans and local servers in one catalog. Nine roles route work by intent — pick a cheap model for fan-out and a deep one for planning."
          />
          <div className="mt-8 space-y-4">
            {(["frontier", "coding-plan", "self-hosted"] as const).map((family) => {
              const providers = PROVIDER_DIRECTORY.filter((provider) => provider.family === family);
              return (
                <div key={family}>
                  <p className="mono-label">
                    {family === "frontier" ? "frontier APIs and gateways" : family === "coding-plan" ? "subscription-routed coding plans" : "run it yourself"}{" "}
                    <span className="text-muted-foreground/60">{providers.length}</span>
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {providers.map((provider) => (
                      <span
                        key={provider.id}
                        title={provider.note ? `${provider.auth} · ${provider.note}` : provider.auth}
                        className="flex items-center gap-1.5 rounded border border-hairline bg-background/60 px-2 py-1 text-2xs text-muted-foreground hover:border-ember/40 hover:text-foreground"
                      >
                        {provider.name}
                        <span className={cn(
                          "font-mono text-[10px]",
                          provider.auth === "local" ? "text-flux" : provider.auth === "plan" ? "text-warn" : "text-muted-foreground/60",
                        )}>
                          {provider.auth}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-6 grid gap-2 sm:grid-cols-3">
            {[
              { label: "roles", value: ROLE_SPECS.map((spec) => spec.name).join(" · ") },
              { label: "web_search backends", value: `${SEARCH_BACKENDS.length} chained in rank order` },
              { label: "model roles cycle", value: "Ctrl+P" },
            ].map((entry) => (
              <div key={entry.label} className="rounded-lg border border-hairline bg-background/60 px-4 py-3">
                <p className="mono-label">{entry.label}</p>
                <p className="mt-1 font-mono text-2xs text-muted-foreground">{entry.value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="windows" className="border-t border-hairline px-6 py-16">
        <div className="mx-auto w-full max-w-6xl">
          <SectionHeading
            label="windows build"
            title="An installer and a portable exe, built by hand, not by hope"
            body="Dispatch the workflow from the Actions tab and it packages the shell around the real omp release binary for Windows — no WSL, no bun on the target machine."
          />
          <div className="mt-8 grid gap-3 lg:grid-cols-[1fr_1fr_1.1fr]">
            {[
              {
                tag: "installer",
                name: "Oh-My-Pi-Desktop-Setup-<version>-x64.exe",
                body: "NSIS: per-user install, desktop and start-menu shortcuts, uninstaller, optional custom directory.",
              },
              {
                tag: "portable",
                name: "Oh-My-Pi-Desktop-Portable-<version>-x64.exe",
                body: "One file. Runs from anywhere, writes nothing to Program Files, keeps its state in %USERPROFILE%\.omp.",
              },
            ].map((artifact) => (
              <div key={artifact.tag} className="rounded-lg border border-hairline bg-panel/60 p-5">
                <p className="mono-label">{artifact.tag}</p>
                <p className="mt-2 break-all font-mono text-2xs text-ember">{artifact.name}</p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{artifact.body}</p>
              </div>
            ))}
            <div className="rounded-lg border border-hairline bg-background/60 p-5">
              <p className="mono-label">what the runner does</p>
              <ol className="mt-2 space-y-1.5 text-xs leading-5 text-muted-foreground">
                <li>
                  <span className="font-mono text-ember">01</span> fetches omp-windows-x64.exe and verifies it against the release's SHA256SUMS.txt
                </li>
                <li>
                  <span className="font-mono text-ember">02</span> typechecks, builds the renderer bundle, and packages both windows targets
                </li>
                <li>
                  <span className="font-mono text-ember">03</span> boots the packaged app on the runner and runs its self-test (runtime resolve → RPC handshake → one-shot → DOM)
                </li>
                <li>
                  <span className="font-mono text-ember">04</span> uploads the installers plus the unpacked app, and can publish a release in one tick
                </li>
              </ol>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <a href="https://github.com/akanopro001/omp-desktop/actions/workflows/desktop-windows.yml" target="_blank" rel="noreferrer">
                    Open the workflow <ArrowRight className="size-3" />
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a href="https://github.com/akanopro001/omp-desktop/releases" target="_blank" rel="noreferrer">
                    Releases
                  </a>
                </Button>
              </div>
            </div>
          </div>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            The shell resolves <span className="font-mono text-foreground">resources/omp-runtime/bin/omp.exe</span> first, then an explicit override, then a
            checkout, then whatever <span className="font-mono text-foreground">omp</span> is on PATH — and reports a damaged payload instead of quietly
            substituting another runtime.
          </p>
        </div>
      </section>

      <section className="border-t border-hairline px-6 py-16">
        <div className="mx-auto grid w-full max-w-6xl gap-8 lg:grid-cols-[1.2fr_1fr]">
          <div className="rounded-xl border border-hairline bg-panel/60 p-7">
            <p className="mono-label">get started</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">Two ways in: the workspace here, or the packaged shell.</h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
              The workspace in this window runs the bundled runtime — the same panes, the same tool cards, the same anchored edits. Build the packaged
              app for real filesystem, git and debugger capability with{" "}
              <span className="font-mono text-foreground">bun run desktop:dev</span>.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button asChild size="lg">
                <Link to="/app">
                  Launch the workspace <ArrowRight className="size-3.5" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <a href="https://omp.sh/docs" target="_blank" rel="noreferrer">
                  omp documentation
                </a>
              </Button>
            </div>
            <div className="mt-6 grid gap-2 sm:grid-cols-3">
              {[
                { icon: HardDrive, label: "bundled runtime", value: "omp release binary" },
                { icon: Workflow, label: "gateway", value: "rpc v1/v2 · one-shot" },
                { icon: Command, label: "palette", value: "⌘K" },
              ].map((entry) => (
                <div key={entry.label} className="rounded border border-hairline px-3 py-2">
                  <entry.icon className="size-3.5 text-ember" />
                  <p className="mt-1 mono-label">{entry.label}</p>
                  <p className="font-mono text-2xs text-foreground">{entry.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-lg border border-hairline bg-background/60 p-5">
              <span className="flex items-center gap-2 font-mono text-2xs text-warn">
                <Siren className="size-3" /> honest about the boundary
              </span>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Host desktop control, the browser relay, the collab relay and DAP attachment need the packaged shell. The UI says so when you ask for
                them instead of faking output — and the browser runtime still runs the tests, the edits and the language servers for real.
              </p>
            </div>
            <div className="rounded-lg border border-hairline bg-background/60 p-5">
              <span className="flex items-center gap-2 font-mono text-2xs text-flux">
                <Sparkles className="size-3" /> try this first
              </span>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Type <span className="font-mono text-foreground">the pi tests are failing, please fix them</span>. The agent reproduces the failure,
                probes convergence numerically, proposes an anchored patch, applies it, and re-runs the suite — failing for a real reason, passing for
                a real reason.
              </p>
            </div>
            <div className="rounded-lg border border-hairline bg-background/60 p-5">
              <span className="flex items-center gap-2 font-mono text-2xs text-ok">
                <Boxes className="size-3" /> architecture credit
              </span>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                The shell/renderer/agent split, runtime resolution ladder and soft workspace switch follow Hermes Agent Desktop. The agent surface is
                oh-my-pi (<span className="font-mono">omp</span>) by Stencil Labs, built on Pi.
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-hairline px-6 py-8">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 font-mono text-2xs text-muted-foreground">
          <span className="text-ember">π</span>
          <span>Oh My Pi Desktop · MIT</span>
          <span className="ml-auto flex items-center gap-4">
            <span>hermes-desktop architecture</span>
            <span>omp agent surface</span>
            <span>{TOOL_SPECS.length} tools</span>
          </span>
        </div>
      </footer>
    </div>
  );
}

function SectionHeading({ label, title, body }: { label: string; title: string; body: string }) {
  return (
    <div className="max-w-2xl">
      <p className="mono-label">{label}</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  );
}

function HeroWindow() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.15 }}
      className="overflow-hidden rounded-xl border border-hairline bg-panel shadow-2xl"
    >
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
        <span className="size-2.5 rounded-full bg-[#ff5f57]" />
        <span className="size-2.5 rounded-full bg-[#febc2e]" />
        <span className="size-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-2 font-mono text-2xs text-muted-foreground">Fix leibniz convergence — OMP Desktop</span>
        <Badge tone="ok" className="ml-auto">
          shell · rpc
        </Badge>
      </div>
      <div className="grid grid-cols-[92px_1fr] divide-x divide-[hsl(var(--hairline))]">
        <div className="space-y-1.5 p-2">
          {["sessions", "projects", "files"].map((entry, index) => (
            <div key={entry} className={`rounded px-1.5 py-1 font-mono text-2xs ${index === 0 ? "bg-secondary/70 text-foreground" : "text-muted-foreground"}`}>
              {entry}
            </div>
          ))}
          <div className="mt-3 space-y-1">
            {["Fix leibniz", "Review fast path", "Accuracy notes"].map((entry, index) => (
              <div key={entry} className={`truncate rounded px-1.5 py-1 font-mono text-2xs ${index === 0 ? "bg-ember/10 text-ember" : "text-muted-foreground/80"}`}>
                {entry}
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-2 p-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-2xs text-ember">π</span>
            <span className="font-mono text-2xs text-muted-foreground">opus-4.6-1m</span>
            <Badge tone="muted">agent</Badge>
            <span className="ml-auto font-mono text-2xs text-muted-foreground/60">$0.03</span>
          </div>
          <div className="rounded border border-hairline px-2 py-1.5">
            <span className="flex items-center gap-1.5 font-mono text-2xs text-muted-foreground">
              <span className="size-2.5 rounded-full border border-ok/50 bg-ok/20" /> bash <span className="text-foreground">bun test</span>
            </span>
            <pre className="mt-1 whitespace-pre-wrap font-mono text-[10px] leading-4 text-destructive/90">
              ✗ leibnizPi converges within 1e-5 over 1e6 terms
            </pre>
          </div>
          <div className="rounded border border-hairline px-2 py-1.5">
            <span className="flex items-center gap-1.5 font-mono text-2xs text-muted-foreground">
              <span className="size-2.5 rounded-full border border-ok/50 bg-ok/20" /> edit
              <span className="text-foreground">src/leibniz.ts</span>
            </span>
            <div className="mt-1 font-mono text-[10px] leading-4">
              <p className="text-muted-foreground">{"12:8c31a2│  for (let i = 0; i < terms; i += 1) {"}</p>
              <p className="text-destructive">-   sum += 1 / (2 * i + 1);</p>
              <p className="text-ok">+   const sign = i % 2 === 0 ? 1 : -1;</p>
              <p className="text-ok">+   sum += (sign * 1) / (2 * i + 1);</p>
            </div>
          </div>
          <div className="rounded border border-warn/40 bg-warn/5 px-2 py-1.5">
            <span className="font-mono text-2xs text-warn">advisor · concern</span>
            <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
              The acceptance criterion is 1e-5 over 1e6 terms; the alternating rewrite lands at ~1e-6. Do not raise the tolerance.
            </p>
          </div>
          <div className="rounded border border-hairline px-2 py-1.5">
            <span className="flex items-center gap-1.5 font-mono text-2xs text-muted-foreground">
              <span className="size-2.5 rounded-full border border-ok/50 bg-ok/20" /> bash <span className="text-foreground">bun test</span>
              <span className="ml-auto text-ok">exit 0</span>
            </span>
            <pre className="mt-1 whitespace-pre-wrap font-mono text-[10px] leading-4 text-ok">6 pass · 6 expect() calls</pre>
          </div>
          <div className="flex items-center gap-1.5 rounded border border-hairline px-2 py-1.5">
            <Users className="size-3 text-flux" />
            <span className="font-mono text-2xs text-muted-foreground">2 subagents · CorrectnessReview + TestsAudit</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
