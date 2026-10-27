import { contextBridge, ipcRenderer, webUtils } from "electron";

contextBridge.exposeInMainWorld("hub", {
  call: (name: string, ...args: unknown[]) => ipcRenderer.invoke("call", name, ...args),
  onState: (fn: (state: unknown, changed: string[]) => void) => ipcRenderer.on("state", (_e, s, c) => fn(s, c)),
  onCommand: (fn: (command: string) => void) => ipcRenderer.on("command", (_e, c) => fn(c)),
  onProgress: (fn: (p: unknown) => void) => ipcRenderer.on("progress", (_e, p) => fn(p)),
  pathFor: (file: File) => webUtils.getPathForFile(file),
});
