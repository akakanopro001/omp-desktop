export {
  cn,
  clamp,
  formatBytes,
  formatClock,
  formatCost,
  formatDuration,
  formatRelative,
  formatTokens,
  lines,
  pluralize,
  shortPath,
  truncate,
  uid,
} from "@/lib/utils";

export function relativeTimeText(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
