// 화면에 열어 주는 기능은 파일 대화상자뿐이다(그 밖에는 로컬 서버를 쓴다)
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("ogolgye", {
  platform: process.platform,                       // 제목 표시줄 모양(맥은 창 버튼이 왼쪽)
  save: (bytes, name, filters) => ipcRenderer.invoke("file:save", { bytes, name, filters }),
  saveTo: (bytes, filePath) => ipcRenderer.invoke("file:saveTo", { bytes, filePath }),
  open: (filters) => ipcRenderer.invoke("file:open", { filters }),
  htmlZip: (html, images) => ipcRenderer.invoke("export:html-zip", { html, images }),
  pdf: (svgs) => ipcRenderer.invoke("export:pdf", { svgs }),
  pdfStream: {
    start: (name, filters) => ipcRenderer.invoke("export:pdf-stream-start", { name, filters }),
    page: (id, svg) => ipcRenderer.invoke("export:pdf-stream-page", { id, svg }),
    finish: (id) => ipcRenderer.invoke("export:pdf-stream-finish", { id }),
    cancel: (id) => ipcRenderer.invoke("export:pdf-stream-cancel", { id }),
  },
  office: (format, model, images) => ipcRenderer.invoke("export:office", { format, model, images }),
  hwpxFromModel: (model, pageless) => ipcRenderer.invoke("convert:hwpx", { model, pageless }),
  google: {
    status: () => ipcRenderer.invoke("google:status"),
    setClient: (clientId, clientSecret) => ipcRenderer.invoke("google:set-client", { clientId, clientSecret }),
    connect: () => ipcRenderer.invoke("google:connect"),
    disconnect: () => ipcRenderer.invoke("google:disconnect"),
    send: (model, title, pageless) => ipcRenderer.invoke("google:send", { model, title, pageless }),
    list: (opt) => ipcRenderer.invoke("google:list", opt),
    warm: () => ipcRenderer.invoke("google:warm"),
    fetch: (file) => ipcRenderer.invoke("google:fetch", typeof file === "string" ? { id: file } : { file }),
  },
  ai: {
    list: () => ipcRenderer.invoke("ai:list"),
    save: (tool) => ipcRenderer.invoke("ai:save", tool),
    remove: (id) => ipcRenderer.invoke("ai:remove", { id }),
    run: (id, input, options) => ipcRenderer.invoke("ai:run", { id, input, options }),
  },
});
