// 오골계 워드 로컬 서버: 편집 화면(rhwp-studio), 앱 화면, PDF 보기를 127.0.0.1 에서만 제공한다.
// Electron 없이 `node server.js` 로 띄우면 브라우저에서도 시험할 수 있다.
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import os from "os";
import crypto from "crypto";

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
const spacer = () => (spacerP ||= mods().then((m) => m.createKiwiSpacer(path.join(__dirname, "models", "kiwi"))).catch(() => null));
export const warmUp = () => { spacer(); };          // 앱을 켤 때 미리 불러 둔다(PDF를 처음 열 때 기다리지 않게)

const sessions = new Map();     // id → PdfSession
let seq = 0;
async function openPdf(bytes, name) {
  const m = await mods();
  const s = await new m.PdfSession(bytes, name).open();
  const id = String(++seq);
  s.id = id;
  s.annotationKey = crypto.createHash("sha256").update(bytes).digest("hex");
  s.ocrLangDir = OCR_DIR;
  s.ocrLanguages = loadSettings().ocrLanguages;
  sessions.set(id, s);
  if (sessions.size > 6) { const [oldId, old] = sessions.entries().next().value; old.close(); sessions.delete(oldId); }
  s.prepareConversion(spacer());                      // 기다리지 않는다(뒤에서)
  return { id, name, pages: s.pageSizes.length, ms: Date.now() - s.state.t0 };
}

// 사용자 자료(설정·PDF 주석·OCR 언어): 홈 폴더의 .ogolgye-word. 프로그램 폴더 밖이라 업데이트해도 남는다.
// (시험할 때는 OGOLGYE_SETTINGS 로 다른 곳을 쓸 수 있다)
const SETTINGS_FILE = process.env.OGOLGYE_SETTINGS || path.join(os.homedir(), ".ogolgye-word", "settings.json");
const PDF_ANNOTATIONS_DIR = () => path.join(path.dirname(SETTINGS_FILE), "pdf-annotations");
const DEFAULT_SETTINGS = { accent: "#6b7b3a", subviewPosition: "right", ruler: false, ocrLanguages: ["kor", "eng"] };
function loadSettings() {
  try {
    const next = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) };
    next.ocrLanguages = cleanOcrLanguages(next.ocrLanguages);
    return next;
  } catch { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  if (!/^#[0-9a-f]{6}$/i.test(next.accent || "")) next.accent = DEFAULT_SETTINGS.accent;
  if (!["left", "right"].includes(next.subviewPosition)) next.subviewPosition = "right";
  next.ruler = next.ruler === true;
  next.ocrLanguages = cleanOcrLanguages(next.ocrLanguages);
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
  return next;
}

// 그림 속 글자 읽기(OCR) 언어: 고른 언어 자료만 한 번 내려받고, 인식은 컴퓨터 안에서 한다
// 언어 자료는 사용자 자료 폴더에 둔다(프로그램 폴더는 업데이트할 때 통째로 바뀌어 새로 받은 언어가 사라진다).
// 프로그램에 들어 있는 기본 언어(한국어·영어)는 처음 한 번 복사해 온다.
const OCR_DIR = path.join(path.dirname(SETTINGS_FILE), "ocr");
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
const readJson = async (req, limit) => JSON.parse((await readBody(req, limit)).toString("utf8") || "{}");
const sendJson = (res, status, body, extra = {}) => res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...extra }).end(JSON.stringify(body));
const sendBytes = (res, bytes, type = "application/octet-stream", extra = {}) => res.writeHead(200, { "Content-Type": type, ...extra }).end(bytes);

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
  if (what === "annotations") {
    sendJson(res, 200, req.method === "POST" ? savePdfAnnotations(s, await readJson(req, 2 * 1024 * 1024)) : loadPdfAnnotations(s), { "Cache-Control": "no-store" });
    return;
  }
  if (what === "figures") { const list = s.figureList(); sendJson(res, list ? 200 : 409, list || []); return; }
  if (what === "content") {
    const pages = (url.searchParams.get("pages") || "").split(",").filter(Boolean).map(Number);
    if (!pages.length || pages.some((n) => !Number.isInteger(n) || n < 0 || n >= s.pageSizes.length)) { sendJson(res, 400, { error: "페이지 범위가 올바르지 않습니다." }); return; }
    // 사진·스캔 쪽은 여기서 그림 속 글자(OCR)를 읽어 함께 넣는다(아직 읽지 않은 쪽이면 시간이 걸린다)
    const c = await s.content(pages, { includeImages: url.searchParams.get("images") === "1" });
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

export function startServer(port = 0) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const p = url.pathname;
      if (p === "/") { res.writeHead(302, { Location: "/app/" }).end(); return; }
      if (API[p] && req.method === "POST") { await API[p](req, res, url); return; }
      if (p === "/api/blank") { sendBytes(res, await blankDocument()); return; }
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
      if (p === "/api/settings") { sendJson(res, 200, req.method === "POST" ? saveSettings(await readJson(req, 65536)) : loadSettings()); return; }
      const pm = p.match(/^\/pdf\/(\d+)\/(.+)$/);
      if (pm) {
        const s = sessions.get(pm[1]);
        if (!s) { res.writeHead(404).end("닫힌 문서"); return; }
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
