// 오골계 워드 — Electron 메인 프로세스
import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { startServer, warmUp } from "./server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let win;

async function createWindow() {
  process.env.OGOLGYE_SETTINGS = path.join(app.getPath("userData"), "settings.json");   // 테마색 등 설정 저장 위치
  const { port } = await startServer(0);           // 빈 포트를 골라 127.0.0.1 에만 연다
  warmUp();                                        // Kiwi 한국어 모델을 뒤에서 미리 불러 둔다
  win = new BrowserWindow({
    width: 1500, height: 950, title: "오골계 워드",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: false },
  });
  Menu.setApplicationMenu(null);                   // 메뉴는 앱 화면의 도구 막대로
  win.loadURL(`http://127.0.0.1:${port}/app/`);
}

// 저장·열기 대화상자(화면에서 요청)
ipcMain.handle("file:save", async (_e, { bytes, name, filters }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: name, filters });
  if (r.canceled || !r.filePath) return null;
  await fs.promises.writeFile(r.filePath, Buffer.from(bytes));
  return { path: r.filePath, name: path.basename(r.filePath) };
});
ipcMain.handle("file:saveTo", async (_e, { bytes, filePath }) => {
  await fs.promises.writeFile(filePath, Buffer.from(bytes));
  return { path: filePath, name: path.basename(filePath) };
});
ipcMain.handle("file:open", async (_e, { filters }) => {
  const r = await dialog.showOpenDialog(win, { properties: ["openFile"], filters });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  return { path: p, name: path.basename(p), bytes: new Uint8Array(await fs.promises.readFile(p)) };
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
