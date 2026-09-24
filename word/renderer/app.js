// 오골계 워드 화면
import { createEditor } from "/vendor/rhwp-editor/index.js";

const STUDIO = "/studio/";
const $ = (s) => document.querySelector(s);
const native = window.ogolgye || null;               // Electron 이면 파일 대화상자를 쓸 수 있다
const DOC_FILTERS = [{ name: "한글 문서", extensions: ["hwp", "hwpx"] }];
const PDF_FILTERS = [{ name: "PDF", extensions: ["pdf"] }];

const main = { editor: null, name: "새 문서.hwpx", path: null, dirty: false };
const sub = { kind: null, editor: null, name: "", path: null, dirty: false, viewerId: null };

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
const exportFor = (ed, name) => (/\.hwp$/i.test(name) ? ed.exportHwp() : ed.exportHwpx());

// ── 주 문서: 새 문서·열기·저장은 편집 화면의 "파일" 메뉴를 쓴다

// ── 서브뷰
function showSub(on) {
  $("#sub-pane").hidden = !on; $("#splitter").hidden = !on;
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
function applySubviewPosition(position) {
  subviewPosition = position === "left" ? "left" : "right";
  $("#work").classList.toggle("sub-left", subviewPosition === "left");
  for (const fr of document.querySelectorAll("iframe")) fr.contentWindow?.postMessage({ type: "ogolgye:subview-position-state", position: subviewPosition }, location.origin);
}
async function pickSubviewPosition(position) {
  applySubviewPosition(position);
  await fetch("/api/settings", { method: "POST", body: JSON.stringify({ subviewPosition }) });
}
fetch("/api/settings").then((r) => r.json()).then((st) => {
  accent = st.accent || accent; applyAccent(accent); applySubviewPosition(st.subviewPosition);
});
// 새로 열린 편집 화면·PDF 창에도 적용
new MutationObserver(() => {
  applyAccent(getComputedStyle(document.documentElement).getPropertyValue("--og-accent").trim() || accent);
  applySubviewPosition(subviewPosition);
})
  .observe($("#work"), { childList: true, subtree: true });

// 편집 화면 메뉴의 "서브뷰"에서 온 요청
async function subviewAction(action) {
  if (action === "close") { await closeSub(); return; }
  if (action === "pdf") { const f = await pickFile(PDF_FILTERS); if (f) await openSubPdf(f); }
  else if (action === "doc") { const f = await pickFile(DOC_FILTERS); if (f) await openSubDoc(f); }
  else if (action === "blank") await openSubDoc({ name: "새 문서.hwpx", path: null, bytes: await blankBytes() });
}
async function insertPdfContent(source, data) {
  if (sub.kind !== "pdf" || String(data.id) !== String(sub.viewerId)) return;
  const text = String(data.text || "");
  if (!text) {
    source?.postMessage({ type: "ogolgye:documentized", ok: false, error: "가져올 본문이 없습니다." }, location.origin);
    return;
  }
  status("PDF 내용을 문서에 넣고 있습니다…");
  try {
    const requestId = `paste-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { removeEventListener("message", receive); reject(new Error("편집기가 응답하지 않습니다.")); }, 5000);
      const receive = (event) => {
        if (event.origin !== location.origin || event.source !== main.editor.element.contentWindow || event.data?.type !== "ogolgye:paste-result" || event.data.requestId !== requestId) return;
        clearTimeout(timer); removeEventListener("message", receive); resolve(event.data);
      };
      addEventListener("message", receive);
      main.editor.element.contentWindow.postMessage({ type: "ogolgye:paste-content", requestId, text, html: data.html || "" }, location.origin);
    });
    if (!result.handled) throw new Error(result.error || "편집기에 내용을 넣지 못했습니다.");
    setDirty(main, true);
    status(`${data.pages?.length || "선택한"}쪽의 내용을 문서에 넣었습니다.`);
    source?.postMessage({ type: "ogolgye:documentized", ok: true }, location.origin);
  } catch (err) {
    const message = String(err?.message || err);
    status("문서화에 실패했습니다.");
    source?.postMessage({ type: "ogolgye:documentized", ok: false, error: message }, location.origin);
  }
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
  if (e.data.type === "ogolgye:documentize") insertPdfContent(e.source, e.data);
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
    };
    const up = () => { sp.classList.remove("on"); shield.hidden = true; removeEventListener("mousemove", move); removeEventListener("mouseup", up); };
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
  status("");
  window.__ogolgye = { main, sub };                 // 시험용
})();
