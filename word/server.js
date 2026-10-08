// 오골계 워드 로컬 서버: 편집 화면(rhwp-studio), 앱 화면, PDF 보기를 127.0.0.1 에서만 제공한다.
// Electron 없이 `node server.js` 로 띄우면 브라우저에서도 시험할 수 있다.
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import os from "os";
import crypto from "crypto";
import { Worker } from "worker_threads";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf", ".webmanifest": "application/manifest+json" };

// 정적 파일 위치
const STATIC = {
  "/app/": path.join(__dirname, "renderer"),
  "/assets/": path.join(__dirname, "assets"),
  "/studio/": path.join(__dirname, "vendor", "rhwp-studio"),
  "/vendor/rhwp-editor/": path.dirname(require.resolve("@rhwp/editor")),
  "/vendor/phosphor/": path.join(path.dirname(require.resolve("@phosphor-icons/web/regular")), ".."),
};

// PDF: 연 문서마다 세션을 두고, 무거운 일은 필요할 때 조금씩(core/session.js)
let modsP = null, spacerP = null;
const mods = () => (modsP ||= Promise.all([import("./core/session.js"), import("./core/viewer-shell.js"), import("./core/src/kiwi-spacer.js")])
  .then(([se, sh, kw]) => ({ PdfSession: se.PdfSession, buildShellHtml: sh.buildShellHtml, createKiwiSpacer: kw.createKiwiSpacer })));
const spacer = () => (spacerP ||= mods().then((m) => m.createKiwiSpacer(path.join(__dirname, "models", "kiwi")))
  .catch((e) => { console.warn("[Kiwi] 불러오지 못해 띄어쓰기 판단에 Kiwi 를 쓰지 않습니다:", e?.message || e); return null; }));
// PDF 준비(글자 추출·문단 복원·글자 층)는 작업 스레드(core/prepare-worker.mjs)에서: 서버가 그동안에도 쪽 그림 요청에 답한다.
// 작업 스레드를 못 띄우면 null(세션이 서버에서 직접 한다 — 그때만 이 스레드에서 Kiwi 를 불러온다).
let prepW = null, prepSeq = 0, prepIdleTimer = 0;
const prepJobs = new Map();
// Kiwi(문단 띄어쓰기 판단)는 작업 스레드 안에서 약 900MB 를 차지하고(WebAssembly 메모리라 한 번 늘면 줄지 않는다),
// PDF 를 준비할 때(글자 추출 뒤 문단 복원)만 쓴다 → 준비가 끝나고 이만큼 아무 PDF 도 준비하지 않으면 작업 스레드를 끝내
// 메모리를 돌려받는다. 다음 PDF 는 새 작업 스레드가 Kiwi 를 다시 불러온다(뒤에서 약 2~3초 더).
const PREP_IDLE_MS = +process.env.OG_PREP_IDLE_MS || 45 * 1000;
function schedulePrepRelease() {
  clearTimeout(prepIdleTimer);
  prepIdleTimer = setTimeout(() => {
    if (prepJobs.size || !prepW) return;
    const w = prepW; prepW = null;
    w.terminate().catch(() => {});
  }, PREP_IDLE_MS);
  prepIdleTimer.unref?.();
}
function prepareWorker() {
  if (prepW !== null) return prepW;
  try {
    const w = new Worker(new URL("./core/prepare-worker.mjs", import.meta.url), { workerData: { kiwiDir: path.join(__dirname, "models", "kiwi") } });
    w.on("message", (m) => {
      const job = prepJobs.get(m.id); if (!job) return;
      if (m.progress) job.onProgress(m.progress[0], m.progress[1]);
      else if (m.phase) job.onPhase(m.phase);
      else { prepJobs.delete(m.id); if (m.error) job.reject(new Error(m.error)); else job.resolve(m.result); if (!prepJobs.size) schedulePrepRelease(); }
    });
    const fail = (e) => { for (const j of prepJobs.values()) j.reject(e instanceof Error ? e : new Error(String(e))); prepJobs.clear(); if (prepW === w) prepW = null; };
    w.on("error", fail);
    w.on("exit", (code) => fail(new Error(`PDF 준비 작업 스레드가 끝났습니다(${code}).`)));
    w.unref();
    prepW = w;
  } catch (e) { console.warn("[PDF 준비] 작업 스레드를 띄우지 못했습니다:", e?.message || e); prepW = false; }
  return prepW;
}
function prepareInWorker(bytes, onProgress, onPhase) {
  const w = prepareWorker();
  if (!w) return Promise.reject(new Error("작업 스레드 없음"));
  clearTimeout(prepIdleTimer);
  return new Promise((resolve, reject) => {
    const id = ++prepSeq;
    prepJobs.set(id, { resolve, reject, onProgress, onPhase });
    w.postMessage({ id, bytes }, [bytes.buffer]);
  });
}
/** 앱을 끌 때: 뒤에서 도는 계산(모델 프로세스·문서화 준비 작업 스레드·OCR)을 기다리지 않고 바로 정리한다.
 *  예전에는 레이아웃 분석이 도는 중에 끄면 계산 중인 쪽이 끝날 때까지(쪽당 최대 4초) 종료가 늦었다. */
export async function shutdown() {
  clearTimeout(prepIdleTimer);
  for (const s of sessions.values()) s.close();
  sessions.clear(); hotSessionId = null;
  try { if (prepW) await prepW.terminate(); } catch { /* 이미 끝남 */ }
  prepW = null;
  try { (await import("./core/ppstructure.js")).shutdownModels(); } catch { /* 모델을 안 씀 */ }
  try { (await import("./core/ocr.js")).shutdownOcr(); } catch { /* OCR 을 안 씀 */ }
}
// 앱을 켤 때: 작업 스레드만 띄워 둔다. Kiwi 는 PDF 를 처음 준비할 때 불러온다 — 예전에는 켜자마자 불러
// PDF 를 한 번도 열지 않아도 메인 프로세스가 약 1GB 였다.
export const warmUp = () => { prepareWorker(); };
// 사용자가 파일을 고르기 시작하면(서브뷰 "내 컴퓨터에서 열기"·드라이브 창) 고르는 동안 Kiwi 를 미리 불러온다 — 쓰지 않으면 똑같이 내려놓는다
function warmKiwi() { const w = prepareWorker(); if (!w) return; w.postMessage({ warm: true }); if (!prepJobs.size) schedulePrepRelease(); }

const sessions = new Map();     // id → PdfSession
let seq = 0;
let hotSessionId = null;
function activeSession(id) {
  const s = sessions.get(id);
  if (s) { sessions.delete(id); sessions.set(id, s); } // 최근 사용한 문서를 뒤로 보내 LRU 순서를 유지한다.
  return s;
}
function activatePdfView(id) {
  if (hotSessionId === id) return;
  hotSessionId = id;
  for (const [otherId, other] of sessions) if (otherId !== id) other.trimViewCaches?.();
}
async function openPdf(bytes, name) {
  const m = await mods();
  const s = await new m.PdfSession(bytes, name).open();
  const id = String(++seq);
  s.id = id;
  s.annotationKey = crypto.createHash("sha256").update(bytes).digest("hex");
  s.ocrLangDir = OCR_DIR;
  s.ppDir = PP_DIR;
  // AI 레이아웃 결과 저장 자리(파일 해시 + 모델 버전): 같은 PDF 를 다시 열면 모델을 다시 돌리지 않는다
  s.layoutStore = path.join(path.dirname(SETTINGS_FILE), "layout-cache", s.annotationKey + "-" + PP_LAYOUT_TAG + ".json");
  s.ocrLanguages = loadSettings().ocrLanguages;
  s.autoLayout = !!loadSettings().pdfRules?.scanTables;
  sessions.set(id, s);
  // 기다리지 않는다(뒤에서). 준비가 끝나면, 레이아웃 분석을 켜 둔 경우 모든 쪽의 레이아웃을 한 쪽씩 미리 읽어 둔다
  // (문서화를 누를 때 96쪽이면 2분 넘게 기다렸다). 문서화를 누르면 같은 기억을 이어 쓰고 두 쪽씩 동시에 돈다.
  s.prepareConversion(spacer, prepareInWorker).then(async () => {   // spacer: 작업 스레드를 못 쓸 때만 여기서 불러온다
    if (!s.state.ready || !loadSettings().pdfRules?.scanTables) return;
    const { ppModelsInstalled } = await import("./core/ppstructure.js");
    if (!ppModelsInstalled(PP_DIR)) return;
    s.scheduleLayoutPrefetch();
  });
  return { id, name, pages: s.pageSizes.length, ms: Date.now() - s.state.t0 };
}

// 사용자 자료(설정·PDF 주석·OCR 언어): 홈 폴더의 .ogolgye-word. 프로그램 폴더 밖이라 업데이트해도 남는다.
// (시험할 때는 OGOLGYE_SETTINGS 로 다른 곳을 쓸 수 있다)
const SETTINGS_FILE = process.env.OGOLGYE_SETTINGS || path.join(os.homedir(), ".ogolgye-word", "settings.json");
const PDF_ANNOTATIONS_DIR = () => path.join(path.dirname(SETTINGS_FILE), "pdf-annotations");
// pdfRules: PDF 문서화의 "규칙 적용" — 오브젝트 그림(objectImages)·표 모양 유지(tables)·문단 사이 빈 줄 살리기(blankLines)
//   ·스캔본 표 인식(scanTables, 모델을 내려받아야 해서 처음에는 끔)
const DEFAULT_PDF_RULES = { objectImages: true, tables: true, blankLines: true, scanTables: false };
const DEFAULT_SETTINGS = { accent: "#6b7b3a", subviewPosition: "right", ruler: false, ocrLanguages: ["kor", "eng"], pdfRules: DEFAULT_PDF_RULES };
const cleanPdfRules = (v) => Object.fromEntries(Object.entries(DEFAULT_PDF_RULES).map(([k, d]) => [k, typeof v?.[k] === "boolean" ? v[k] : d]));
function loadSettings() {
  try {
    const next = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) };
    next.ocrLanguages = cleanOcrLanguages(next.ocrLanguages);
    next.pdfRules = cleanPdfRules(next.pdfRules);
    return next;
  } catch { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  if (!/^#[0-9a-f]{6}$/i.test(next.accent || "")) next.accent = DEFAULT_SETTINGS.accent;
  if (!["left", "right"].includes(next.subviewPosition)) next.subviewPosition = "right";
  next.ruler = next.ruler === true;
  next.ocrLanguages = cleanOcrLanguages(next.ocrLanguages);
  next.pdfRules = cleanPdfRules(next.pdfRules);
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
  return next;
}

// 그림 속 글자 읽기(OCR) 언어: 고른 언어 자료만 한 번 내려받고, 인식은 컴퓨터 안에서 한다
// 언어 자료는 사용자 자료 폴더에 둔다(프로그램 폴더는 업데이트할 때 통째로 바뀌어 새로 받은 언어가 사라진다).
// 프로그램에 들어 있는 기본 언어(한국어·영어)는 처음 한 번 복사해 온다.
const OCR_DIR = path.join(path.dirname(SETTINGS_FILE), "ocr");
// 스캔본 표 인식 모델(PP-Structure, 약 131MB): 켤 때 한 번 내려받는다(core/ppstructure.js)
const PP_DIR = path.join(path.dirname(SETTINGS_FILE), "models", "pp-structure");
const PP_LAYOUT_TAG = "dc5670eb";   // 레이아웃 모델(PP-DocLayoutV3.onnx sha256 앞부분) — 모델이 바뀌면 저장된 결과를 쓰지 않는다
const ppInstall = { running: false, done: 0, total: 0, error: "" };
// 모델 실행 엔진(onnxruntime-node)이 이 컴퓨터에서 돌아가는가 — 맥은 애플 실리콘(arm64)용만 있어 인텔 맥에서는 쓸 수 없다
let ppSupported = null;
async function ppRuntimeOk() {
  if (ppSupported === null) ppSupported = await import("onnxruntime-node").then(() => true, () => false);
  return ppSupported;
}
async function ppStatus() {
  const { ppModelsInstalled } = await import("./core/ppstructure.js");
  return { supported: await ppRuntimeOk(), installed: ppModelsInstalled(PP_DIR), ...ppInstall };
}
async function ppStartInstall() {
  const { installPpModels, ppModelsInstalled } = await import("./core/ppstructure.js");
  if (!(await ppRuntimeOk())) return { ...(await ppStatus()), error: "이 컴퓨터에서는 표 인식 모델을 실행할 수 없습니다(인텔 맥 등)." };
  if (ppInstall.running || ppModelsInstalled(PP_DIR)) return ppStatus();
  Object.assign(ppInstall, { running: true, done: 0, total: 0, error: "" });
  installPpModels(PP_DIR, (done, total) => Object.assign(ppInstall, { done, total }))
    .catch((e) => { ppInstall.error = String(e?.message || e); })
    .finally(() => { ppInstall.running = false; });
  return ppStatus();
}
const BUILTIN_OCR_DIR = path.join(__dirname, "models", "ocr");
try {
  fs.mkdirSync(OCR_DIR, { recursive: true });
  for (const n of fs.readdirSync(BUILTIN_OCR_DIR).filter((f) => f.endsWith(".traineddata"))) {
    if (!fs.existsSync(path.join(OCR_DIR, n))) fs.copyFileSync(path.join(BUILTIN_OCR_DIR, n), path.join(OCR_DIR, n));
  }
} catch { /* 기본 언어 자료 없음(npm run get-model 전) */ }
const OCR_COMMON = [
  ["kor", "한국어"], ["eng", "영어"], ["jpn", "일본어"], ["chi_sim", "중국어(간체)"], ["chi_tra", "중국어(번체)"],
  ["fra", "프랑스어"], ["deu", "독일어"], ["spa", "스페인어"], ["ita", "이탈리아어"], ["por", "포르투갈어"],
  ["rus", "러시아어"], ["ukr", "우크라이나어"], ["vie", "베트남어"], ["tha", "태국어"], ["ind", "인도네시아어"],
  ["ara", "아랍어"], ["heb", "히브리어"], ["hin", "힌디어"], ["tur", "튀르키예어"], ["nld", "네덜란드어"],
];
const validOcrCode = (v) => /^[a-z][a-z0-9_]{1,19}$/.test(String(v || ""));
function cleanOcrLanguages(value) {
  const out = [...new Set((Array.isArray(value) ? value : DEFAULT_SETTINGS.ocrLanguages).map(String).filter(validOcrCode))].slice(0, 8);
  return out.length ? out : [...DEFAULT_SETTINGS.ocrLanguages];
}
function installedOcrLanguages() {
  try { return fs.readdirSync(OCR_DIR).filter((n) => n.endsWith(".traineddata") && fs.statSync(path.join(OCR_DIR, n)).size > 100000).map((n) => n.slice(0, -12)); }
  catch { return []; }
}
async function installOcrLanguages(languages) {
  fs.mkdirSync(OCR_DIR, { recursive: true });
  const installed = new Set(installedOcrLanguages()), downloaded = [];
  for (const code of languages) {
    if (installed.has(code)) continue;
    const target = path.join(OCR_DIR, `${code}.traineddata`), temp = `${target}.${process.pid}.tmp`;
    try {
      const r = await fetch(`https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/${code}.traineddata`);
      if (!r.ok) throw new Error(`${code} 언어 자료를 찾지 못했습니다. (HTTP ${r.status})`);
      const data = Buffer.from(await r.arrayBuffer());
      if (data.length < 100000 || data.length > 60 * 1024 * 1024) throw new Error(`${code} 언어 자료가 올바르지 않습니다.`);
      fs.writeFileSync(temp, data); fs.renameSync(temp, target); downloaded.push(code);
    } catch (e) { try { fs.unlinkSync(temp); } catch { /* 없음 */ } throw e; }
  }
  return downloaded;
}
function ocrLanguageState(downloaded = []) {
  const selected = loadSettings().ocrLanguages, installed = installedOcrLanguages();
  const names = new Map(OCR_COMMON), known = new Set(names.keys());
  const extras = [...new Set([...selected, ...installed])].filter((code) => !known.has(code)).map((code) => [code, code]);
  return {
    languages: [...OCR_COMMON, ...extras].map(([code, name]) => ({ code, name: names.get(code) || name, installed: installed.includes(code) })),
    selected, installed, downloaded,
  };
}
async function setOcrLanguages(raw) {
  if (!Array.isArray(raw) || raw.some((code) => !validOcrCode(code)) || raw.length > 8) throw Object.assign(new Error("OCR 언어 코드는 영문 소문자·숫자·밑줄로 입력하고, 최대 8개까지 선택할 수 있습니다."), { status: 400 });
  const languages = cleanOcrLanguages(raw);
  const downloaded = await installOcrLanguages(languages);
  saveSettings({ ocrLanguages: languages });
  for (const session of sessions.values()) session.setOcrLanguages(languages);
  return ocrLanguageState(downloaded);
}

// PDF 주석(형광펜·북마크·포스트잇 메모): 파일 내용(해시)별로 저장한다
function cleanPdfAnnotations(raw) {
  const point = (v) => Number.isFinite(+v) ? Math.max(0, Math.min(100000, +v)) : 0;
  const text = (v, max = 5000) => String(v || "").slice(0, max);
  const id = (v) => /^[\w-]{1,100}$/.test(String(v || "")) ? String(v) : crypto.randomUUID();
  const page = (v) => Math.max(0, Math.floor(+v || 0));
  const list = (v, max) => (Array.isArray(v) ? v : []).slice(0, max);
  return {
    version: 1,
    highlights: list(raw?.highlights, 5000).map((h) => ({
      id: id(h.id), page: page(h.page), color: /^#[0-9a-f]{6}$/i.test(h.color) ? h.color : "#ffe066",
      text: text(h.text), rects: list(h.rects, 200).map((r) => ({ x: point(r.x), y: point(r.y), w: point(r.w), h: point(r.h) })),
    })).filter((h) => h.rects.some((r) => r.w > 0 && r.h > 0)),
    // y: 선택한 글자에서 만든 북마크의 위치(쪽 높이의 %)
    bookmarks: list(raw?.bookmarks, 2000).map((b) => ({
      id: id(b.id), page: page(b.page), label: text(b.label, 200), ...(Number.isFinite(+b.y) && b.y !== null && b.y !== "" ? { y: point(b.y) } : {}),
    })),
    // quote: 선택한 글자에서 만든 메모의 인용문, folded: 접어 둔 포스트잇
    notes: list(raw?.notes, 5000).map((n) => ({
      id: id(n.id), page: page(n.page), x: point(n.x), y: point(n.y), text: text(n.text),
      ...(n.quote ? { quote: text(n.quote, 200) } : {}), ...(n.folded ? { folded: true } : {}),
    })).filter((n) => n.text.trim() || n.quote),
  };
}
const pdfAnnotationsFile = (session) => path.join(PDF_ANNOTATIONS_DIR(), session.annotationKey + ".json");
function loadPdfAnnotations(session) {
  try { return cleanPdfAnnotations(JSON.parse(fs.readFileSync(pdfAnnotationsFile(session), "utf8"))); }
  catch { return cleanPdfAnnotations(null); }
}
function savePdfAnnotations(session, value) {
  const cleaned = cleanPdfAnnotations(value);
  fs.mkdirSync(PDF_ANNOTATIONS_DIR(), { recursive: true });
  fs.writeFileSync(pdfAnnotationsFile(session), JSON.stringify(cleaned), "utf8");
  return cleaned;
}
const accentStyle = () => `<style id="og-accent">:root{--og-accent:${loadSettings().accent}}</style>`;

// 빈 문서(HWPX)
let blankBytes = null;
async function blankDocument() {
  if (blankBytes) return blankBytes;
  const { rhwpEngine, DEFAULT_FONT } = await import("./core/hwpx-from-model.js");
  const { HwpDocument } = await rhwpEngine();
  const doc = HwpDocument.createEmpty();
  doc.createBlankDocument();
  const fontId = doc.findOrCreateFontId(DEFAULT_FONT);
  if (fontId >= 0) doc.updateStyleShapes(0, JSON.stringify({ fontId }), JSON.stringify({}));
  blankBytes = Buffer.from(doc.exportHwpx());
  doc.free?.();
  return blankBytes;
}

function readBody(req, limit = 300 * 1024 * 1024) {
  return new Promise((ok, fail) => {
    const parts = []; let n = 0;
    req.on("data", (c) => { n += c.length; if (n > limit) { fail(new Error("too large")); req.destroy(); } else parts.push(c); });
    req.on("end", () => ok(Buffer.concat(parts)));
    req.on("error", fail);
  });
}
const readJson = async (req, limit) => {
  if (!/^application\/json(?:;|$)/i.test(String(req.headers["content-type"] || ""))) {
    const e = new Error("JSON 요청 형식이 아닙니다."); e.status = 415; throw e;
  }
  return JSON.parse((await readBody(req, limit)).toString("utf8") || "{}");
};
const sendJson = (res, status, body, extra = {}) => res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...extra }).end(JSON.stringify(body));
const sendBytes = (res, bytes, type = "application/octet-stream", extra = {}) => res.writeHead(200, { "Content-Type": type, ...extra }).end(bytes);

function cookieValue(req, name) {
  const part = String(req.headers.cookie || "").split(";").map((s) => s.trim()).find((s) => s.startsWith(name + "="));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : "";
}
function sameSecret(a, b) {
  const aa = Buffer.from(String(a || "")), bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
}
function loopbackHost(host) {
  try { return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(`http://${host}`).hostname); }
  catch { return false; }
}
function securityHeaders(res, pathname) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  let csp = "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'";
  if (pathname.startsWith("/studio/")) csp += " 'unsafe-eval' 'wasm-unsafe-eval'";
  if (/^\/pdf\/\d+\/view$/.test(pathname)) csp = "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'";
  res.setHeader("Content-Security-Policy", csp);
}

// 편집 화면(rhwp-studio)에 오골계 워드 테마와 메뉴 연결 스크립트를 끼워 넣는다(rhwp 소스는 건드리지 않음)
function patchStudioHtml(html) {
  return html
    .replace("</head>", '<link rel="stylesheet" href="/app/studio-theme.css">\n' + accentStyle() + "\n</head>")
    .replace("</body>", '<script src="/app/studio-bridge.js"></script>\n</body>');
}

function serveStatic(res, base, rel) {
  const file = path.normalize(path.join(base, decodeURIComponent(rel || "index.html")));
  if (file !== base && !file.startsWith(base + path.sep)) { res.writeHead(403).end(); return; }
  fs.stat(file, (err, st) => {
    const f = !err && st.isDirectory() ? path.join(file, "index.html") : file;
    fs.readFile(f, (e, data) => {
      if (e) { res.writeHead(404).end("not found"); return; }
      const studioIndex = base === STATIC["/studio/"] && f === path.join(base, "index.html");
      sendBytes(res, studioIndex ? patchStudioHtml(data.toString("utf8")) : data, MIME[path.extname(f).toLowerCase()], { "Cache-Control": "no-cache" });
    });
  });
}

// 브라우저로 띄운 경우에 쓰는 변환 API(데스크톱 앱은 같은 일을 메인 프로세스에서 한다)
const API = {
  async "/api/export-office"(req, res) {
    const { format, model } = await readJson(req, 200 * 1024 * 1024);
    const { officeExport } = await import("./core/export-office.js");
    sendBytes(res, officeExport(format, model));
  },
  async "/api/hwpx-from-model"(req, res) {
    const { model, pageless } = await readJson(req, 200 * 1024 * 1024);
    const { hwpxFromModel } = await import("./core/hwpx-from-model.js");
    sendBytes(res, await hwpxFromModel(model, { pageless: pageless ?? null }));
  },
  async "/api/docx-parts"(req, res) {
    const { docxParts } = await import("./core/unzip.js");
    sendJson(res, 200, docxParts(await readBody(req, 200 * 1024 * 1024)));
  },
  async "/api/pdf"(req, res, url) {
    sendJson(res, 200, await openPdf(await readBody(req), url.searchParams.get("name") || "문서.pdf"));
  },
};

// /pdf/{id}/… : 열어 둔 PDF 한 부
async function servePdf(req, res, url, s, what) {
  if (what === "view") { const h = (await mods()).buildShellHtml(s.id, s.meta()); sendBytes(res, h.replace("</head>", accentStyle() + "</head>"), MIME[".html"]); return; }
  if (what === "status") { sendJson(res, 200, s.meta()); return; }
  // 서브뷰에서 PDF 탭을 닫으면: 세션(쪽 그림·글자층·문단 복원 결과, 탭마다 50~110MB)을 바로 내려놓는다
  if (what === "close" && req.method === "POST") { s.close(); sessions.delete(s.id); sendJson(res, 200, { ok: true }); return; }
  if (what === "annotations") {
    sendJson(res, 200, req.method === "POST" ? savePdfAnnotations(s, await readJson(req, 2 * 1024 * 1024)) : loadPdfAnnotations(s), { "Cache-Control": "no-store" });
    return;
  }
  if (what === "images.zip") {
    // 그림 모두 내려받기: 보기 화면의 그림(배경 없이 꺼낸 오브젝트)을 쪽 순서대로 한 ZIP 으로
    // POST {ids:["쪽:그림id", …]} 이면 목록에서 고른 그림만(그림 내보내기 창), GET 이면 모두
    const body = req.method === "POST" ? await readJson(req, 1024 * 1024) : null;
    const entries = s.figureZipEntries(Array.isArray(body?.ids) ? body.ids : null);
    if (!entries) { sendJson(res, 409, { error: "아직 그림을 찾는 중입니다." }); return; }
    if (!entries.length) { sendJson(res, 404, { error: body ? "고른 그림을 꺼내지 못했습니다." : "이 PDF에는 꺼낼 그림이 없습니다." }); return; }
    const { zipBytes } = await import("./core/export-files.js");
    const base = String(s.name || "PDF").replace(/\.pdf$/i, "") + "-그림.zip";
    sendBytes(res, zipBytes(entries), "application/zip", { "Content-Disposition": `attachment; filename="images.zip"; filename*=UTF-8''${encodeURIComponent(base)}`, "Cache-Control": "no-store" });
    return;
  }
  if (what === "figures") { const list = s.figureList(); sendJson(res, list ? 200 : 409, list || []); return; }
  if (what === "content") {
    const pages = (url.searchParams.get("pages") || "").split(",").filter(Boolean).map(Number);
    if (!pages.length || pages.some((n) => !Number.isInteger(n) || n < 0 || n >= s.pageSizes.length)) { sendJson(res, 400, { error: "페이지 범위가 올바르지 않습니다." }); return; }
    // 사진·스캔 쪽은 여기서 그림 속 글자(OCR)를 읽어 함께 넣는다(아직 읽지 않은 쪽이면 시간이 걸린다)
    // 규칙 적용(images=1: 오브젝트 그림, tables=1: 표 모양 유지, blanks=1: 문단 사이 빈 줄 살리기, scan=1: 스캔본 표 인식). 모두 없으면 글만
    const on = (k) => url.searchParams.get(k) === "1";
    const c = await s.content(pages, { includeImages: on("images"), keepTables: on("tables"), keepBlankLines: on("blanks"), scanTables: on("scan") });
    if (!c) { sendJson(res, 409, { error: "문서화 준비 중입니다." }); return; }
    if (!c.text.trim() && !s.ocrReady()) { sendJson(res, 409, { error: "가져올 본문이 없습니다. 사진·스캔 PDF라면 도구 → 환경 설정 → OCR 언어에서 언어 자료를 설치해 주세요." }); return; }
    sendJson(res, 200, { text: c.text, html: c.html, pages: pages.map((n) => n + 1) });
    return;
  }
  let m;
  if ((m = what.match(/^thumb\/(\d+)\.jpg$/)) && +m[1] < s.pageSizes.length) { sendBytes(res, Buffer.from(s.pageThumb(+m[1])), "image/jpeg", { "Cache-Control": "max-age=3600" }); return; }
  if ((m = what.match(/^page\/(\d+)\.jpg$/))) { sendBytes(res, Buffer.from(s.pageImage(+m[1])), "image/jpeg", { "Cache-Control": "max-age=3600" }); return; }
  if ((m = what.match(/^text\/(\d+)$/))) { sendBytes(res, s.textLayer(+m[1]), MIME[".html"]); return; }
  if ((m = what.match(/^ocr\/(\d+)$/))) {
    const h = await s.ocrPage(+m[1]);                     // null: 언어 자료 없음
    res.writeHead(h === null ? 409 : 200, { "Content-Type": MIME[".html"] }).end(h || ""); return;
  }
  if ((m = what.match(/^image\/(\d+)\/([\w-]+)$/))) {
    const file = s.figureFile(+m[1], m[2]);
    if (!file) { res.writeHead(404).end("그림 없음"); return; }
    const ext = String(file.ext || "png").toLowerCase().replace("jpg", "jpeg");
    sendBytes(res, Buffer.from(file.data), `image/${ext}`, { "Cache-Control": "max-age=3600" });
    return;
  }
  res.writeHead(404).end("not found");
}

export function startServer(port = 0, { authToken = "" } = {}) {
  if (process.env.OG_TRACE) {                                    // 진단(OG_TRACE=1): 서버가 막힌 구간(200ms 넘게)과 느린 요청을 터미널에
    let last = performance.now();
    setInterval(() => { const n = performance.now(), lag = n - last - 50; if (lag > 200) console.error(`[lag] ${Math.round(lag)}ms at ${new Date().toISOString().slice(11, 23)}`); last = n; }, 50).unref();
  }
  const server = http.createServer(async (req, res) => {
    if (process.env.OG_TRACE) { const t0 = performance.now(); res.on("finish", () => { const ms = performance.now() - t0; if (ms > 150 || /view|status/.test(req.url)) console.error(`[req] ${Math.round(ms)}ms ${req.url.slice(0, 60)} at ${new Date().toISOString().slice(11, 23)}`); }); }
    try {
      const url = new URL(req.url, "http://localhost");
      const p = url.pathname;
      securityHeaders(res, p);
      if (!loopbackHost(req.headers.host)) { res.writeHead(421).end("잘못된 호스트"); return; }
      if (authToken && !sameSecret(cookieValue(req, "ogolgye_session"), authToken)) { res.writeHead(401).end("인증되지 않은 요청"); return; }
      if (authToken && req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) { res.writeHead(403).end("허용되지 않은 출처"); return; }
      if (p === "/") { res.writeHead(302, { Location: "/app/" }).end(); return; }
      if (API[p] && req.method === "POST") { await API[p](req, res, url); return; }
      if (p === "/api/blank") { sendBytes(res, await blankDocument()); return; }
      if (p === "/api/prepare-warm") { warmKiwi(); sendJson(res, 200, { ok: true }); return; }
      // 제품 정보: 오골계 워드 라이선스와 오픈소스 라이선스 원문(core/licenses.js)
      if (p === "/api/licenses" || p.startsWith("/api/licenses/") || p === "/licenses/chromium") {
        const lic = await import("./core/licenses.js");
        if (p === "/api/licenses") { sendJson(res, 200, lic.licenseSummary()); return; }
        if (p === "/licenses/chromium") {
          const f = lic.chromiumLicensePath();
          if (!f) { res.writeHead(404).end("Chromium 라이선스 파일을 찾지 못했습니다."); return; }
          sendBytes(res, fs.readFileSync(f), MIME[".html"], { "Cache-Control": "max-age=3600" }); return;
        }
        const detail = lic.licenseDetail(decodeURIComponent(p.slice("/api/licenses/".length)));
        if (detail) sendJson(res, 200, detail); else sendJson(res, 404, { error: "없는 항목입니다." });
        return;
      }
      if (p === "/api/ocr-languages") {
        try { sendJson(res, 200, req.method === "POST" ? await setOcrLanguages((await readJson(req, 65536)).languages) : ocrLanguageState(), { "Cache-Control": "no-store" }); }
        catch (e) { sendJson(res, e.status || 500, { error: String(e?.message || e) }); }
        return;
      }
      if (p === "/api/pp-structure") { sendJson(res, 200, req.method === "POST" ? await ppStartInstall() : await ppStatus(), { "Cache-Control": "no-store" }); return; }
      if (p === "/api/settings") {
        const patch = req.method === "POST" ? await readJson(req, 65536) : null;
        const settings = patch ? saveSettings(patch) : loadSettings();
        if (patch && Object.prototype.hasOwnProperty.call(patch, "pdfRules")) for (const s of sessions.values()) {
          s.autoLayout = !!settings.pdfRules.scanTables;
          if (s.autoLayout && s.state.ready) s.scheduleLayoutPrefetch(); else s.cancelLayoutPrefetch();
        }
        sendJson(res, 200, settings); return;
      }
      const pm = p.match(/^\/pdf\/(\d+)\/(.+)$/);
      if (pm) {
        const s = activeSession(pm[1]);
        if (!s) { res.writeHead(404).end("닫힌 문서"); return; }
        if (pm[2] === "view" || /^page\/\d+\.jpg$/.test(pm[2])) activatePdfView(pm[1]);
        await servePdf(req, res, url, s, pm[2]); return;
      }
      for (const [prefix, base] of Object.entries(STATIC)) if (p.startsWith(prefix)) { serveStatic(res, base, p.slice(prefix.length)); return; }
      res.writeHead(404).end("not found");
    } catch (e) {
      if (!res.headersSent) sendJson(res, e?.status || 500, { error: String(e?.message || e) });
    }
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok({ server, port: server.address().port })));
}

// node server.js 로 직접 실행
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { port } = await startServer(+process.env.PORT || 7801);
  warmUp();
  console.log(`오골계 워드 서버: http://127.0.0.1:${port}/app/`);
}
