// 오골계 워드 화면
import { createEditor } from "/vendor/rhwp-editor/index.js";

const STUDIO = "/studio/";
const $ = (s) => document.querySelector(s);
const native = window.ogolgye || null;               // Electron 이면 파일 대화상자를 쓸 수 있다
const DOC_FILTERS = [{ name: "한글 문서", extensions: ["hwp", "hwpx"] }];
const PDF_FILTERS = [{ name: "PDF", extensions: ["pdf"] }];
const EXPORT_FILTERS = {
  pdf: [{ name: "PDF 문서", extensions: ["pdf"] }],
  txt: [{ name: "일반 텍스트", extensions: ["txt"] }],
  md: [{ name: "Markdown", extensions: ["md"] }],
  html: [{ name: "압축된 웹페이지", extensions: ["zip"] }],
  docx: [{ name: "Microsoft Word", extensions: ["docx"] }],
  odt: [{ name: "OpenDocument 텍스트", extensions: ["odt"] }],
  rtf: [{ name: "서식 있는 텍스트", extensions: ["rtf"] }],
  epub: [{ name: "EPUB 출판물", extensions: ["epub"] }],
};

const main = { editor: null, name: "새 문서.hwpx", path: null, dirty: false };
const sub = { kind: null, editor: null, name: "", path: null, dirty: false, viewerId: null };

// 창 제목: 프로그램 이름 - 주 문서 이름 (데스크톱 앱은 제목 표시줄을 화면이 직접 그린다)
if (native) document.documentElement.classList.add("native", native.platform === "darwin" ? "mac" : "win");
function updateTitle() {
  const title = main.name ? `오골계 워드 - ${main.name}` : "오골계 워드";
  document.title = title; $("#app-title").textContent = title;
}
const status = (t) => { $("#status").textContent = t || ""; };
const setDirty = (who, v) => { who.dirty = v; if (who === sub) $("#sub-dirty").hidden = !v; };

async function blankBytes() { return new Uint8Array(await (await fetch("/api/blank")).arrayBuffer()); }

async function newEditor(container, who) {
  // 주 문서 편집 화면에만 "서브뷰" 메뉴가 들어가도록 표시
  return createEditor(container, { studioUrl: STUDIO + (who === main ? "?ogolgye=main" : "") });
}

// ── 파일 고르기(Electron 대화상자, 아니면 브라우저 파일 선택)
function pickFile(filters) {
  if (native) return native.open(filters);
  return new Promise((ok) => {
    const inp = $("#picker");
    inp.accept = filters.flatMap((f) => f.extensions.map((e) => "." + e)).join(",");
    inp.onchange = async () => {
      const f = inp.files[0]; inp.value = "";
      ok(f ? { name: f.name, path: null, bytes: new Uint8Array(await f.arrayBuffer()) } : null);
    };
    inp.click();
  });
}
async function saveBytes(bytes, name, path, filters, forceDialog) {
  if (native) return path && !forceDialog ? native.saveTo(bytes, path) : native.save(bytes, name, filters);
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([bytes])), download: name });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return { name, path: null };
}

// ── 주 문서: 새 문서·열기·저장은 편집 화면의 "파일" 메뉴를 쓴다

// ── 서브뷰
let mainResizeRaf = 0, mainResizeTimer = 0;
function notifyMainResize() {
  const send = () => main.editor?.element?.contentWindow?.postMessage({ type: "ogolgye:host-resize" }, location.origin);
  cancelAnimationFrame(mainResizeRaf);
  mainResizeRaf = requestAnimationFrame(() => requestAnimationFrame(send));
  clearTimeout(mainResizeTimer);
  mainResizeTimer = setTimeout(send, 320);       // 분할바·iframe 배치가 완전히 끝난 뒤 한 번 더 맞춘다
}
function showSub(on) {
  $("#sub-pane").hidden = !on; $("#splitter").hidden = !on;
  notifyMainResize();
}
async function closeSub() {
  if (sub.kind === "doc" && sub.dirty && !confirm("서브뷰 문서에 저장하지 않은 내용이 있습니다. 닫을까요?")) { return false; }
  sub.editor?.destroy?.();
  Object.assign(sub, { kind: null, editor: null, name: "", path: null, dirty: false, viewerId: null });
  $("#sub-body").innerHTML = '<div id="sub-drop" class="drop">PDF 또는 HWP/HWPX 파일을 여기에 끌어다 놓거나<br>위쪽 서브뷰 메뉴에서 여세요.</div>';
  bindDrop(); showSub(false); return true;
}
function subHead(kind, name) {
  $("#sub-kind").textContent = kind === "pdf" ? "PDF" : "문서"; $("#sub-kind").className = "kind " + kind;
  $("#sub-name").textContent = name; setDirty(sub, false);
}
async function openSubPdf(file) {
  if (sub.kind && !(await closeSub())) return;
  showSub(true); subHead("pdf", file.name);
  $("#sub-body").innerHTML = '<div class="busy">PDF를 불러오고 있습니다.</div>';
  const r = await fetch("/api/pdf?name=" + encodeURIComponent(file.name), { method: "POST", body: file.bytes });
  const info = await r.json();
  if (!r.ok) { $("#sub-body").innerHTML = `<div class="busy">PDF를 열 수 없습니다. (${info.error || r.status})</div>`; return; }
  Object.assign(sub, { kind: "pdf", name: file.name, path: file.path, viewerId: info.id });
  $("#sub-body").innerHTML = `<iframe src="/pdf/${info.id}/view" title="PDF 보기"></iframe>`;
  status("");
}
async function openSubDoc(file) {
  if (sub.kind && !(await closeSub())) return;
  showSub(true); subHead("doc", file.name);
  $("#sub-body").innerHTML = "";
  sub.kind = "doc";
  sub.editor = await newEditor($("#sub-body"), sub);
  await sub.editor.loadFile(file.bytes, file.name);
  Object.assign(sub, { name: file.name, path: file.path }); setDirty(sub, false);
}

// ── 테마색: 앱 화면 + 모든 편집 화면 + PDF 창에 적용하고 저장
function applyAccent(color) {
  document.documentElement.style.setProperty("--og-accent", color);
  for (const fr of document.querySelectorAll("iframe")) {
    try { fr.contentDocument?.documentElement.style.setProperty("--og-accent", color); } catch { /* 불러오는 중 */ }
    fr.contentWindow?.postMessage({ type: "ogolgye:theme", color }, location.origin);
  }
}
async function pickAccent(color) {
  applyAccent(color);
  await fetch("/api/settings", { method: "POST", body: JSON.stringify({ accent: color }) });
}
let accent = "#6b7b3a";
let subviewPosition = "right";
let rulerVisible = false;
function applySubviewPosition(position) {
  subviewPosition = position === "left" ? "left" : "right";
  $("#work").classList.toggle("sub-left", subviewPosition === "left");
  for (const fr of document.querySelectorAll("iframe")) fr.contentWindow?.postMessage({ type: "ogolgye:subview-position-state", position: subviewPosition }, location.origin);
  notifyMainResize();
}
async function pickSubviewPosition(position) {
  applySubviewPosition(position);
  await fetch("/api/settings", { method: "POST", body: JSON.stringify({ subviewPosition }) });
}
function applyRuler(visible) {
  rulerVisible = visible !== false;
  for (const fr of document.querySelectorAll("iframe")) fr.contentWindow?.postMessage({ type: "ogolgye:view", ruler: rulerVisible }, location.origin);
}
async function pickRuler(visible) {
  applyRuler(visible);
  await fetch("/api/settings", { method: "POST", body: JSON.stringify({ ruler: rulerVisible }) });
}
fetch("/api/settings").then((r) => r.json()).then((st) => {
  accent = st.accent || accent; applyAccent(accent); applySubviewPosition(st.subviewPosition); applyRuler(st.ruler);
});
// 새로 열린 편집 화면·PDF 창에도 적용
// (iframe 이 불러와질 때마다 보낸다. 넣자마자 보내면 아직 받을 준비가 안 되어 있다)
const syncFrames = () => {
  applyAccent(getComputedStyle(document.documentElement).getPropertyValue("--og-accent").trim() || accent);
  applySubviewPosition(subviewPosition);
  applyRuler(rulerVisible);
  // 편집 화면에 데스크톱 앱 기능(원래 용지로 PDF 저장 등)이 있는지 알린다
  main.editor?.element?.contentWindow?.postMessage({ type: "ogolgye:host-info", native: !!native?.pdf }, location.origin);
};
new MutationObserver((records) => {
  for (const r of records) for (const n of r.addedNodes) {
    for (const fr of n.nodeName === "IFRAME" ? [n] : n.querySelectorAll?.("iframe") || []) fr.addEventListener("load", syncFrames);
  }
}).observe($("#work"), { childList: true, subtree: true });

// 편집 화면 메뉴의 "서브뷰"에서 온 요청
async function subviewAction(action) {
  if (action === "close") { await closeSub(); return; }
  if (action === "pdf") { const f = await pickFile(PDF_FILTERS); if (f) await openSubPdf(f); }
  else if (action === "doc") { const f = await pickFile(DOC_FILTERS); if (f) await openSubDoc(f); }
  else if (action === "blank") await openSubDoc({ name: "새 문서.hwpx", path: null, bytes: await blankBytes() });
}
// 그림이 든 문서화 HTML만 단계로 나눈다. 글만 있을 때는 HTML 전체를 한 번에 넣어 빠르게 처리한다.
function pdfSteps(html) {
  const parsed = new DOMParser().parseFromString(String(html || ""), "text/html");
  const root = parsed.body.children.length === 1 && parsed.body.firstElementChild?.tagName === "DIV" ? parsed.body.firstElementChild : parsed.body;
  const steps = [{ kind: "fresh" }]; let images = 0, freshParagraph = true, pending = [];   // 새 문단에서 시작
  const flush = () => {
    if (!pending.length) return;
    const wrapper = parsed.createElement("div");
    for (const node of pending) wrapper.appendChild(node.cloneNode(true));
    const chunkHtml = wrapper.innerHTML;
    const chunkText = pending.map((node) => node.textContent || "").join("\n");
    if (!freshParagraph) steps.push({ kind: "break" });
    steps.push({ kind: "text", text: chunkText, html: chunkHtml });
    freshParagraph = false; pending = [];
  };
  for (const node of root.children) {
    const img = node.matches("p") ? node.querySelector(":scope > img:only-child") : null;
    const m = img?.getAttribute("src")?.match(/^data:([^;]+);base64,(.+)$/i);
    if (m) {
      flush();
      images++;
      const ext = (m[1].split("/")[1] || "png").replace("jpeg", "jpg");
      // 글자 뒤라면 먼저 새 문단으로 이동한다. 빈 문단을 하나 더 만든 뒤 위쪽에 그림을 넣어
      // 그림 뒤에 항상 이어 쓸 문단을 남긴다.
      if (!freshParagraph) steps.push({ kind: "break" });
      steps.push({ kind: "break" }, { kind: "up" });
      steps.push({ kind: "image", mime: m[1], b64: m[2], name: `pdf-image-${images}.${ext}` });
      freshParagraph = true;
      continue;
    }
    pending.push(node);
  }
  flush();
  return { steps, images };
}
// 주 편집 화면에 요청을 보내고 같은 requestId 의 응답(replyType)을 기다린다
function askEditor(message, replyType, timeout, timeoutMessage = "편집기가 응답하지 않습니다.") {
  const requestId = `${message.type}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const frame = main.editor.element.contentWindow;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { removeEventListener("message", receive); reject(new Error(timeoutMessage)); }, timeout);
    const receive = (event) => {
      if (event.origin !== location.origin || event.source !== frame || event.data?.type !== replyType || event.data.requestId !== requestId) return;
      clearTimeout(timer); removeEventListener("message", receive); resolve(event.data);
    };
    addEventListener("message", receive);
    frame.postMessage({ ...message, requestId }, location.origin);
  });
}
const sendPasteStep = (step) => askEditor({ type: "ogolgye:paste-step", step }, "ogolgye:paste-result", 8000);
async function docSignature() { try { return (await main.editor.getDocumentState()).documentSha256; } catch { return null; } }
// 그림 넣기는 편집기 안에서 비동기로 끝난다 → 문서가 실제로 바뀔 때까지 기다린다(최대 5초)
async function waitDocChange(before) {
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const now = await docSignature();
    if (now && now !== before) return true;
  }
  return false;
}

async function insertPdfContent(source, data) {
  if (sub.kind !== "pdf" || String(data.id) !== String(sub.viewerId)) return;
  const reply = (ok, error = "") => source?.postMessage({ type: "ogolgye:documentized", ok, error }, location.origin);
  const fail = (err) => { status("문서화에 실패했습니다."); reply(false, String(err?.message || err)); };
  const text = String(data.text || "");
  if (!text) { reply(false, "가져올 본문이 없습니다."); return; }
  status("PDF 내용을 문서에 넣고 있습니다…");
  // 그림은 편집기의 파일 붙여넣기 경로가 필요하다. 글만 있으면 전체 HTML을 한 번에 넣는다.
  if (/<img\b/i.test(String(data.html || ""))) {
    try {
      const { steps, images } = pdfSteps(String(data.html));
      let placed = 0;
      for (const st of steps) {
        const before = st.kind === "image" ? await docSignature() : null;
        const r = await sendPasteStep(st);
        if (!r.handled) throw new Error(r.error || "편집기에 내용을 넣지 못했습니다.");
        if (st.kind === "image" && await waitDocChange(before)) {
          placed++;
          // 넣은 그림을 "글자처럼 취급"으로 바꾼다(실패해도 그림은 남는다)
          await sendPasteStep({ kind: "inline" }).catch(() => null);
        }
      }
      // 모든 글·그림 삽입이 끝난 상태에서 페이지 수와 커서 좌표를 한 번에 다시 맞춘다.
      const refreshed = await sendPasteStep({ kind: "refresh" });
      if (!refreshed.handled) throw new Error(refreshed.error || "문서 화면을 갱신하지 못했습니다.");
      setDirty(main, true);
      const miss = images - placed;
      status(`${data.pages?.length || "선택한"}쪽의 내용을 문서에 넣었습니다.` + (miss ? ` (그림 ${miss}개는 넣지 못했습니다)` : ""));
      reply(true);
    } catch (err) { fail(err); }
    return;
  }
  try {
    const before = await docSignature();
    const result = await askEditor({ type: "ogolgye:paste-content", text, html: data.html || "" }, "ogolgye:paste-result", 5000);
    if (!result.handled) throw new Error(result.error || "편집기에 내용을 넣지 못했습니다.");
    if (before && !(await waitDocChange(before))) throw new Error("문서에 넣은 내용이 실제로 반영되지 않았습니다.");
    setDirty(main, true);
    status(`${data.pages?.length || "선택한"}쪽의 내용을 문서에 넣었습니다.`);
    reply(true);
  } catch (err) { fail(err); }
}

// ── 다른 형식으로 내보내기(PDF/TXT/Markdown/압축 HTML)
const utf8 = (text) => new TextEncoder().encode(text);
const exportBaseName = () => (main.name || "문서").replace(/\.(?:hwp|hwpx|hml)$/i, "") || "문서";
async function requestExportData(format) {
  const r = await askEditor({ type: "ogolgye:export-build", format }, "ogolgye:export-result", 60000, "편집기가 내보내기 자료를 만들지 못했습니다.");
  if (!r.ok) throw new Error(r.error || "내보내기 자료를 만들지 못했습니다.");
  return r;
}
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function webDocument(fragment, title) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(title)}</title><style>body{max-width:900px;margin:32px auto;padding:0 24px;color:#222;font-family:system-ui,"맑은 고딕",sans-serif;line-height:1.65}img,svg{max-width:100%;height:auto}table{border-collapse:collapse;max-width:100%}th,td{border:1px solid #bbb;padding:.35em .55em}p{margin:.65em 0}.og-section+ .og-section{margin-top:2em}</style></head><body><main>${fragment}</main></body></html>`;
}
// ── 3단계 형식(Word·OpenDocument·RTF·EPUB): 문서 HTML → 형식에 상관없는 중간 구조
const OFFICE_FORMATS = ["docx", "odt", "rtf", "epub"];
async function officeBytes(format, model) {
  if (native?.office) return native.office(format, model);                 // 데스크톱 앱
  const r = await fetch("/api/export-office", { method: "POST", body: JSON.stringify({ format, model }) });   // 브라우저로 띄운 경우
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "파일을 만들지 못했습니다.");
  return new Uint8Array(await r.arrayBuffer());
}
function modelFromHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const hex = (c) => {
    if (!c) return null;
    const m = String(c).match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (m) return (m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1]).toUpperCase();
    const rgb = String(c).match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    return rgb ? rgb.slice(1, 4).map((v) => (+v).toString(16).padStart(2, "0")).join("").toUpperCase() : null;
  };
  const pt = (v) => { const m = String(v || "").match(/([\d.]+)\s*(pt|px)?/); if (!m) return null; return m[2] === "px" ? +m[1] * 0.75 : +m[1]; };
  const runsOf = (node, base) => {
    const out = [];
    const walk = (n, st) => {
      if (n.nodeType === Node.TEXT_NODE) { const t = (n.nodeValue || "").replace(/[\r\n]+/g, ""); if (t) out.push({ text: t, ...st }); return; }
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      const tag = n.tagName.toLowerCase();
      if (tag === "br") { out.push({ br: true }); return; }
      if (tag === "img") {
        const m = (n.getAttribute("src") || "").match(/^data:([^;,]+);base64,(.+)$/);
        if (m) out.push({ img: { mime: m[1], b64: m[2], w: +n.getAttribute("width") || n.naturalWidth || 0, h: +n.getAttribute("height") || n.naturalHeight || 0 } });
        return;
      }
      if (tag === "table") return;                                            // 표는 블록으로 따로
      const s2 = { ...st }, css = n.style;
      if (tag === "b" || tag === "strong" || /^(bold|[6-9]00)$/.test(css.fontWeight)) s2.b = true;
      if (tag === "i" || tag === "em" || css.fontStyle === "italic") s2.i = true;
      if (tag === "u" || /underline/.test(css.textDecoration)) s2.u = true;
      if (tag === "s" || tag === "del" || tag === "strike" || /line-through/.test(css.textDecoration)) s2.s = true;
      if (css.color) s2.color = hex(css.color);
      if (css.fontSize) s2.size = pt(css.fontSize);
      if (css.fontFamily) s2.font = css.fontFamily.split(",")[0].replace(/['"]/g, "").trim() || null;
      for (const c of n.childNodes) walk(c, s2);
    };
    for (const c of node.childNodes) walk(c, base || {});
    // 같은 모양이 이어지는 글자 조각은 합친다
    const merged = [];
    for (const r of out) {
      const last = merged.at(-1);
      if (last && r.text !== undefined && last.text !== undefined && ["b", "i", "u", "s", "color", "size", "font"].every((k) => (last[k] || null) === (r[k] || null))) last.text += r.text;
      else merged.push(r);
    }
    return merged.map((r) => r.text === undefined ? r : { text: r.text, b: !!r.b, i: !!r.i, u: !!r.u, s: !!r.s, color: r.color || null, size: r.size || null, font: r.font || null });
  };
  const alignOf = (el) => { const a = (el.style && el.style.textAlign) || el.getAttribute?.("align") || ""; return /center/.test(a) ? "center" : /right|end/.test(a) ? "right" : /justify/.test(a) ? "justify" : "left"; };
  const blocksOf = (container) => {
    const blocks = [];
    let pending = null;                                                       // 문단 밖에 놓인 글자 모으기
    const flush = () => { if (pending && pending.runs.length) blocks.push(pending); pending = null; };
    for (const n of container.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) { if (n.nodeValue.trim()) { pending = pending || { t: "p", align: "left", heading: 0, runs: [] }; pending.runs.push(...runsOf({ childNodes: [n] })); } continue; }
      if (n.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = n.tagName.toLowerCase();
      if (tag === "table") { flush(); blocks.push(tableOf(n)); continue; }
      if (/^(section|div|article|main|body|thead|tbody)$/.test(tag) || (n.querySelector && n.querySelector(":scope > table, :scope > p, :scope > div"))) { flush(); blocks.push(...blocksOf(n)); continue; }
      if (/^(p|h[1-6]|li|blockquote|pre)$/.test(tag)) {
        flush();
        const runs = runsOf(n);
        // 문단 스타일 표시(편집 화면의 Google 문서식 스타일) → 제목 구조
        const og = n.getAttribute && n.getAttribute("data-og-style");
        if (og) styled = true;
        const heading = og && /^h[1-6]$/.test(og) ? +og[1] : /^h[1-6]$/.test(tag) ? +tag[1] : 0;
        const style = og === "title" || og === "subtitle" ? og : null;
        blocks.push({ t: "p", align: alignOf(n), heading, style, runs });
        for (const t of n.querySelectorAll("table")) blocks.push(tableOf(t));
        continue;
      }
      pending = pending || { t: "p", align: "left", heading: 0, runs: [] };
      pending.runs.push(...runsOf({ childNodes: [n] }));
    }
    flush();
    return blocks;
  };
  const tableOf = (t) => ({
    t: "table",
    rows: [...t.rows].map((tr) => [...tr.cells].map((td) => ({ colspan: td.colSpan || 1, rowspan: td.rowSpan || 1, blocks: blocksOf(td) }))),
  });
  let styled = false;
  const blocks = blocksOf(doc.body);
  if (styled) return blocks;                                              // 스타일로 제목을 알 수 있으면 크기로 추측하지 않는다
  // 제목 추정: 편집 화면 HTML 에는 제목 표시가 없으므로, 본문보다 확실히 큰 짧은 문단을 제목으로(가장 큰 크기부터 1·2·3 수준)
  const sizes = new Map();
  for (const b of blocks) if (b.t === "p") for (const r of b.runs) if (r.text && r.size) sizes.set(r.size, (sizes.get(r.size) || 0) + r.text.length);
  const body = [...sizes].sort((a, b) => b[1] - a[1])[0]?.[0] || 10;
  const big = [...new Set(blocks.filter((b) => b.t === "p" && !b.heading).map((b) => {
    const t = b.runs.filter((r) => r.text && r.text.trim());
    return t.length && t.map((r) => r.text).join("").trim().length <= 60 && t.every((r) => (r.size || body) >= body * 1.3) ? Math.min(...t.map((r) => r.size || body)) : 0;
  }).filter(Boolean))].sort((a, b) => b - a).slice(0, 3);
  for (const b of blocks) if (b.t === "p" && !b.heading) {
    const t = b.runs.filter((r) => r.text && r.text.trim());
    if (!t.length || t.map((r) => r.text).join("").trim().length > 60) continue;
    const lv = big.indexOf(Math.min(...t.map((r) => r.size || body))) + 1;
    if (lv > 0 && t.every((r) => (r.size || body) >= body * 1.3)) b.heading = lv;
  }
  return blocks;
}

// Word(.docx) 본문 XML → 중간 구조. Google 문서는 Docs API 전용 변환 경로를 쓴다.
// 스타일 상속(문단 스타일 → 글자 스타일 → 직접 서식), 제목 수준, 정렬, 글자 모양, 탭·줄바꿈, 링크 안 글자, 그림, 표(가로·세로 합침)
function modelFromDocx(parts) {
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
  const xml = (t) => new DOMParser().parseFromString(t || "<x/>", "application/xml");
  const kid = (el, name) => el && [...el.childNodes].find((n) => n.namespaceURI === W && n.localName === name);
  const kids = (el, name) => el ? [...el.childNodes].filter((n) => n.namespaceURI === W && (!name || n.localName === name)) : [];
  const val = (el) => el ? (el.getAttributeNS(W, "val") ?? el.getAttribute("w:val")) : null;
  const on = (el) => el ? !/^(0|false|off|none)$/i.test(val(el) ?? "true") : undefined;
  // 관계(그림 파일)
  const rels = {};
  for (const r of xml(parts.rels).getElementsByTagName("Relationship")) rels[r.getAttribute("Id")] = r.getAttribute("Target");
  const readRpr = (rPr) => {
    const o = {};
    if (!rPr) return o;
    const b = kid(rPr, "b"), i = kid(rPr, "i"), u = kid(rPr, "u"), st = kid(rPr, "strike") || kid(rPr, "dstrike");
    const c = kid(rPr, "color"), sz = kid(rPr, "sz"), f = kid(rPr, "rFonts");
    if (b) o.b = on(b); if (i) o.i = on(i); if (st) o.s = on(st);
    if (u) o.u = !/^none$/i.test(val(u) || "single");
    if (c && val(c) && !/^auto$/i.test(val(c))) o.color = val(c).toUpperCase();
    if (sz && val(sz)) o.size = +val(sz) / 2;
    if (f) { const name = f.getAttributeNS(W, "eastAsia") || f.getAttributeNS(W, "ascii") || f.getAttributeNS(W, "hAnsi"); if (name) o.font = name; }
    return o;
  };
  // 스타일 표: 문단 스타일의 제목 수준·정렬·글자 모양(basedOn 을 따라 올라간다)
  const styles = {};
  const sdoc = xml(parts.styles);
  let docDefaults = {};
  for (const dd of sdoc.getElementsByTagNameNS(W, "rPrDefault")) docDefaults = readRpr(kid(dd, "rPr"));
  for (const st of sdoc.getElementsByTagNameNS(W, "style")) {
    const id = st.getAttributeNS(W, "styleId"), pPr = kid(st, "pPr"), name = (val(kid(st, "name")) || "").toLowerCase();
    const ol = pPr && kid(pPr, "outlineLvl"), hm = name.match(/^heading\s*([1-9])$/) || name.match(/^제목\s*([1-9])$/);
    const kind = /^(title|제목)$/.test(name) ? "title" : /^(subtitle|부제목)$/.test(name) ? "subtitle" : null;
    styles[id] = { basedOn: val(kid(st, "basedOn")), rpr: readRpr(kid(st, "rPr")), jc: pPr && val(kid(pPr, "jc")), kind,
      heading: kind ? 0 : hm ? +hm[1] : ol && val(ol) !== null && +val(ol) < 9 ? +val(ol) + 1 : 0 };
  }
  const styleChain = (id) => { const out = []; for (let k = 0; id && styles[id] && k < 20; k++) { out.unshift(styles[id]); id = styles[id].basedOn; } return out; };
  const ALIGN = { left: "left", start: "left", center: "center", right: "right", end: "right", both: "justify", distribute: "justify" };
  const b64ToMime = (target) => ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp" })[String(target).split(".").pop().toLowerCase()] || "image/png";
  const paragraph = (p) => {
    const pPr = kid(p, "pPr"), pStyle = pPr && val(kid(pPr, "pStyle"));
    const chain = styleChain(pStyle);
    let heading = 0, jc = null, kind = null, base = { ...docDefaults };
    for (const st of chain) { if (st.heading) heading = st.heading; if (st.kind) kind = st.kind; if (st.jc) jc = st.jc; Object.assign(base, st.rpr); }
    const ol = pPr && kid(pPr, "outlineLvl"); if (ol && +val(ol) < 9) heading = +val(ol) + 1;
    if (pPr && kid(pPr, "jc")) jc = val(kid(pPr, "jc"));
    const runs = [];
    const walk = (el) => {
      for (const n of el.childNodes) {
        if (n.nodeType !== 1) continue;
        if (n.namespaceURI === W && n.localName === "r") {
          const rPr = kid(n, "rPr"), rStyle = rPr && val(kid(rPr, "rStyle"));
          // 제목·부제목 문단은 오골계 워드(Google식) 스타일 모양을 쓰므로, 글자에 직접 입힌 서식만 옮긴다
          const fmt = kind || heading ? {} : { ...base };
          for (const st of styleChain(rStyle)) Object.assign(fmt, st.rpr); Object.assign(fmt, readRpr(rPr));
          for (const c of n.childNodes) {
            if (c.nodeType !== 1) continue;
            const ln = c.localName;
            if (c.namespaceURI === W && (ln === "t")) runs.push({ text: c.textContent, ...fmt });
            else if (c.namespaceURI === W && ln === "tab") runs.push({ text: "\t", ...fmt });
            else if (c.namespaceURI === W && (ln === "br" || ln === "cr")) runs.push({ br: true });
            else if (c.namespaceURI === W && ln === "drawing") {
              const blip = c.getElementsByTagNameNS(A, "blip")[0], ext = c.getElementsByTagNameNS(WP, "extent")[0];
              const target = blip && rels[blip.getAttributeNS(R, "embed")];
              const data = target && parts.media[target.replace(/^\.?\//, "").replace(/^word\//, "")];
              if (data) runs.push({ img: { mime: b64ToMime(target), b64: data, w: ext ? Math.round(+ext.getAttribute("cx") / 9525) : 0, h: ext ? Math.round(+ext.getAttribute("cy") / 9525) : 0 } });
            }
          }
        } else if (n.namespaceURI === W && /^(hyperlink|smartTag|ins|sdt|sdtContent|fldSimple)$/.test(n.localName)) walk(n);
      }
    };
    walk(p);
    // 같은 모양 글자 조각 합치기
    const merged = [];
    for (const r of runs) {
      const last = merged.at(-1), keys = ["b", "i", "u", "s", "color", "size", "font"];
      if (last && r.text !== undefined && last.text !== undefined && keys.every((k) => (last[k] || null) === (r[k] || null))) last.text += r.text;
      else merged.push(r);
    }
    const clean = merged.map((r) => r.text === undefined ? r : { text: r.text, b: !!r.b, i: !!r.i, u: !!r.u, s: !!r.s, color: r.color || null, size: r.size || null, font: r.font || null });
    return { t: "p", align: ALIGN[jc] || "left", heading: kind ? 0 : Math.min(6, heading || 0), style: kind, runs: clean };
  };
  const table = (tbl) => {
    const rows = [], open = [];                            // open[col] = 세로 합침이 이어지는 칸
    for (const tr of kids(tbl, "tr")) {
      const row = []; let col = 0;
      for (const tc of kids(tr, "tc")) {
        const tcPr = kid(tc, "tcPr"), span = +(val(tcPr && kid(tcPr, "gridSpan")) || 1), vm = tcPr && kid(tcPr, "vMerge");
        if (vm && val(vm) !== "restart") { if (open[col]) open[col].rowspan++; col += span; continue; }   // 위 칸에 이어짐
        const cell = { colspan: span, rowspan: 1, blocks: blocksOf(tc) };
        for (let k = 0; k < span; k++) open[col + k] = vm ? cell : null;
        row.push(cell); col += span;
      }
      rows.push(row);
    }
    return { t: "table", rows };
  };
  const blocksOf = (el) => {
    const out = [];
    for (const n of el.childNodes) {
      if (n.nodeType !== 1 || n.namespaceURI !== W) continue;
      if (n.localName === "p") out.push(paragraph(n));
      else if (n.localName === "tbl") out.push(table(n));
      else if (n.localName === "sdt") { const c = kid(n, "sdtContent"); if (c) out.push(...blocksOf(c)); }
    }
    return out;
  };
  const body = xml(parts.document).getElementsByTagNameNS(W, "body")[0];
  return body ? blocksOf(body) : [];
}

// Markdown: 중간 구조에서 만든다(제목·굵게·기울임·취소선·표·그림). 밑줄은 Markdown 에 표기법이 없어 글자만 남긴다.
function markdownFromModel(blocks) {
  const escText = (t) => t.replace(/([\\`*_[\]<>|])/g, "\\$1");
  const inline = (runs) => runs.map((r) => {
    if (r.br) return "  \n";
    if (r.img) return `![](data:${r.img.mime};base64,${r.img.b64})`;
    const t = r.text || "", m = t.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!m[2]) return t;
    let core = escText(m[2]);
    if (r.s) core = `~~${core}~~`;
    if (r.i) core = `*${core}*`;
    if (r.b) core = `**${core}**`;
    return m[1] + core + m[3];                                    // 표시는 글자에 붙이고 앞뒤 빈칸은 바깥으로
  }).join("").replace(/\*\*\*\*/g, "").trim();
  const lineStart = (s) => s.replace(/^(#{1,6}\s|[-+*]\s|>|\d+[.)]\s)/, "\\$1");
  const cellText = (blocks) => blocks.map((b) => b.t === "p" ? inline(b.runs) : "").filter(Boolean).join("<br>").replace(/\n/g, "<br>").replace(/\|/g, "\\|");
  const out = [];
  for (const b of blocks) {
    if (b.t === "table") {
      // 합친 칸: 처음 칸에 내용, 가려진 자리는 비움
      const grid = [];
      b.rows.forEach((row, r) => { grid[r] = grid[r] || []; let c = 0;
        for (const cell of row) { while (grid[r][c] !== undefined) c++;
          for (let dr = 0; dr < (cell.rowspan || 1); dr++) for (let dc = 0; dc < (cell.colspan || 1); dc++) { grid[r + dr] = grid[r + dr] || []; grid[r + dr][c + dc] = dr || dc ? "" : cellText(cell.blocks || []); }
          c += cell.colspan || 1; } });
      const rows = grid.slice(0, b.rows.length), cols = Math.max(...rows.map((r) => r.length));
      const line = (r) => "| " + Array.from({ length: cols }, (_, i) => r[i] || " ").join(" | ") + " |";
      out.push([line(rows[0]), line(Array(cols).fill("---")), ...rows.slice(1).map(line)].join("\n"));
      continue;
    }
    const text = inline(b.runs);
    if (!text) continue;
    // 제목은 그 자체로 굵으므로 굵게 표시를 빼고 쓴다
    const plainBold = () => inline(b.runs.map((r) => ({ ...r, b: false })));
    if (b.style === "title") out.push(`# ${plainBold()}`);
    else if (b.style === "subtitle") out.push(`*${plainBold().replace(/\*/g, "")}*`);
    else out.push(b.heading ? `${"#".repeat(Math.min(6, b.heading))} ${plainBold()}` : lineStart(text));
  }
  return out.join("\n\n") + "\n";
}

function textFromHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const tag = node.tagName.toLowerCase();
    if (tag === "br") return "\n";
    if (tag === "img") return node.getAttribute("alt") ? `[${node.getAttribute("alt")}]` : "";
    if (tag === "tr") return [...node.children].map(walk).join("\t") + "\n";
    const body = [...node.childNodes].map(walk).join("");
    return /^(p|div|section|article|h[1-6]|li|ul|ol|table|blockquote|pre)$/.test(tag) ? body + "\n" : body;
  };
  return walk(doc.body).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
// Google 문서로 보내기: Word 로 만들어 드라이브에 올리며 변환, 페이지 없음으로 보고 있었다면 그렇게 바꾼다
async function sendToGoogleDocs() {
  if (!main.editor) return;
  if (!native?.google) { alert("Google 문서로 보내기는 데스크톱 앱에서 사용할 수 있습니다."); return; }
  const st = await native.google.status();
  if (!st.ok || !st.connected) { alert("먼저 도구 → 환경 설정 → Google 드라이브 연결에서 연결해 주세요."); return; }
  status("Google 문서로 보내고 있습니다…");
  try {
    const data = await requestExportData("html"), base = exportBaseName();
    // 탭이 있으면 탭별 중간 구조도 함께(첫 탭은 Word 로 올리고, 나머지는 Google 문서 탭으로 만든다)
    const tabs = Array.isArray(data.tabs) ? data.tabs.map((t) => ({ name: t.name, blocks: modelFromHtml(t.html) })) : null;
    const r = await native.google.send({ title: base, blocks: tabs ? tabs[0].blocks : modelFromHtml(data.html), tabs }, base, !!data.pageless);
    if (!r.ok) throw new Error(r.error);
    const notes = [r.tabsMade ? `탭 ${r.tabsMade + 1}개` : "", r.pagelessApplied ? "페이지 없음" : ""].filter(Boolean).join(", ");
    status(r.warning ? r.warning : `Google 문서로 보냈습니다${notes ? ` (${notes})` : ""}.`);
    if (r.warning) alert(r.warning);
  } catch (err) { status("Google 문서로 보내지 못했습니다."); alert(String(err?.message || err)); }
}
// 편집 화면의 Google 드라이브 연결 탭 ↔ 데스크톱 앱
async function googleAction(source, msg) {
  let r;
  if (!native?.google) r = { ok: false, error: "Google 드라이브 연결은 데스크톱 앱에서 사용할 수 있습니다." };
  else if (msg.action === "setClient") r = await native.google.setClient(msg.clientId, msg.clientSecret);
  else if (["status", "connect", "disconnect"].includes(msg.action)) r = await native.google[msg.action]();
  else r = { ok: false, error: "알 수 없는 요청입니다." };
  source?.postMessage({ type: "ogolgye:google-result", requestId: msg.requestId, ...r }, location.origin);
}

// 편집 화면의 사용자 AI 도구 ↔ 데스크톱 앱. 키는 이 바깥(메인 프로세스)의 암호화 저장소에만 둔다.
async function aiAction(source, msg) {
  let r;
  if (!native?.ai) r = { ok: false, error: "AI 도구는 데스크톱 앱에서 사용할 수 있습니다." };
  else if (msg.action === "list") r = await native.ai.list();
  else if (msg.action === "save") r = await native.ai.save(msg.tool);
  else if (msg.action === "remove") r = await native.ai.remove(msg.id);
  else if (msg.action === "run") r = await native.ai.run(msg.id, msg.input);
  else r = { ok: false, error: "알 수 없는 요청입니다." };
  source?.postMessage({ type: "ogolgye:ai-result", requestId: msg.requestId, ...r }, location.origin);
  if (r.ok && ["save", "remove"].includes(msg.action)) {
    for (const fr of document.querySelectorAll("iframe")) fr.contentWindow?.postMessage({ type: "ogolgye:ai-tools-changed", tools: r.tools }, location.origin);
  }
}

// ── Google 드라이브에서 열기: 한글·PDF 는 원본, Word·Google 문서는 한글 문서로 바꿔서 연다
async function hwpxFromModelBytes(model, pageless) {
  if (native?.hwpxFromModel) return native.hwpxFromModel(model, pageless);
  const r = await fetch("/api/hwpx-from-model", { method: "POST", body: JSON.stringify({ model, pageless }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "한글 문서를 만들지 못했습니다.");
  return new Uint8Array(await r.arrayBuffer());
}
const DRIVE_KIND = { folder: ["폴더", "📁"], gdoc: ["Google 문서", "📝"], docx: ["Word", "📘"], pdf: ["PDF", "📕"], hwp: ["한글", "📄"] };
const drive = { el: null, stack: [], shared: false, query: "", files: [], selected: null, busy: false };
function driveEl() {
  if (drive.el) return drive.el;
  const el = document.createElement("div");
  el.id = "drive-dialog"; el.hidden = true;
  el.innerHTML = `<div class="dv-box" role="dialog" aria-label="Google 드라이브에서 열기">
    <div class="dv-head"><b>Google 드라이브에서 열기</b><button class="dv-x" title="닫기">✕</button></div>
    <div class="dv-bar"><button data-dv="mine" class="on">내 드라이브</button><button data-dv="shared">공유 문서함</button>
      <input class="dv-q" type="search" placeholder="이름으로 찾기"><button data-dv="find">찾기</button></div>
    <div class="dv-path"></div>
    <div class="dv-list" tabindex="0"></div>
    <div class="dv-foot"><label>여는 곳 <select class="dv-target"><option value="main">편집 화면</option><option value="sub">서브뷰</option></select></label>
      <span class="dv-msg"></span><button data-dv="cancel">취소</button><button data-dv="open" class="primary" disabled>열기</button></div></div>`;
  document.body.appendChild(el);
  const q = (s) => el.querySelector(s);
  q(".dv-x").onclick = () => closeDrive();
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-dv]"); if (!b) return;
    const act = b.dataset.dv;
    if (act === "cancel") closeDrive();
    else if (act === "mine" || act === "shared") { drive.shared = act === "shared"; drive.query = ""; q(".dv-q").value = ""; drive.stack = [{ id: "root", name: drive.shared ? "공유 문서함" : "내 드라이브" }]; el.querySelectorAll("[data-dv=mine],[data-dv=shared]").forEach((x) => x.classList.toggle("on", x === b)); loadDrive(); }
    else if (act === "find") { drive.query = q(".dv-q").value.trim(); loadDrive(); }
    else if (act === "open" && drive.selected) openDriveFile(drive.selected);
    else if (act === "up") { drive.stack.pop(); drive.query = ""; loadDrive(); }
  });
  q(".dv-q").addEventListener("keydown", (e) => { if (e.key === "Enter") { drive.query = e.target.value.trim(); loadDrive(); } });
  q(".dv-list").addEventListener("click", (e) => {
    const row = e.target.closest(".dv-row"); if (!row) return;
    drive.selected = drive.files[+row.dataset.i];
    el.querySelectorAll(".dv-row").forEach((r) => r.classList.toggle("sel", r === row));
    q("[data-dv=open]").disabled = drive.selected.kind === "folder";
  });
  q(".dv-list").addEventListener("dblclick", (e) => {
    const row = e.target.closest(".dv-row"); if (!row) return;
    const f = drive.files[+row.dataset.i];
    if (f.kind === "folder") { drive.stack.push({ id: f.id, name: f.name }); drive.query = ""; loadDrive(); } else openDriveFile(f);
  });
  el.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrive(); });
  drive.el = el;
  return el;
}
function closeDrive() { if (drive.el) drive.el.hidden = true; }
async function openDriveDialog() {
  if (!native?.google) { alert("Google 드라이브에서 열기는 데스크톱 앱에서 사용할 수 있습니다."); return; }
  const st = await native.google.status();
  if (!st.ok || !st.connected) { alert("먼저 도구 → 환경 설정 → Google 드라이브 연결에서 연결해 주세요."); return; }
  if (!st.canBrowse) { alert("드라이브에서 가져오려면 읽기 권한이 필요합니다. 도구 → 환경 설정 → Google 드라이브 연결에서 \"연결하기\"를 한 번 더 눌러 주세요."); return; }
  const el = driveEl();
  el.hidden = false;
  if (!drive.stack.length) drive.stack = [{ id: "root", name: "내 드라이브" }];
  loadDrive();
}
async function loadDrive() {
  const el = driveEl(), list = el.querySelector(".dv-list"), msg = el.querySelector(".dv-msg");
  drive.selected = null; el.querySelector("[data-dv=open]").disabled = true;
  const here = drive.stack.at(-1);
  el.querySelector(".dv-path").innerHTML = drive.query ? `"${escHtml(drive.query)}" 찾은 결과` :
    (drive.stack.length > 1 ? '<button data-dv="up" title="위로">↑</button> ' : "") + drive.stack.map((s) => escHtml(s.name)).join(" › ");
  list.innerHTML = '<div class="dv-empty">불러오고 있습니다…</div>';
  const opt = drive.query ? { query: drive.query } : drive.shared && drive.stack.length === 1 ? { shared: true } : { folderId: here.id };
  const r = await native.google.list(opt);
  if (!r.ok) { list.innerHTML = `<div class="dv-empty">${escHtml(r.error)}</div>`; return; }
  drive.files = r.files;
  list.innerHTML = r.files.length ? r.files.map((f, i) => {
    const [label, icon] = DRIVE_KIND[f.kind] || ["", ""];
    return `<div class="dv-row" data-i="${i}"><span class="dv-ic">${icon}</span><span class="dv-name">${escHtml(f.name)}</span><span class="dv-kind">${label}</span><span class="dv-date">${f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : ""}</span></div>`;
  }).join("") : '<div class="dv-empty">가져올 수 있는 파일이 없습니다. (Google 문서, Word, PDF, 한글 파일을 보여 줍니다)</div>';
  msg.textContent = "";
}
async function openDriveFile(f) {
  const el = driveEl(), msg = el.querySelector(".dv-msg");
  const target = f.kind === "pdf" ? "sub" : el.querySelector(".dv-target").value;
  if (target === "main" && main.dirty && !confirm("편집 화면에 저장하지 않은 내용이 있습니다. 가져온 문서로 바꿀까요?")) return;
  msg.textContent = "가져오고 있습니다…"; el.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    const r = await native.google.fetch(f.id);
    if (!r.ok) throw new Error(r.error);
    let file;
    if (r.kind === "pdf") file = { name: /\.pdf$/i.test(r.name) ? r.name : r.name + ".pdf", path: null, bytes: new Uint8Array(r.bytes) };
    else if (r.kind === "hwp") file = { name: r.name, path: null, bytes: new Uint8Array(r.bytes) };
    else {
      msg.textContent = "한글 문서로 바꾸고 있습니다…";
      const model = { title: r.name, blocks: modelFromDocx(r.parts) };      // 한글 만들기는 { blocks } 모양을 받는다
      const bytes = await hwpxFromModelBytes(model, r.pageless);           // Google 문서: 그 문서의 보기 방식, Word: 기본 보기
      file = { name: r.name.replace(/\.docx$/i, "") + ".hwpx", path: null, bytes: new Uint8Array(bytes) };
    }
    closeDrive();
    if (r.kind === "pdf") await openSubPdf(file);
    else if (target === "sub") await openSubDoc(file);
    else { await main.editor.loadFile(file.bytes, file.name); Object.assign(main, { name: file.name, path: null }); setDirty(main, false); updateTitle(); }
    status(`${f.name}을(를) Google 드라이브에서 가져왔습니다.`);
  } catch (err) { msg.textContent = String(err?.message || err); }
  finally { el.querySelectorAll("button").forEach((b) => (b.disabled = false)); el.querySelector("[data-dv=open]").disabled = !drive.selected || drive.selected.kind === "folder"; }
}

async function exportDocument(format) {
  if (format === "gdocs") return sendToGoogleDocs();
  if (!main.editor || !EXPORT_FILTERS[format]) return;
  const labels = { pdf: "PDF", txt: "텍스트", md: "Markdown", html: "웹페이지", docx: "Word", odt: "OpenDocument", rtf: "RTF", epub: "EPUB" };
  status(`${labels[format]} 내보내기를 준비하고 있습니다…`);
  try {
    const data = await requestExportData(format), base = exportBaseName(); let bytes, name;
    if (format === "pdf") {
      if (!native?.pdf) throw new Error("PDF 내보내기는 데스크톱 앱에서 사용할 수 있습니다.");
      bytes = await native.pdf(data.svgs); name = `${base}.pdf`;
    } else if (format === "txt") { bytes = utf8("\ufeff" + textFromHtml(data.html)); name = `${base}.txt`; }
    else if (format === "md") { bytes = utf8("\ufeff" + markdownFromModel(modelFromHtml(data.html))); name = `${base}.md`; }
    else if (OFFICE_FORMATS.includes(format)) {
      const model = { title: base, blocks: modelFromHtml(data.html) };
      bytes = await officeBytes(format, model); name = `${base}.${format}`;
    }
    else {
      if (!native?.htmlZip) throw new Error("압축 웹페이지 내보내기는 데스크톱 앱에서 사용할 수 있습니다.");
      bytes = await native.htmlZip(webDocument(data.html, base)); name = `${base}-웹페이지.zip`;
    }
    const saved = await saveBytes(bytes, name, null, EXPORT_FILTERS[format], true);
    status(saved ? `${saved.name || name} 파일로 내보냈습니다.` : "내보내기를 취소했습니다.");
  } catch (err) { status("내보내기에 실패했습니다."); alert(String(err?.message || err)); }
}

async function openDroppedSubview(raw) {
  if (!raw?.name || !raw.bytes) return;
  const file = { name: raw.name, path: raw.path || null, bytes: raw.bytes instanceof Uint8Array ? raw.bytes : new Uint8Array(raw.bytes) };
  if (/\.pdf$/i.test(file.name)) await openSubPdf(file);
  else if (/\.hwpx?$/i.test(file.name)) await openSubDoc(file);
}
addEventListener("message", (e) => {
  if (e.origin !== location.origin || !e.data) return;
  if (e.data.type === "ogolgye:subview") subviewAction(e.data.action);
  if (e.data.type === "ogolgye:theme-pick") pickAccent(e.data.color);
  if (e.data.type === "ogolgye:subview-position") pickSubviewPosition(e.data.position);
  if (e.data.type === "ogolgye:view-pick" && typeof e.data.ruler === "boolean") pickRuler(e.data.ruler);
  if (e.data.type === "ogolgye:ocr-updated") {
    for (const fr of document.querySelectorAll("#sub-body iframe")) fr.contentWindow?.postMessage({ type: "ogolgye:ocr-updated", languages: e.data.languages }, location.origin);
    status("OCR 언어를 적용했습니다. 열어 둔 PDF를 다시 읽습니다.");
  }
  if (e.data.type === "ogolgye:export-pick") exportDocument(e.data.format);
  if (e.data.type === "ogolgye:google") googleAction(e.source, e.data);
  if (e.data.type === "ogolgye:ai") aiAction(e.source, e.data);
  if (e.data.type === "ogolgye:drive-open") openDriveDialog();
  if (e.data.type === "ogolgye:documentize") insertPdfContent(e.source, e.data);
  if (e.data.type === "ogolgye:doc-name") { main.name = String(e.data.name || ""); updateTitle(); }
  if (e.data.type === "ogolgye:image-dropped") { if (e.data.ok) { setDirty(main, true); status("그림을 문서에 넣었습니다."); } else status("그림을 넣지 못했습니다: " + e.data.error); }
  if (e.data.type === "ogolgye:subview-drop") openDroppedSubview(e.data.file);
});
$("#sub-close").onclick = closeSub;

// 서브뷰에 파일 끌어다 놓기
function bindDrop() {
  const pane = $("#sub-pane"), drop = $("#sub-drop");
  pane.ondragover = (e) => { e.preventDefault(); drop?.classList.add("over"); };
  pane.ondragleave = () => drop?.classList.remove("over");
  pane.ondrop = async (e) => {
    e.preventDefault(); drop?.classList.remove("over");
    const f = e.dataTransfer.files[0]; if (!f) return;
    await openDroppedSubview({ name: f.name, path: f.path || null, bytes: await f.arrayBuffer() });
  };
}

// 빈 공간이나 분할바 위로 놓는 경우. iframe 위의 드롭은 각 iframe의 전달 코드가 맡는다.
addEventListener("dragover", (e) => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); }, true);
addEventListener("drop", async (e) => {
  const f = e.dataTransfer?.files?.[0]; if (!f) return;
  e.preventDefault(); e.stopPropagation();
  await openDroppedSubview({ name: f.name, path: f.path || null, bytes: await f.arrayBuffer() });
}, true);

// ── 분할바
(() => {
  const sp = $("#splitter"), shield = $("#drag-shield"), work = $("#work");
  sp.onmousedown = (e) => {
    e.preventDefault(); sp.classList.add("on"); shield.hidden = false;       // 편집기 iframe 이 마우스를 가로채지 않게 덮개
    const move = (ev) => {
      const r = work.getBoundingClientRect();
      const raw = subviewPosition === "left" ? ev.clientX - r.left : r.right - ev.clientX;
      const w = Math.min(Math.max(raw, 260), r.width - 260);
      $("#sub-pane").style.flexBasis = w + "px";
      notifyMainResize();
    };
    const up = () => { sp.classList.remove("on"); shield.hidden = true; removeEventListener("mousemove", move); removeEventListener("mouseup", up); notifyMainResize(); };
    addEventListener("mousemove", move); addEventListener("mouseup", up);
  };
})();

// 브라우저 실행에서는 저장하지 않은 변경을 경고한다. Electron은 내부 Studio까지 이 이벤트를
// 취소하면 창이 닫히지 않으므로 정상 종료를 우선하고, 저장 확인은 앱의 파일 흐름에서 맡는다.
addEventListener("beforeunload", (e) => {
  if (!native && (main.dirty || (sub.kind === "doc" && sub.dirty))) { e.preventDefault(); e.returnValue = ""; }
});

// ── 저장 안 한 변경 표시: 편집기에 주기적으로 묻는다
setInterval(async () => {
  for (const who of [main, sub]) {
    if (!who.editor || (who === sub && sub.kind !== "doc")) continue;
    try { const st = await who.editor.getDocumentState(); if (st && st.dirty !== who.dirty) setDirty(who, !!st.dirty); } catch { /* 불러오는 중 */ }
  }
}, 1200);

// ── 시작: 빈 문서
(async () => {
  bindDrop();
  status("편집기 준비 중…");
  main.editor = await newEditor($("#main-editor"), main);
  await main.editor.loadFile(await blankBytes(), "새 문서.hwpx");
  setDirty(main, false);
  syncFrames();
  status("");
})();
