import { Button } from "@/components/ui/primitives";
import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <div className="flex min-h-full items-center justify-center px-6">
      <div className="text-center">
        <p className="font-mono text-4xl text-ember">π</p>
        <h1 className="mt-4 text-lg font-semibold tracking-tight">That route isn’t part of the shell</h1>
        <p className="mt-2 max-w-md text-xs text-muted-foreground">
          The desktop lives at <span className="font-mono text-foreground">/app</span>; the overview lives at the root.
        </p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <Button asChild size="sm">
            <Link to="/app">Open the desktop</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/">Back to the overview</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
