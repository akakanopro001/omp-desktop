import { Badge, Button } from "@/components/ui/primitives";
import { Hint } from "@/components/ui/tooltip";
import { modeSpec, openSettings, ui, useDesktop } from "@/lib/omp/state";
import { bridge } from "@/lib/omp/state";
import { cn, formatCost, shortPath } from "./format";
import { Command, Settings2 } from "lucide-react";
import { useEffect } from "react";

export function TitleBar({ root }: { root: string }) {
  const desktop = useDesktop();
  const session = desktop.session;
  const branch = root.split("/").filter(Boolean).pop() ?? "workspace";

  useEffect(() => {
    const title = session ? `${session.title} — OMP Desktop` : "OMP Desktop";
    document.title = title;
    void bridge.setWindowTitle(title);
  }, [session?.title, session]);

  return (
    <header className="flex h-9 shrink-0 items-center gap-3 border-b border-hairline surface-chrome px-3">
        <div className="flex items-center gap-1.5">
          {["#ff5f57", "#febc2e", "#28c840"].map((color) => (
            <span key={color} className="size-2.5 rounded-full" style={{ background: color }} />
          ))}
        </div>

        <span className="font-mono text-sm leading-none text-ember">π</span>
        <span className="max-w-[280px] truncate text-xs text-foreground">{session?.title ?? "OMP Desktop"}</span>
        <span className="hidden items-center gap-1.5 font-mono text-2xs text-muted-foreground/70 md:flex">
          {shortPath(root, 30)}
          <span className="opacity-40">·</span>
          {branch}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          {session && <Badge tone={session.mode === "plan" || session.mode === "vibe" ? "flux" : "muted"}>{modeSpec(session.mode).name}</Badge>}
          {desktop.settings.advisor.enabled && <Badge tone="warn">advisor</Badge>}
          {session && <span className="font-mono text-2xs text-muted-foreground/70">{formatCost(session.usage.costUsd)}</span>}
          <Button variant="ghost" size="sm" onClick={() => ui.set((prev) => ({ ...prev, paletteOpen: true }))}>
            <Command className="size-3" /> {desktop.settings.shortcuts["palette.open"]}
          </Button>
          <Hint label="Settings (⌘,)">
            <Button variant="ghost" size="icon-sm" onClick={() => openSettings(desktop.ui.settingsSection)}>
              <Settings2 className="size-3.5" />
            </Button>
          </Hint>
          <span
            className={cn(
              "flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-2xs",
              desktop.boot.capabilities ? "border-ok/40 text-ok" : "border-hairline text-muted-foreground",
            )}
          >
            <span className={cn("size-1.5 rounded-full", desktop.boot.capabilities ? "bg-ok" : "bg-muted-foreground/50")} />
            {bridge.kind === "electron" ? "shell" : "browser"} · rpc
          </span>
      </div>
    </header>
  );
}
