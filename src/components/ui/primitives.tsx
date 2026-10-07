import * as SwitchPrimitive from "@radix-ui/react-switch";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export { Button, buttonVariants } from "./button";
export type { ButtonProps } from "./button";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-8 w-full rounded-md border border-input bg-background/60 px-2.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60 disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "w-full resize-none rounded-md border border-input bg-background/60 px-2.5 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mono-label", className)} {...props} />;
}

export function Badge({ className, tone = "muted", ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: "muted" | "ember" | "ok" | "warn" | "danger" | "flux" }) {
  const tones: Record<string, string> = {
    muted: "border-hairline bg-secondary/60 text-muted-foreground",
    ember: "border-ember/40 bg-ember/10 text-ember",
    ok: "border-ok/40 bg-ok/10 text-ok",
    warn: "border-warn/40 bg-warn/10 text-warn",
    danger: "border-destructive/40 bg-destructive/10 text-destructive",
    flux: "border-flux/40 bg-flux/10 text-flux",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-2xs uppercase tracking-[0.08em]",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

export const Switch = forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>>(
  ({ className, ...props }, ref) => (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        "peer inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full border border-hairline transition-colors data-[state=checked]:bg-ember/80 data-[state=unchecked]:bg-secondary",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-3 rounded-full bg-background shadow transition-transform data-[state=checked]:translate-x-3.5 data-[state=unchecked]:translate-x-0.5" />
    </SwitchPrimitive.Root>
  ),
);
Switch.displayName = "Switch";

export function Separator({ className, vertical = false }: { className?: string; vertical?: boolean }) {
  return <div className={cn(vertical ? "h-full w-px bg-hairline" : "h-px w-full bg-hairline", className)} />;
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "rounded border border-hairline bg-secondary/70 px-1 py-0.5 font-mono text-2xs text-muted-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function Row({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center justify-between gap-4 border-b border-hairline px-4 py-2.5 last:border-b-0", className)} {...props} />;
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-start gap-1 px-4 py-6">
      <p className="text-xs font-medium text-foreground">{title}</p>
      <p className="max-w-prose text-xs text-muted-foreground">{body}</p>
    </div>
  );
}
