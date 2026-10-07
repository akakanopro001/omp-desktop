import { Badge, Button, Input, Label, Row, Separator, Switch, Textarea } from "@/components/ui/primitives";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DISCOVERY_PROVIDERS,
  ENTRY_POINTS,
  GATED_TOOL_NOTE,
  MAGIC_KEYWORDS,
  MEMORY_BACKENDS,
  PROVIDER_DIRECTORY,
  PROVIDERS,
  ROLE_SPECS,
  SCHEME_SPECS,
  SEARCH_BACKENDS,
  SKILLS,
  STICKY_RULES_NOTE,
  TOOL_SPECS,
  TTS_VOICES,
} from "@/lib/omp/catalog";
import { DEFAULT_ROLE_MODELS } from "@/lib/omp/catalog";
import type { ConnectionProfile, DesktopSettings, ProviderApi } from "@/lib/omp/protocol";

import { addConnection, bridge, capabilitiesFor, clearDesktopState, notify, removeConnection, settings, ui, useDesktop, workspace } from "@/lib/omp/state";
import { hasShell, type OneShotResult, type RuntimeEntryPoint } from "@/lib/native";
import { cn } from "./format";
import { Check, KeyRound, PlugZap, RotateCcw, ShieldCheck, Sparkles, Terminal, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

const SECTIONS = [
  { id: "providers", label: "Providers & models" },
  { id: "connections", label: "Connections" },
  { id: "capabilities", label: "Capabilities" },
  { id: "tools", label: "Tools & permissions" },
  { id: "skills", label: "Skills" },
  { id: "rules", label: "Stream rules" },
  { id: "memory", label: "Memory" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "appearance", label: "Appearance" },
  { id: "about", label: "About & boot log" },
] as const;

export function SettingsOverlay() {
  const desktop = useDesktop();
  const section = desktop.ui.settingsSection;

  return (
    <Dialog open={desktop.ui.settingsOpen} onOpenChange={(open) => ui.set((prev) => ({ ...prev, settingsOpen: open }))}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Desktop settings</DialogTitle>
          <DialogDescription>
            Stored by the shell, never rendered back into a transcript. Profiles and connection modes switch as a soft workspace change — the window and the current turn stay mounted.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-[430px]">
          <nav className="w-[204px] shrink-0 border-r border-hairline p-2">
            {SECTIONS.map((entry) => (
              <button
                key={entry.id}
                onClick={() => ui.set((prev) => ({ ...prev, settingsSection: entry.id }))}
                className={cn(
                  "mb-0.5 block w-full rounded px-2 py-1.5 text-left text-2xs transition-colors",
                  section === entry.id ? "bg-secondary/70 text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {entry.label}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-auto">
            {section === "providers" && <ProvidersSection />}
            {section === "connections" && <ConnectionsSection />}
            {section === "capabilities" && <CapabilitiesSection />}
            {section === "tools" && <ToolsSection />}
            {section === "skills" && <SkillsSection />}
            {section === "rules" && <RulesSection />}
            {section === "memory" && <MemorySection />}
            {section === "shortcuts" && <ShortcutsSection />}
            {section === "appearance" && <AppearanceSection />}
            {section === "about" && <AboutSection />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProvidersSection() {
  const desktop = useDesktop();
  const [draft, setDraft] = useState({ id: "", baseUrl: "", api: "openai-completions" as ProviderApi, models: "" });

  return (
    <div>
      <div className="border-b border-hairline px-4 py-3">
        <p className="text-xs text-foreground">Sixty-plus providers, one role away.</p>
        <p className="mt-1 text-2xs text-muted-foreground">
          Nine roles route work by intent: default, smol, slow, plan, commit, vision, task, advisor, tiny. Cycle models per role with{" "}
          <span className="font-mono text-ember">Ctrl+P</span>, or assign one below.
        </p>
      </div>

      <div className="border-b border-hairline px-4 py-3">
        <p className="mono-label">model roles</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {Object.entries(desktop.settings.modelRoles).map(([role, selector]) => (
            <div key={role} className="flex items-center gap-2 rounded border border-hairline px-2 py-1.5">
              <span className="w-16 shrink-0 font-mono text-2xs text-ember">{role}</span>
              <select
                value={selector ?? ""}
                onChange={(event) =>
                  settings.set((prev) => ({ ...prev, modelRoles: { ...prev.modelRoles, [role]: event.target.value } }))
                }
                className="min-w-0 flex-1 rounded border border-hairline bg-background px-1.5 py-1 font-mono text-2xs text-foreground outline-none"
              >
                {PROVIDERS.flatMap((provider) => provider.models).map((model) => (
                  <option key={model.selector} value={model.selector}>
                    {model.selector}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      <div className="px-4 py-3">
        <p className="mono-label">providers</p>
        <div className="mt-2 space-y-1.5">
          {PROVIDERS.map((provider) => {
            const key = desktop.settings.providerKeys.find((entry) => entry.providerId === provider.id);
            return (
              <div key={provider.id} className="flex items-center gap-2 rounded border border-hairline px-2.5 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs text-foreground">{provider.name}</span>
                    <Badge tone={provider.category === "local" ? "flux" : provider.category === "coding-plan" ? "warn" : "muted"}>{provider.auth}</Badge>
                    {provider.category === "local" && <span className="font-mono text-2xs text-muted-foreground/70">{provider.baseUrl}</span>}
                  </div>
                  <p className="mt-0.5 font-mono text-2xs text-muted-foreground/70">
                    {provider.models.length} model(s) · {provider.api}
                    {provider.envVar ? ` · ${provider.envVar}` : ""}
                  </p>
                </div>
                {provider.auth === "api-key" ? (
                  <Button
                    variant={key?.stored ? "outline" : "secondary"}
                    size="sm"
                    onClick={() => {
                      settings.set((prev) => {
                        const exists = prev.providerKeys.some((entry) => entry.providerId === provider.id);
                        return {
                          ...prev,
                          providerKeys: exists
                            ? prev.providerKeys.map((entry) =>
                                entry.providerId === provider.id ? { ...entry, stored: !entry.stored, lastUsedAt: Date.now() } : entry,
                              )
                            : [...prev.providerKeys, { providerId: provider.id, stored: true, lastUsedAt: Date.now() }],
                        };
                      });
                    }}
                  >
                    <KeyRound className="size-3" />
                    {key?.stored ? "key stored" : "store key"}
                  </Button>
                ) : provider.auth === "none" ? (
                  <Badge tone="muted">no key</Badge>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => notify(`Device flow started for ${provider.name}`, "info")}>
                    <PlugZap className="size-3" /> {provider.auth === "oauth" ? "sign in" : "attach plan"}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-2xs text-muted-foreground/70">
          Key values live in the shell keychain. This pane only records that a key exists — a transcript can never echo one back.
        </p>
      </div>

      <div className="border-t border-hairline px-4 py-3">
        <p className="mono-label">custom openai-compatible provider</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Input placeholder="id (spark)" value={draft.id} onChange={(event) => setDraft((prev) => ({ ...prev, id: event.target.value }))} />
          <Input placeholder="baseUrl" value={draft.baseUrl} onChange={(event) => setDraft((prev) => ({ ...prev, baseUrl: event.target.value }))} />
          <select
            value={draft.api}
            onChange={(event) => setDraft((prev) => ({ ...prev, api: event.target.value as ProviderApi }))}
            className="h-8 rounded border border-hairline bg-background px-2 font-mono text-2xs text-foreground outline-none"
          >
            {["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai", "azure-openai-responses", "bedrock-converse-stream", "typesafe"].map(
              (api) => (
                <option key={api} value={api}>
                  {api}
                </option>
              ),
            )}
          </select>
          <Input placeholder="models (comma separated)" value={draft.models} onChange={(event) => setDraft((prev) => ({ ...prev, models: event.target.value }))} />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => {
              if (!draft.id || !draft.baseUrl) return;
              settings.set((prev) => ({
                ...prev,
                customProviders: [
                  ...prev.customProviders,
                  { id: draft.id, baseUrl: draft.baseUrl, api: draft.api, models: draft.models.split(",").map((entry) => entry.trim()).filter(Boolean) },
                ],
              }));
              notify(`Provider ${draft.id} written to models.yml`, "ok");
              setDraft({ id: "", baseUrl: "", api: "openai-completions", models: "" });
            }}
          >
            add provider
          </Button>
          <span className="font-mono text-2xs text-muted-foreground/70">
            {desktop.settings.customProviders.length} custom · written to ~/.omp/agent/models.yml
          </span>
        </div>
      </div>
    </div>
  );
}

function ConnectionsSection() {
  const desktop = useDesktop();
  const [draft, setDraft] = useState({ name: "", url: "https://", mode: "remote" as ConnectionProfile["mode"], authMode: "token" as ConnectionProfile["authMode"] });

  return (
    <div>
      <div className="border-b border-hairline px-4 py-3">
        <p className="text-xs text-foreground">Local runtime, remote gateway, or cloud — same renderer, different execution boundary.</p>
        <p className="mt-1 text-2xs text-muted-foreground">
          In remote mode the gateway host runs the tools: terminal commands and file operations land there, not on this computer. Transport-managed
          headers (Authorization, Cookie, Host, Origin, Referer, X-Hermes-Session-Token) are stripped before any per-connection header is applied.
        </p>
      </div>

      {desktop.connections.map((connection) => {
        const capabilities = capabilitiesFor(connection);
        return (
          <div key={connection.id} className="border-b border-hairline px-4 py-3">
            <div className="flex items-center gap-2">
              <span className={cn("size-1.5 rounded-full", connection.mode === "local" ? "bg-ok" : "bg-flux")} />
              <span className="text-xs text-foreground">{connection.name}</span>
              <Badge tone={connection.mode === "local" ? "ok" : "flux"}>{connection.mode}</Badge>
              {connection.id === desktop.activeConnectionId && <Badge tone="ember">active</Badge>}
              <div className="ml-auto flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const probed = await bridge.probeGateway(connection);
                    notify(`${connection.name}: rpc ${probed.rpc ? "ok" : "failed"} · ws ${probed.websocket ? "ok" : "failed"} · auth ${probed.auth}`, probed.rpc ? "ok" : "danger");
                  }}
                >
                  test
                </Button>
                {connection.mode !== "local" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      removeConnection(connection.id);
                      notify(`${connection.name} removed`, "warn");
                    }}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                )}
              </div>
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-2xs text-muted-foreground">
              <span>url {connection.url ?? "—"}</span>
              <span>auth {connection.authMode}{connection.tokenStored ? " · token stored" : ""}</span>
              <span>gateway {connection.gatewayVersion ?? "unknown"}</span>
              <span>latency {connection.lastLatencyMs !== undefined ? `${connection.lastLatencyMs}ms` : "—"}</span>
              {(connection.headers ?? []).map((header) => (
                <span key={header.name}>header {header.name}: stored</span>
              ))}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {Object.entries(capabilities)
                .filter(([key]) => key !== "auth")
                .map(([key, value]) => (
                  <Badge key={key} tone={value ? "ok" : "muted"}>
                    {key} {value ? "✓" : "—"}
                  </Badge>
                ))}
            </div>
          </div>
        );
      })}

      <div className="px-4 py-3">
        <p className="mono-label">add connection</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Input placeholder="name" value={draft.name} onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))} />
          <Input placeholder="https://gateway:7878" value={draft.url} onChange={(event) => setDraft((prev) => ({ ...prev, url: event.target.value }))} />
          <select
            value={draft.mode}
            onChange={(event) => setDraft((prev) => ({ ...prev, mode: event.target.value as ConnectionProfile["mode"] }))}
            className="h-8 rounded border border-hairline bg-background px-2 font-mono text-2xs text-foreground outline-none"
          >
            {["remote", "cloud", "local"].map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
          <select
            value={draft.authMode}
            onChange={(event) => setDraft((prev) => ({ ...prev, authMode: event.target.value as ConnectionProfile["authMode"] }))}
            className="h-8 rounded border border-hairline bg-background px-2 font-mono text-2xs text-foreground outline-none"
          >
            {["token", "oauth", "none"].map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </div>
        <Button
          className="mt-2"
          size="sm"
          onClick={() => {
            if (!draft.name.trim() || !draft.url.trim()) return;
            const connection: ConnectionProfile = {
              id: `conn_${Date.now().toString(36)}`,
              name: draft.name.trim(),
              mode: draft.mode,
              url: draft.url.trim(),
              authMode: draft.authMode,
              tokenStored: draft.authMode === "token",
              createdAt: Date.now(),
              capabilities: capabilitiesFor({ id: "probe", name: "", mode: draft.mode, authMode: draft.authMode, createdAt: Date.now() }),
            };
            addConnection(connection);
            notify(`Connection ${connection.name} saved`, "ok");
            setDraft({ name: "", url: "https://", mode: "remote", authMode: "token" });
          }}
        >
          save connection
        </Button>
      </div>
    </div>
  );
}

function ToolsSection() {
  const desktop = useDesktop();
  return (
    <div>
      <div className="border-b border-hairline px-4 py-3">
        <p className="text-xs text-foreground">Pin the active set, gate the destructive ones.</p>
        <p className="mt-1 text-2xs text-muted-foreground">
          Gated tools pause for a single approval instead of prompting on every call. Gated-and-off tools stay discoverable behind{" "}
          <span className="font-mono text-ember">read xd://</span>.
        </p>
      </div>
      <div className="px-4 py-3">
        {["files", "runtime", "intelligence", "coordination", "desktop", "memory"].map((group) => (
          <div key={group} className="mb-3">
            <p className="mono-label">{group}</p>
            {TOOL_SPECS.filter((spec) => spec.group === group).map((spec) => {
              const gate = desktop.settings.tools[spec.name] ?? { enabled: true, requiresApproval: false };
              return (
                <div key={spec.name} className="flex items-start gap-3 border-b border-hairline/60 py-2 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-2xs text-ember">{spec.name}</span>
                      {spec.destructive && <Badge tone="danger">destructive</Badge>}
                      {spec.gated && <Badge tone="warn">gated</Badge>}
                    </div>
                    <p className="mt-0.5 text-2xs text-muted-foreground">{spec.summary}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <label className="flex items-center gap-1.5">
                      <span className="font-mono text-2xs text-muted-foreground">enabled</span>
                      <Switch
                        checked={gate.enabled}
                        onCheckedChange={(checked) =>
                          settings.set((prev) => ({ ...prev, tools: { ...prev.tools, [spec.name]: { ...gate, enabled: checked } } }))
                        }
                      />
                    </label>
                    <label className="flex items-center gap-1.5">
                      <span className="font-mono text-2xs text-muted-foreground">approval</span>
                      <Switch
                        checked={gate.requiresApproval}
                        onCheckedChange={(checked) =>
                          settings.set((prev) => ({ ...prev, tools: { ...prev.tools, [spec.name]: { ...gate, requiresApproval: checked } } }))
                        }
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function SkillsSection() {
  return (
    <div>
      <div className="border-b border-hairline px-4 py-3">
        <p className="text-xs text-foreground">Skills the agent has learned or manages.</p>
        <p className="mt-1 text-2xs text-muted-foreground">Project-scoped by default: what it learns about this repo stays with this repo.</p>
      </div>
      {SKILLS.map((skill) => (
        <Row key={skill.id}>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-2xs text-ember">{skill.name}</span>
              <Badge tone={skill.source === "managed" ? "ember" : skill.source === "learned" ? "flux" : "muted"}>{skill.source}</Badge>
            </div>
            <p className="mt-0.5 text-2xs text-muted-foreground">{skill.summary}</p>
          </div>
          <span className="shrink-0 font-mono text-2xs text-muted-foreground/70">{skill.uses} uses</span>
        </Row>
      ))}
    </div>
  );
}

function RulesSection() {
  const desktop = useDesktop();
  return (
    <div>
      <div className="border-b border-hairline px-4 py-3">
        <p className="text-xs text-foreground">Time-traveling stream rules.</p>
        <p className="mt-1 text-2xs text-muted-foreground">
          Rules sit dormant until the model goes off-script. A regex match aborts the stream mid-token, injects the rule as a system reminder, and
          retries from the same point — no context tax on every turn. Injections survive compaction.
        </p>
      </div>
      {desktop.settings.streamRules.map((rule) => (
        <div key={rule.id} className="border-b border-hairline px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-2xs text-foreground">{rule.name}</span>
            <Badge tone={rule.enabled ? "ok" : "muted"}>{rule.enabled ? "armed" : "dormant"}</Badge>
            <span className="font-mono text-2xs text-muted-foreground/70">{rule.hits ?? 0} injection(s)</span>
            <Switch
              className="ml-auto"
              checked={rule.enabled}
              onCheckedChange={(checked) =>
                settings.set((prev) => ({ ...prev, streamRules: prev.streamRules.map((entry) => (entry.id === rule.id ? { ...entry, enabled: checked } : entry)) }))
              }
            />
          </div>
          <pre className="mt-1.5 overflow-auto rounded border border-hairline bg-secondary/30 px-2 py-1 font-mono text-2xs text-flux">/{rule.pattern}/</pre>
          <p className="mt-1 text-2xs text-muted-foreground">{rule.body}</p>
        </div>
      ))}
    </div>
  );
}

function MemorySection() {
  const desktop = useDesktop();
  const facts = desktop.session?.memoryFacts ?? [];
  return (
    <div>
      <div className="border-b border-hairline px-4 py-3">
        <p className="text-xs text-foreground">Memory the agent curates.</p>
        <p className="mt-1 text-2xs text-muted-foreground">
          Facts are written mid-run with retain, pulled back with recall, and compressed into a mental model that loads on the first turn of the
          next session.
        </p>
      </div>
      <div className="px-4 py-3">
        <Label>backend</Label>
        <div className="mt-1.5 space-y-1.5">
          {MEMORY_BACKENDS.map((backend) => (
            <button
              key={backend.id}
              onClick={() => settings.set((prev) => ({ ...prev, memory: { ...prev.memory, backend: backend.id as DesktopSettings["memory"]["backend"] } }))}
              className={cn(
                "flex w-full items-center gap-2 rounded border px-2.5 py-2 text-left",
                desktop.settings.memory.backend === backend.id ? "border-ember/40 bg-ember/5" : "border-hairline hover:bg-secondary/40",
              )}
            >
              <div className="min-w-0 flex-1">
                <span className="font-mono text-2xs text-foreground">{backend.name}</span>
                <p className="text-2xs text-muted-foreground">{backend.detail}</p>
              </div>
              {desktop.settings.memory.backend === backend.id && <Check className="size-3.5 text-ember" />}
            </button>
          ))}
        </div>
        <div className="mt-3 space-y-2">
          <Row className="px-0">
            <div>
              <p className="text-xs text-foreground">Project scope</p>
              <p className="text-2xs text-muted-foreground">Keep what is learned about this repo inside this repo.</p>
            </div>
            <Switch
              checked={desktop.settings.memory.projectScoped}
              onCheckedChange={(checked) => settings.set((prev) => ({ ...prev, memory: { ...prev.memory, projectScoped: checked } }))}
            />
          </Row>
          <Row className="px-0">
            <div>
              <p className="text-xs text-foreground">Autoload mental model</p>
              <p className="text-2xs text-muted-foreground">Load the compressed summary on the first turn of a new session.</p>
            </div>
            <Switch
              checked={desktop.settings.memory.autoload}
              onCheckedChange={(checked) => settings.set((prev) => ({ ...prev, memory: { ...prev.memory, autoload: checked } }))}
            />
          </Row>
        </div>
        <Separator className="my-3" />
        <Label>facts in this session ({facts.length})</Label>
        <ul className="mt-1.5 space-y-1">
          {facts.map((fact) => (
            <li key={fact} className="text-2xs text-foreground/90">
              · {fact}
            </li>
          ))}
          {facts.length === 0 && <li className="text-2xs text-muted-foreground">Nothing retained yet.</li>}
        </ul>
      </div>
    </div>
  );
}

function ShortcutsSection() {
  const desktop = useDesktop();
  return (
    <div>
      <div className="border-b border-hairline px-4 py-3">
        <p className="text-xs text-foreground">Keyboard behaviour</p>
        <p className="mt-1 text-2xs text-muted-foreground">Bindings are per-machine and live in the shell config, not in the repo.</p>
      </div>
      {Object.entries(desktop.settings.shortcuts).map(([action, binding]) => (
        <Row key={action}>
          <span className="font-mono text-2xs text-foreground">{action}</span>
          <kbd className="rounded border border-hairline bg-secondary/60 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">{binding}</kbd>
        </Row>
      ))}
    </div>
  );
}

function AppearanceSection() {
  const desktop = useDesktop();
  return (
    <div className="px-4 py-3">
      <Row className="px-0">
        <div>
          <p className="text-xs text-foreground">Theme</p>
          <p className="text-2xs text-muted-foreground">Dark chrome keeps long transcripts low-glare.</p>
        </div>
        <div className="flex items-center gap-1.5">
          {(["dark", "light"] as const).map((theme) => (
            <Button
              key={theme}
              variant={desktop.settings.theme === theme ? "default" : "outline"}
              size="sm"
              onClick={() => {
                settings.set((prev) => ({ ...prev, theme }));
                document.documentElement.classList.toggle("dark", theme === "dark");
              }}
            >
              {theme}
            </Button>
          ))}
        </div>
      </Row>
      <Row className="px-0">
        <div>
          <p className="text-xs text-foreground">Density</p>
          <p className="text-2xs text-muted-foreground">Compact fits more tool cards on screen.</p>
        </div>
        <div className="flex items-center gap-1.5">
          {(["compact", "comfortable"] as const).map((density) => (
            <Button
              key={density}
              variant={desktop.settings.density === density ? "default" : "outline"}
              size="sm"
              onClick={() => settings.set((prev) => ({ ...prev, density }))}
            >
              {density}
            </Button>
          ))}
        </div>
      </Row>
      <Row className="px-0">
        <div>
          <p className="text-xs text-foreground">Stream speed</p>
          <p className="text-2xs text-muted-foreground">Instant resolves every event without animation delay.</p>
        </div>
        <div className="flex items-center gap-1.5">
          {(["instant", "fast", "normal"] as const).map((speed) => (
            <Button
              key={speed}
              variant={desktop.settings.streamSpeed === speed ? "default" : "outline"}
              size="sm"
              onClick={() => settings.set((prev) => ({ ...prev, streamSpeed: speed }))}
            >
              {speed}
            </Button>
          ))}
        </div>
      </Row>
      <Row className="px-0">
        <div>
          <p className="text-xs text-foreground">Transcript font size</p>
          <p className="text-2xs text-muted-foreground">{desktop.settings.transcriptFontSize.toFixed(1)}px</p>
        </div>
        <input
          type="range"
          min={11}
          max={17}
          step={0.5}
          value={desktop.settings.transcriptFontSize}
          onChange={(event) => settings.set((prev) => ({ ...prev, transcriptFontSize: Number(event.target.value) }))}
          className="w-40 accent-[hsl(var(--ember))]"
        />
      </Row>
      <Row className="px-0">
        <div>
          <p className="text-xs text-foreground">Advisor reviewer</p>
          <p className="text-2xs text-muted-foreground">Pair a reviewer model that reads every turn and injects notes inline.</p>
        </div>
        <Switch
          checked={desktop.settings.advisor.enabled}
          onCheckedChange={(checked) => settings.set((prev) => ({ ...prev, advisor: { ...prev.advisor, enabled: checked } }))}
        />
      </Row>
      <Row className="px-0">
        <div>
          <p className="text-xs text-foreground">Auto-compact</p>
          <p className="text-2xs text-muted-foreground">Collapse long transcripts into the mental model automatically.</p>
        </div>
        <Switch checked={desktop.settings.autoCompact} onCheckedChange={(checked) => settings.set((prev) => ({ ...prev, autoCompact: checked }))} />
      </Row>
      <Row className="px-0">
        <div>
          <p className="text-xs text-foreground">Browser relay</p>
          <p className="text-2xs text-muted-foreground">Adopt Chrome tabs you already have open without stealing focus.</p>
        </div>
        <Switch checked={desktop.settings.browserRelay} onCheckedChange={(checked) => settings.set((prev) => ({ ...prev, browserRelay: checked }))} />
      </Row>
    </div>
  );
}

function AboutSection() {
  const desktop = useDesktop();
  return (
    <div className="px-4 py-3">
      <div className="rounded border border-hairline p-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-lg text-ember">π</span>
          <div>
            <p className="text-xs text-foreground">Oh My Pi Desktop 0.1.0</p>
            <p className="font-mono text-2xs text-muted-foreground">shell: {bridge.kind === "electron" ? "Electron" : "browser runtime"} · gateway: {desktop.boot.capabilities?.auth ?? "none"}</p>
          </div>
        </div>
        <p className="mt-2 text-2xs text-muted-foreground">
          {hasShell()
            ? "Native shell attached: local filesystem, git and window capability are owned by the main process behind a narrow preload bridge."
            : "No preload bridge — running the bundled browser runtime. Run `bun run desktop:dev` to attach the Electron shell."}
        </p>
      </div>

      <div className="mt-3">
        <Label>runtime resolution order</Label>
        <div className="mt-1.5 space-y-1">
          {desktop.boot.candidates.map((candidate) => (
            <div key={candidate.kind} className="flex items-start gap-2 rounded border border-hairline px-2 py-1.5">
              <Badge tone={candidate.state === "ok" ? "ok" : candidate.state === "unusable" ? "danger" : "muted"}>{candidate.state}</Badge>
              <div className="min-w-0">
                <p className="font-mono text-2xs text-foreground">{candidate.label}</p>
                <p className="text-2xs text-muted-foreground">{candidate.detail}</p>
                {candidate.command && <p className="font-mono text-2xs text-muted-foreground/70">{candidate.command}</p>}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-2xs text-muted-foreground/70">
          A damaged bundled payload is reported rather than silently replaced by whatever `omp` happens to be on PATH.
        </p>
      </div>

      <div className="mt-3">
        <Label>workspace</Label>
        <div className="mt-1.5 grid grid-cols-3 gap-2">
          {[
            { label: "files", value: workspace.snapshot().length },
            { label: "folders", value: workspace.folders_().length },
            { label: "sessions", value: desktop.sessions.length },
          ].map((entry) => (
            <div key={entry.label} className="rounded border border-hairline px-2.5 py-1.5">
              <p className="mono-label">{entry.label}</p>
              <p className="font-mono text-xs text-foreground">{entry.value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <Label>boot log</Label>
        <pre className="mt-1.5 max-h-40 overflow-auto rounded border border-hairline bg-chrome px-2.5 py-2 font-mono text-2xs text-muted-foreground">
          {desktop.boot.stages.map((stage) => `${stage.state.padEnd(8)} ${stage.label}${stage.detail ? ` — ${stage.detail}` : ""}`).join("\n") || "no boot log"}
        </pre>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            clearDesktopState();
            notify("Desktop state cleared — reloading", "warn");
            setTimeout(() => window.location.reload(), 600);
          }}
        >
          <RotateCcw className="size-3" /> reset desktop state
        </Button>
        <Button variant="ghost" size="sm" onClick={() => notify(`Logs are written to ~/.omp/desktop.log (packaged shell)`, "info")}>
          <Terminal className="size-3" /> where are the logs?
        </Button>
        <span className="ml-auto font-mono text-2xs text-muted-foreground/60">state persists locally</span>
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-2xs text-muted-foreground/70">
        <ShieldCheck className="size-3" /> keys and tokens never enter the transcript; this pane renders state flags only.
      </p>
      <Textarea className="mt-3 h-16" readOnly value={"# omp-desktop config\nruntime:\n  resolve: bundled → override → checkout → install\nmemory:\n  backend: local\n  projectScoped: true\n"} />
    </div>
  );
}

/**
 * Capabilities — the upstream feature surface, read from the shell when one is
 * attached. Entry-point support is probed against the real runtime
 * (`omp --help`), and a one-shot run actually executes `omp -p "…" --mode text`
 * so the entry point is exercised, not merely described.
 */
function CapabilitiesSection() {
  const [entryPoints, setEntryPoints] = useState<RuntimeEntryPoint[]>([]);
  const [source, setSource] = useState<"catalog" | "probing" | "shell">(bridge.entryPoints ? "probing" : "catalog");
  const [prompt, setPrompt] = useState("List the entry points this runtime exposes.");
  const [result, setResult] = useState<OneShotResult | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!bridge.entryPoints) return;
    let alive = true;
    bridge
      .entryPoints()
      .then((list) => {
        if (!alive) return;
        setEntryPoints(list?.length ? list : []);
        setSource(list?.length ? "shell" : "catalog");
      })
      .catch(() => alive && setSource("catalog"));
    return () => {
      alive = false;
    };
  }, []);

  const visible = entryPoints.length
    ? entryPoints
    : ENTRY_POINTS.map((entry) => ({ ...entry, supported: true }));

  const runOnce = async () => {
    if (!bridge.runOneShot) {
      notify("One-shot runs need the packaged shell — start it with bun run desktop:dev", "warn");
      return;
    }
    if (!prompt.trim()) return;
    setRunning(true);
    setResult(null);
    const outcome: OneShotResult = await bridge
      .runOneShot({ prompt: prompt.trim(), timeoutMs: 120000 })
      .catch((error) => ({ ok: false, error: String(error) }) as OneShotResult);
    setResult(outcome);
    setRunning(false);
    notify(outcome.ok ? "One-shot run finished" : `One-shot run failed: ${outcome.error ?? outcome.code}`, outcome.ok ? "ok" : "danger");
  };

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2">
        <p className="text-xs text-foreground">Four entry points, one agent.</p>
        <Badge tone={source === "shell" ? "ok" : source === "probing" ? "muted" : "warn"}>
          {source === "shell" ? "probed against the runtime" : source === "probing" ? "probing…" : "catalog"}
        </Badge>
      </div>
      <div className="mt-2 space-y-1">
        {visible.map((entry) => (
          <div key={entry.id} className="flex items-start gap-2 rounded border border-hairline px-2 py-1.5">
            <Badge tone={entry.supported ? "ok" : "muted"}>{entry.supported ? "ready" : "n/a"}</Badge>
            <div className="min-w-0">
              <p className="text-2xs text-foreground">
                {entry.name} <span className="font-mono text-muted-foreground">{entry.command}</span>
              </p>
              <p className="mt-0.5 text-2xs text-muted-foreground">{entry.detail}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded border border-hairline px-2.5 py-2">
        <Label>run a one-shot request</Label>
        <div className="mt-1.5 flex items-center gap-2">
          <Input value={prompt} onChange={(event) => setPrompt(event.target.value)} className="h-8 font-mono text-2xs" />
          <Button size="sm" onClick={runOnce} disabled={running || !hasShell()}>
            <Sparkles className="size-3" /> {running ? "running…" : "run"}
          </Button>
        </div>
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-hairline bg-chrome px-2.5 py-2 font-mono text-2xs text-muted-foreground">
          {result ? result.stdout || result.stderr || result.error || "(no output)" : "omp -p \"…\" --mode text — runs non-interactively and exits"}
        </pre>
      </div>

      <div className="mt-3">
        <Label>internal schemes ({SCHEME_SPECS.length})</Label>
        <p className="mt-1 text-2xs text-muted-foreground">
          Every FS-shaped tool resolves these, so a PR, a subagent's findings, a merge conflict or a skill is just a path.
        </p>
        <div className="mt-1.5 grid gap-1 sm:grid-cols-2">
          {SCHEME_SPECS.map((spec) => (
            <div key={spec.scheme} className="rounded border border-hairline px-2 py-1.5">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-2xs text-ember">{spec.scheme}</span>
                <span className="text-2xs text-foreground">{spec.name}</span>
                {spec.writable && <Badge tone="flux">writable</Badge>}
              </div>
              <p className="mt-0.5 text-2xs text-muted-foreground">{spec.detail}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <Label>inherited config ({DISCOVERY_PROVIDERS.length} providers)</Label>
        <p className="mt-1 text-2xs text-muted-foreground">
          {STICKY_RULES_NOTE}
        </p>
        <div className="mt-1.5 space-y-0.5">
          {DISCOVERY_PROVIDERS.map((provider) => (
            <div key={provider.id} className="flex items-start gap-2 border-b border-hairline/50 py-1 last:border-b-0">
              <span className="w-8 shrink-0 font-mono text-2xs text-muted-foreground">{provider.priority}</span>
              <span className="w-40 shrink-0 font-mono text-2xs text-foreground">{provider.id}</span>
              <span className="min-w-0 flex-1 font-mono text-2xs text-muted-foreground">{provider.paths}</span>
              <span className="hidden shrink-0 text-2xs text-muted-foreground/70 xl:block">{provider.contributes}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {[
          { label: "model providers", value: PROVIDER_DIRECTORY.length },
          { label: "search backends", value: SEARCH_BACKENDS.length },
          { label: "roles", value: ROLE_SPECS.length },
          { label: "tools", value: TOOL_SPECS.length },
          { label: "voices", value: TTS_VOICES.length },
          { label: "memory backends", value: MEMORY_BACKENDS.length },
        ].map((entry) => (
          <div key={entry.label} className="rounded border border-hairline px-2.5 py-1.5">
            <p className="mono-label">{entry.label}</p>
            <p className="font-mono text-xs text-foreground">{entry.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-3">
        <Label>roles and what they route</Label>
        <div className="mt-1.5 space-y-0.5">
          {ROLE_SPECS.map((spec) => (
            <div key={spec.role} className="flex items-baseline gap-2 border-b border-hairline/50 py-1 last:border-b-0">
              <span className="w-16 shrink-0 font-mono text-2xs text-ember">{spec.name}</span>
              <span className="min-w-0 flex-1 text-2xs text-muted-foreground">{spec.detail}</span>
              {spec.override && <span className="shrink-0 font-mono text-2xs text-muted-foreground/70">{spec.override}</span>}
              <span className="shrink-0 font-mono text-2xs text-foreground">{DEFAULT_ROLE_MODELS[spec.role]}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 rounded border border-hairline px-2.5 py-2">
        <Label>prompt controls</Label>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {MAGIC_KEYWORDS.map((keyword) => (
            <span key={keyword.keyword} className="rounded border border-hairline px-1.5 py-0.5 font-mono text-2xs text-ember">
              {keyword.keyword}
            </span>
          ))}
        </div>
        <p className="mt-1.5 text-2xs text-muted-foreground">Prose only — never inside code spans, fenced blocks, identifiers or paths.</p>
        <p className="mt-1.5 text-2xs text-muted-foreground/80">{GATED_TOOL_NOTE}</p>
      </div>

      <div className="mt-3">
        <Label>search backends</Label>
        <p className="mt-1 text-2xs text-muted-foreground">
          web_search chains these in rank order and hands whatever URLs it finds straight to read.
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {SEARCH_BACKENDS.map((backend) => (
            <span key={backend} className="rounded border border-hairline px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
              {backend}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
