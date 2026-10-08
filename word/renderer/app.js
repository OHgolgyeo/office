// 오골계 워드 화면
import { createEditor } from "/vendor/rhwp-editor/index.js";
import { importDocument, SUBVIEW_EXTENSIONS } from "./doc-import.js";

const STUDIO = "/studio/";
const $ = (s) => document.querySelector(s);
const native = window.ogolgye || null;               // Electron 이면 파일 대화상자를 쓸 수 있다
const SUBVIEW_FILTERS = [{ name: "문서 (PDF·한글·Word·OpenDocument·RTF·텍스트·Markdown·HTML·EPUB·Excel·PowerPoint)", extensions: SUBVIEW_EXTENSIONS }, { name: "모든 파일", extensions: ["*"] }];
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
const emptySub = () => ({ id: "", kind: null, editor: null, name: "", path: null, dirty: false, viewerId: null, element: null });
const subTabs = [];
const spareSubEditors = [], SPARE_SUB_EDITORS = 3;                 // 닫은 서브 문서 편집기를 숨겨 두었다가 다음 문서 탭에 다시 쓴다(closeSub·openSubDoc)
let sub = emptySub(), nextSubId = 1;
const subTabsShell = $("#sub-tabs-shell"), subTabsElement = $("#sub-tabs"), statusElement = $("#status"), subCloseElement = $("#sub-close");

// 창 제목: 프로그램 이름 - 주 문서 이름 (데스크톱 앱은 제목 표시줄을 화면이 직접 그린다)
if (native) document.documentElement.classList.add("native", native.platform === "darwin" ? "mac" : "win");
function updateTitle() {
  const title = main.name ? `오골계 워드 - ${main.name}` : "오골계 워드";
  document.title = title; $("#app-title").textContent = title;
}
// 상태 문구: 끝난 일의 알림("…했습니다")은 잠시 뒤 지운다. 진행 중 문구("…하고 있습니다…")는 다음 문구가 바꿀 때까지 둔다.
// (예전에는 드라이브에서 가져온 문서 탭을 닫아도 "…가져왔습니다." 가 탭 줄에 그대로 남았다)
let statusTimer = 0;
const status = (t) => {
  statusElement.textContent = t || "";
  clearTimeout(statusTimer);
  if (t && !/…$/.test(t)) statusTimer = setTimeout(() => { if (statusElement.textContent === t) statusElement.textContent = ""; }, 6000);
};
const setDirty = (who, v) => { who.dirty = v; if (who !== main) renderSubTabs(); };

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
function renderSubTabs() {
  const strip = subTabsElement; if (!strip) return;
  strip.innerHTML = "";
  for (const tab of subTabs) {
    const item = document.createElement("div");
    item.className = "sub-tab" + (tab === sub ? " active" : ""); item.dataset.tabId = tab.id; item.role = "tab";
    item.ariaSelected = tab === sub ? "true" : "false"; item.title = tab.name;
    const kind = document.createElement("span"); kind.className = "sub-tab-kind"; kind.textContent = tab.kind === "pdf" ? "PDF" : "문서";
    const name = document.createElement("span"); name.className = "sub-tab-name"; name.textContent = tab.name;
    const dirty = document.createElement("span"); dirty.className = "sub-tab-dirty"; dirty.textContent = tab.dirty ? "●" : "";
    const close = document.createElement("button"); close.className = "sub-tab-x"; close.type = "button"; close.title = `${tab.name} 닫기`; close.textContent = "×";
    item.append(kind, name, dirty, close); strip.appendChild(item);
  }
  strip.querySelector(".sub-tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}
const SUB_TABS_CSS = `
#sub-tabs-shell{position:sticky;top:0;z-index:20000;display:flex;align-items:center;gap:6px;min-height:32px;padding:3px 8px 0;border-bottom:1px solid #e6e7e3;background:#fff;font:12px "Malgun Gothic","Noto Sans KR",system-ui,sans-serif;color:#444;box-sizing:border-box}
#sub-tabs{display:flex;align-self:stretch;min-width:0;max-width:72%;overflow-x:auto;overflow-y:hidden;gap:2px;scrollbar-width:thin}
#sub-tabs-shell .spacer{flex:1}.status{color:#888;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-right:6px}
#sub-tabs-shell>button{border:1px solid #e6e7e3;background:#fff;border-radius:5px;padding:1px 8px;font:inherit;cursor:pointer;color:#555}
#sub-tabs-shell>button:hover{background:color-mix(in srgb,var(--og-accent) 12%,#fff);border-color:var(--og-accent)}
.sub-tab{display:flex;align-items:center;gap:5px;min-width:90px;max-width:190px;padding:3px 5px 3px 8px;border:1px solid transparent;border-radius:6px 6px 0 0;background:#f6f6f4;color:#666;cursor:pointer;white-space:nowrap;box-sizing:border-box}
.sub-tab:hover{background:color-mix(in srgb,var(--og-accent) 12%,#fff)}.sub-tab.active{border-color:#e6e7e3;border-bottom-color:#fff;background:#fff;color:#222;box-shadow:inset 0 2px var(--og-accent)}
.sub-tab-kind{flex:none;color:var(--og-accent);font-size:10px;font-weight:700}.sub-tab-name{min-width:0;overflow:hidden;text-overflow:ellipsis}.sub-tab-dirty{flex:none;color:var(--og-accent);font-size:9px}
.sub-tab-x{flex:none;border:0!important;background:transparent!important;border-radius:3px!important;padding:0 3px!important;line-height:16px!important;color:#888!important}.sub-tab-x:hover{background:color-mix(in srgb,var(--og-accent) 16%,#fff)!important;color:#333!important}`;
function parkSubTabs() {
  if (subTabsShell.parentNode !== $("#sub-body")) $("#sub-body").prepend(subTabsShell);
}
function mountSubTabs(tab) {
  const frame = tab?.editor?.element || tab?.element?.querySelector("iframe");
  const doc = frame?.contentDocument;
  const anchor = tab?.kind === "doc" ? doc?.getElementById("menu-bar") : doc?.querySelector(".menu");
  if (!anchor) { parkSubTabs(); return false; }
  let style = doc.getElementById("og-sub-tabs-style");
  if (!style) {
    style = doc.createElement("style"); style.id = "og-sub-tabs-style";
    style.textContent = SUB_TABS_CSS + (tab.kind === "pdf" ? ".menu{top:32px!important}" : "");
    doc.head.appendChild(style);
  }
  doc.body.prepend(subTabsShell); renderSubTabs(); return true;
}
function activateSub(tab) {
  if (!tab || !subTabs.includes(tab)) return;
  sub = tab;
  for (const item of subTabs) if (item.element) item.element.hidden = item !== tab;
  mountSubTabs(tab);
  renderSubTabs();
  notifyMainResize();
}
function makeSub(kind, name, path = null, reuseElement = null) {
  const tab = { ...emptySub(), id: `sub-${nextSubId++}`, kind, name, path };
  if (reuseElement) tab.element = reuseElement;                   // 숨겨 둔 편집기 자리(옮기면 iframe 이 다시 불러와지므로 그 자리 그대로)
  else { tab.element = document.createElement("div"); tab.element.className = "sub-tab-page"; $("#sub-body").appendChild(tab.element); }
  tab.element.dataset.tabId = tab.id; subTabs.push(tab); showSub(true); activateSub(tab);
  $("#sub-drop").hidden = true;
  return tab;
}
async function closeSub(tab = sub, skipConfirm = false) {
  if (!subTabs.includes(tab)) return true;
  if (!skipConfirm && tab.kind === "doc" && tab.dirty && !confirm(`서브뷰 문서 '${tab.name}'에 저장하지 않은 내용이 있습니다. 닫을까요?`)) return false;
  if (tab.kind === "pdf" && tab.viewerId) {
    // 아직 안 보낸 주석을 먼저 보내고(최대 0.8초), 서버의 PDF 세션을 내려놓는다(남겨 두면 탭마다 50~110MB 가 쌓였다)
    const w = tab.element?.querySelector("iframe")?.contentWindow;
    await Promise.race([Promise.resolve().then(() => w?.ogFlushAnnotations?.()).catch(() => {}), new Promise((r) => setTimeout(r, 800))]);
    fetch(`/pdf/${tab.viewerId}/close`, { method: "POST" }).catch(() => {});
    if (!subTabs.includes(tab)) return true;                       // 기다리는 사이 이미 닫혔다
  }
  // 탭 줄은 보이는 탭의 iframe 안에 들어가 있다. 그 iframe 을 먼저 지우면 브라우저가 문서를 닫으면서 탭 줄의
  // 이벤트(✕·탭 ×·탭 전환·휠)를 모두 떼어 버려, 한 번 다 닫은 뒤로는 탭 줄이 먹통이 됐다 → 지우기 전에 꺼내 둔다
  parkSubTabs();
  const index = subTabs.indexOf(tab);
  if (tab.kind === "doc" && tab.editor && spareSubEditors.length < SPARE_SUB_EDITORS) {
    // 문서 편집기는 지워도 크로미움 안쪽에서 편집 화면 전체(약 20MB)를 놓아주지 않아 탭을 여닫을수록 메모리가 쌓였다
    // → 몇 개는 숨겨 두었다가 다음 문서 탭에 다시 쓴다(다른 파일을 여는 것과 같다)
    tab.element.hidden = true; delete tab.element.dataset.tabId;
    spareSubEditors.push({ element: tab.element, editor: tab.editor });
  } else { tab.editor?.destroy?.(); tab.element?.remove(); }
  subTabs.splice(index, 1);
  status("");                                                      // 닫은 탭에 대한 알림이 남지 않게
  if (tab === sub) {
    const next = subTabs[Math.min(index, subTabs.length - 1)];
    if (next) activateSub(next); else sub = emptySub();
  } else if (subTabs.includes(sub)) mountSubTabs(sub);           // 다른 탭을 닫았으면 꺼내 둔 탭 줄을 보던 탭에 다시
  renderSubTabs();
  if (!subTabs.length) { parkSubTabs(); $("#sub-drop").hidden = false; showSub(false); }
  return true;
}
async function closeAllSubTabs() {
  const dirty = subTabs.filter((tab) => tab.kind === "doc" && tab.dirty);
  if (dirty.length && !confirm(`서브뷰에 저장하지 않은 문서가 ${dirty.length}개 있습니다. 모두 닫을까요?`)) return false;
  for (const tab of [...subTabs]) await closeSub(tab, true);
  return true;
}
async function openSubPdf(file) {
  const tab = makeSub("pdf", file.name, file.path);
  tab.element.innerHTML = '<div class="busy">PDF를 불러오고 있습니다.</div>';
  const r = await fetch("/api/pdf?name=" + encodeURIComponent(file.name), { method: "POST", body: file.bytes });
  const info = await r.json();
  if (!r.ok) { tab.element.innerHTML = `<div class="busy">PDF를 열 수 없습니다. (${info.error || r.status})</div>`; return; }
  tab.viewerId = info.id;
  tab.element.innerHTML = `<iframe src="/pdf/${info.id}/view" title="PDF 보기"></iframe>`;
  const frame = tab.element.querySelector("iframe");
  frame.addEventListener("load", () => { if (tab === sub) mountSubTabs(tab); }, { once: true });
  status("");
}
// 서브뷰에 아무 문서나: PDF 는 PDF 보기, 한글은 그대로, 그 밖(Word·ODT·RTF·텍스트·Markdown·HTML·EPUB·CSV·Excel·PowerPoint)은
// 한글 문서(HWPX)로 바꿔서 편집기로 연다(renderer/doc-import.js). 이 컴퓨터 안에서만 바꾼다.
async function openSubAny(file) {
  try {
    const kind = await hwpxOrOriginal(file);
    if (kind.pdf) return await openSubPdf(file);
    await openSubDoc(kind.file);
    status(kind.converted ? `${file.name}을(를) 한글 문서로 바꿔 열었습니다.` : "");
  } catch (err) { status(String(err?.message || err)); alert(String(err?.message || err)); }
}
// 문서 → { pdf: true } 또는 { file: 한글 문서(HWPX/HWP) 파일, converted }
async function hwpxOrOriginal(file) {
  const r = await importDocument(file.name, file.bytes);
  if (r.kind === "pdf") return { pdf: true };
  if (r.kind === "hwp") return { file, converted: false };
  status(`${file.name}을(를) 한글 문서로 바꾸고 있습니다…`);
  const title = String(file.name).replace(/\.[^.]+$/, "");
  const blocks = r.kind === "docx" ? modelFromDocx(r.parts) : modelFromHtml(r.html);
  if (!blocks.length) throw new Error(`${file.name}에서 가져올 내용을 찾지 못했습니다.`);
  const bytes = await hwpxFromModelBytes({ title, blocks }, null);
  return { file: { name: title + ".hwpx", path: null, bytes: new Uint8Array(bytes) }, converted: true };
}
async function openSubDoc(file) {
  let spare = spareSubEditors.pop();
  if (spare) {
    // 숨긴 채로 먼저 불러온 뒤 보인다(보이고 나서 바꾸면 앞 문서의 쪽을 그리려다 "페이지 N 정보가 없습니다"가 났다).
    // 닫을 때 이미 "저장하지 않은 내용" 확인을 받았다 — 편집기의 같은 확인(고친 문서 위에 열기 거부)은 건너뛴다
    try { await spare.editor.loadFile(file.bytes, file.name, { skipUnsavedGuard: true }); }
    catch { spare.editor.destroy?.(); spare.element.remove(); spare = null; }   // 숨겨 둔 편집기가 고장 났으면 새로
  }
  const tab = makeSub("doc", file.name, file.path, spare?.element);
  if (spare) {
    tab.editor = spare.editor;
    // 숨긴 동안(크기 0) 잡힌 배치를 보인 크기로 다시 맞춘다(페이지 없음 보기는 창 너비를 따른다)
    const send = () => tab.editor.element?.contentWindow?.postMessage({ type: "ogolgye:host-resize" }, location.origin);
    requestAnimationFrame(() => requestAnimationFrame(send)); setTimeout(send, 320);
  } else {
    tab.editor = await newEditor(tab.element, tab);
    await tab.editor.loadFile(file.bytes, file.name);
  }
  if (tab === sub) mountSubTabs(tab);
  setDirty(tab, false);
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
  await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accent: color }) });
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
  await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subviewPosition }) });
}
function applyRuler(visible) {
  rulerVisible = visible !== false;
  for (const fr of document.querySelectorAll("iframe")) fr.contentWindow?.postMessage({ type: "ogolgye:view", ruler: rulerVisible }, location.origin);
}
async function pickRuler(visible) {
  applyRuler(visible);
  await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ruler: rulerVisible }) });
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
const workRoot = $("#work");
const frameObserver = new MutationObserver((records) => {
  for (const r of records) for (const n of r.addedNodes) {
    for (const fr of n.nodeName === "IFRAME" ? [n] : n.querySelectorAll?.("iframe") || []) fr.addEventListener("load", syncFrames);
  }
});
if (workRoot) frameObserver.observe(workRoot, { childList: true, subtree: true });

// 편집 화면 메뉴의 "서브뷰"에서 온 요청
// PDF 를 열 것 같으면(파일 고르기) 서버가 Kiwi(문단 띄어쓰기 판단)를 미리 불러오게 한다 — 고르는 동안 준비.
// (이 함수의 정의만 지워지고 부르는 곳이 남아, "서브뷰 열기 → 내 컴퓨터"가 오류로 멈춘 적이 있다)
const warmPdfPrepare = () => { fetch("/api/prepare-warm", { method: "POST" }).catch(() => {}); };
async function subviewAction(action) {
  if (action === "close") { await closeAllSubTabs(); return; }
  if (action === "computer") {
    warmPdfPrepare();
    const f = await pickFile(SUBVIEW_FILTERS);
    if (f) await openSubAny(f);
  }
  else if (action === "drive") await openDriveDialog("sub");
  else if (action === "blank") await openSubDoc({ name: "새 문서.hwpx", path: null, bytes: await blankBytes() });
}
// 그림이나 쪽 나누기가 든 문서화 HTML만 단계로 나눈다. 글만 있을 때는 HTML 전체를 한 번에 넣어 빠르게 처리한다.
function pdfSteps(html) {
  const parsed = new DOMParser().parseFromString(String(html || ""), "text/html");
  const root = parsed.body.children.length === 1 && parsed.body.firstElementChild?.tagName === "DIV" ? parsed.body.firstElementChild : parsed.body;
  const steps = [{ kind: "fresh" }]; let images = 0, freshParagraph = true, pending = [];   // 새 문단에서 시작
  // 목록 항목(문서화가 data-og-list 를 단 문단)은 따로 한 덩어리로 넣고, 편집기가 그 문단들에 진짜 글머리표·문단 번호를 건다.
  // htmlMarked: 기호 글자를 되살린 HTML(표 칸 안처럼 목록 모양을 걸 수 없을 때)
  const isList = (node) => node.matches("p[data-og-list]");
  const flush = () => {
    if (!pending.length) return;
    const wrapper = parsed.createElement("div");
    for (const node of pending) wrapper.appendChild(node.cloneNode(true));
    const chunkHtml = wrapper.innerHTML;
    const chunkText = pending.map((node) => node.textContent || "").join("\n");
    if (!freshParagraph) steps.push({ kind: "break" });
    const step = { kind: "text", text: chunkText, html: chunkHtml };
    if (isList(pending[0])) {
      step.list = pending.map((n) => ({ type: n.dataset.ogList, mark: n.dataset.ogMark || "", fmt: n.dataset.ogFmt || "", code: +(n.dataset.ogCode || 0), start: n.dataset.ogStart != null ? +n.dataset.ogStart : null }));
      const marked = parsed.createElement("div");
      for (const n of pending) { const c = n.cloneNode(true); c.textContent = (n.dataset.ogMarker ? n.dataset.ogMarker + " " : "") + n.textContent; marked.appendChild(c); }
      step.htmlMarked = marked.innerHTML;
    }
    steps.push(step);
    freshParagraph = false; pending = [];
  };
  for (const node of root.children) {
    // 원본에서 일부러 쪽을 넘긴 자리 → 쪽 나누기(그 뒤는 새 쪽의 빈 문단에서 이어 쓴다)
    if (node.matches("hr[data-og-page-break]")) { flush(); if (steps.length > 1) { steps.push({ kind: "pagebreak" }); freshParagraph = true; } continue; }
    const img = node.matches("p") ? node.querySelector(":scope > img:only-child") : null;
    const m = img?.getAttribute("src")?.match(/^data:([^;]+);base64,(.+)$/i);
    if (m) {
      flush();
      images++;
      const ext = (m[1].split("/")[1] || "png").replace("jpeg", "jpg");
      // 글자 뒤라면 먼저 새 문단으로 이동한다. 빈 문단을 하나 더 만든 뒤 위쪽에 그림을 넣어
      // 그림 뒤에 항상 이어 쓸 문단을 남긴다.
      // 내용이 그림으로 시작하면 한 문단 더 내려가서 넣는다: 빈 문서의 첫 문단에는 구역·용지 설정이 함께 들어 있어,
      // 그림이 그 문단에 들어가면 전체 선택 후 삭제해도 편집기가 첫 문단의 개체와 함께 그림을 남겼다(두 번 지워야 했다).
      if (!freshParagraph || steps.length === 1) steps.push({ kind: "break" });
      steps.push({ kind: "break" }, { kind: "up" });
      // wPt·hPt: PDF 에 그려진 크기(pt) — 편집기에 같은 크기로 넣는다
      steps.push({ kind: "image", mime: m[1], b64: m[2], name: `pdf-image-${images}.${ext}`, wPt: +img.getAttribute("width") || 0, hPt: +img.getAttribute("height") || 0 });
      freshParagraph = true;
      continue;
    }
    if (pending.length && isList(pending[0]) !== isList(node)) flush();   // 목록 / 보통 문단이 바뀌는 곳에서 덩어리를 나눈다
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
  if (!subTabs.some((tab) => tab.kind === "pdf" && String(data.id) === String(tab.viewerId))) return;
  const reply = (ok, error = "") => source?.postMessage({ type: "ogolgye:documentized", ok, error }, location.origin);
  const fail = (err) => { status("문서화에 실패했습니다."); reply(false, String(err?.message || err)); };
  const text = String(data.text || "");
  if (!text) { reply(false, "가져올 본문이 없습니다."); return; }
  status("PDF 내용을 문서에 넣고 있습니다…");
  // 그림은 편집기의 파일 붙여넣기 경로가 필요하다. 글만 있으면 전체 HTML을 한 번에 넣는다.
  if (/<img\b|data-og-page-break|data-og-list/i.test(String(data.html || ""))) {
    try {
      const { steps, images } = pdfSteps(String(data.html));
      // 한 번에 넣기(편집기 작업 하나, 화면은 마지막에 한 번만 그림). 커서가 표 칸 안이면 단계별로.
      const batch = await askEditor({ type: "ogolgye:paste-batch", steps }, "ogolgye:paste-result", 180000, "편집기가 응답하지 않습니다.");
      if (batch.handled) {
        setDirty(main, true);
        const miss = images - (batch.placed ?? images);
        status(`${data.pages?.length || "선택한"}쪽의 내용을 문서에 넣었습니다.` + (miss ? ` (그림 ${miss}개는 넣지 못했습니다)` : ""));
        reply(true);
        return;
      }
      if (batch.batch) throw new Error(batch.error || "편집기에 내용을 넣지 못했습니다.");
      let placed = 0;
      for (const st of steps) {
        const r = await sendPasteStep(st);
        // 그림 하나를 넣지 못해도(손상된 그림 등) 나머지 내용은 계속 넣는다
        if (st.kind === "image") { if (r.handled) placed++; continue; }
        if (!r.handled) throw new Error(r.error || "편집기에 내용을 넣지 못했습니다.");
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
async function requestExportData(format, liftImages = false) {
  const r = await askEditor({ type: "ogolgye:export-build", format, liftImages }, "ogolgye:export-result", 60000, "편집기가 내보내기 자료를 만들지 못했습니다.");
  if (!r.ok) throw new Error(r.error || "내보내기 자료를 만들지 못했습니다.");
  return r;
}
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function webDocument(fragment, title) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(title)}</title><style>body{max-width:900px;margin:32px auto;padding:0 24px;color:#222;font-family:system-ui,"맑은 고딕",sans-serif;line-height:1.65}img,svg{max-width:100%;height:auto}table{border-collapse:collapse;max-width:100%}th,td{border:1px solid #bbb;padding:.35em .55em}p{margin:.65em 0}.og-section+ .og-section{margin-top:2em}</style></head><body><main>${fragment}</main></body></html>`;
}
// ── 3단계 형식(Word·OpenDocument·RTF·EPUB): 문서 HTML → 형식에 상관없는 중간 구조
const OFFICE_FORMATS = ["docx", "odt", "rtf", "epub"];
// 따로 받은 그림(바이트)을 다시 base64 로 중간 구조에 넣는다(바이트를 그대로 못 보내는 길에서만 쓴다)
function inlineExportImages(node, images) {
  if (!node || typeof node !== "object" || !images?.length) return node;
  if (Array.isArray(node)) { for (const x of node) inlineExportImages(x, images); return node; }
  if (node.img && Number.isInteger(node.img.ref)) {
    const im = images[node.img.ref];
    if (im) { let bin = ""; for (let i = 0; i < im.bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, im.bytes.subarray(i, i + 0x8000)); node.img.mime = im.mime; node.img.b64 = btoa(bin); delete node.img.ref; }
  }
  for (const k of Object.keys(node)) if (node[k] && typeof node[k] === "object") inlineExportImages(node[k], images);
  return node;
}
async function officeBytes(format, model, images = null) {
  if (native?.office) return native.office(format, model, images);         // 데스크톱 앱(그림은 바이트 그대로)
  inlineExportImages(model, images);
  const r = await fetch("/api/export-office", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ format, model }) });   // 브라우저로 띄운 경우
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
        const src = n.getAttribute("src") || "", m = src.match(/^data:([^;,]+);base64,(.+)$/), ref = src.match(/^og-img:(\d+)$/);
        const size = { w: +n.getAttribute("width") || n.naturalWidth || 0, h: +n.getAttribute("height") || n.naturalHeight || 0 };
        if (m) out.push({ img: { mime: m[1], b64: m[2], ...size } });
        else if (ref) out.push({ img: { ref: +ref[1], ...size } });       // 그림 바이트는 따로 넘어온다(내보내기)
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

// 편집 화면의 사용자 API 도구 ↔ 데스크톱 앱. 키는 이 바깥(메인 프로세스)의 암호화 저장소에만 둔다.
async function aiAction(source, msg) {
  let r;
  if (!native?.ai) r = { ok: false, error: "API 도구는 데스크톱 앱에서 사용할 수 있습니다." };
  else if (msg.action === "list") r = await native.ai.list();
  else if (msg.action === "save") r = await native.ai.save(msg.tool);
  else if (msg.action === "remove") r = await native.ai.remove(msg.id);
  else if (msg.action === "run") r = await native.ai.run(msg.id, msg.input, msg.options || {});
  else r = { ok: false, error: "알 수 없는 요청입니다." };
  source?.postMessage({ type: "ogolgye:ai-result", requestId: msg.requestId, ...r }, location.origin);
  if (r.ok && ["save", "remove"].includes(msg.action)) {
    for (const fr of document.querySelectorAll("iframe")) fr.contentWindow?.postMessage({ type: "ogolgye:ai-tools-changed", tools: r.tools }, location.origin);
  }
}

// ── Google 드라이브에서 열기: 한글·PDF 는 원본, Word·Google 문서는 한글 문서로 바꿔서 연다
async function hwpxFromModelBytes(model, pageless) {
  if (native?.hwpxFromModel) return native.hwpxFromModel(model, pageless);
  const r = await fetch("/api/hwpx-from-model", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, pageless }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "한글 문서를 만들지 못했습니다.");
  return new Uint8Array(await r.arrayBuffer());
}
const DRIVE_KIND = { folder: ["폴더", "📁"], gdoc: ["Google 문서", "📝"], docx: ["Word", "📘"], pdf: ["PDF", "📕"], hwp: ["한글", "📄"], gexport: ["Google 시트·슬라이드", "📊"], file: ["문서", "📃"] };
const driveLabel = (f) => f.kind === "file" ? [(String(f.name).match(/\.([a-z0-9]+)$/i)?.[1] || "문서").toUpperCase(), DRIVE_KIND.file[1]] : DRIVE_KIND[f.kind] || ["", ""];
// cache: 한 번 본 폴더 목록(바로 보여 주고 뒤에서 새로 받는다), prefetch: 고른 파일을 미리 받는 약속(열기를 누르면 이어 쓴다)
const drive = { el: null, stack: [], shared: false, query: "", files: [], selected: null, busy: false, forcedTarget: null, cache: new Map(), prefetch: new Map() };
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
    drivePrefetch(drive.selected);                                // 고르는 순간 받기 시작(열기를 누를 때는 이미 받는 중이거나 끝남)
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
function closeDrive() { if (drive.el) drive.el.hidden = true; drive.forcedTarget = null; }
async function openDriveDialog(target = null) {
  const el = driveEl();
  const targetSelect = el.querySelector(".dv-target");
  drive.forcedTarget = target === "sub" ? "sub" : null;
  targetSelect.value = drive.forcedTarget || "main";
  targetSelect.disabled = !!drive.forcedTarget;
  el.hidden = false;
  const list = el.querySelector(".dv-list"), msg = el.querySelector(".dv-msg");
  drive.selected = null; el.querySelector("[data-dv=open]").disabled = true;
  list.innerHTML = '<div class="dv-empty">Google 드라이브 연결 상태를 확인하고 있습니다…</div>';
  msg.textContent = "";
  if (!native?.google) { list.innerHTML = '<div class="dv-empty">Google 드라이브에서 열기는 데스크톱 앱에서 사용할 수 있습니다.</div>'; return; }
  native.google.warm?.().catch?.(() => {});                      // 연결 토큰을 미리(목록 요청과 겹쳐 기다림을 줄인다)
  let st;
  try { st = await native.google.status(); }
  catch (err) { list.innerHTML = `<div class="dv-empty">연결 상태를 확인하지 못했습니다.<br>${escHtml(err?.message || err)}</div>`; return; }
  if (!st?.ok || !st.connected) {
    list.innerHTML = `<div class="dv-empty">${escHtml(st?.error || "먼저 도구 → 환경 설정 → Google 드라이브 연결에서 연결해 주세요.")}</div>`;
    return;
  }
  if (!st.canBrowse) {
    list.innerHTML = '<div class="dv-empty">드라이브에서 가져오려면 읽기 권한이 필요합니다.<br>도구 → 환경 설정 → Google 드라이브 연결에서 “연결하기”를 한 번 더 눌러 주세요.</div>';
    return;
  }
  if (!drive.stack.length) drive.stack = [{ id: "root", name: "내 드라이브" }];
  await loadDrive();
}
async function loadDrive() {
  const el = driveEl(), list = el.querySelector(".dv-list"), msg = el.querySelector(".dv-msg");
  drive.selected = null; el.querySelector("[data-dv=open]").disabled = true;
  const here = drive.stack.at(-1);
  el.querySelector(".dv-path").innerHTML = drive.query ? `"${escHtml(drive.query)}" 찾은 결과` :
    (drive.stack.length > 1 ? '<button data-dv="up" title="위로">↑</button> ' : "") + drive.stack.map((s) => escHtml(s.name)).join(" › ");
  const opt = drive.query ? { query: drive.query } : drive.shared && drive.stack.length === 1 ? { shared: true } : { folderId: here.id };
  const key = JSON.stringify(opt);
  const show = (files) => {
    const keep = drive.selected?.id;
    drive.files = files;
    list.innerHTML = files.length ? files.map((f, i) => {
      const [label, icon] = driveLabel(f);
      return `<div class="dv-row${f.id === keep ? " sel" : ""}" data-i="${i}"><span class="dv-ic">${icon}</span><span class="dv-name">${escHtml(f.name)}</span><span class="dv-kind">${escHtml(label)}</span><span class="dv-date">${f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : ""}</span></div>`;
    }).join("") : '<div class="dv-empty">가져올 수 있는 파일이 없습니다. (Google 문서·시트·슬라이드, PDF, 한글, Word, ODT, RTF, 텍스트, Markdown, HTML, EPUB, CSV, Excel, PowerPoint 파일을 보여 줍니다)</div>';
    drive.selected = files.find((f) => f.id === keep) || null;
    el.querySelector("[data-dv=open]").disabled = !drive.selected || drive.selected.kind === "folder";
  };
  // 한 번 본 폴더는 바로 보여 주고(뒤에서 새 목록을 받아 바뀐 것만 다시 그린다), 처음이면 받는 동안 안내
  const cached = drive.cache.get(key);
  if (cached) { show(cached); msg.textContent = "새 목록을 확인하고 있습니다…"; }
  else list.innerHTML = '<div class="dv-empty">불러오고 있습니다…</div>';
  const token = (drive.loadToken = (drive.loadToken || 0) + 1);
  try {
    const r = await native.google.list(opt);
    if (!r?.ok) throw new Error(r?.error || "Google 드라이브 목록을 불러오지 못했습니다.");
    const files = Array.isArray(r.files) ? r.files : [];
    drive.cache.set(key, files);
    if (token !== drive.loadToken) return;                       // 그 사이 다른 폴더로 옮겼다
    if (!cached || JSON.stringify(cached) !== JSON.stringify(files)) show(files);
    msg.textContent = "";
  } catch (err) {
    if (token !== drive.loadToken) return;
    if (cached) { msg.textContent = "새 목록을 받지 못해 전에 받은 목록을 보여 줍니다."; return; }
    drive.files = [];
    list.innerHTML = `<div class="dv-empty">Google 드라이브 목록을 불러오지 못했습니다.<br>${escHtml(err?.message || err)}</div>`;
    msg.textContent = "연결 상태와 인터넷 연결을 확인해 주세요.";
  }
}
// 고른 파일을 미리 받는다(같은 파일은 한 번만). 받은 결과는 열기에서 이어 쓰고, 오래된 것은 버린다(최근 3개)
function drivePrefetch(f) {
  if (!f || f.kind === "folder" || !native?.google) return null;
  if (!drive.prefetch.has(f.id)) {
    const p = native.google.fetch({ id: f.id, name: f.name, mimeType: f.mimeType, kind: f.kind });
    p.catch(() => {});
    drive.prefetch.set(f.id, p);
    while (drive.prefetch.size > 3) drive.prefetch.delete(drive.prefetch.keys().next().value);
  }
  return drive.prefetch.get(f.id);
}
async function openDriveFile(f) {
  const el = driveEl(), msg = el.querySelector(".dv-msg");
  const target = f.kind === "pdf" || f.kind === "gexport" ? "sub" : drive.forcedTarget || el.querySelector(".dv-target").value;
  if (target === "main" && main.dirty && !confirm("편집 화면에 저장하지 않은 내용이 있습니다. 가져온 문서로 바꿀까요?")) return;
  msg.textContent = "가져오고 있습니다…"; el.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    // 목록에서 받은 이름·형식을 함께 넘겨 같은 메타데이터를 Google에 다시 묻는 왕복을 없앤다.
    // 고를 때 이미 받기 시작했으면(drivePrefetch) 그 결과를 이어 쓴다. 실패한 미리 받기는 한 번 더 받는다.
    let r = await drivePrefetch(f);
    if (!r?.ok) { drive.prefetch.delete(f.id); r = await drivePrefetch(f); }
    if (!r?.ok) throw new Error(r?.error || "파일을 받지 못했습니다.");
    let file;
    if (r.kind === "pdf") file = { name: /\.pdf$/i.test(r.name) ? r.name : r.name + ".pdf", path: null, bytes: new Uint8Array(r.bytes) };
    else if (r.kind === "hwp") file = { name: r.name, path: null, bytes: new Uint8Array(r.bytes) };
    else if (r.kind === "file") {
      // 그 밖의 문서(ODT·RTF·텍스트·Markdown·HTML·EPUB·CSV·Excel·PowerPoint): 받은 그대로 한글 문서로 바꾼다
      msg.textContent = "한글 문서로 바꾸고 있습니다…";
      const k = await hwpxOrOriginal({ name: r.name, path: null, bytes: new Uint8Array(r.bytes) });
      file = k.pdf ? { name: r.name, path: null, bytes: new Uint8Array(r.bytes) } : k.file;
    }
    else {
      msg.textContent = "한글 문서로 바꾸고 있습니다…";
      const model = { title: r.name, blocks: modelFromDocx(r.parts) };      // 한글 만들기는 { blocks } 모양을 받는다
      const bytes = await hwpxFromModelBytes(model, r.pageless);           // Google 문서: 그 문서의 보기 방식, Word: 기본 보기
      file = { name: r.name.replace(/\.docx$/i, "") + ".hwpx", path: null, bytes: new Uint8Array(bytes) };
    }
    drive.prefetch.delete(f.id);
    closeDrive();
    if (r.kind === "pdf" || /\.pdf$/i.test(file.name)) await openSubPdf(file);
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
    const base = exportBaseName(); let bytes, name;
    if (format === "pdf") {
      if (!native?.pdfStream) throw new Error("PDF 내보내기는 데스크톱 앱에서 사용할 수 있습니다.");
      const stream = await native.pdfStream.start(`${base}.pdf`, EXPORT_FILTERS.pdf);
      if (!stream?.id) { status("내보내기를 취소했습니다."); return; }
      let editorStarted = false;
      try {
        const info = await askEditor({ type: "ogolgye:export-pdf-info" }, "ogolgye:export-pdf-result", 60000);
        editorStarted = !!info.ok;
        if (!info.ok || !Number.isInteger(info.pageCount) || info.pageCount < 1) throw new Error(info.error || "내보낼 쪽이 없습니다.");
        for (let page = 0; page < info.pageCount; page++) {
          status(`PDF 내보내기 중… ${page + 1}/${info.pageCount}`);
          const part = await askEditor({ type: "ogolgye:export-pdf-page", page }, "ogolgye:export-pdf-result", 60000);
          if (!part.ok || !part.svg) throw new Error(part.error || `${page + 1}쪽을 만들지 못했습니다.`);
          await native.pdfStream.page(stream.id, part.svg);
          part.svg = null;
        }
        await askEditor({ type: "ogolgye:export-pdf-end" }, "ogolgye:export-pdf-result", 60000);
        editorStarted = false;
        const saved = await native.pdfStream.finish(stream.id);
        status(`${saved.name || `${base}.pdf`} 파일로 내보냈습니다.`);
      } catch (err) { await native.pdfStream.cancel(stream.id).catch(() => {}); throw err; }
      finally { if (editorStarted) await askEditor({ type: "ogolgye:export-pdf-end" }, "ogolgye:export-pdf-result", 5000).catch(() => {}); }
      return;
    }
    // Word·ODT·RTF·EPUB·압축 웹페이지는 그림을 바이트로 따로 받는다(텍스트·Markdown 은 그림을 글 안에 넣거나 버리므로 그대로)
    const lift = OFFICE_FORMATS.includes(format) || (format === "html" && !!native?.htmlZip);
    const data = await requestExportData(format, lift);
    if (format === "txt") { bytes = utf8("\ufeff" + textFromHtml(data.html)); name = `${base}.txt`; }
    else if (format === "md") { bytes = utf8("\ufeff" + markdownFromModel(modelFromHtml(data.html))); name = `${base}.md`; }
    else if (OFFICE_FORMATS.includes(format)) {
      const model = { title: base, blocks: modelFromHtml(data.html) };
      bytes = await officeBytes(format, model, data.images || null); name = `${base}.${format}`;
    }
    else {
      if (!native?.htmlZip) throw new Error("압축 웹페이지 내보내기는 데스크톱 앱에서 사용할 수 있습니다.");
      bytes = await native.htmlZip(webDocument(data.html, base), data.images || null); name = `${base}-웹페이지.zip`;
    }
    const saved = await saveBytes(bytes, name, null, EXPORT_FILTERS[format], true);
    status(saved ? `${saved.name || name} 파일로 내보냈습니다.` : "내보내기를 취소했습니다.");
  } catch (err) { status("내보내기에 실패했습니다."); alert(String(err?.message || err)); }
}

async function openDroppedSubview(raw) {
  if (!raw?.name || !raw.bytes) return;
  const file = { name: raw.name, path: raw.path || null, bytes: raw.bytes instanceof Uint8Array ? raw.bytes : new Uint8Array(raw.bytes) };
  await openSubAny(file);
}
addEventListener("message", (e) => {
  if (e.origin !== location.origin || !e.data) return;
  const editorSource = main.editor?.element?.contentWindow === e.source || subTabs.some((tab) => tab.editor?.element?.contentWindow === e.source);
  // PDF 탭의 element 는 탭 자리(div)이고 보기 화면은 그 안의 iframe 이다. div 의 contentWindow(없음)와 비교하면 PDF 보기에서 온
  // 메시지가 하나도 통과하지 못해 문서화 결과가 조용히 버려졌다(문서화 단추를 눌러도 아무 일도 일어나지 않음).
  const pdfSource = subTabs.some((tab) => tab.kind === "pdf" && tab.element?.querySelector("iframe")?.contentWindow === e.source);
  const editorMessages = new Set(["ogolgye:subview", "ogolgye:theme-pick", "ogolgye:subview-position", "ogolgye:view-pick", "ogolgye:ocr-updated", "ogolgye:export-pick", "ogolgye:google", "ogolgye:ai", "ogolgye:drive-open", "ogolgye:doc-name", "ogolgye:image-dropped", "ogolgye:subview-drop"]);
  // 파일 끌어다 놓기(subview-drop)는 PDF 보기 화면도 보낸다(열어 둔 PDF 위에 다른 PDF 를 놓으면 새 탭으로)
  const fromPdfViewer = pdfSource && e.data.type === "ogolgye:subview-drop";
  if (editorMessages.has(e.data.type) && !editorSource && !fromPdfViewer) return;
  if (e.data.type === "ogolgye:documentize" && !pdfSource) return;
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
  if (e.data.type === "ogolgye:doc-name") {
    const name = String(e.data.name || ""), tab = subTabs.find((x) => x.editor?.element?.contentWindow === e.source);
    if (tab) { tab.name = name; renderSubTabs(); }
    else if (main.editor?.element?.contentWindow === e.source) { main.name = name; updateTitle(); }
  }
  if (e.data.type === "ogolgye:image-dropped") { if (e.data.ok) { setDirty(main, true); status("그림을 문서에 넣었습니다."); } else status("그림을 넣지 못했습니다: " + e.data.error); }
  if (e.data.type === "ogolgye:subview-drop") openDroppedSubview(e.data.file);
});
// 탭이 많아 탭 줄이 넘치면 세로 휠로 탭 줄을 가로로 민다(그대로 두면 아래의 PDF 가 스크롤됐다)
subTabsElement.addEventListener("wheel", (e) => {
  if (e.ctrlKey || subTabsElement.scrollWidth <= subTabsElement.clientWidth + 1) return;
  e.preventDefault();
  subTabsElement.scrollLeft += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
}, { passive: false });
subTabsElement.addEventListener("click", async (e) => {
  const item = e.target.closest(".sub-tab"); if (!item) return;
  const tab = subTabs.find((x) => x.id === item.dataset.tabId); if (!tab) return;
  if (e.target.closest(".sub-tab-x")) await closeSub(tab);
  else activateSub(tab);
});
subCloseElement.onclick = closeAllSubTabs;

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
      const w = Math.round(Math.min(Math.max(raw, 260), r.width - 260));   // 정수 픽셀(소수점 폭이면 서브뷰 안이 번진다)
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
  if (!native && (main.dirty || subTabs.some((tab) => tab.kind === "doc" && tab.dirty))) { e.preventDefault(); e.returnValue = ""; }
});

// 편집기의 "바뀜" 표시만 읽는다. 예전에는 getDocumentState 로 물었는데, 그 함수는 문서 전체를 파일로 내보내 지문(SHA)까지
// 만든다 — 1.2초마다, 열어 둔 문서마다 0.1~0.25초씩 화면이 멈췄다(가만히 있어도, 타자·스크롤 중에도). 표시만 바로 읽는다.
async function editorDirty(who) {
  const og = who.editor?.element?.contentWindow?.__ogolgyeStudio;
  if (typeof og?.isDirty === "function") return !!og.isDirty();
  const st = await who.editor.getDocumentState();                  // 연결 통로가 없는 옛 편집 화면
  return st ? !!st.dirty : null;
}
// ── 저장 안 한 변경 표시: 편집기에 주기적으로 묻는다
setInterval(async () => {
  for (const who of [main, ...subTabs]) {
    if (!who.editor || (who !== main && who.kind !== "doc")) continue;
    try { const dirty = await editorDirty(who); if (dirty !== null && dirty !== who.dirty) setDirty(who, dirty); } catch { /* 불러오는 중 */ }
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
