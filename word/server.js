// 오골계 워드 로컬 서버: 편집 화면(rhwp-studio), 앱 화면, PDF 변환을 127.0.0.1 에서만 제공한다.
// Electron 없이 `node server.js` 로 띄우면 브라우저에서도 시험할 수 있다.
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import os from "os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf", ".webmanifest": "application/manifest+json" };

// 정적 파일 위치
const STATIC = {
  "/app/": path.join(__dirname, "renderer"),
  "/studio/": path.join(__dirname, "vendor", "rhwp-studio"),
  "/vendor/rhwp-editor/": path.dirname(require.resolve("@rhwp/editor")),
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
  s.ocrLangDir = path.join(__dirname, "models", "ocr");
  sessions.set(id, s);
  if (sessions.size > 6) { const [oldId, old] = sessions.entries().next().value; old.close(); sessions.delete(oldId); }
  s.prepareConversion(spacer());                      // 기다리지 않는다(뒤에서)
  return { id, name, pages: s.input.pages.length, ms: s.state.tText };
}

// 설정(테마색 등): Electron 은 사용자 데이터 폴더, 아니면 홈 폴더의 .ogolgye-word
const SETTINGS_FILE = process.env.OGOLGYE_SETTINGS || path.join(os.homedir(), ".ogolgye-word", "settings.json");
const DEFAULT_SETTINGS = { accent: "#6b7b3a", subviewPosition: "right" };
function loadSettings() { try { return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) }; } catch { return { ...DEFAULT_SETTINGS }; } }
function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  if (next.accent && !/^#[0-9a-f]{6}$/i.test(next.accent)) delete next.accent;
  if (!['left', 'right'].includes(next.subviewPosition)) next.subviewPosition = "right";
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
  return next;
}
const accentStyle = () => `<style id="og-accent">:root{--og-accent:${loadSettings().accent}}</style>`;

// 빈 문서(HWPX)
let blankBytes = null;
async function blankDocument() {
  if (blankBytes) return blankBytes;
  const { initSync, HwpDocument } = await import("@rhwp/core");
  initSync({ module: fs.readFileSync(path.join(path.dirname(require.resolve("@rhwp/core")), "rhwp_bg.wasm")) });
  const doc = HwpDocument.createEmpty();
  doc.createBlankDocument();
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

// 편집 화면(rhwp-studio)에 오골계 워드 테마와 메뉴 연결 스크립트를 끼워 넣는다(rhwp 소스는 건드리지 않음)
function patchStudioHtml(html) {
  return html
    .replace("</head>", '<link rel="stylesheet" href="/app/studio-theme.css">\n' + accentStyle() + "\n</head>")
    .replace("</body>", '<script src="/app/studio-bridge.js"></script>\n</body>');
}

function serveStatic(res, base, rel) {
  const file = path.normalize(path.join(base, decodeURIComponent(rel || "index.html")));
  if (!file.startsWith(base)) { res.writeHead(403).end(); return; }
  fs.stat(file, (err, st) => {
    const f = !err && st.isDirectory() ? path.join(file, "index.html") : file;
    fs.readFile(f, (e, data) => {
      if (e) { res.writeHead(404).end("not found"); return; }
      res.writeHead(200, { "Content-Type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
      res.end(base === STATIC["/studio/"] && path.basename(f) === "index.html" && path.dirname(f) === base ? patchStudioHtml(data.toString("utf8")) : data);
    });
  });
}

export function startServer(port = 0) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const p = url.pathname;
      if (p === "/") { res.writeHead(302, { Location: "/app/" }).end(); return; }
      if (p === "/api/blank") { const b = await blankDocument(); res.writeHead(200, { "Content-Type": "application/octet-stream" }).end(b); return; }
      if (p === "/api/pdf" && req.method === "POST") {
        const info = await openPdf(await readBody(req), url.searchParams.get("name") || "문서.pdf");
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(info)); return;
      }
      const contentMatch = p.match(/^\/pdf\/(\d+)\/content$/);
      if (contentMatch) {
        const s = sessions.get(contentMatch[1]);
        if (!s) { res.writeHead(404).end("닫힌 문서"); return; }
        const pages = (url.searchParams.get("pages") || "").split(",").filter(Boolean).map(Number);
        if (!pages.length || pages.some((n) => !Number.isInteger(n) || n < 0 || n >= s.input.pages.length)) {
          res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "페이지 범위가 올바르지 않습니다." })); return;
        }
        const text = s.contentText(pages);
        if (text === null) { res.writeHead(409, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "문서화 준비 중입니다." })); return; }
        const html = s.contentHtml(pages, { includeImages: url.searchParams.get("images") === "1" });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify({ text, html, pages: pages.map((n) => n + 1) })); return;
      }
      const m = p.match(/^\/pdf\/(\d+)\/(view|status|fonts\.css|page\/(\d+)\.jpg|text\/(\d+)|conv\/(\d+)|convbg\/(\d+)\.jpg|ocr\/(\d+))$/);
      if (m) {
        const s = sessions.get(m[1]);
        if (!s) { res.writeHead(404).end("닫힌 문서"); return; }
        const what = m[2];
        if (what === "view") { const h = (await mods()).buildShellHtml(m[1], s.meta()); res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(h.replace("</head>", accentStyle() + "</head>")); return; }
        if (what === "status") { res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(s.meta())); return; }
        if (what === "fonts.css") { res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" }).end(s.fontCss()); return; }
        if (m[3] !== undefined) { res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "max-age=3600" }).end(Buffer.from(s.pageImage(+m[3]))); return; }
        if (m[4] !== undefined) { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(s.textLayer(+m[4])); return; }
        if (m[7] !== undefined) { const h = await s.ocrPage(+m[7]); res.writeHead(h === null ? 409 : 200, { "Content-Type": "text/html; charset=utf-8" }).end(h || ""); return; }
        if (m[6] !== undefined) { const j = s.convBackground(+m[6]); res.writeHead(j ? 200 : 409, { "Content-Type": "image/jpeg", "Cache-Control": "max-age=3600" }).end(j ? Buffer.from(j) : ""); return; }
        if (m[5] !== undefined) { const h = s.convPage(+m[5]); res.writeHead(h === null ? 409 : 200, { "Content-Type": "text/html; charset=utf-8" }).end(h || ""); return; }
      }
      if (p === "/api/settings") {
        const body = req.method === "POST" ? saveSettings(JSON.parse((await readBody(req, 65536)).toString("utf8") || "{}")) : loadSettings();
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body)); return;
      }
      for (const [prefix, base] of Object.entries(STATIC)) if (p.startsWith(prefix)) { serveStatic(res, base, p.slice(prefix.length)); return; }
      res.writeHead(404).end("not found");
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: String(e && e.message || e) }));
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
