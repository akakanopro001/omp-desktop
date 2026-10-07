import type { FileDiff } from "@/lib/omp/protocol";
import { Button } from "@/components/ui/button";
import { cn, downloadText } from "@/lib/utils";
import { unifiedDiffText } from "@/lib/omp/hashline";
import { Check, Download, FileDiff as FileDiffIcon } from "lucide-react";
import { useState } from "react";

export function DiffView({ diff, compact = false }: { diff: FileDiff; compact?: boolean }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(unifiedDiffText(diff));
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable in this host */
    }
  };

  return (
    <div className="overflow-hidden rounded-md border border-hairline bg-chrome/60">
      <div className="flex items-center justify-between gap-2 border-b border-hairline px-2.5 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <FileDiffIcon className="size-3.5 shrink-0 text-ember" />
          <span className="truncate font-mono text-2xs text-foreground">{diff.path}</span>
          <span className="shrink-0 font-mono text-2xs text-ok">+{diff.added}</span>
          <span className="shrink-0 font-mono text-2xs text-destructive">-{diff.removed}</span>
        </div>
        {!compact && (
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="icon-sm" onClick={copy} title="Copy unified diff">
              {copied ? <Check className="size-3" /> : <Download className="size-3" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => downloadText(`${diff.path.replace(/\//g, "_")}.diff`, unifiedDiffText(diff))}>
              save
            </Button>
          </div>
        )}
      </div>

      <div className={cn("overflow-auto font-mono text-[11px] leading-5", compact ? "max-h-56" : "max-h-[420px]")}>
        {diff.stale && (
          <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
            <span className="font-semibold">stale anchor · patch rejected</span>
            <pre className="mt-1 whitespace-pre-wrap text-[10.5px] opacity-90">{diff.stale}</pre>
          </div>
        )}
        {diff.hunks.map((hunk, hunkIndex) => (
          <div key={`${hunk.header}-${hunkIndex}`}>
            <div className="border-y border-hairline bg-secondary/40 px-3 py-0.5 text-2xs text-muted-foreground">{hunk.header}</div>
            {hunk.lines.map((line, lineIndex) => (
              <div
                key={`${lineIndex}-${line.text.slice(0, 12)}`}
                className={cn(
                  "flex gap-2 whitespace-pre px-2",
                  line.type === "add" && "bg-ok/10 text-ok",
                  line.type === "del" && "bg-destructive/10 text-destructive/90",
                  line.type === "ctx" && "text-muted-foreground",
                )}
              >
                <span className="w-9 shrink-0 select-none text-right text-muted-foreground/50">{line.oldNo ?? ""}</span>
                <span className="w-9 shrink-0 select-none text-right text-muted-foreground/50">{line.newNo ?? ""}</span>
                <span className="w-2 shrink-0 select-none">{line.type === "add" ? "+" : line.type === "del" ? "-" : " "}</span>
                <span className="min-w-0 flex-1">{line.text || " "}</span>
              </div>
            ))}
          </div>
        ))}
        {diff.hunks.length === 0 && <div className="px-3 py-2 text-muted-foreground">no textual change</div>}
      </div>

      {!compact && diff.anchors.length > 0 && (
        <div className="border-t border-hairline bg-secondary/20 px-2.5 py-1.5 font-mono text-2xs text-muted-foreground">
          {diff.anchors.length} anchors re-indexed after the patch
          <span className="mx-1.5 opacity-40">·</span>
          {diff.anchors.slice(0, 3).map((anchor) => `${anchor.line}:${anchor.hash}`).join(" ")}
          {diff.anchors.length > 3 ? " …" : ""}
        </div>
      )}
    </div>
  );
}
