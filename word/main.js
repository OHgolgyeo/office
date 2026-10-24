// 오골계 워드 — Electron 메인 프로세스
import { app, BrowserWindow, dialog, ipcMain, Menu, shell, safeStorage } from "electron";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { startServer, shutdown, setPaddleOcrProvider } from "./server.js";
import { htmlArchive, pdfPrintParts, pdfPrintStreamShell, pdfPrintStreamPage } from "./core/export-files.js";
import { officeExport } from "./core/export-office.js";
import { GoogleDocs } from "./core/google-docs.js";
import { AiTools } from "./core/ai-tools.js";
import { docxParts } from "./core/unzip.js";
import { hwpxFromModel } from "./core/hwpx-from-model.js";
import updater from "electron-updater";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ICON = path.join(__dirname, "assets", "icons", "word-folder-blue-to-sky.png");
let win;
let appOrigin = "";
let paddleWindow = null, paddleReady = null, paddleSeq = 0, paddleIdleTimer = null;
const paddleJobs = new Map();
const writablePaths = new Set();
const pdfStreams = new Map();

function trustedIpc(event) {
  const frame = event?.senderFrame;
  if (!win || win.isDestroyed() || event.sender !== win.webContents || frame !== win.webContents.mainFrame || !String(frame.url || "").startsWith(appOrigin + "/app/")) {
    throw new Error("허용되지 않은 화면의 요청입니다.");
  }
}
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, arg) => { trustedIpc(event); return fn(event, arg); });
}
function bytesOf(value, max = 512 * 1024 * 1024) {
  const bytes = Buffer.from(value || []);
  if (bytes.length > max) throw new Error("처리할 파일이 너무 큽니다.");
  return bytes;
}
function writableKey(filePath) {
  const full = path.resolve(String(filePath || ""));
  return process.platform === "win32" ? full.toLowerCase() : full;
}

async function pdfFromSvgs(svgs) {
  // 쪽 크기 스타일만 담은 작은 틀을 연 뒤 쪽 조각(SVG)을 하나씩 붙인다. 한 덩어리 HTML 을 data 주소로 열면
  // 그림이 많은 문서(수 MB)에서 ERR_INVALID_URL 로 PDF 내보내기가 실패했다(파일로 열어도 5MB 쯤에서 실패).
  const { shell, pages } = pdfPrintParts(svgs);
  const pdfWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  try {
    await pdfWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(shell));
    for (const page of pages) await pdfWindow.webContents.executeJavaScript(`document.body.insertAdjacentHTML("beforeend", ${JSON.stringify(page)}); 0`, true);
    await pdfWindow.webContents.executeJavaScript("document.fonts ? document.fonts.ready.then(()=>true) : true", true);
    return await pdfWindow.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { marginType: "none" } });
  } finally { if (!pdfWindow.isDestroyed()) pdfWindow.destroy(); }
}

function closePdfStream(id) {
  const state = pdfStreams.get(id); if (!state) return;
  pdfStreams.delete(id);
  if (!state.window.isDestroyed()) state.window.destroy();
}
async function beginPdfStream(name, filters) {
  // 저장 대화상자나 인쇄 창이 겹쳐 남지 않도록 앱에서는 한 번에 한 PDF만 만든다.
  for (const id of [...pdfStreams.keys()]) closePdfStream(id);
  const chosen = await dialog.showSaveDialog(win, { defaultPath: name, filters });
  if (chosen.canceled || !chosen.filePath) return null;
  const id = crypto.randomUUID(), pdfWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  try { await pdfWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(pdfPrintStreamShell())); }
  catch (e) { pdfWindow.destroy(); throw e; }
  pdfStreams.set(id, { window: pdfWindow, filePath: chosen.filePath, names: new Map(), pages: 0 });
  pdfWindow.once("closed", () => pdfStreams.delete(id));
  return { id };
}
async function appendPdfStream(id, svg) {
  const state = pdfStreams.get(id); if (!state) throw new Error("끝났거나 취소된 PDF 내보내기입니다.");
  const text = String(svg || "").trimStart(); if (!/^<svg\b/i.test(text) || text.length > 64 * 1024 * 1024) throw new Error("PDF 쪽 자료가 올바르지 않거나 너무 큽니다.");
  const part = pdfPrintStreamPage(text, state.names);
  if (part.rule) await state.window.webContents.executeJavaScript(`document.getElementById("page-rules").textContent += ${JSON.stringify(part.rule)}; 0`, true);
  await state.window.webContents.executeJavaScript(`document.body.insertAdjacentHTML("beforeend", ${JSON.stringify(part.page)}); 0`, true);
  state.pages++;
  return { pages: state.pages };
}
async function finishPdfStream(id) {
  const state = pdfStreams.get(id); if (!state) throw new Error("끝났거나 취소된 PDF 내보내기입니다.");
  try {
    if (!state.pages) throw new Error("내보낼 쪽이 없습니다.");
    await state.window.webContents.executeJavaScript("document.fonts ? document.fonts.ready.then(()=>true) : true", true);
    const pdf = await state.window.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { marginType: "none" } });
    await fs.promises.writeFile(state.filePath, pdf);
    writablePaths.add(writableKey(state.filePath));
    return { path: state.filePath, name: path.basename(state.filePath), pages: state.pages };
  } finally { closePdfStream(id); }
}

async function createWindow() {
  const paddleSmokeFile = process.env.OG_PADDLE_SMOKE_RESULT || "";
  const authToken = crypto.randomBytes(32).toString("hex");
  const { port } = await startServer(0, { authToken }); // 빈 포트를 골라 127.0.0.1 에만 연다
  appOrigin = `http://127.0.0.1:${port}`;
  setPaddleOcrProvider(recognizeWithPaddle);
  win = new BrowserWindow({
    width: 1500, height: 950, title: "오골계 워드", show: !paddleSmokeFile,
    icon: APP_ICON,
    // 제목 표시줄은 화면이 그린다(Windows 기본보다 5px 높게, 문서 이름 표시). 창 버튼만 Windows가 그린다.
    // 높이·색은 renderer/style.css 의 .titlebar 와 같게 맞춘다.
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#f3f3f3", symbolColor: "#1f1f1f", height: 28 },
    trafficLightPosition: { x: 12, y: 7 },           // 맥: 창 버튼(빨강·노랑·초록)을 제목 표시줄 가운데 높이에
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true },
  });
  // 메뉴는 앱 화면의 도구 막대로. 맥은 화면 맨 위 메뉴가 없으면 복사·붙여넣기·종료 단축키가 동작하지 않아 기본 메뉴만 둔다.
  Menu.setApplicationMenu(process.platform === "darwin" ? Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }]) : null);
  // 화면 속 인터넷 주소(설명의 하이퍼링크 등)는 앱 안에 새 창을 띄우지 않고 기본 브라우저로 연다
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  await win.webContents.session.cookies.set({
    url: appOrigin, name: "ogolgye_session", value: authToken,
    httpOnly: true, secure: false, sameSite: "strict",
  });
  // 배포 전 실검사 전용: 실제 설치본과 같은 진입점·보안 쿠키·숨은 OCR 화면에서 한국어 모델을 실행한다.
  if (paddleSmokeFile) {
    try {
      // 외부 글꼴·화면 캡처에 의존하지 않는 검사용 활자 PNG. 한국어 모델이 함께 지원하는 라틴 문자 인식까지 검사한다.
      const { PNG } = await import("pngjs"), image = new PNG({ width: 900, height: 220 });
      image.data.fill(255);
      const glyphs = {
        O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
        C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
        R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
        T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
        E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
        S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
      };
      const scale = 18; let penX = 45;
      for (const char of "OCR TEST") {
        if (char === " ") { penX += scale * 3; continue; }
        glyphs[char].forEach((row, gy) => [...row].forEach((on, gx) => {
          if (on !== "1") return;
          for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
            const at = ((45 + gy * scale + y) * image.width + penX + gx * scale + x) * 4;
            image.data[at] = image.data[at + 1] = image.data[at + 2] = 0; image.data[at + 3] = 255;
          }
        }));
        penX += scale * 7;
      }
      // OG_PADDLE_SMOKE_PNG: 이 그림들(;로 구분)을 대신 읽어 결과를 모두 남긴다 — 네이티브 PaddleOCR(core/paddle-native.js)과 견주기용
      const pngs = (process.env.OG_PADDLE_SMOKE_PNG || "").split(";").filter(Boolean);
      const det = process.env.OG_PADDLE_SMOKE_DET ? { detector: process.env.OG_PADDLE_SMOKE_DET } : {};
      if (pngs.length) {
        const all = [];
        for (const f of pngs) { const t = Date.now(); all.push({ file: f, ms: 0, ...(await recognizeWithPaddle({ png: fs.readFileSync(f), packs: ["korean"], ...det })) }); all.at(-1).ms = Date.now() - t; }
        fs.writeFileSync(paddleSmokeFile, JSON.stringify({ ok: true, compare: all }, null, 2)); app.quit(); return;
      }
      const png = PNG.sync.write(image);
      const result = await recognizeWithPaddle({ png, packs: ["korean"], ...det });
      // OG_PADDLE_SMOKE_PDF(스캔 PDF)가 있으면 실제 경로도: 서버로 열어 PDF 세션 작업 스레드 → 본체 → 숨은 OCR 화면
      let pdfOcr = null;
      if (process.env.OG_PADDLE_SMOKE_PDF) {
        const headers = { cookie: `ogolgye_session=${authToken}` };
        const info = await (await fetch(`${appOrigin}/api/pdf?name=smoke.pdf`, { method: "POST", headers, body: fs.readFileSync(process.env.OG_PADDLE_SMOKE_PDF) })).json();
        for (let i = 0; i < 600; i++) { const st = await (await fetch(`${appOrigin}/pdf/${info.id}/status`, { headers })).json(); if (st.ready || st.error) break; await new Promise((r) => setTimeout(r, 100)); }
        pdfOcr = (await (await fetch(`${appOrigin}/pdf/${info.id}/ocr/0`, { headers })).text()).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
      }
      const ok = result.items?.some((x) => /ocr|test/i.test(x.text)) && (pdfOcr === null || /ocr|test/i.test(pdfOcr));
      fs.writeFileSync(paddleSmokeFile, JSON.stringify({ ok, pdfOcr, ...result }, null, 2));
    } catch (e) { fs.writeFileSync(paddleSmokeFile, JSON.stringify({ ok: false, error: String(e?.stack || e) }, null, 2)); process.exitCode = 1; }
    app.quit(); return;
  }
  await win.loadURL(`${appOrigin}/app/`);
  // 배포본 회귀 검사 전용: 실제 사용자 실행에는 없는 환경 변수이며, 화면과 iframe이 뜰 시간을 준 뒤 스스로 끝낸다.
  const smokeMs = Number(process.env.OG_SMOKE_EXIT_MS || 0);
  if (smokeMs > 0) setTimeout(() => app.quit(), Math.max(1000, smokeMs)).unref?.();
}

function closePaddleWindow(reason = "PaddleOCR 실행기가 끝났습니다.") {
  clearTimeout(paddleIdleTimer); paddleIdleTimer = null;
  const old = paddleWindow; paddleWindow = null; paddleReady = null;
  for (const job of paddleJobs.values()) job.reject(new Error(reason));
  paddleJobs.clear();
  if (old && !old.isDestroyed()) old.destroy();
}
function schedulePaddleRelease() {
  clearTimeout(paddleIdleTimer);
  paddleIdleTimer = setTimeout(() => { if (!paddleJobs.size) closePaddleWindow(); }, 15 * 1000);
  paddleIdleTimer.unref?.();
}
async function ensurePaddleWindow() {
  if (paddleWindow && !paddleWindow.isDestroyed() && paddleReady) return paddleReady;
  paddleWindow = new BrowserWindow({ show: false, webPreferences: {
    preload: path.join(__dirname, "paddle-preload.cjs"), contextIsolation: true, sandbox: true,
  } });
  const current = paddleWindow;
  current.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  current.webContents.on("will-navigate", (event, url) => {
    if (url !== `${appOrigin}/paddle-sdk/host.html`) event.preventDefault();
  });
  paddleReady = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ipcMain.off("paddle-ocr:ready", ready);
      reject(new Error("PaddleOCR 실행기를 시작하지 못했습니다."));
    }, 30000);
    const ready = (event) => {
      if (event.sender !== current.webContents) return;
      clearTimeout(timer); ipcMain.off("paddle-ocr:ready", ready); resolve();
    };
    ipcMain.on("paddle-ocr:ready", ready);
  });
  current.once("closed", () => { if (paddleWindow === current) closePaddleWindow(); });
  try {
    await current.loadURL(`${appOrigin}/paddle-sdk/host.html`);
    await paddleReady;
  } catch (e) {
    if (paddleWindow === current) closePaddleWindow(String(e?.message || e));
    throw e;
  }
}
async function recognizeWithPaddle({ png, packs, mime = "image/png", detector = "PP-OCRv5_mobile_det" }) {
  await ensurePaddleWindow();
  clearTimeout(paddleIdleTimer); paddleIdleTimer = null;
  const id = ++paddleSeq;
  return new Promise((resolve, reject) => {
    paddleJobs.set(id, { resolve, reject });
    paddleWindow.webContents.send("paddle-ocr:request", { id, bytes: new Uint8Array(png), packs, mime, detector });
  }).finally(schedulePaddleRelease);
}
ipcMain.on("paddle-ocr:result", (event, result) => {
  if (!paddleWindow || event.sender !== paddleWindow.webContents || !Number.isInteger(result?.id)) return;
  const job = paddleJobs.get(result.id); if (!job) return;
  paddleJobs.delete(result.id);
  if (result.ok) job.resolve({ items: Array.isArray(result.items) ? result.items : [] });
  else job.reject(new Error(result.error || "PaddleOCR 인식에 실패했습니다."));
});

// 저장·열기 대화상자(화면에서 요청)
handle("file:save", async (_e, { bytes, name, filters }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: name, filters });
  if (r.canceled || !r.filePath) return null;
  await fs.promises.writeFile(r.filePath, bytesOf(bytes));
  writablePaths.add(writableKey(r.filePath));
  return { path: r.filePath, name: path.basename(r.filePath) };
});
handle("file:saveTo", async (_e, { bytes, filePath }) => {
  const full = path.resolve(String(filePath || ""));
  if (!writablePaths.has(writableKey(full))) throw new Error("저장 대화상자에서 확인하지 않은 경로입니다.");
  await fs.promises.writeFile(full, bytesOf(bytes));
  return { path: full, name: path.basename(full) };
});
handle("file:open", async (_e, { filters }) => {
  const r = await dialog.showOpenDialog(win, { properties: ["openFile"], filters });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  writablePaths.add(writableKey(p));
  return { path: p, name: path.basename(p), bytes: new Uint8Array(await fs.promises.readFile(p)) };
});
handle("export:html-zip", async (_e, { html, images }) => new Uint8Array(htmlArchive(html, images || [])));
handle("export:pdf", async (_e, { svgs }) => new Uint8Array(await pdfFromSvgs(svgs)));
handle("export:pdf-stream-start", async (_e, { name, filters }) => beginPdfStream(name, filters));
handle("export:pdf-stream-page", async (_e, { id, svg }) => appendPdfStream(id, svg));
handle("export:pdf-stream-finish", async (_e, { id }) => finishPdfStream(id));
handle("export:pdf-stream-cancel", async (_e, { id }) => { closePdfStream(id); return { canceled: true }; });
handle("export:office", async (_e, { format, model, images }) => new Uint8Array(officeExport(format, model, images || [])));

// Google 연결 정보·AI 키는 운영체제 보안 저장소(safeStorage)로만 암호화해 둔다. 쓸 수 없으면 평문으로 대신 저장하지 않는다.
function secureCrypt(what) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error(`운영체제 보안 저장소를 사용할 수 없어 ${what}을(를) 안전하게 저장할 수 없습니다.`);
  return { encrypt: (t) => safeStorage.encryptString(t), decrypt: (b) => safeStorage.decryptString(Buffer.from(b)) };
}
// 화면 요청 처리: 결과는 { ok: true, ... } 또는 { ok: false, error }
const ipcCall = (fn) => async (event, arg) => { try { trustedIpc(event); return { ok: true, ...(await fn(arg || {})) }; } catch (err) { return { ok: false, error: String(err?.message || err) }; } };

// Google 연결: 사용자가 각자 등록한 클라이언트를 쓴다
let google = null;
const googleDocs = () => (google ||= new GoogleDocs({ dir: app.getPath("userData"), crypt: secureCrypt("Google 연결 정보"), openExternal: (url) => shell.openExternal(url) }));
ipcMain.handle("google:status", ipcCall(async () => googleDocs().status()));
ipcMain.handle("google:set-client", ipcCall(async ({ clientId, clientSecret }) => googleDocs().setClient(clientId, clientSecret)));
ipcMain.handle("google:connect", ipcCall(async () => googleDocs().connect()));
ipcMain.handle("google:disconnect", ipcCall(async () => googleDocs().disconnect()));
ipcMain.handle("google:send", ipcCall(async ({ model, title, pageless }) => googleDocs().send({ docx: officeExport("docx", model), title, pageless, tabs: model.tabs })));
ipcMain.handle("google:list", ipcCall(async (opt) => googleDocs().list(opt)));
ipcMain.handle("google:warm", ipcCall(async () => ({ warmed: await googleDocs().warm() })));
// 드라이브 파일 가져오기: 한글·PDF 는 원본, Word 는 본문 부품으로, Google 문서는 Docs API 중간 구조로 바꾼다
ipcMain.handle("google:fetch", ipcCall(async ({ id, file }) => {
  const selected = file && typeof file === "object" ? file : null;
  const f = await googleDocs().fetchFile(selected?.id || id, selected);
  if (f.kind === "docx") return { kind: "docx", name: f.name, pageless: f.pageless, source: f.source, parts: docxParts(f.bytes) };
  if (f.kind === "model") return { kind: "hwp", name: f.name.replace(/\.hwpx$/i, "") + ".hwpx", bytes: new Uint8Array(await hwpxFromModel(f.model, { pageless: f.pageless })) };   // Google 문서(탭 포함) → 한글 문서
  return { kind: f.kind, name: f.name, bytes: new Uint8Array(f.bytes) };
}));

// 사용자 API 도구: API 키와 설정은 암호화하고 요청도 메인 프로세스에서 보낸다.
let ai = null;
const aiTools = () => (ai ||= new AiTools({ dir: app.getPath("userData"), crypt: secureCrypt("API 키") }));
ipcMain.handle("ai:list", ipcCall(async () => ({ tools: aiTools().list() })));
ipcMain.handle("ai:save", ipcCall(async (tool) => ({ tools: aiTools().save(tool) })));
ipcMain.handle("ai:remove", ipcCall(async ({ id }) => ({ tools: aiTools().remove(id) })));
ipcMain.handle("ai:run", ipcCall(async ({ id, input, options }) => aiTools().run(id, input, options)));
// 중간 구조 → 한글 문서(HWPX)
handle("convert:hwpx", async (_e, { model, pageless }) => new Uint8Array(await hwpxFromModel(model, { pageless: pageless ?? null })));

app.setAppUserModelId("com.ogolgye.word");
// ── 자동 업데이트: GitHub 릴리스(OHgolgyeo/office)에 새 버전이 올라오면 받아 두고 설치한다.
// Windows: 받은 뒤 "지금 다시 시작"을 고르면 바로, 아니면 프로그램을 닫을 때 설치된다. 맥: 알려 주고 내려받기 페이지를 연다. 설치본에서만 동작한다.
const UPDATE_CHECK_MS = 4 * 60 * 60 * 1000;                  // 켜 둔 동안 4시간마다 다시 확인
// 바뀐 점: release-notes.json(버전 → { title, text } — 안내문 그대로, 또는 { title, items } — 번호 매긴 목록) — 업데이트 뒤 첫 실행 안내에 쓰고, 깃허브 릴리스 글(.github/word-release-notes.md)도
// 같은 내용으로 만든다. 업데이트 알림 창은 아직 설치 안 된 새 버전의 글이 필요하므로 깃허브 릴리스 글(info.releaseNotes)을 쓴다.
function releaseNotesOf(version) {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, "release-notes.json"), "utf8"))[version] || null; } catch { return null; }
}
const notesText = (items) => items.map((t, i) => `${i + 1}. ${t}`).join("\n");
/** electron-updater 가 준 릴리스 글(GitHub: HTML 문자열, 또는 [{ version, note }])을 알림 창에 넣을 글로 */
function updateNotesText(info) {
  const raw = Array.isArray(info?.releaseNotes) ? info.releaseNotes.map((r) => r?.note || "").join("\n") : String(info?.releaseNotes || "");
  const text = raw.replace(/<\/(p|li|h\d|div)>|<br\s*\/?>/gi, "\n").replace(/<li[^>]*>/gi, "• ").replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
  return text.length > 1500 ? text.slice(0, 1500) + "…" : text;
}
/** 업데이트(또는 처음 설치) 뒤 처음 켤 때 한 번 바뀐 점을 알린다. 본 버전은 사용자 자료(userData)의 whats-new.json 에 남긴다. */
async function showWhatsNewOnce() {
  if (!app.isPackaged && !process.env.OG_WHATS_NEW) return;
  if (process.env.OG_SMOKE_EXIT_MS || process.env.OG_PADDLE_SMOKE_RESULT) return;   // 배포 전 실검사는 창을 띄우지 않는다
  const file = path.join(app.getPath("userData"), "whats-new.json"), version = app.getVersion();
  let seen = null;
  try { seen = JSON.parse(fs.readFileSync(file, "utf8")).seen || null; } catch { /* 처음 */ }
  if (seen === version) return;
  const notes = releaseNotesOf(version);
  try { fs.writeFileSync(file, JSON.stringify({ seen: version })); } catch { /* 못 적으면 다음에 또 알린다 */ }
  if (!notes || !win || win.isDestroyed()) return;
  await dialog.showMessageBox(win, { type: "info", title: "업데이트 안내", buttons: ["확인"], defaultId: 0, noLink: true,
    message: notes.title || `오골계 워드 ${version} 업데이트 안내`, detail: notes.text || notesText(notes.items || []) });
}
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
        detail: (updateNotesText(info) ? `바뀐 점\n${updateNotesText(info)}\n\n` : "") + "내려받기 페이지에서 맥용 파일(.dmg)을 받아 설치하세요. 설정과 문서는 그대로 남습니다.",
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
      detail: (updateNotesText(info) ? `바뀐 점\n${updateNotesText(info)}\n\n` : "") + "지금 다시 시작하면 바로 적용됩니다. 저장하지 않은 문서가 있으면 먼저 저장한 뒤 누르세요.\n\"나중에\"를 누르면 프로그램을 닫을 때 자동으로 적용됩니다.",
    });
    if (r.response === 0) setImmediate(() => autoUpdater.quitAndInstall(false, true));
  });
  autoUpdater.on("error", (e) => log("error", e?.stack || e));
  const check = () => autoUpdater.checkForUpdates().catch((e) => log("check failed", e?.message || e));
  setTimeout(check, 5000);
  setInterval(check, UPDATE_CHECK_MS);
}

app.whenReady().then(async () => {
  await createWindow(); setupAutoUpdate();
  showWhatsNewOnce().catch(() => {});
  // Google 드라이브에 연결해 두었으면 연결 토큰을 뒤에서 미리 받아 둔다(드라이브 창의 첫 목록이 토큰 갱신을 기다리지 않게)
  setTimeout(() => { try { googleDocs().warm().catch(() => {}); } catch { /* 연결 안 함 */ } }, 4000);
});
app.on("window-all-closed", () => app.quit());
// 끌 때 뒤에서 도는 계산(레이아웃 분석·문서화 준비·OCR)을 기다리지 않는다
let shuttingDown = false;
app.on("before-quit", (e) => {
  if (shuttingDown) return;
  shuttingDown = true; e.preventDefault();
  setPaddleOcrProvider(null); closePaddleWindow();
  for (const id of [...pdfStreams.keys()]) closePdfStream(id);
  Promise.race([shutdown(), new Promise((r) => setTimeout(r, 1500))]).finally(() => app.quit());
});
