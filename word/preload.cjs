// 화면에 열어 주는 기능은 파일 대화상자뿐이다(그 밖에는 로컬 서버를 쓴다)
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("ogolgye", {
  save: (bytes, name, filters) => ipcRenderer.invoke("file:save", { bytes, name, filters }),
  saveTo: (bytes, filePath) => ipcRenderer.invoke("file:saveTo", { bytes, filePath }),
  open: (filters) => ipcRenderer.invoke("file:open", { filters }),
});
