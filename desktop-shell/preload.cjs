/**
 * The narrow preload bridge.
 *
 * Nothing crosses this line except the operations the renderer actually needs.
 * No `require`, no module loader, no fs handle — just ipcRenderer.invoke
 * wrappers matching the NativeBridge interface in src/lib/native.ts.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ompNative", {
  version: "0.1.0-shell",
  runtime: {
    resolve: (payload) => ipcRenderer.invoke("runtime:resolve", payload),
    start: () => ipcRenderer.invoke("runtime:start"),
    state: () => ipcRenderer.invoke("runtime:state"),
    handshake: () => ipcRenderer.invoke("runtime:handshake"),
    probe: (url, token, headers) => ipcRenderer.invoke("runtime:probe", { url, token, headers }),
    // The other three omp entry points, plus the RPC passthrough the panes use
    // to talk to the session the shell owns.
    entryPoints: (refresh) => ipcRenderer.invoke("runtime:entryPoints", { refresh }),
    oneShot: (payload) => ipcRenderer.invoke("runtime:oneshot", payload),
    command: (type, params, timeoutMs) => ipcRenderer.invoke("runtime:command", { type, params, timeoutMs }),
  },
  fs: {
    list: (root) => ipcRenderer.invoke("fs:list", root),
    read: (path) => ipcRenderer.invoke("fs:read", path),
    write: (path, content) => ipcRenderer.invoke("fs:write", path, content),
  },
  git: {
    status: (root) => ipcRenderer.invoke("git:status", root),
    log: (root) => ipcRenderer.invoke("git:log", root),
  },
  clipboard: {
    write: (text) => ipcRenderer.invoke("clipboard:write", text),
  },
  dialog: {
    pickFolder: () => ipcRenderer.invoke("dialog:pickFolder"),
  },
  window: {
    setTitle: (title) => ipcRenderer.invoke("window:setTitle", title),
  },
});
