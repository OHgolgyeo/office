const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("paddleHost", {
  onRequest: (fn) => ipcRenderer.on("paddle-ocr:request", (_event, value) => fn(value)),
  result: (value) => ipcRenderer.send("paddle-ocr:result", value),
  ready: () => ipcRenderer.send("paddle-ocr:ready"),
});
