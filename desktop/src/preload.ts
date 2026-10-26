import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("hub", {
  state: () => ipcRenderer.invoke("state"),
  call: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  onState: (fn: (state: unknown) => void) => ipcRenderer.on("state", (_e, s) => fn(s)),
});
