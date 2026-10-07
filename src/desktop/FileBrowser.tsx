import { buildTree, type TreeDir } from "@/lib/omp/vfs";
import { fsVersion, openFile, workspace } from "@/lib/omp/state";
import { useAtomValue } from "@/lib/store";
import { cn, formatBytes } from "./format";
import { ChevronDown, ChevronRight, FileCode, FileText, FolderTree } from "lucide-react";
import { useMemo, useState } from "react";

export function FileBrowser({ root }: { root: string }) {
  const version = useAtomValue(fsVersion);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const tree = useMemo(() => {
    void version;
    return buildTree(workspace, root);
  }, [root, version]);

  const status = useMemo(() => {
    void version;
    return new Map(workspace.status(root).map((entry) => [entry.path, entry.status]));
  }, [root, version]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
        <FolderTree className="size-3.5 text-muted-foreground" />
        <span className="truncate font-mono text-2xs text-foreground">{root}</span>
        <span className="ml-auto shrink-0 font-mono text-2xs text-muted-foreground/70">{workspace.paths(root).length} files</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1.5 py-2">
        <Dir
          node={tree}
          depth={0}
          collapsed={collapsed}
          toggle={(path) => setCollapsed((prev) => ({ ...prev, [path]: !prev[path] }))}
          status={status}
          root={tree.path}
        />
      </div>
      <div className="border-t border-hairline px-3 py-1.5 font-mono text-2xs text-muted-foreground/70">
        {[...status.values()].filter((value) => value === "modified").length} modified ·{" "}
        {[...status.values()].filter((value) => value === "untracked").length} untracked
      </div>
    </div>
  );
}

function Dir({
  node,
  depth,
  collapsed,
  toggle,
  status,
  root,
}: {
  node: TreeDir;
  depth: number;
  collapsed: Record<string, boolean>;
  toggle: (path: string) => void;
  status: Map<string, string>;
  root: string;
}) {
  const isOpen = !collapsed[node.path];
  const isRoot = node.path === root;
  return (
    <div>
      {!isRoot && (
        <button
          onClick={() => toggle(node.path)}
          className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-secondary/40"
          style={{ paddingLeft: 6 + depth * 12 }}
        >
          {isOpen ? <ChevronDown className="size-3 text-muted-foreground" /> : <ChevronRight className="size-3 text-muted-foreground" />}
          <span className="font-mono text-2xs text-foreground/90">{node.name}</span>
        </button>
      )}
      {isOpen && (
        <>
          {isRoot && (
            <div className="mb-1 px-1.5 font-mono text-2xs text-muted-foreground/60" style={{ paddingLeft: 6 + depth * 12 }}>
              {node.name}/
            </div>
          )}
          {node.dirs.map((child) => (
            <Dir key={child.path} node={child} depth={depth + 1} collapsed={collapsed} toggle={toggle} status={status} root={root} />
          ))}
          {node.files.map((file) => {
            const state = status.get(file.path);
            const isCode = /\.(ts|tsx|js|jsx)$/.test(file.path);
            return (
              <button
                key={file.path}
                onClick={() => openFile(file.path)}
                className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-secondary/40"
                style={{ paddingLeft: 6 + (depth + 1) * 12 }}
              >
                {isCode ? <FileCode className="size-3 text-ember/80" /> : <FileText className="size-3 text-muted-foreground" />}
                <span className={cn("truncate font-mono text-2xs", state === "modified" ? "text-warn" : "text-foreground/90")}>{file.name}</span>
                {file.dirty && <span className="size-1.5 shrink-0 rounded-full bg-warn" />}
                <span className="ml-auto shrink-0 font-mono text-2xs text-muted-foreground/50">{formatBytes(file.size)}</span>
                {state === "modified" && <span className="shrink-0 font-mono text-2xs text-warn">M</span>}
                {state === "untracked" && <span className="shrink-0 font-mono text-2xs text-flux">U</span>}
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}
