// 오골계 워드 — Electron 메인 프로세스
import { app, BrowserWindow, dialog, ipcMain, Menu, shell, safeStorage } from "electron";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { startServer, warmUp } from "./server.js";
import { htmlArchive, pdfPrintHtml } from "./core/export-files.js";
import { officeExport } from "./core/export-office.js";
import { GoogleDocs } from "./core/google-docs.js";
import { AiTools } from "./core/ai-tools.js";
import { docxParts } from "./core/unzip.js";
import { hwpxFromModel } from "./core/hwpx-from-model.js";
import updater from "electron-updater";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ICON = path.join(__dirname, "assets", "icons", "word-folder-blue-to-sky.png");
let win;

async function pdfFromSvgs(svgs) {
  const html = pdfPrintHtml(svgs);
  const pdfWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  try {
    await pdfWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    await pdfWindow.webContents.executeJavaScript("document.fonts ? document.fonts.ready.then(()=>true) : true", true);
    return await pdfWindow.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { marginType: "none" } });
  } finally { if (!pdfWindow.isDestroyed()) pdfWindow.destroy(); }
}

async function createWindow() {
  const { port } = await startServer(0);           // 빈 포트를 골라 127.0.0.1 에만 연다
  warmUp();                                        // Kiwi 한국어 모델을 뒤에서 미리 불러 둔다
  win = new BrowserWindow({
    width: 1500, height: 950, title: "오골계 워드",
    icon: APP_ICON,
    // 제목 표시줄은 화면이 그린다(Windows 기본보다 5px 높게, 문서 이름 표시). 창 버튼만 Windows가 그린다.
    // 높이·색은 renderer/style.css 의 .titlebar 와 같게 맞춘다.
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#f3f3f3", symbolColor: "#1f1f1f", height: 28 },
    trafficLightPosition: { x: 12, y: 7 },           // 맥: 창 버튼(빨강·노랑·초록)을 제목 표시줄 가운데 높이에
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: false },
  });
  // 메뉴는 앱 화면의 도구 막대로. 맥은 화면 맨 위 메뉴가 없으면 복사·붙여넣기·종료 단축키가 동작하지 않아 기본 메뉴만 둔다.
  Menu.setApplicationMenu(process.platform === "darwin" ? Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }]) : null);
  // 화면 속 인터넷 주소(설명의 하이퍼링크 등)는 앱 안에 새 창을 띄우지 않고 기본 브라우저로 연다
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
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
ipcMain.handle("export:html-zip", async (_e, { html }) => new Uint8Array(htmlArchive(html)));
ipcMain.handle("export:pdf", async (_e, { svgs }) => new Uint8Array(await pdfFromSvgs(svgs)));
ipcMain.handle("export:office", async (_e, { format, model }) => new Uint8Array(officeExport(format, model)));

// Google 연결 정보·AI 키는 운영체제 보안 저장소(safeStorage)로만 암호화해 둔다. 쓸 수 없으면 평문으로 대신 저장하지 않는다.
function secureCrypt(what) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error(`운영체제 보안 저장소를 사용할 수 없어 ${what}을(를) 안전하게 저장할 수 없습니다.`);
  return { encrypt: (t) => safeStorage.encryptString(t), decrypt: (b) => safeStorage.decryptString(Buffer.from(b)) };
}
// 화면 요청 처리: 결과는 { ok: true, ... } 또는 { ok: false, error }
const ipcCall = (fn) => async (_e, arg) => { try { return { ok: true, ...(await fn(arg || {})) }; } catch (err) { return { ok: false, error: String(err?.message || err) }; } };

// Google 연결: 사용자가 각자 등록한 클라이언트를 쓴다
let google = null;
const googleDocs = () => (google ||= new GoogleDocs({ dir: app.getPath("userData"), crypt: secureCrypt("Google 연결 정보"), openExternal: (url) => shell.openExternal(url) }));
ipcMain.handle("google:status", ipcCall(async () => googleDocs().status()));
ipcMain.handle("google:set-client", ipcCall(async ({ clientId, clientSecret }) => googleDocs().setClient(clientId, clientSecret)));
ipcMain.handle("google:connect", ipcCall(async () => googleDocs().connect()));
ipcMain.handle("google:disconnect", ipcCall(async () => googleDocs().disconnect()));
ipcMain.handle("google:send", ipcCall(async ({ model, title, pageless }) => googleDocs().send({ docx: officeExport("docx", model), title, pageless, tabs: model.tabs })));
ipcMain.handle("google:list", ipcCall(async (opt) => googleDocs().list(opt)));
// 드라이브 파일 가져오기: 한글·PDF 는 원본, Word 는 본문 부품으로, Google 문서는 Docs API 중간 구조로 바꾼다
ipcMain.handle("google:fetch", ipcCall(async ({ id }) => {
  const f = await googleDocs().fetchFile(id);
  if (f.kind === "docx") return { kind: "docx", name: f.name, pageless: f.pageless, source: f.source, parts: docxParts(f.bytes) };
  if (f.kind === "model") return { kind: "hwp", name: f.name.replace(/\.hwpx$/i, "") + ".hwpx", bytes: new Uint8Array(await hwpxFromModel(f.model, { pageless: f.pageless })) };   // Google 문서(탭 포함) → 한글 문서
  return { kind: f.kind, name: f.name, bytes: new Uint8Array(f.bytes) };
}));

// 사용자 AI 도구: API 키와 설정은 암호화하고 요청도 메인 프로세스에서 보낸다.
let ai = null;
const aiTools = () => (ai ||= new AiTools({ dir: app.getPath("userData"), crypt: secureCrypt("API 키") }));
ipcMain.handle("ai:list", ipcCall(async () => ({ tools: aiTools().list() })));
ipcMain.handle("ai:save", ipcCall(async (tool) => ({ tools: aiTools().save(tool) })));
ipcMain.handle("ai:remove", ipcCall(async ({ id }) => ({ tools: aiTools().remove(id) })));
ipcMain.handle("ai:run", ipcCall(async ({ id, input }) => aiTools().run(id, input)));
// 중간 구조 → 한글 문서(HWPX)
ipcMain.handle("convert:hwpx", async (_e, { model, pageless }) => new Uint8Array(await hwpxFromModel(model, { pageless: pageless ?? null })));

app.setAppUserModelId("com.ogolgye.word");
// ── 자동 업데이트: GitHub 릴리스(OHgolgyeo/office)에 새 버전이 올라오면 받아 두고 설치한다.
// Windows: 받은 뒤 "지금 다시 시작"을 고르면 바로, 아니면 프로그램을 닫을 때 설치된다. 맥: 알려 주고 내려받기 페이지를 연다. 설치본에서만 동작한다.
const UPDATE_CHECK_MS = 4 * 60 * 60 * 1000;                  // 켜 둔 동안 4시간마다 다시 확인
function setupAutoUpdate() {
  if (!app.isPackaged) return;
  const { autoUpdater } = updater;
  const logFile = path.join(app.getPath("userData"), "update.log");
  const log = (...a) => { try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${a.join(" ")}\n`); } catch { /* 기록 실패 */ } };
  autoUpdater.logger = { info: (m) => log("info", m), warn: (m) => log("warn", m), error: (m) => log("error", m), debug: () => {} };
  let asked = false;
  // 맥은 애플 개발자 인증서로 서명한 앱만 스스로 설치할 수 있다. 서명하지 않은 지금은 새 버전을 알려 주고 내려받기 페이지를 연다.
  const selfInstall = process.platform !== "darwin";
  autoUpdater.autoDownload = selfInstall;
  autoUpdater.autoInstallOnAppQuit = selfInstall;
  if (!selfInstall) {
    autoUpdater.on("update-available", async (info) => {
      if (asked || !win || win.isDestroyed()) return;
      asked = true;
      const r = await dialog.showMessageBox(win, {
        type: "info", title: "업데이트", buttons: ["내려받기 페이지 열기", "나중에"], defaultId: 0, cancelId: 1,
        message: `오골계 워드 ${info.version} 새 버전이 나왔습니다.`,
        detail: "내려받기 페이지에서 맥용 파일(.dmg)을 받아 설치하세요. 설정과 문서는 그대로 남습니다.",
      });
      if (r.response === 0) shell.openExternal("https://github.com/OHgolgyeo/office/releases/latest");
    });
  }
  autoUpdater.on("update-downloaded", async (info) => {
    if (asked || !win || win.isDestroyed()) return;
    asked = true;
    const r = await dialog.showMessageBox(win, {
      type: "info", title: "업데이트", buttons: ["지금 다시 시작", "나중에"], defaultId: 0, cancelId: 1, noLink: true,
      message: `오골계 워드 ${info.version} 업데이트를 받았습니다.`,
      detail: "지금 다시 시작하면 바로 적용됩니다. 저장하지 않은 문서가 있으면 먼저 저장한 뒤 누르세요.\n\"나중에\"를 누르면 프로그램을 닫을 때 자동으로 적용됩니다.",
    });
    if (r.response === 0) setImmediate(() => autoUpdater.quitAndInstall(false, true));
  });
  autoUpdater.on("error", (e) => log("error", e?.stack || e));
  const check = () => autoUpdater.checkForUpdates().catch((e) => log("check failed", e?.message || e));
  setTimeout(check, 5000);
  setInterval(check, UPDATE_CHECK_MS);
}

app.whenReady().then(async () => { await createWindow(); setupAutoUpdate(); });
app.on("window-all-closed", () => app.quit());
