// 편집 화면 안에서 도는 스크립트: 주 문서 편집 화면의 메뉴 줄에 "서브뷰" 메뉴를 넣고,
// 누르면 바깥 앱(오골계 워드)에 알린다. 서브뷰로 연 두 번째 문서에는 넣지 않는다.
// 테마색: 앱이 보내는 색을 적용한다(주·서브 편집 화면 모두)
// Studio 자체의 종료 차단은 바깥 앱의 저장 여부 관리와 겹치며 Electron 창을 닫지 못하게 한다.
// 이 스크립트는 Studio의 beforeunload보다 먼저 capture 단계에서 중복 차단을 끊는다.
addEventListener("beforeunload", (e) => e.stopImmediatePropagation(), true);

// 문서화 붙여넣기는 편집기 엔진의 변경과 페이지 없음 화면 재배치가 끝난 뒤에 완료로 알린다.
// 이벤트가 defaultPrevented 된 것만 보고 바로 완료 처리하면 다음 PDF를 열 때 이전 캔버스가 다시 그려져
// 방금 넣은 내용이 사라진 것처럼 보이고, 커서 좌표도 이전 쪽 배치에 남을 수 있다.
// 다음 그림 차례에 실행한다. 창이 가려지거나 최소화되면 그림 차례(requestAnimationFrame)가 멈추므로 잠시 뒤에는 그냥 실행한다.
function ogFrame(fn, wait = 100) {
  let done = false;
  const run = () => { if (!done) { done = true; fn(); } };
  requestAnimationFrame(run); setTimeout(run, wait);
}

// Studio의 일반 텍스트 붙여넣기는 줄마다 `insertText`와 문단 나누기를 각각 실행한다.
// 긴 원고에서는 줄 수만큼 페이지 계산·변경 이벤트·되돌리기 기록이 생기므로, 서식 없는 큰
// 클립보드만 같은 내용의 HTML 조각으로 바꾸어 Studio가 이미 가진 단일 pasteHtml 작업을 쓰게 한다.
// HTML이 원래 들어 있는 복사(웹페이지·PDF 문서화)는 원본 서식을 지키기 위해 건드리지 않는다.
const OG_BULK_PASTE_CHARS = 12000;
const OG_BULK_PASTE_LINES = 80;
let ogBulkPasteReplay = false;
function ogPlainPasteHtml(text) {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const paragraphs = String(text).replace(/\r\n?/g, "\n").split("\n")
    .map((line) => `<p>${line ? esc(line) : "<br>"}</p>`).join("");
  return `<!--StartFragment-->${paragraphs}<!--EndFragment-->`;
}
document.addEventListener("paste", (e) => {
  if (ogBulkPasteReplay || !e.clipboardData) return;
  const target = e.target;
  if (!(target instanceof Element) || !target.matches('[aria-label="문서 편집 입력"]')) return;
  if (e.clipboardData.getData("text/html")) return;
  const plain = e.clipboardData.getData("text/plain");
  if (!plain || (plain.length < OG_BULK_PASTE_CHARS && (plain.match(/\n/g)?.length || 0) < OG_BULK_PASTE_LINES)) return;

  e.preventDefault();
  e.stopImmediatePropagation();
  const data = new DataTransfer();
  data.setData("text/plain", plain);
  data.setData("text/html", ogPlainPasteHtml(plain));
  ogBulkPasteReplay = true;
  try {
    // 다시 보낸 이벤트는 이 capture listener만 통과하고 Studio의 기존 붙여넣기·실행 취소 경로로 간다.
    target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  } finally { ogBulkPasteReplay = false; }
}, true);
// 붙여넣기(문서화) 응답: 편집 화면이 미뤄 둔 쪽 배치를 먼저 끝내고, 화면을 실제로 다시 그린 뒤에 알린다.
// 배치가 끝나기 전에 알리면 넣은 글이 화면에 안 보이거나(쪽 배치가 예전 상태) 다음 작업과 겹친다.
// 문서화한 내용은 새 문단에서 시작한다. 커서가 글이 있는 문단에 있으면 그 문단 끝으로 가서 문단을 나눈다
// (그대로 붙여넣으면 첫 문단이 기존 문단 뒤에 붙어 "…끝.제목"처럼 섞인다). 표 칸 안이면 그대로 둔다.
function ogFreshParagraph(target) {
  const ih = window.__ogolgyeStudio?.inputHandler, d = ogDoc();
  if (!ih || !d) return;
  try {
    try { ih.flushDeferredPaginationIfNeeded("ogolgye-paste", false); } catch { /* 배치할 것 없음 */ }
    const pos = ih.cursor.getPosition();
    if (pos.parentParaIndex !== undefined) return;
    const len = d.getParagraphLength(pos.sectionIndex, pos.paragraphIndex);
    if (!len) return;
    if (pos.charOffset !== len) ih.moveCursorTo({ sectionIndex: pos.sectionIndex, paragraphIndex: pos.paragraphIndex, charOffset: len });
    const data = new DataTransfer(); data.setData("text/plain", "\n");
    target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  } catch { /* 커서를 알 수 없으면 그대로 붙여넣는다 */ }
}
// 붙여 넣을 HTML 의 표가 본문 폭(원래 용지 기준)보다 넓으면 칸 폭을 비율대로 줄인다. PDF 표·글상자는 PDF 쪽 폭
// 그대로(예: 542pt)라 A4 본문(약 453pt)보다 넓으면 용지 오른쪽 밖으로 넘쳤다(한컴에서도 같다).
function ogFitTablesHtml(html) {
  const hasTable = /<table/i.test(html || ""), hasTabs = /tab-stops:right/i.test(html || "");
  if (!hasTable && !hasTabs) return html;
  let body = 0;
  try {
    const og = window.__ogolgyeStudio, pos = og.inputHandler.cursor.getPosition(), pd = og.wasm.getPageDef(pos.sectionIndex);
    body = (pd.width - pd.marginLeft - pd.marginRight - (pd.marginGutter || 0)) / 100 - 2;   // pt, 표 바깥 여백 몫을 조금 뺀다
  } catch { return html; }
  if (!(body > 50)) return html;
  // 목차(문서화): 쪽 번호를 맞추는 오른쪽 탭은 본문 오른쪽 끝에 둔다(PDF 의 단 폭 대신)
  if (hasTabs) html = html.replace(/tab-stops:right( dotted)? [\d.]+pt/g, (_, dot) => `tab-stops:right${dot || ""} ${(body - 1).toFixed(1)}pt`);
  if (!hasTable) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  let changed = false;
  for (const table of doc.querySelectorAll("table")) {
    const row = table.querySelector("tr");
    const width = (td) => parseFloat(/width:\s*([\d.]+)pt/.exec(td.getAttribute("style") || "")?.[1]) || 0;
    // 표 폭 = 첫 행 칸 폭의 합(합친 칸은 colspan 만큼 이미 넓다)
    const total = row ? [...row.children].reduce((s, td) => s + width(td), 0) : 0;
    // 원본에서 자기 단을 가득 채운 표(data-og-fit, 문서화)는 본문 폭에 맞춰 늘리고, 다른 표는 넘칠 때만 줄인다
    const fit = table.getAttribute("data-og-fit") === "1";
    if (!total || (!fit && total <= body)) continue;
    const k = body / total;
    for (const td of table.querySelectorAll("td, th")) {
      const w = width(td);
      if (w) td.setAttribute("style", td.getAttribute("style").replace(/width:\s*[\d.]+pt/, `width:${(w * k).toFixed(1)}pt`));
    }
    changed = true;
  }
  return changed ? doc.body.innerHTML : html;
}

// 문서화 그림 넣기: 커서가 있는 빈 문단에 그림을 넣고 같은 동작 안에서 "글자처럼 취급"으로 바꾼다.
// 편집기의 붙여넣기 경로로 넣으면 그림이 용지 왼쪽 위에 떠 있는 개체(글자처럼 취급 아님)로 먼저 들어가고,
// 나중에 따로 바꾸는 단계가 늦거나 빗나가면 그대로 남아 글자 뒤·위에 겹쳐 보였다.
// 크기는 PDF 에 그려진 크기(pt, 1pt = 100 HWPUNIT), 글 폭·본문 높이보다 크면 비율대로 줄인다. 되돌리기 한 번에 지워진다.
// PDF 그림 한 장의 바이트·크기(HWPUNIT): 글 폭과 본문 높이 안에 들어가게 줄인다(쪽보다 긴 그림은 쪽 경계에서 잘려 보인다)
async function ogPdfImageSpec(st, sectionIndex) {
  const og = window.__ogolgyeStudio || {};
  const bin = Uint8Array.from(atob(st.b64), (c) => c.charCodeAt(0));
  const bmp = await createImageBitmap(new Blob([bin], { type: st.mime || "image/png" }));
  const natW = bmp.width, natH = bmp.height; bmp.close?.();
  let w = st.wPt > 0 ? Math.round(st.wPt * 100) : natW * 75, h = st.hPt > 0 ? Math.round(st.hPt * 100) : natH * 75;
  try {
    const pd = og.wasm.getPageDef(sectionIndex);
    const col = pd.width - pd.marginLeft - pd.marginRight - (pd.marginGutter || 0);
    const body = (pd.height - pd.marginTop - pd.marginBottom - (pd.marginHeader || 0) - (pd.marginFooter || 0)) * 0.95;
    const k = Math.min(1, col > 0 ? col / w : 1, body > 0 ? body / h : 1);
    if (k < 1) { w = Math.round(w * k); h = Math.round(h * k); }
  } catch { /* 쪽 정보가 없으면 PDF 크기 그대로 */ }
  const ext = String(st.name || "").split(".").pop().toLowerCase() || "png";
  return { bin, natW, natH, w, h, ext };
}
// 문서화 내용을 한 번에 넣기: 단계(글 HTML·문단 나누기·쪽 나누기·그림)를 편집기 작업 하나 안에서 엔진에 바로 적용하고
// 화면은 마지막에 한 번만 다시 그린다. 예전에는 단계마다 붙여넣기 → 다시 배치·그리기를 해서 96쪽 PDF(76단계)가
// 18초 걸렸다. 되돌리기(Ctrl+Z)도 한 번에 된다. 커서가 표 칸 안이면 false(단계별 넣기로).
// PDF 목록 항목 문단(first..last)에 진짜 목록 모양을 건다: 글머리표(기호 그대로) 또는 문단 번호(원본 번호 모양,
// 첫 항목은 원본 번호로 다시 시작). 문서화가 기호·번호 글자는 이미 뺐다.
function ogApplyPdfList(wasm, sec, first, last, items, ids) {
  const n = Math.min(items.length, last - first + 1);
  for (let i = 0; i < n; i++) {
    const it = items[i], para = first + i;
    try {
      const key = it.type === "b" ? "b" + it.mark : "n" + it.fmt + "|" + it.code;
      if (!ids.has(key)) ids.set(key, it.type === "b" ? wasm.ensureDefaultBullet(it.mark || "●")
        : wasm.createNumbering(JSON.stringify({ levelFormats: [it.fmt || "^1."], numberFormats: [it.code || 0], startNumber: 1, textDistance: 50 })));
      wasm.applyParaFormat(sec, para, JSON.stringify({ headType: it.type === "b" ? "Bullet" : "Number", numberingId: ids.get(key), paraLevel: 0 }));
      if (it.type === "n" && it.start != null) wasm.setNumberingRestart(sec, para, 2, it.start);
    } catch { /* 이 항목은 글자만 남긴다 */ }
  }
}
async function ogPasteBatch(steps) {
  const og = window.__ogolgyeStudio || {}, ih = og.inputHandler;
  if (!ih || !og.wasm) throw new Error("편집 화면을 다시 빌드해야 합니다(npm run build-studio).");
  try { ih.flushDeferredPaginationIfNeeded("ogolgye-paste", false); } catch { /* 배치할 것 없음 */ }
  const start = ih.cursor.getPosition();
  if (start.parentParaIndex !== undefined || start.cellPath) return { batch: false };
  const specs = new Map();
  for (const st of steps) if (st.kind === "image") { try { specs.set(st, await ogPdfImageSpec(st, start.sectionIndex)); } catch { /* 깨진 그림은 건너뛴다 */ } }
  let placed = 0, error = "";
  const listIds = new Map();                                       // 같은 번호 모양·글머리 기호는 한 번만 만든다
  ih.executeOperation({ kind: "snapshot", operationType: "pasteHtml", operation: (wasm) => {
    let p = { sectionIndex: start.sectionIndex, paragraphIndex: start.paragraphIndex, charOffset: start.charOffset };
    const sec = () => p.sectionIndex;
    const go = (para, off = 0) => { p = { sectionIndex: sec(), paragraphIndex: para, charOffset: off }; };
    const json = (r) => (typeof r === "string" ? JSON.parse(r) : r) || {};
    const split = () => { const r = json(wasm.splitParagraph(sec(), p.paragraphIndex, p.charOffset)); if (r.ok === false) throw new Error("문단을 나누지 못했습니다."); go(r.paraIdx ?? p.paragraphIndex + 1, r.charOffset ?? 0); };
    for (const st of steps) {
      if (st.kind === "fresh") {
        const len = wasm.getParagraphLength(sec(), p.paragraphIndex);
        if (len) { go(p.paragraphIndex, len); split(); }
      } else if (st.kind === "break") split();
      else if (st.kind === "up") go(Math.max(0, p.paragraphIndex - 1), 0);
      else if (st.kind === "text") {
        const first = p.paragraphIndex;
        const r = json(wasm.pasteHtml(sec(), p.paragraphIndex, p.charOffset, ogFitTablesHtml(st.html || "")));
        if (r.ok === false) throw new Error(r.error || "글을 넣지 못했습니다.");
        go(r.paraIdx ?? p.paragraphIndex, r.charOffset ?? p.charOffset);
        if (st.list?.length) ogApplyPdfList(wasm, sec(), first, p.paragraphIndex, st.list, listIds);
      } else if (st.kind === "pagebreak") {
        const r = json(wasm.insertPageBreak(sec(), p.paragraphIndex, wasm.getParagraphLength(sec(), p.paragraphIndex)));
        if (r.ok === false) throw new Error("쪽 나누기를 넣지 못했습니다.");
        go(r.paraIdx ?? p.paragraphIndex + 1, r.charOffset ?? 0);
      } else if (st.kind === "image") {
        const sp = specs.get(st); if (!sp) continue;
        const r = wasm.insertPicture(sec(), p.paragraphIndex, p.charOffset, "", sp.bin, sp.w, sp.h, sp.natW, sp.natH, sp.ext, "");
        if (!r?.ok) continue;                                       // 그림 하나를 못 넣어도 나머지는 계속
        wasm.setPictureProperties(sec(), r.paraIdx, r.controlIdx, { treatAsChar: true });
        placed++; go(r.paraIdx + 1, 0);
      }
    }
    return p;
  } });
  // 한 동작 안에서 글을 붙이고 앞쪽 문단에 목록·그림 속성을 더했는데 커서는 맨 끝에 있다. 쪽 경계 캐시는 커서 쪽 직전부터만
  // 다시 재므로(쪽 수가 그대로면) 앞쪽 쪽들이 옛 경계로 잘려, 이음매에서 빈 곳 다음에 위가 잘린 글·그림이 보였다 → 전부 다시 잰다
  ogInvalidatePageEdges(true); ogRelayout();
  return { batch: true, placed, error };
}
async function ogInsertPdfImage(st) {
  const og = window.__ogolgyeStudio || {}, ih = og.inputHandler;
  if (!ih || !og.wasm) throw new Error("편집 화면을 다시 빌드해야 합니다(npm run build-studio).");
  const bin = Uint8Array.from(atob(st.b64), (c) => c.charCodeAt(0));
  const bmp = await createImageBitmap(new Blob([bin], { type: st.mime || "image/png" }));
  const natW = bmp.width, natH = bmp.height; bmp.close?.();
  let w = st.wPt > 0 ? Math.round(st.wPt * 100) : natW * 75, h = st.hPt > 0 ? Math.round(st.hPt * 100) : natH * 75;
  try {
    const pos = ih.cursor.getPosition(), pd = og.wasm.getPageDef(pos.sectionIndex);
    // 글 폭과 본문 높이 안에 들어가게 줄인다(쪽보다 긴 그림은 쪽 경계에서 잘려 보인다)
    const col = pd.width - pd.marginLeft - pd.marginRight - (pd.marginGutter || 0);
    const body = (pd.height - pd.marginTop - pd.marginBottom - (pd.marginHeader || 0) - (pd.marginFooter || 0)) * 0.95;
    const k = Math.min(1, col > 0 ? col / w : 1, body > 0 ? body / h : 1);
    if (k < 1) { w = Math.round(w * k); h = Math.round(h * k); }
  } catch { /* 쪽 정보가 없으면 PDF 크기 그대로 */ }
  const ext = String(st.name || "").split(".").pop().toLowerCase() || "png";
  let error = "";
  ih.executeOperation({ kind: "snapshot", operationType: "pasteImage", operation: (wasm) => {
    const p = ih.cursor.getPosition();
    const r = wasm.insertPicture(p.sectionIndex, p.paragraphIndex, p.charOffset, "", bin, w, h, natW, natH, ext, "");
    if (!r?.ok) { error = "그림을 넣지 못했습니다."; return p; }
    const inline = wasm.setPictureProperties(p.sectionIndex, r.paraIdx, r.controlIdx, { treatAsChar: true });
    if (inline && inline.ok === false) error = "그림을 글자처럼 취급으로 바꾸지 못했습니다.";
    return { sectionIndex: p.sectionIndex, paragraphIndex: r.paraIdx + 1, charOffset: 0 };
  } });
  if (error) throw new Error(error);
}
function ogReplyPaste(requestId, handled, error = "", refresh = false, extra = {}) {
  const reply = () => parent.postMessage({ type: "ogolgye:paste-result", requestId, handled, error, ...extra }, location.origin);
  if (!handled || !refresh) { reply(); return; }
  setTimeout(async () => {
    try { window.__ogolgyeStudio?.inputHandler?.flushDeferredPaginationIfNeeded?.("ogolgye-paste", false); } catch { /* 배치할 것 없음 */ }
    try { await ogRedraw(); } catch { try { ogRelayout(); } catch { /* 편집 준비 중 */ } }
    try { const ih = window.__ogolgyeStudio.inputHandler, rect = ih.cursor.getRect(); if (rect) ih.scrollCaretIntoView(rect); } catch { /* 커서 없음 */ }   // 넣은 내용의 끝이 보이게
    reply();
  }, 0);
}

// 편집 화면이 나중에 만드는 요소(메뉴·도구 줄·환경 설정 창)에 기능을 붙인다. 설치 함수는 붙였으면 true 를 돌려주고,
// 아직이면 DOM 이 바뀔 때마다 다시 시도한다. 문서 전체를 지켜보는 관찰자는 이것 하나만 둔다.
const ogPending = new Set();
function ogWhenReady(install) { if (!install()) ogPending.add(install); }
new MutationObserver((records) => {
  for (const install of ogPending) if (install()) ogPending.delete(install);
  // 커서·선택 표시는 자식 노드를 자주 갈아 끼운다. 그때마다 문서 전체에서 환경 설정 창을
  // 찾지 않고, 실제 환경 설정 본문이 추가된 경우에만 사용자 탭을 설치한다.
  const optionChanged = records.some((r) => r.target?.closest?.(".modal-overlay .opt-body") ||
    [...r.addedNodes].some((n) => n.nodeType === 1 && (n.matches?.(".modal-overlay .opt-body, .opt-body") || n.querySelector?.(".modal-overlay .opt-body, .opt-body"))));
  if (optionChanged) ogInstallOptionTabs();                 // 환경 설정 창은 열 때마다 새로 만들어진다
}).observe(document.documentElement, { childList: true, subtree: true });
// 실제 마우스 움직임이 있기 전의 마우스 올림 표시는 무시한다(studio-theme.css의 og-pointer-live)
{
  let from = null;
  const live = (e) => {
    if (e.type === "pointermove" && from && Math.hypot(e.clientX - from[0], e.clientY - from[1]) < 2) return;
    if (e.type === "pointermove" && !from) { from = [e.clientX, e.clientY]; return; }
    document.documentElement.classList.add("og-pointer-live");
    for (const t of ["pointermove", "pointerdown", "keydown"]) removeEventListener(t, live, true);
  };
  for (const t of ["pointermove", "pointerdown", "keydown"]) addEventListener(t, live, true);
}

function markSubviewPosition() {
  const current = document.documentElement.dataset.ogSubviewPosition || "right";
  document.querySelectorAll("[data-og-position]").forEach((x) => {
    const on = x.dataset.ogPosition === current;
    x.setAttribute("aria-checked", String(on));
    const icon = x.querySelector(".md-icon"); if (icon) icon.textContent = on ? "✓" : "";
  });
}

addEventListener("message", (e) => {
  if (e.origin !== location.origin || !e.data) return;
  if (e.data.type === "ogolgye:theme") document.documentElement.style.setProperty("--og-accent", e.data.color);
  if (e.data.type === "ogolgye:subview-position-state") {
    document.documentElement.dataset.ogSubviewPosition = e.data.position === "left" ? "left" : "right";
    markSubviewPosition();
  }
  if (e.data.type === "ogolgye:export-build") {
    setTimeout(() => {
      try {
        const data = ogBuildExport(e.data.format);
        // 그림을 따로: HTML 속 base64 그림을 꺼내 바이트로 넘긴다(넘길 때 복사하지 않는다). 그림이 많은 긴 문서에서 같은 그림이
        // HTML 문자열 → 창 사이 복사 → 파싱한 문서 → 중간 구조 → 프로세스 사이 복사로 여러 벌 생기던 것을 줄인다.
        const images = e.data.liftImages ? ogLiftExportImages(data) : null;
        parent.postMessage({ type: "ogolgye:export-result", requestId: e.data.requestId, ok: true, ...data, ...(images ? { images } : {}) }, location.origin, images ? images.map((im) => im.bytes.buffer) : []);
      } catch (err) {
        parent.postMessage({ type: "ogolgye:export-result", requestId: e.data.requestId, ok: false, error: String(err?.message || err) }, location.origin);
      }
    }, 0);
  }
  if (e.data.type === "ogolgye:export-pdf-info" || e.data.type === "ogolgye:export-pdf-page" || e.data.type === "ogolgye:export-pdf-end") {
    setTimeout(() => {
      try {
        const w = ogW(); if (!w || !ogDoc()) throw new Error("열린 문서가 없습니다.");
        const data = e.data.type === "ogolgye:export-pdf-info"
          ? ogBeginPdfExport()
          : e.data.type === "ogolgye:export-pdf-end"
            ? (ogEndPdfExport(), { ended: true })
            : (() => {
            const page = Number(e.data.page);
            if (!Number.isInteger(page) || page < 0 || page >= w.pageCount) throw new Error("PDF 쪽 번호가 올바르지 않습니다.");
            return { page, svg: w.renderPageSvg(page) };
          })();
        parent.postMessage({ type: "ogolgye:export-pdf-result", requestId: e.data.requestId, ok: true, ...data }, location.origin);
      } catch (err) {
        parent.postMessage({ type: "ogolgye:export-pdf-result", requestId: e.data.requestId, ok: false, error: String(err?.message || err) }, location.origin);
      }
    }, 0);
  }
  if (e.data.type === "ogolgye:paste-batch") {
    const reply = (extra) => parent.postMessage({ type: "ogolgye:paste-result", requestId: e.data.requestId, ...extra }, location.origin);
    ogPasteBatch(e.data.steps || []).then((r) => {
      if (!r.batch) { reply({ handled: false, batch: false, error: "" }); return; }
      ogReplyPaste(e.data.requestId, true, "", true, { batch: true, placed: r.placed });   // 다시 배치·그리기는 한 번만(끝나면 답한다)
    }, (err) => reply({ handled: false, batch: true, error: String(err?.message || err) }));
    return;
  }
  if (e.data.type === "ogolgye:paste-step") {
    // 문서화 한 단계: text(글자 HTML) / break(문단 나누기) / up(한 줄 위로) / image(그림 — 글자처럼 취급으로 바로 넣기)
    let handled = false, error = "";
    try {
      const target = document.querySelector('[aria-label="문서 편집 입력"], textarea, [contenteditable="true"]');
      if (!target) throw new Error("문서 입력 위치를 찾지 못했습니다.");
      target.focus({ preventScroll: true });
      const st = e.data.step, data = new DataTransfer();
      if (st.kind === "refresh") {
        ogReplyPaste(e.data.requestId, true, "", true);
        return;
      }
      if (st.kind === "fresh") {
        ogFreshParagraph(target);
        ogReplyPaste(e.data.requestId, true, "");
        return;
      }
      if (st.kind === "up") {
        // 커서를 한 줄 위로(그림을 넣을 빈 문단으로). 편집기의 키 처리 경로를 그대로 쓴다
        const kev = new KeyboardEvent("keydown", { key: "ArrowUp", code: "ArrowUp", keyCode: 38, bubbles: true, cancelable: true });
        target.dispatchEvent(kev);
        parent.postMessage({ type: "ogolgye:paste-result", requestId: e.data.requestId, handled: true, error: "" }, location.origin);
        return;
      }
      if (st.kind === "pagebreak") {
        // 원본에서 일부러 쪽을 넘긴 자리(문서화가 표시): 지금 문단 끝에서 쪽 나누기(Ctrl+Enter 와 같은 동작)
        const ih = window.__ogolgyeStudio?.inputHandler;
        try { ih.flushDeferredPaginationIfNeeded("ogolgye-paste", false); } catch { /* 배치할 것 없음 */ }
        let error = "";
        ih.executeOperation({ kind: "snapshot", operationType: "pageBreak", operation: (wasm) => {
          const p = ih.cursor.getPosition();
          const end = wasm.getParagraphLength(p.sectionIndex, p.paragraphIndex);
          const r = JSON.parse(wasm.insertPageBreak(p.sectionIndex, p.paragraphIndex, end));
          if (!r.ok) { error = "쪽 나누기를 넣지 못했습니다."; return p; }
          return { sectionIndex: p.sectionIndex, paragraphIndex: r.paraIdx ?? p.paragraphIndex + 1, charOffset: r.charOffset ?? 0 };
        } });
        ogReplyPaste(e.data.requestId, !error, error);
        return;
      }
      if (st.kind === "image") {
        // 그림은 붙여넣기 이벤트를 거치지 않고 한 번에 "글자처럼 취급"으로 넣는다(ogInsertPdfImage).
        ogInsertPdfImage(st).then(() => ogReplyPaste(e.data.requestId, true, ""),
          (err) => ogReplyPaste(e.data.requestId, false, String(err?.message || err)));
        return;
      }
      // (단계별 넣기는 목록 모양을 걸 수 없는 곳(표 칸 안)이라 기호 글자를 되살린 HTML 을 쓴다)
      if (st.kind === "text") { data.setData("text/plain", st.text || ""); if (st.html) data.setData("text/html", ogFitTablesHtml(st.htmlMarked || st.html)); }
      else if (st.kind === "break") data.setData("text/plain", "\n");
      const ev = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
      target.dispatchEvent(ev);
      handled = ev.defaultPrevented;
      if (!handled) error = "편집기가 붙여넣기 요청을 받지 않았습니다.";
    } catch (err) { error = String(err?.message || err); }
    ogReplyPaste(e.data.requestId, handled, error);
  }
  if (e.data.type === "ogolgye:paste-content") {
    let handled = false, error = "";
    try {
      const target = document.activeElement?.matches?.('[aria-label="문서 편집 입력"]')
        ? document.activeElement : document.querySelector('[aria-label="문서 편집 입력"], textarea, [contenteditable="true"]');
      if (!target) throw new Error("문서 입력 위치를 찾지 못했습니다.");
      target.focus({ preventScroll: true });
      ogFreshParagraph(target);
      const data = new DataTransfer();
      data.setData("text/plain", String(e.data.text || ""));
      if (e.data.html) data.setData("text/html", ogFitTablesHtml(String(e.data.html)));
      const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      handled = event.defaultPrevented;
      if (!handled && !error) error = "편집기가 붙여넣기 요청을 받지 않았습니다.";
    } catch (err) { error = String(err?.message || err); }
    ogReplyPaste(e.data.requestId, handled, error, handled);
  }
});

// ── 쪽 보기(페이지 없음 / 용지)와 눈금자 ───────────────────────────────
// 페이지 없음: 편집 화면의 쪽 위치 계산(VirtualScroll)을 바꿔 다음 쪽 본문이 앞 쪽 본문 바로 아래에서 이어지게 하고,
// 쪽 캔버스마다 위아래 여백(머리말·꼬리말·쪽 번호 포함)을 잘라 낸다. 커서·클릭·스크롤이 모두 같은 계산을 쓰므로 함께 따라온다.
const ogRoot = document.documentElement;
// 새 문서는 페이지 없음 + 눈금자 숨김으로 시작한다. 저장된 문서/환경 설정은 불러온 뒤 이 값을 덮어쓴다.
ogRoot.classList.add("og-pageless", "og-noruler");
const ogPageless = () => ogRoot.classList.contains("og-pageless");
function ogBodyBand(info) {
  const top = info.headerArea ? info.headerArea.y + info.headerArea.height : info.marginTop + info.marginHeader;
  const bottom = info.footerArea ? info.footerArea.y : info.height - info.marginBottom - info.marginFooter;
  return [top, bottom];
}
// 쪽 안에서 글·개체가 실제로 차지하는 범위(쪽 좌표). start = 첫 줄(또는 개체) 위, end = 마지막 줄 다음 줄이 올 자리.
// 본문 영역 밖(머리말·꼬리말·쪽 번호)은 뺀다. 알 수 없으면 본문 영역 전체 + 기존 간격.
// 쪽 글 배치를 읽는 데 쪽마다 십여 ms가 걸려 입력할 때마다 모두 읽으면 느리다. 읽어 둔 값을 쓰고,
// 입력이 잠시 멈추면 다시 읽어 달라졌을 때만 배치를 다시 한다. 쪽 수·용지가 바뀌면 바로 다시 읽는다.
// 페이지 없음 배치용 본문 경계 캐시. 예전에는 입력이 멈출 때마다 모든 쪽의
// getPageTextLayout/getPageControlLayout을 다시 읽었다. 긴 문서에서는 글자 하나를
// 입력할 때마다 쪽 수에 비례해 느려졌으므로, 보통 입력에는 커서가 있는 쪽 주변과
// 마지막 쪽만 갱신한다. 문서 교체·쪽 수·용지 변경 때만 전체를 다시 읽는다.
// rev: 문서가 바뀔 때마다 올린다. seen: 쪽마다 마지막으로 잰 rev — 화면에 보이는 쪽이 옛 rev 면 다시 잰다(ogCheckVisibleEdges)
const ogEdges = { key: "", list: [], dirty: new Set(), refreshTimer: 0, rev: 0, seen: new Map(), stable: 0, convergeFrom: null };
const ogSelectionRuns = { doc: null, pages: new Map() };
const ogPageGeometry = { key: "", infos: [], body: [] };
function ogDirtyPageHint() {
  const ih = window.__ogolgyeStudio?.inputHandler;
  try {
    const rect = ih?.cursor?.getRect?.();
    if (Number.isInteger(rect?.pageIndex)) return rect.pageIndex;
  } catch { /* 커서 사각형이 아직 없음 */ }
  try {
    const pos = ih?.cursor?.getPosition?.(), raw = pos && ogDoc()?.getCursorRect(pos.sectionIndex, pos.paragraphIndex, pos.charOffset);
    const rect = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Number.isInteger(rect?.pageIndex)) return rect.pageIndex;
  } catch { /* 편집 준비 중 */ }
  return -1;
}
function ogInvalidatePageEdges(all = false) {
  ogEdges.rev++;
  if (all) {
    ogEdges.key = ""; ogEdges.list = []; ogEdges.dirty.clear(); clearTimeout(ogEdges.refreshTimer); ogEdges.seen.clear(); ogEdges.stable = 0; ogEdges.convergeFrom = null;
    ogSelectionRuns.doc = null; ogSelectionRuns.pages.clear(); ogPageGeometry.key = "";
    return;
  }
  const n = window.__ogolgyeStudio?.inputHandler?.virtualScroll?.pageHeights?.length || 0;
  const page = ogDirtyPageHint();
  // 글 한 자가 늘어나면 그 쪽부터 뒤쪽 쪽 나눔이 연쇄적으로 바뀔 수 있다. 앞쪽 쪽의 배치는
  // 그대로이므로 남기고, 현재 쪽의 직전부터만 버린다. 페이지를 알 수 없을 때는 전부 비운다.
  if (page < 0) ogSelectionRuns.pages.clear();
  else for (const i of [...ogSelectionRuns.pages.keys()]) if (i >= Math.max(0, page - 1)) ogSelectionRuns.pages.delete(i);
  // 글이 늘거나 줄면 그 쪽부터 끝까지 모든 쪽의 내용이 밀린다. 예전에는 커서 쪽 앞뒤와 마지막 쪽만 다시 재서,
  // 앞쪽에서 엔터를 치면 뒤쪽 화면 쪽은 옛 경계로 잘려 이음매에서 줄이 반쯤 가려졌다. 커서 쪽 직전부터 끝까지 다시 잰다
  // (ogPageEdges 가 커서에 가까운 쪽부터 짧게 나눠 잰다).
  ogEdges.hint = page;
  ogEdges.convergeFrom = page < 0 ? 0 : Math.max(0, page - 1); ogEdges.stable = 0;
  for (let i = ogEdges.convergeFrom; i < n; i++) ogEdges.dirty.add(i);
  clearTimeout(ogEdges.refreshTimer);
  ogEdges.refreshTimer = setTimeout(ogRefreshEdges, 350);
}
function ogPageGeometryFor(w, n) {
  let key = "";
  try {
    if (!w.doc.__ogId) w.doc.__ogId = Math.random();
    const defs = Array.from({ length: ogSectionCount() }, (_, i) => w.getPageDef(i));
    // 보기 전용 용지(ogPL.view)도 키에 넣는다: getPageDef 는 원래 용지라 창 폭·확대가 바뀌어도 그대로여서,
    // 쪽 폭이 바뀐 뒤에도 예전 쪽 정보로 본문 경계를 잘라 글 오른쪽이 가려졌다.
    key = `${w.doc.__ogId}|${n}|${JSON.stringify(defs)}|${JSON.stringify(ogPL.view)}`;
  } catch { key = String(n); }
  if (ogPageGeometry.key === key && ogPageGeometry.infos.length === n) return ogPageGeometry;
  const infos = [], body = [];
  for (let i = 0; i < n; i++) {
    let info = null;
    try { info = w.getPageInfo(i); } catch { info = null; }
    infos.push(info); body.push(info ? ogBodyBand(info) : null);
  }
  Object.assign(ogPageGeometry, { key, infos, body });
  return ogPageGeometry;
}
function ogPageEdges(n, bandOf) {
  const w = ogW();
  let key = "";
  try {
    if (!w.doc.__ogId) w.doc.__ogId = Math.random();                // 문서를 다시 읽어 바꿔 끼우면 새로 읽는다
    // 보기 용지(ogPL.view)도 키에 넣는다: 창 폭·확대가 바뀌면 쪽 수가 같아도 모든 쪽의 경계가 바뀐다
    key = `${w.doc.__ogId}|${JSON.stringify(w.getPageDef(0))}|${JSON.stringify(ogPL.view)}`;
  } catch { key = String(n); }
  const readOne = (i) => { const [t, b] = bandOf(i); return ogPageContentEdge(i, t, b); };
  const read = () => Array.from({ length: n }, (_, i) => readOne(i));
  if (ogEdges.key !== key) {
    ogEdges.key = key; ogEdges.list = read(); ogEdges.dirty.clear();
    ogEdges.seen.clear(); for (let i = 0; i < n; i++) ogEdges.seen.set(i, ogEdges.rev);
    return ogEdges.list;
  }
  // 글을 한 줄 늘려 쪽 수만 바뀐 경우 기존 쪽 전체를 다시 읽지 않는다. 새 쪽만 즉시 읽고,
  // 앞쪽 변화 범위는 document-changed가 표시한 dirty 구간에서 짧게 나눠 확인한다.
  if (ogEdges.list.length !== n) {
    const old = ogEdges.list.length;
    if (n < old) ogEdges.list.length = n;
    else for (let i = old; i < n; i++) { ogEdges.list.push(readOne(i)); ogEdges.seen.set(i, ogEdges.rev); }
    for (const i of [...ogEdges.dirty]) if (i >= n) ogEdges.dirty.delete(i);
  }
  if (!ogEdges.dirty.size) return ogEdges.list;
  // 이 함수 자체가 배치 계산 도중 불리므로 바뀐 쪽만 지금 읽으면 새 경계가 같은 배치에 바로 반영된다.
  // 다시 잴 쪽이 많으면(앞쪽 편집으로 뒤 쪽이 모두 밀림) 커서에 가까운 쪽부터 약 25ms 만 재고,
  // 남은 쪽은 잠시 뒤 다시 배치하면서 이어서 잰다(긴 문서에서 타자가 멈추지 않게).
  const pages = [...ogEdges.dirty].filter((i) => i >= 0 && i < n).sort((a, b) => a - b);
  const sameEdge = (a, b) => !!a && !!b && Math.abs(a.start - b.start) < 0.5 && Math.abs(a.end - b.end) < 0.5
    && (a.exact === undefined || b.exact === undefined || Math.abs(a.exact - b.exact) < 0.5)
    && a.startKind === b.startKind && a.endKind === b.endKind;
  const t0 = performance.now();
  let k = 0;
  for (; k < pages.length; k++) {
    if (k >= 3 && performance.now() - t0 > 25) break;
    const page = pages[k], before = ogEdges.list[page], after = readOne(page);
    ogEdges.list[page] = after; ogEdges.dirty.delete(page); ogEdges.seen.set(page, ogEdges.rev);
    if (ogEdges.convergeFrom !== null && page >= ogEdges.convergeFrom) {
      ogEdges.stable = sameEdge(before, after) ? ogEdges.stable + 1 : 0;
      // 세 쪽 연속으로 실제 내용 경계가 같으면 이후 쪽의 화면 배치는 그대로다. 뒤쪽은 보일 때 검증하므로
      // 멀리 떨어진 표·그림이 바뀐 예외도 스크롤 시 바로 보정된다.
      if (ogEdges.stable >= 3) {
        for (const i of [...ogEdges.dirty]) if (i > page) ogEdges.dirty.delete(i);
        ogEdges.convergeFrom = null; ogEdges.stable = 0;
        break;
      }
    }
  }
  for (const i of [...ogEdges.dirty]) if (i < 0 || i >= n) ogEdges.dirty.delete(i);
  if (ogEdges.dirty.size) { clearTimeout(ogEdges.refreshTimer); ogEdges.refreshTimer = setTimeout(ogRefreshEdges, 30); }
  return ogEdges.list;
}
function ogPageContentEdge(i, t, b) {
  const w = ogW(), inBody = (y) => y >= t - 1 && y <= b + 1;
  // 엔진이 그리기 트리에서 잰 내용 범위(글 줄·표 조각·그림·도형). 다음 쪽으로 이어지는 표 조각까지 정확하다.
  // 예전 추정(글 줄 위치 + 개체 목록 + 14px)은 이어지는 표 조각을 몰라 쪽 경계에서 줄이 가려지거나 틈이 생겼다.
  if (typeof w.doc?.getPageContentBounds === "function") {
    try {
      const r = JSON.parse(w.doc.getPageContentBounds(i));
      if (r.top === null || r.bottom === null) return { start: t, end: b + 14 };
      // 표 테두리는 표의 위·아래 끝 선 "위에" 그려져 선 두께의 절반이 표 밖으로 나간다. 쪽이 표로 시작하거나 표로 끝날 때 표 끝에
      // 딱 맞춰 자르면 테두리가 반쯤 잘려 옅고 얇게 보였다(같은 모양의 표인데 쪽 첫머리의 표만 위 테두리가 얇음). 1px 여유를 둔다.
      const edgePad = (kind) => (kind === "table" ? 1 : 0);
      const start = Math.max(0, Math.min(r.top, b) - edgePad(r.topKind));
      // 끝: 마지막이 글 줄이면 다음 줄이 올 자리(줄 간격 그대로 이어지게), 표·개체면 그 아래 끝 + 조금.
      // exact 는 다음 쪽이 같은 표의 이어지는 조각으로 시작할 때 틈 없이 붙이는 자리.
      let end;
      if (r.bottomKind === "text" && r.lineTop !== null && r.lineBottom !== null && r.lineBottom >= r.bottom - 0.5) {
        // 줄 간격(pitch)은 줄과 줄 사이 거리라, 그 사이에 표가 끼어 있으면 표 높이만큼 커진다 — 그대로 쓰면 쪽이 바뀌는 자리에
        // 표 하나만큼 빈 곳이 생겼다(문서화한 카드 표 사이). 줄 높이의 3배를 넘으면 보통 줄 간격(줄 높이 × 1.6)으로 본다
        // 마지막 줄이 글자처럼 놓인 그림이면 줄 높이가 그림 높이다 — 줄 높이에 비례한 간격을 주면 그림 높이의 60%만큼
        // (560px 그림이면 336px) 빈 곳이 생겨 그림과 다음 쪽 그림 사이가 층처럼 벌어졌다. 글 줄로 보기에 너무 높은 줄(40px 초과)은
        // 개체처럼 그 아래 끝 + 8px(같은 쪽 안에서 그림끼리 놓이는 간격)로 잇는다.
        const lineH = r.lineBottom - r.lineTop;
        const pitch = r.pitch && r.pitch <= lineH * 3 ? r.pitch : lineH * 1.6;
        end = lineH > 40 ? r.bottom + 8 : Math.max(r.bottom, r.lineTop + pitch);
      } else end = r.bottom + 8;
      return { start, end: Math.max(end, start + 1), exact: r.bottom + edgePad(r.bottomKind), startKind: r.topKind, endKind: r.bottomKind };
    } catch { /* 아래 추정 방식 */ }
  }
  let ys = [], lastH = 0, start = Infinity, end = -Infinity;
  try {
    const runs = JSON.parse(w.doc.getPageTextLayout(i)).runs || [];
    let maxY = -Infinity;
    for (const r of runs) if (inBody(r.y)) { ys.push(r.y); if (r.y >= maxY) { maxY = r.y; lastH = r.h || lastH; } }
  } catch { ys = []; }
  ys = [...new Set(ys.map((y) => Math.round(y * 10) / 10))].sort((a, c) => a - c);
  if (ys.length) {
    const gaps = ys.slice(1).map((y, k) => y - ys[k]).filter((g) => g > 0 && g <= 3 * Math.max(lastH, 10)).sort((a, c) => a - c);
    const pitch = gaps.length ? gaps[Math.floor(gaps.length / 2)] : Math.max(lastH, 10) * 1.6;
    start = ys[0]; end = ys[ys.length - 1] + pitch;
  }
  try {
    for (const c of w.getPageControlLayout(i)?.controls || []) {
      const y = c.y, h = c.h ?? c.height ?? 0;
      if (!Number.isFinite(y) || !inBody(y)) continue;
      start = Math.min(start, y); end = Math.max(end, y + h + 14);
    }
  } catch { /* 개체 없음 */ }
  if (!Number.isFinite(start)) return { start: t, end: b + 14 };
  return { start: Math.max(t, start), end: Math.max(end, start + 1) };
}
function ogInstallPageless() {
  const og = window.__ogolgyeStudio, vs = og && og.inputHandler && og.inputHandler.virtualScroll;
  if (!vs) return false;
  if (vs.__ogPageless) return true;
  vs.__ogPageless = true;
  ogInstallPagePointSync(og.inputHandler, vs);
  // 편집 화면은 마우스 자리의 쪽을 "쪽 시작 자리가 그 아래인 마지막 쪽"으로 찾는다. 페이지 없음에서는 쪽을 잘라 이어 붙여
  // 다음 쪽의 시작 자리(잘린 위 여백 포함)가 앞 쪽의 마지막 줄들과 겹치므로, 쪽 끝의 위 여백 높이(약 28px)만큼은 다음 쪽의
  // 여백으로 잘못 짚었다 — 그 자리의 표 테두리·그림에 마우스를 올려도 크기 조절 표시가 나오지 않고 클릭도 빗나갔다.
  // 화면에 보이는 띠(이음매 사이)로 쪽을 찾는다. 띠 밖(문서 탭으로 치운 쪽 등)은 원래 방식.
  const pageAtY = vs.getPageAtY.bind(vs);
  vs.getPageAtY = function (docY) {
    const bands = this.__ogBands;
    if (ogPageless() && bands) {
      for (let i = 0; i < bands.length; i++) {
        const off = this.pageOffsets[i];
        if (docY >= off + bands[i][0] && docY < off + bands[i][1]) return i;
      }
    }
    return pageAtY(docY);
  };
  const original = vs.layoutSingleColumn.bind(vs);
  vs.layoutSingleColumn = function () {
    original();
    this.__ogBands = null;
    if (ogPageless()) ogPagelessLayout.call(this);
    ogApplyTabLayout(this);
  };
  const ogPagelessLayout = function () {
    const n = this.pageHeights.length;
    if (!n) return;
    const bands = [];
    const zoom = og.inputHandler.viewportManager.getZoom() || 1;
    let maxPageWidth = 0;
    const geometry = ogPageGeometryFor(og.wasm, n), infos = geometry.infos;
    const body = geometry.body.map((band, i) => band || [0, this.pageHeights[i] / zoom]);
    // 실제 글·개체가 있는 범위. 쪽 사이를 본문 영역 끝이 아니라 마지막 줄 기준으로 이어야
    // 쪽이 바뀌는 곳의 줄 간격이 다른 줄과 같아진다(마지막 줄 아래 남는 빈 공간을 빼고).
    const edges = ogPageEdges(n, (i) => body[i]);
    let off = 0, prevOff = 0, prevBottom = 0;
    for (let i = 0; i < n; i++) {
      const info = infos[i];
      if (info) {
        // setPageDef 뒤에도 VirtualScroll에는 이전 종이 치수가 남을 수 있다. 캔버스·커서·스크롤이 같은 현재 치수를 쓰게 한다.
        this.pageWidths[i] = info.width * zoom;
        this.pageHeights[i] = info.height * zoom;
      }
      maxPageWidth = Math.max(maxPageWidth, this.pageWidths[i] || 0);
      const [t, b] = body[i];
      const edge = edges[i] || { start: t, end: b + 14 };
      // 표가 다음 쪽으로 이어지면(이 쪽 끝과 다음 쪽 첫머리가 모두 표) 표 조각 끝에 바로 붙인다
      const next = edges[i + 1];
      const joinTable = edge.endKind === "table" && next?.startKind === "table" && Number.isFinite(edge.exact);
      const top = edge.start * zoom, bottom = (i < n - 1 ? (joinTable ? edge.exact : edge.end) : b) * zoom;
      if (i === 0) off = 28 * zoom - t * zoom;                       // 첫 본문은 흰 작업면 위에서 항상 같은 위치
      else off = prevOff + prevBottom - top;                         // 앞 쪽 마지막 줄 + 한 줄 간격 자리에서 이어서
      this.pageOffsets[i] = off;
      // 본문 좌우 경계(여백 표시를 가리는 자르기에 쓴다)
      const left = info && info.marginLeft !== undefined ? info.marginLeft * zoom : 0;
      const right = info && info.marginRight !== undefined ? (info.width - info.marginRight) * zoom : this.pageWidths[i];
      bands.push([top, bottom, this.pageHeights[i], left, right, this.pageWidths[i]]);
      prevOff = off; prevBottom = bottom;
    }
    this.__ogBands = bands;
    this.maxPageWidth = maxPageWidth;
    // 화면 폭에서 이미 좌우 40px을 뺀 종이이므로 20px만 더하면 세로 스크롤바가 생겨도 가로 스크롤이 생기지 않는다.
    this.totalWidth = maxPageWidth + 20;
    this.totalHeight = off + bands[n - 1][1] + 28 * zoom;
    ogFrame(ogClipPages);
  };
  // 문서 내용이 바뀌었을 때만 경계 캐시를 더럽힌다. 단순 스크롤·선택·확대는
  // 기존 값을 그대로 써서 전체 페이지의 글 배치를 다시 읽지 않는다.
  og.eventBus?.on("document-changed", () => ogInvalidatePageEdges(false));
  // 큰 내용을 붙이면 편집 화면이 쪽 나눔을 뒤에서 나눠 계산하고, 끝나면 document-changed 가 아니라 document-mutated 만 낸다.
  // 그 전에 잰 경계가 남으면 그림 틀은 제자리인데 쪽 그림만 옛 경계로 잘려, 그림 위쪽이 통째로 가려졌다(문서화 직후).
  // 내용이 바뀐 것으로 치고(rev), 화면에 보이는 쪽부터 다시 잰다.
  og.eventBus?.on("document-mutated", () => { ogEdges.rev++; ogQueueClip(); });
  return true;
}
// 편집기의 기본 좌표 변환은 VirtualScroll의 계산값을 다시 조합한다. 페이지 없음은 쪽을 이어 붙이고
// 문서 탭은 다른 쪽을 화면 밖으로 옮기므로, 다시 그리는 순간 둘의 위치가 잠깐이라도 달라지면 클릭과
// 위·아래 방향키(내부적으로 같은 hitTest를 사용)가 엉뚱한 문단을 고른다. 보이는 캔버스의 실제 사각형을
// 기준으로 좌표를 되돌리면 확대·스크롤·쪽 재배치 중에도 화면과 hitTest가 정확히 일치한다.
// 화면에 그려진 쪽 캔버스와 그 쪽 번호. 편집 화면의 캔버스 묶음(canvasPool)이 쪽 번호별로 기억하는 것을 그대로 쓴다.
// (캔버스 위치로 쪽 번호를 짐작하면, 쪽 배치를 다시 계산한 직후처럼 위치와 계산값이 잠깐 어긋날 때 쪽을 못 찾거나 잘못 찾는다.
//  그러면 클릭이 엉뚱한 곳에 커서를 놓고, 여백 자르기가 빠진 쪽의 흰 여백이 앞 쪽 글을 덮는다.)
function ogPageCanvases() {
  const pool = window.__ogolgyeStudio?.canvasView?.canvasPool;
  try {
    const pages = pool?.activePages;
    if (Array.isArray(pages)) return pages.map((i) => [i, pool.getCanvas(i)]).filter(([, c]) => c && c.isConnected);
  } catch { /* 편집 화면 구조가 다르면 아래 방식 */ }
  // 예비: 캔버스 위치와 쪽 위치 계산값을 맞춰 본다
  const vs = window.__ogolgyeStudio?.inputHandler?.virtualScroll, out = [];
  for (const c of document.querySelectorAll("#scroll-content .document-page-canvas")) {
    const top = Number.parseFloat(c.style.top);
    const i = vs?.pageOffsets?.findIndex((o) => Math.abs(o - top) < 1) ?? -1;
    if (i >= 0) out.push([i, c]);
  }
  return out;
}
function ogInstallPagePointSync(ih, vs) {
  if (!ih || ih.__ogPagePointSync || typeof ih.pagePointFromClientPoint !== "function") return;
  ih.__ogPagePointSync = true;
  const original = ih.pagePointFromClientPoint.bind(ih);
  ih.pagePointFromClientPoint = function (clientX, clientY) {
    if (!ogPageless()) return original(clientX, clientY);
    const content = this.container?.querySelector("#scroll-content");
    if (!content || !vs.pageOffsets?.length) return original(clientX, clientY);
    let best = null;
    for (const [pageIdx, canvas] of ogPageCanvases()) {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      // 이어 붙인 쪽의 잘린 위·아래 여백이 겹치면 실제 본문에 가까운 쪽을 우선한다.
      const band = vs.__ogBands?.[pageIdx];
      const scaleY = rect.height / Math.max(1, vs.pageHeights[pageIdx] / (this.viewportManager.getZoom() || 1));
      const bodyTop = band ? rect.top + (band[0] / (this.viewportManager.getZoom() || 1)) * scaleY : rect.top;
      const bodyBottom = band ? rect.top + (band[1] / (this.viewportManager.getZoom() || 1)) * scaleY : rect.bottom;
      const bodyDistance = clientY < bodyTop ? bodyTop - clientY : clientY > bodyBottom ? clientY - bodyBottom : 0;
      const pageDistance = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
      const score = bodyDistance * 1000 + pageDistance;
      if (!best || score < best.score) best = { canvas, rect, pageIdx, score };
    }
    if (!best) return original(clientX, clientY);
    try {
      const info = window.__ogolgyeStudio.wasm.getPageInfo(best.pageIdx);
      const scaleX = best.rect.width / Math.max(1, info.width);
      const scaleY = best.rect.height / Math.max(1, info.height);
      // 페이지 없음에서는 잘라 낸 종이 여백도 캔버스 사각형 안에 남아 있다. 그 좌표를 그대로
      // hitTest에 넘기면 여백을 끌 때 다른 줄/쪽으로 튀거나, 선택 끝이 보이지 않는 여백에 놓인다.
      // 보이는 본문 안으로 제한해 클릭·정방향/역방향 드래그·자동 스크롤이 같은 좌표계를 쓴다.
      const band = vs.__ogBands?.[best.pageIdx];
      const zoom = this.viewportManager.getZoom() || 1;
      const left = info.marginLeft ?? 0, right = info.width - (info.marginRight ?? 0);
      const top = band ? band[0] / zoom : 0, bottom = band ? band[1] / zoom : info.height;
      const pageX = Math.min(Math.max((clientX - best.rect.left) / scaleX, left), Math.max(left, right));
      const pageY = Math.min(Math.max((clientY - best.rect.top) / scaleY, top), Math.max(top, bottom));
      return { pageIdx: best.pageIdx, pageX, pageY };
    } catch { return original(clientX, clientY); }
  };
}
// 쪽 캔버스마다 여백 잘라 내기(캔버스가 그리는 쪽 번호의 본문 경계로)
// 쪽 하나의 자르기 모양. 본문 경계에 딱 맞춰 자른다. 여백 모서리 표시는 본문 경계선 위에 그려지고 본문 "바깥"(좌우 여백,
// 위아래 여백)으로만 뻗으므로, 본문 폭 안쪽은 경계까지 그대로 보여 주고(쪽 맨 윗줄 글자가 잘리지 않게) 좌우 여백만 경계에서
// 3px 안쪽까지 잘라 표시를 가린다. k: 요소가 그려진 배율 ÷ 지금 배율(확대·축소 직후 다시 그리기 전까지 요소는 옛 크기에
// scale 로 늘려 보여 주는데, 자르기는 늘리기 전 좌표로 적용되므로 경계를 그만큼 되돌려 놓아야 한다).
function ogPageClip(band, fallbackWidth, k = 1) {
  const [t, b, h, l, r, w] = band.map((v) => v * k);
  const e = 3 * k, T = t.toFixed(1), B = b.toFixed(1), Ti = (t + e).toFixed(1), Bi = (b - e).toFixed(1), L = l.toFixed(1), R = r.toFixed(1), W = (w || fallbackWidth).toFixed(1);
  return l && r ? `polygon(${L}px ${T}px, ${R}px ${T}px, ${R}px ${Ti}px, ${W}px ${Ti}px, ${W}px ${Bi}px, ${R}px ${Bi}px, ${R}px ${B}px, ${L}px ${B}px, ${L}px ${Bi}px, 0px ${Bi}px, 0px ${Ti}px, ${L}px ${Ti}px)`
    : `inset(${(t + k).toFixed(1)}px 0 ${Math.max(0, h - b + k).toFixed(1)}px 0)`;
}
function ogClipPages() {
  const ih = window.__ogolgyeStudio?.inputHandler, vs = ih?.virtualScroll, zoom = ih?.viewportManager?.getZoom?.() || 1;
  const byCanvas = new Map(ogPageCanvases().map(([i, c]) => [c, i]));
  const on = ogPageless() && !!vs?.__ogBands;
  const drawn = new Map();                                         // 쪽 번호 → 그 쪽 그림이 그려진 배율 ÷ 지금 배율
  document.querySelectorAll("#scroll-content .document-page-canvas").forEach((c) => {
    const idx = byCanvas.get(c);
    // 페이지 없음이 아니거나 어느 쪽인지 모르면 자르지 않는다(예전 쪽의 자르기가 남아 글이 가려지지 않게)
    if (!on || idx === undefined || !vs.__ogBands[idx]) { if (c.style.clipPath) c.style.clipPath = ""; return; }
    // 쪽 배치를 다시 계산했는데 캔버스가 예전 자리에 남아 있으면 계산된 자리로 옮긴다
    // (커서·선택 표시는 계산된 자리를 기준으로 그리므로, 캔버스가 어긋나 있으면 커서가 글과 다른 곳에 보인다)
    const want = vs.pageOffsets?.[idx];
    if (Number.isFinite(want) && Math.abs(parseFloat(c.style.top) - want) > 0.5) c.style.top = `${want}px`;
    const rz = Number(c.dataset.rhwpRenderedZoom), k = Number.isFinite(rz) && rz > 0 ? rz / zoom : 1;
    const clip = ogPageClip(vs.__ogBands[idx], c.width, k);
    if (c.style.clipPath !== clip) c.style.clipPath = clip;
    drawn.set(idx, k);
  });
  // 편집 화면은 쪽 그림 말고도 쪽 크기 그대로인 층을 쪽마다 놓는다: 그림이 든 쪽의 흰 종이 판 + 그림(DOM 이미지) 층, 배경·글 뒤·글 앞
  // 개체 층, 타자 중에 쓰는 고정 층, 격자, 머리말·꼬리말 편집 층. 자르지 않으면 쪽 끝 아래로 남는 부분이 다음 쪽의 첫 줄들(또는
  // 다음 쪽 맨 위 그림의 윗부분)을 덮고, 위 여백 부분은 앞 쪽의 마지막 줄을 덮는다(어느 쪽이 나중에 그려졌는지에 따라 달라 가끔만
  // 보였다). 쪽 그림과 똑같이 자른다. 쪽 그림이 이미 치워졌는데 층만 남은 경우에도(그리기 실패 등) 그 쪽의 경계로 자른다.
  document.querySelectorAll("#scroll-content [data-rhwp-overlay-page], #scroll-content [data-rhwp-grid-page], #scroll-content [data-rhwp-hf-edit-page]").forEach((el) => {
    if (el.classList.contains("document-page-canvas")) return;
    const idx = Number(el.dataset.rhwpOverlayPage ?? el.dataset.rhwpGridPage ?? el.dataset.rhwpHfEditPage), band = on ? vs.__ogBands[idx] : null;
    if (!band) { if (el.style.clipPath) el.style.clipPath = ""; return; }
    const want = vs.pageOffsets?.[idx];
    if (Number.isFinite(want) && el.style.top && Math.abs(parseFloat(el.style.top) - want) > 0.5) el.style.top = `${want}px`;
    const clip = ogPageClip(band, parseFloat(el.style.width) || 0, drawn.get(idx) ?? 1);
    if (el.style.clipPath !== clip) el.style.clipPath = clip;
  });
}
// 화면에 보이는 쪽(과 그 앞뒤)의 경계가 지금 문서 내용으로 잰 것인지 확인한다. 문서가 바뀌면 커서 쪽 직전부터만 다시 재는데,
// 바뀐 곳이 커서보다 앞쪽이면(되돌리기, 앞 문단의 모양 바꾸기, 여러 단계 붙여넣기 등) 그 사이 쪽들은 옛 경계가 남는다.
// 보이는 쪽만 다시 재므로 긴 문서에서도 가볍고, 스크롤해 새 쪽이 보일 때도 같은 확인을 한다.
function ogCheckVisibleEdges() {
  if (!ogPageless()) return;
  const n = window.__ogolgyeStudio?.inputHandler?.virtualScroll?.pageHeights?.length || 0;
  if (!n || ogEdges.list.length !== n) return;
  const stale = new Set();
  for (const [i] of ogPageCanvases()) for (const k of [i - 1, i, i + 1]) if (k >= 0 && k < n && ogEdges.seen.get(k) !== ogEdges.rev && !ogEdges.dirty.has(k)) stale.add(k);
  if (!stale.size) { ogVerifyVisibleEdges(); return; }
  const pending = ogEdges.dirty.size > 0;                          // 이미 다시 잴 쪽이 예약돼 있으면(타자 중) 그 예약에 얹기만 한다
  for (const k of stale) ogEdges.dirty.add(k);
  if (pending) return;
  ogEdges.hint = Math.min(...stale);
  clearTimeout(ogEdges.refreshTimer);
  ogEdges.refreshTimer = setTimeout(ogRefreshEdges, 30);
}
// 마지막 안전장치: 화면이 잠잠해지면(0.4초) 보이는 쪽의 내용 범위를 엔진에서 다시 재서, 기억한 경계와 다르면 바로 고친다.
// 경계가 옛 값으로 남는 길을 하나씩 막아도(붙여넣기 뒤, 뒤에서 도는 쪽 나눔, 앞쪽 편집) 놓친 길이 있으면 그림 위쪽이나
// 쪽 첫 줄이 가려진 채 남는다 — 어떤 길로 어긋났든 보이는 쪽은 스스로 맞춰지게 한다. 보이는 쪽만(2~3쪽) 재므로 가볍다.
let ogVerifyTimer = 0;
function ogVerifyVisibleEdges() {
  clearTimeout(ogVerifyTimer);
  ogVerifyTimer = setTimeout(() => {
    const vs = window.__ogolgyeStudio?.inputHandler?.virtualScroll, zoom = window.__ogolgyeStudio?.inputHandler?.viewportManager?.getZoom?.() || 1;
    const n = vs?.pageHeights?.length || 0;
    if (!ogPageless() || !n || ogEdges.dirty.size || ogEdges.list.length !== n) return;
    ogClipPages();                                                 // 쪽 그림의 자리·자르기도 지금 경계에 다시 맞춘다(같으면 아무것도 안 바뀐다)
    const differs = (a, b) => Math.abs((a ?? 0) - (b ?? 0)) > 0.5;
    let changed = false;
    for (const [i] of ogPageCanvases()) {
      const cur = ogEdges.list[i]; if (!cur) continue;
      const [t, b] = ogPageGeometry.body[i] || [0, vs.pageHeights[i] / zoom];
      let fresh; try { fresh = ogPageContentEdge(i, t, b); } catch { continue; }
      if (differs(fresh.start, cur.start) || differs(fresh.end, cur.end) || differs(fresh.exact, cur.exact) || fresh.startKind !== cur.startKind || fresh.endKind !== cur.endKind) { ogEdges.list[i] = fresh; changed = true; }
      ogEdges.seen.set(i, ogEdges.rev);
    }
    if (changed) ogSoftRelayout();
  }, 400);
}
let ogClipQueued = false;
function ogQueueClip() { if (ogClipQueued) return; ogClipQueued = true; ogFrame(() => { ogClipQueued = false; ogClipPages(); ogCheckVisibleEdges(); }); }

// 엔진의 여러 줄 선택 사각형은 중간 줄을 '본문 폭 전체'로 돌려준다. 종이 보기에서는 자연스럽지만
// 페이지 없음에서는 오른쪽의 긴 빈 작업면까지 파랗게 칠해져 여백을 선택한 것처럼 보인다.
// 각 줄에서 실제로 그려진 글자/개체의 가로 범위와 교차시켜 브라우저·Google 문서와 같은 표시로 만든다.
// pages: 자를 쪽 번호(화면에 그려진 쪽). 나머지 쪽의 사각형은 그대로 두었다가 스크롤해 보일 때 자른다.
// (전체 선택처럼 선택이 긴 문서 전체에 걸칠 때 모든 쪽의 글 배치를 읽지 않게)
function ogTrimSelectionRects(rects, pages = null) {
  if (!ogPageless() || !Array.isArray(rects) || !rects.length) return rects;
  const d = ogDoc();
  if (!d) return rects;
  // 기억해 둔 글 배치가 지금 화면과 다르면(옛 배치) 선택 표시를 엉뚱한 폭으로 자른다 — 줄마다 앞쪽 몇 글자만 칠해진 것처럼 보였다.
  // 문서가 바뀌거나(rev: 편집·뒤에서 도는 쪽 나눔), 보기 용지가 바뀌면(창 폭 → 줄바꿈이 달라짐) 모두 버린다. 그 밖에 놓친 길
  // (글꼴이 늦게 불려 글 폭이 바뀜 등)이 있어도 오래 남지 않게, 읽은 지 1.5초가 지난 것은 다시 읽는다.
  const stamp = `${ogEdges.rev}|${JSON.stringify(ogPL.view)}`;
  if (ogSelectionRuns.doc !== d || ogSelectionRuns.stamp !== stamp) { ogSelectionRuns.doc = d; ogSelectionRuns.stamp = stamp; ogSelectionRuns.pages.clear(); }
  const now = performance.now();
  const runsFor = (pageIndex) => {
    if (ogSelectionRuns.pages.has(pageIndex)) {
      const cached = ogSelectionRuns.pages.get(pageIndex);
      if (now - cached.at <= 1500) {
        ogSelectionRuns.pages.delete(pageIndex); ogSelectionRuns.pages.set(pageIndex, cached);   // LRU
        return cached;
      }
      ogSelectionRuns.pages.delete(pageIndex);
    }
    let runs = [];
    try {
      const rawRuns = JSON.parse(d.getPageTextLayout(pageIndex)).runs || [];
      runs = rawRuns.map((r) => ({
        x: Number(r.x), y: Number(r.y), w: Number(r.w ?? r.width), h: Number(r.h ?? r.height)
      })).filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.w) && r.w > 0)
        .sort((a, b) => a.y - b.y || a.x - b.x);
    } catch { runs = []; }
    // 선택 사각형 하나마다 그 쪽의 모든 글자 조각을 filter하면 전체 선택이 O(줄 수×글자 조각 수)가 된다.
    // y순 인덱스와 최대 높이를 함께 저장해 해당 줄 주변만 이진 탐색한다.
    const indexed = { runs, at: now, maxH: runs.reduce((m, r) => Math.max(m, Number.isFinite(r.h) && r.h > 0 ? r.h : 0), 0) };
    ogSelectionRuns.pages.set(pageIndex, indexed);
    while (ogSelectionRuns.pages.size > 16) ogSelectionRuns.pages.delete(ogSelectionRuns.pages.keys().next().value);
    return indexed;
  };
  const lineRuns = (pageIndex, y, h) => {
    const { runs, maxH } = runsFor(pageIndex);
    const fromY = y - Math.max(maxH, h, 2) - 2, toY = y + h + 2;
    let lo = 0, hi = runs.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (runs[mid].y < fromY) lo = mid + 1; else hi = mid; }
    const found = [];
    for (let i = lo; i < runs.length && runs[i].y < toY; i++) {
      const r = runs[i], rh = Number.isFinite(r.h) && r.h > 0 ? r.h : h;
      if (r.y + rh > y - 2) found.push(r);
    }
    return found;
  };
  return rects.map((rect) => {
    if (pages && !pages.has(rect.pageIndex)) return rect;
    const x = Number(rect.x), y = Number(rect.y), w = Number(rect.width), h = Number(rect.height);
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return rect;
    const sameLine = lineRuns(rect.pageIndex, y, h);
    if (!sameLine.length) return rect;
    const lineLeft = Math.min(...sameLine.map((r) => r.x));
    // 문단 끝(줄바꿈)이 선택되었다는 표시가 글자 끝에 조금 보이도록 2 HWPUNIT을 남긴다.
    const lineRight = Math.max(...sameLine.map((r) => r.x + r.w)) + 2;
    const nextLeft = Math.max(x, lineLeft), nextRight = Math.min(x + w, lineRight);
    return nextRight > nextLeft ? { ...rect, x: nextLeft, width: nextRight - nextLeft } : rect;
  });
}

// 편집기(rhwp)는 글자에만 선택 사각형을 만들고, 선택 범위 안의 그림·표(글자처럼 취급한 개체)에는 표시가 없다.
// 전체 선택을 해도 그림·표는 선택되지 않은 것처럼 보였다(실제로는 함께 지워진다). 화면에 그려진 쪽에서
// 선택 범위 안 문단에 든 그림·표 자리를 선택 사각형으로 더한다. 본문 개체만(표 칸 안 선택 등은 편집기 표시 그대로).
function ogObjectSelectionRects(rects, pages) {
  const ih = window.__ogolgyeStudio?.inputHandler, d = ogDoc();
  if (!ih || !d || !Array.isArray(rects) || !rects.length || !pages?.size) return [];
  let sel;
  try { sel = ih.cursor.getSelection?.(); } catch { return []; }
  const a = sel?.anchor, f = sel?.focus;
  if (!a || !f || a.parentParaIndex !== undefined || f.parentParaIndex !== undefined) return [];
  const before = (x, y) => x.paragraphIndex < y.paragraphIndex || (x.paragraphIndex === y.paragraphIndex && x.charOffset < y.charOffset);
  const [s, e] = before(f, a) ? [f, a] : [a, f];
  if (!before(s, e)) return [];
  // 개체 문단이 선택에 드는가: 시작·끝 문단 사이, 시작 문단은 맨 앞부터 고른 경우, 끝 문단은 무언가 고른 경우
  const covered = (p) => (p > s.paragraphIndex && p < e.paragraphIndex)
    || (p === s.paragraphIndex && s.charOffset === 0 && (p < e.paragraphIndex || e.charOffset > 0))
    || (p === e.paragraphIndex && p > s.paragraphIndex && e.charOffset > 0);
  const out = [];
  for (const pageIndex of pages) {
    let controls = [];
    try { controls = JSON.parse(d.getPageControlLayout(pageIndex)).controls || []; } catch { continue; }
    for (const c of controls) {
      if (!["image", "picture", "table", "shape", "equation"].includes(c.type) || c.secIdx !== s.sectionIndex || !covered(c.paraIdx)) continue;
      out.push({ pageIndex, x: c.x, y: c.y, width: c.w, height: c.h });
    }
  }
  return out;
}

function ogInstallSelectionGuard() {
  const ih = window.__ogolgyeStudio?.inputHandler, renderer = ih?.selectionRenderer;
  if (!ih || !renderer || typeof renderer.render !== "function") return false;
  if (renderer.__ogSelectionGuard) return true;
  const render = renderer.render;
  // 마지막으로 받은 선택 사각형(원본)과 이미 잘라 그린 쪽. 스크롤로 새 쪽이 보이면 그 쪽만 더 잘라 다시 그린다.
  const last = { rects: null, zoom: 1, trimmed: new Set() };
  const visiblePages = () => new Set(window.__ogolgyeStudio?.canvasView?.canvasPool?.activePages || []);
  renderer.render = function (rects, zoom) {
    last.rects = rects; last.zoom = zoom; last.trimmed = visiblePages();
    return render.call(this, [...ogTrimSelectionRects(rects, last.trimmed), ...ogObjectSelectionRects(rects, last.trimmed)], zoom);
  };
  let scrollTimer = 0;
  ih.container?.addEventListener("scroll", () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      if (!ogPageless() || !last.rects || !ih.cursor?.hasSelection?.()) return;
      const pages = visiblePages();
      if ([...pages].every((p) => last.trimmed.has(p))) return;
      for (const p of pages) last.trimmed.add(p);
      renderer.lastSignature = "";
      render.call(renderer, [...ogTrimSelectionRects(last.rects, last.trimmed), ...ogObjectSelectionRects(last.rects, last.trimmed)], last.zoom);
    }, 120);
  }, { passive: true });
  renderer.__ogSelectionGuard = true;
  return true;
}

function ogRefreshSelection() {
  const ih = window.__ogolgyeStudio?.inputHandler;
  try {
    if (!ih?.cursor?.hasSelection?.()) return false;
    // SelectionRenderer는 좌표 서명을 캐시한다. 페이지를 이어 붙인 뒤에는 같은 논리 선택도 화면
    // 좌표가 달라질 수 있으므로 캐시를 비우고 논리 시작/끝에서 사각형을 다시 받는다.
    if (ih.selectionRenderer) ih.selectionRenderer.lastSignature = "";
    ih.caret?.hide?.();
    ih.updateSelection?.();
    return true;
  } catch { return false; }
}

// 쪽 위치만 다시 잡기(다시 그리지 않음). ogRelayout 은 확대/축소 신호를 보내 화면에 보이는 쪽을 전부 다시 그린다 — 긴 문서에서
// 한 번에 0.3~0.5초. 쪽 경계가 바뀌었을 뿐 쪽 그림은 그대로인 경우(타자·엔터 뒤, 새 쪽이 보일 때)에는 쪽 자리만 옮기면 된다:
// 편집 화면의 배치 계산(recalcLayout — 이미 그려진 쪽 그림을 새 자리로 옮긴다)과 보이는 쪽 갱신(새로 보이는 쪽만 그린다)을 쓴다.
function ogSoftRelayout() {
  const og = window.__ogolgyeStudio, ih = og?.inputHandler, cv = og?.canvasView, vm = ih?.viewportManager, c = ih?.container, vs = ih?.virtualScroll;
  if (!cv || !vm || !c || !vs || typeof cv.recalcLayout !== "function" || typeof cv.updateVisiblePages !== "function") { ogRelayout(); return; }
  try {
    // 기준 쪽(커서가 있는 쪽이 그려져 있으면 그 쪽, 아니면 화면 맨 위에 걸친 쪽)이 화면에서 제자리에 있게 스크롤을 맞춘다
    let anchor = -1;
    try { const r = ih.cursor?.getRect?.(); if (Number.isInteger(r?.pageIndex) && (cv.canvasPool?.activePages || []).includes(r.pageIndex)) anchor = r.pageIndex; } catch { /* 커서 없음 */ }
    if (anchor < 0) anchor = vs.getPageAtY(c.scrollTop + 1);
    const before = vs.pageOffsets[anchor];
    vm.scrollY = c.scrollTop; vm.scrollX = c.scrollLeft;
    cv.recalcLayout();
    const delta = vs.pageOffsets[anchor] - before;
    if (Number.isFinite(delta) && Math.abs(delta) > 0.5) { if (typeof vm.setScrollTop === "function") vm.setScrollTop(c.scrollTop + delta); else c.scrollTop += delta; }
    cv.updateVisiblePages();
    // 커서·선택·개체 손잡이를 새 쪽 자리에 맞춘다(확대/축소 신호를 받았을 때 편집 화면이 하는 일)
    const zoom = vm.getZoom();
    try { if (ih.active && ih.cursor.getRect()) ih.caret.updatePosition(zoom); } catch { /* 커서 표시 없음 */ }
    try { if (ih.fieldMarker?.isVisible) ih.updateFieldMarkers(); } catch { /* 필드 표시 없음 */ }
    try { if (ih.cursor.isInCellSelectionMode?.()) ih.updateCellSelection(); } catch { /* 칸 선택 없음 */ }
    try { if (ih.cursor.isInPictureObjectSelection?.()) ih.renderPictureObjectSelection(); } catch { /* 그림 선택 없음 */ }
    try { if (ih.cursor.isInTableObjectSelection?.()) ih.renderTableObjectSelection(); } catch { /* 표 선택 없음 */ }
  } catch { ogRelayout(); return; }
  ogQueueClip();
  ogFrame(ogRefreshSelection);
}
// 다시 잴 쪽(dirty)을 재 보고, 경계가 실제로 바뀐 때만 쪽 위치를 다시 잡는다. 예전에는 재기 전에 무조건 다시 배치(= 모두 다시 그림)했다
// — 줄 수가 그대로인 타자(대부분)에도 타자를 멈출 때마다 화면이 0.3~0.5초 멈췄다.
// 커서 쪽부터 뒤로 재다가 세 쪽이 잇달아 그대로면 그 뒤 쪽들은 재지 않는다(보일 때 확인한다 — ogCheckVisibleEdges).
function ogRefreshEdges() {
  if (!ogPageless()) return;
  const vs = window.__ogolgyeStudio?.inputHandler?.virtualScroll, n = vs?.pageHeights?.length || 0;
  if (!ogEdges.dirty.size) return;
  let pageCount = n; try { pageCount = ogW().pageCount ?? ogW().doc.pageCount(); } catch { /* 편집 준비 중 */ }
  // 쪽 수·용지가 바뀌었으면 배치 계산이 모든 것을 다시 읽어야 한다(쪽 그림도 달라진다)
  if (!n || pageCount !== n || ogEdges.list.length !== n || ogPageGeometry.body.length !== n) { ogRelayout(); return; }
  const zoom = window.__ogolgyeStudio.inputHandler.viewportManager?.getZoom?.() || 1;
  const hint = Math.max(0, (ogEdges.hint ?? 0) - 1);
  const pages = [...ogEdges.dirty].filter((i) => i >= 0 && i < n).sort((a, b) => (a < hint) - (b < hint) || a - b);   // 커서 쪽부터 뒤로, 그다음 앞쪽
  const differs = (a, b) => Math.abs((a ?? 0) - (b ?? 0)) > 0.5;
  const t0 = performance.now();
  let changed = false, calm = 0, k = 0;
  for (const i of pages) {
    if (k >= 3 && performance.now() - t0 > 25) break;
    const cur = ogEdges.list[i], [t, b] = ogPageGeometry.body[i] || [0, vs.pageHeights[i] / zoom];
    let fresh; try { fresh = ogPageContentEdge(i, t, b); } catch { ogEdges.dirty.delete(i); continue; }
    k++; ogEdges.dirty.delete(i); ogEdges.seen.set(i, ogEdges.rev);
    if (!cur || differs(fresh.start, cur.start) || differs(fresh.end, cur.end) || differs(fresh.exact, cur.exact) || fresh.startKind !== cur.startKind || fresh.endKind !== cur.endKind) {
      ogEdges.list[i] = fresh; changed = true; calm = 0;
    } else if (i >= hint && ++calm >= 3 && !changed) {
      for (const j of [...ogEdges.dirty]) if (j > i) ogEdges.dirty.delete(j);
      break;
    }
  }
  for (const i of [...ogEdges.dirty]) if (i < 0 || i >= n) ogEdges.dirty.delete(i);
  if (changed) { ogSoftRelayout(); return; }                       // 남은 쪽은 배치 계산(ogPageEdges)이 이어서 잰다
  if (ogEdges.dirty.size) { clearTimeout(ogEdges.refreshTimer); ogEdges.refreshTimer = setTimeout(ogRefreshEdges, 30); }
}
function ogRelayout() {
  // 창 크기가 그대로면 편집 화면이 배치를 다시 계산하지 않으므로, 같은 배율로 확대/축소 변경 신호를 보내 다시 계산시킨다
  const og = window.__ogolgyeStudio, vm = og && og.inputHandler && og.inputHandler.viewportManager;
  // 편집 화면은 스크롤 위치를 스크롤 이벤트 때 기억해 두고 그 값으로 화면 위치를 다시 잡는다. 커서를 따라 방금 스크롤한 값이
  // 아직 반영되지 않았으면 예전 값(맨 위 등)으로 되돌아가므로, 실제 스크롤 위치를 먼저 알려 준다.
  const c = og?.inputHandler?.container;
  if (vm && c) { vm.scrollY = c.scrollTop; vm.scrollX = c.scrollLeft; }
  try { if (vm && og.eventBus) og.eventBus.emit("zoom-changed", vm.getZoom()); else dispatchEvent(new Event("resize")); }
  catch { dispatchEvent(new Event("resize")); }
  ogQueueClip();
  ogFrame(ogRefreshSelection);
}
function ogApplyView(v) {
  if (v.ruler !== undefined) ogRoot.classList.toggle("og-noruler", !v.ruler);
  if (v.pageMode) { if (v.pageMode === "paper") ogLeavePageless(); else ogEnterPageless(); return; }
  ogRelayout();
}

// ── 문서 탭 ──────────────────────────────────────────────────────
// 탭 = 쪽 나누기 + 탭 이름 책갈피("오골계워드:탭=이름"). 첫 탭은 문서 맨 앞에서 시작한다(책갈피가 없으면 "탭 1").
// 고른 탭의 쪽만 보이도록 쪽 위치 계산에서 다른 탭의 쪽을 화면 밖으로 치운다(주 편집 화면에서만).
const OG_TAB = "오골계워드:탭=";
const OG_IS_MAIN = new URLSearchParams(location.search).get("ogolgye") === "main";
// 서브뷰 편집기에는 "문서 복구" 창을 띄우지 않는다(복구는 주 편집 화면에서 한다). 편집기는 새로 뜰 때마다 복구본이 있으면
// 이 창을 띄우는데, 서브뷰에서는 좁아 잘 보이지도 않으면서 화면 전체를 덮어 서브뷰 탭의 닫기(×·전체 닫기)를 가로챘다.
// "나중에"를 누른 것과 같게 닫는다(복구본은 그대로 남아 주 편집 화면에서 복구할 수 있다).
if (!OG_IS_MAIN) {
  const ogDismissRecovery = () => {
    for (const body of document.querySelectorAll(".recovery-dialog-body")) {
      const box = body.closest(".modal-overlay") || body.parentElement;
      const later = [...(box?.querySelectorAll("button") || [])].find((b) => b.textContent.trim() === "나중에");
      if (later) later.click(); else box?.remove();
    }
  };
  const ogRecoveryWatch = new MutationObserver(ogDismissRecovery);
  ogRecoveryWatch.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => ogRecoveryWatch.disconnect(), 30000);           // 복구 창은 편집기가 뜰 때 한 번만 나온다
}
const ogTab = { active: 0 };
const ogTabCache = { doc: null, list: [], dirty: true, timer: 0 };
function ogInvalidateTabCache(clear = false) {
  ogTabCache.dirty = true;
  if (clear) { ogTabCache.doc = null; ogTabCache.list = []; }
}
function ogTabList(force = false) {
  const d = ogDoc(); if (!d) return [];
  // 커서 이동과 화면 재배치는 매우 자주 일어난다. 그때마다 책갈피를 JSON으로
  // 풀고 각 탭의 시작 쪽을 다시 묻지 않고, 문서 입력이 잠시 멈출 때 갱신한다.
  if (!force && ogTabCache.doc === d && ogTabCache.list.length) return ogTabCache.list;
  let bms = [];
  try { bms = JSON.parse(d.getBookmarks()).filter((b) => String(b.name).startsWith(OG_TAB) && (b.sec || 0) === 0); } catch { bms = []; }
  const tabs = bms.map((b) => ({ name: b.name.slice(OG_TAB.length) || "이름 없는 페이지", para: b.para, bm: b })).sort((a, b) => a.para - b.para);
  if (!tabs.length || tabs[0].para !== 0) tabs.unshift({ name: "페이지 1", para: 0, bm: null });
  for (const t of tabs) { try { t.startPage = JSON.parse(d.getCursorRect(0, t.para, 0)).pageIndex; } catch { t.startPage = -1; } }
  ogTabCache.doc = d; ogTabCache.list = tabs; ogTabCache.dirty = false;
  return tabs;
}
function ogTabOfPara(tabs, para) {
  let lo = 0, hi = tabs.length - 1, found = 0;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (tabs[mid].para <= para) { found = mid; lo = mid + 1; } else hi = mid - 1; }
  return found;
}
function ogApplyTabLayout(vs) {
  ogTab.range = null;
  if (!OG_IS_MAIN) return;
  const tabs = ogTabList(); if (tabs.length < 2) return;
  const n = vs.pageHeights.length; if (!n) return;
  const a = Math.min(Math.max(0, ogTab.active), tabs.length - 1);
  const start = tabs[a].startPage, end = a + 1 < tabs.length ? tabs[a + 1].startPage - 1 : n - 1;
  if (start < 0 || end < start || end >= n) return;
  const zoom = window.__ogolgyeStudio.inputHandler.viewportManager.getZoom() || 1;
  const bands = vs.__ogBands;
  const firstTop = bands ? 28 * zoom - bands[start][0] : vs.pageOffsets[0];
  const shift = vs.pageOffsets[start] - firstTop;
  for (let i = 0; i < n; i++) {
    if (i < start) vs.pageOffsets[i] = -1e7 + i;                     // 앞 탭의 쪽: 화면 위 멀리(순서는 유지)
    else if (i > end) vs.pageOffsets[i] = 1e7 + i;                   // 뒤 탭의 쪽: 화면 아래 멀리
    else vs.pageOffsets[i] -= shift;
  }
  vs.totalHeight = vs.pageOffsets[end] + (bands ? bands[end][1] + 28 * zoom : vs.pageHeights[end] + vs.pageGap);
  ogTab.range = [start, end];
}
// 문단의 실제 끝(글자 수 + 그 문단의 그림·표 수)
function ogParaEnd(d, p) {
  let objs = 0;
  try { objs = JSON.parse(d.getControls()).filter((c) => (c.list || 0) === 0 && c.para === p && /^(gso|tbl)/.test(String(c.ctrlId).trim())).length; } catch { /* 없음 */ }
  return d.getParagraphLength(0, p) + objs;
}
// 탭 편집은 편집 화면의 실행 취소 되는 경로로
function ogTabOperation(kind, fn) {
  const ih = window.__ogolgyeStudio?.inputHandler; if (!ih) return;
  // 편집 화면은 입력 직후 쪽 배치를 미뤄 두고 초점이 빠질 때 마무리한다. 패널을 눌러도 초점이 안 빠지므로 먼저 마무리한다
  try { ih.flushDeferredPaginationIfNeeded("ogolgye-tab", false); } catch { /* 없음 */ }
  let pos = null;
  ih.executeOperation({ kind: "snapshot", operationType: "ogolgye-" + kind, operation: () => (pos = fn(ogDoc())) });
  ogInvalidateTabCache();
  if (pos) { try { ih.moveCursorTo(pos); } catch { /* 그대로 */ } }
}
function ogSelectTab(i, moveCursor = true) {
  const tabs = ogTabList(); if (!tabs[i]) return;
  ogTab.active = i;
  ogRedraw();                                                       // 숨겼던 쪽은 예전 그림이 남아 있을 수 있어 새로 그린다
  if (moveCursor) { try { window.__ogolgyeStudio.inputHandler.moveCursorTo({ sectionIndex: 0, paragraphIndex: tabs[i].para, charOffset: 0 }); } catch { /* 그대로 */ } }
  const c = window.__ogolgyeStudio?.inputHandler?.container; if (c) c.scrollTop = 0;
  ogRenderTabs();
  try { window.__ogolgyeStudio.inputHandler.focus(); } catch { /* 초점 */ }
}
function ogAddTab() {
  const tabs = ogTabList();
  const used = new Set(tabs.map((t) => t.name));
  let k = tabs.length + 1; while (used.has("페이지 " + k)) k++;
  const name = "페이지 " + k;
  let newPara = null;
  ogTabOperation("add-tab", (d) => {
    if (!tabs[0].bm) d.addBookmark(0, 0, 0, OG_TAB + tabs[0].name);            // 첫 탭 이름도 파일에 적어 둔다
    const last = d.getParagraphCount(0) - 1;
    const r = JSON.parse(d.insertPageBreak(0, last, ogParaEnd(d, last)));
    newPara = r.paraIdx ?? last + 1;
    if (ogStyleIds.normal !== undefined) d.applyStyle(0, newPara, ogStyleIds.normal);
    d.addBookmark(0, newPara, 0, OG_TAB + name);
    return { sectionIndex: 0, paragraphIndex: newPara, charOffset: 0 };
  });
  ogTab.active = tabs.length;
  ogTabList(true); ogRedraw(); ogRenderTabs();
  try { window.__ogolgyeStudio.inputHandler.focus(); } catch { /* 초점 */ }
}
function ogRenameTab(i, name) {
  name = String(name || "").trim(); const tabs = ogTabList(); const t = tabs[i];
  if (!t || !name || name === t.name) { ogRenderTabs(); return; }
  ogTabOperation("rename-tab", (d) => {
    if (t.bm) d.renameBookmark(t.bm.sec || 0, t.bm.para, t.bm.ctrlIdx, OG_TAB + name);
    else d.addBookmark(0, 0, 0, OG_TAB + name);
    return window.__ogolgyeStudio.inputHandler.cursor.getPosition();
  });
  // 책갈피 이름만 바꿔도 rhwp의 부분 갱신은 그 책갈피가 든 문단을 다시 그리는데,
  // 큰 제목 스타일에서는 이전 글자 조각과 새 조각의 범위를 잘못 합쳐 일부 글자가 빈 것처럼 보인다.
  // 본문 데이터는 그대로이므로 전체 쪽 배치/캔버스를 mutation 경로로 갱신하고 커서 사각형도 다시 받는다.
  ogTabList(true); ogRedraw(); ogRenderTabs();
}
function ogDeleteTab(i) {
  const tabs = ogTabList(); const t = tabs[i];
  if (!t || tabs.length < 2) return;
  if (!confirm(`"${t.name}" 페이지와 그 안의 내용을 모두 삭제할까요?`)) return;
  ogTabOperation("delete-tab", (d) => {
    // 범위 지우기(deleteRange)는 책갈피 같은 개체가 든 문단에서 엔진이 멈추므로, 문단 단위로 지운다
    const endPara = (i + 1 < tabs.length ? tabs[i + 1].para : d.getParagraphCount(0)) - 1;
    if (i > 0) {                                                                   // 뒤에서부터 문단 지우기(쪽 나누기도 함께 사라진다)
      for (let p = endPara; p >= t.para; p--) d.deleteParagraph(0, p);
      return { sectionIndex: 0, paragraphIndex: Math.max(0, t.para - 1), charOffset: 0 };
    }
    // 첫 탭: 첫 문단(문서 전체 설정이 든 구역 정의)은 남기고, 비운 뒤 다음 탭 첫 문단과 합친다
    for (let p = endPara; p >= 1; p--) d.deleteParagraph(0, p);
    const objs = JSON.parse(d.getControls()).filter((c) => (c.list || 0) === 0 && c.para === 0 && /^(gso|tbl)/.test(String(c.ctrlId).trim())).sort((a, b) => b.controlIndex - a.controlIndex);
    for (const c of objs) { try { String(c.ctrlId).trim() === "tbl" ? d.deleteTableControl(0, 0, c.controlIndex) : d.deletePictureControl(0, 0, c.controlIndex); } catch { /* 지울 수 없는 개체 */ } }
    if (t.bm) { const bm = JSON.parse(d.getBookmarks()).find((b) => b.name === OG_TAB + t.name && b.para === 0); if (bm) d.deleteBookmark(0, 0, bm.ctrlIdx); }
    // 빈 문단을 합치면 엔진이 멈추므로, 글자를 남긴 채(없으면 임시 글자) 먼저 합치고 첫 탭 글자만 지운다
    let first = d.getParagraphLength(0, 0);
    if (!first) { d.insertText(0, 0, 0, "x"); first = 1; }
    d.mergeParagraph(0, 1);
    d.deleteText(0, 0, 0, first);
    return { sectionIndex: 0, paragraphIndex: 0, charOffset: 0 };
  });
  ogTab.active = Math.max(0, i - 1);
  ogTabList(true); ogRedraw(); ogRenderTabs();
}
// 페이지 목록(주 편집 화면의 서식 도구 줄 맨 왼쪽)
function ogTabHeadings(tabs, i) {
  const d = ogDoc(), out = [];
  const from = tabs[i].para, to = (i + 1 < tabs.length ? tabs[i + 1].para : d.getParagraphCount(0)) - 1;
  for (let p = from; p <= to; p++) {
    try {
      const sn = JSON.parse(d.getStyleAt(0, p)).name, st = OG_STYLES.find((x) => x.name === sn);
      if (!st || !(st.level || st.key === "title")) continue;
      const len = d.getParagraphLength(0, p); if (!len) continue;
      out.push({ para: p, level: st.level || 1, text: d.getTextRange(0, p, 0, Math.min(len, 80)) });
    } catch { /* 건너뜀 */ }
  }
  return out;
}
const ogEsc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function ogRenderTabs(forceTabs = false) {
  const panel = document.querySelector(".og-tabs"); if (!panel || !ogDoc()) return;
  const tabs = ogTabList(forceTabs);
  if (ogTab.active >= tabs.length) ogTab.active = tabs.length - 1;
  const list = panel.querySelector(".og-tabs-list");
  const expanded = panel.closest(".og-page-list")?.classList.contains("open");
  list.innerHTML = tabs.map((t, i) => {
    const on = i === ogTab.active;
    // 닫힌 페이지 목록의 제목을 매 입력마다 전 문단에서 찾지 않는다.
    const heads = on && expanded ? ogTabHeadings(tabs, i).map((h) => `<div class="og-ol" data-para="${h.para}" style="padding-left:${14 + (h.level - 1) * 12}px" title="${ogEsc(h.text)}">${ogEsc(h.text)}</div>`).join("") : "";
    return `<div class="og-tab${on ? " on" : ""}" data-i="${i}"><span class="og-tab-ic">▤</span><span class="og-tab-name">${ogEsc(t.name)}</span><button type="button" class="og-tab-more" title="페이지 메뉴">⋮</button></div>${heads ? `<div class="og-ols">${heads}</div>` : ""}`;
  }).join("");
}
function ogInstallTabs() {
  if (!OG_IS_MAIN || document.querySelector(".og-tabs")) return true;
  const styleSelect = document.getElementById("style-name"), styleField = styleSelect?.closest(".sb-field"), grid = styleField?.parentElement;
  if (!styleSelect || !styleField || !grid) return false;
  const item = document.createElement("span"); item.className = "sb-field og-page-list";
  item.innerHTML = '<button type="button" class="og-page-list-btn" title="페이지 목록"><span>페이지 목록</span><span class="og-page-list-arrow">▾</span></button><div class="og-tabs"><div class="og-tabs-head"><span>페이지 목록</span><button type="button" class="og-tabs-add" title="페이지 추가">＋ 새 페이지</button></div><div class="og-tabs-list"></div><div class="og-tab-menu" hidden><div data-act="rename">이름 바꾸기</div><div data-act="delete">페이지 삭제</div></div></div>';
  grid.insertBefore(item, styleField);
  const panel = item.querySelector(".og-tabs"), title = item.querySelector(".og-page-list-btn");
  title.addEventListener("mousedown", (e) => e.preventDefault());
  title.addEventListener("click", (e) => {
    e.stopPropagation();
    item.classList.toggle("open");
    if (item.classList.contains("open")) ogRenderTabs(ogTabCache.dirty);
  });
  // 메뉴 안의 동작이 편집기 커서를 뜻하지 않도록 이벤트를 막는다.
  for (const ev of ["pointerdown", "pointerup", "mousedown", "mouseup", "dblclick"]) panel.addEventListener(ev, (e) => e.stopPropagation());
  panel.querySelector(".og-tabs-add").onclick = () => ogAddTab();
  const menu = panel.querySelector(".og-tab-menu"); let menuTab = -1;
  panel.addEventListener("click", (e) => {
    const more = e.target.closest(".og-tab-more");
    if (more) {
      e.stopPropagation(); menuTab = +more.closest(".og-tab").dataset.i;
      const r = more.getBoundingClientRect(), pr = panel.getBoundingClientRect();
      menu.style.top = (r.bottom - pr.top) + "px"; menu.hidden = false;
      menu.querySelector('[data-act="delete"]').classList.toggle("disabled", ogTabList().length < 2);
      return;
    }
    const act = e.target.closest(".og-tab-menu [data-act]");
    if (act) {
      menu.hidden = true;
      if (act.dataset.act === "delete" && !act.classList.contains("disabled")) ogDeleteTab(menuTab);
      if (act.dataset.act === "rename") {
        const row = panel.querySelector(`.og-tab[data-i="${menuTab}"] .og-tab-name`); if (!row) return;
        const input = document.createElement("input"); input.className = "og-tab-edit"; input.value = row.textContent;
        row.replaceWith(input); input.focus(); input.select();
        const i = menuTab; let done = false;
        const commit = (ok) => { if (done) return; done = true; if (ok) ogRenameTab(i, input.value); else ogRenderTabs(); };
        // Enter·Esc 는 여기서 소비하고, 마무리(편집기로 초점 이동)는 이 입력이 끝난 뒤에 한다.
        // 입력 도중 초점을 옮기면 같은 Enter 가 편집기에도 전달되어 문서에 줄바꿈이 들어간다.
        input.addEventListener("keydown", (k) => {
          k.stopPropagation();
          if (k.key === "Enter" || k.key === "Escape") { k.preventDefault(); const ok = k.key === "Enter"; setTimeout(() => commit(ok), 0); }
        });
        input.addEventListener("blur", () => commit(true));
      }
      return;
    }
    menu.hidden = true;
    const ol = e.target.closest(".og-ol");
    if (ol) { item.classList.remove("open"); try { window.__ogolgyeStudio.inputHandler.moveCursorTo({ sectionIndex: 0, paragraphIndex: +ol.dataset.para, charOffset: 0 }); window.__ogolgyeStudio.inputHandler.focus(); } catch { /* 그대로 */ } return; }
    const tab = e.target.closest(".og-tab");
    if (tab && !e.target.closest(".og-tab-edit")) { item.classList.remove("open"); ogSelectTab(+tab.dataset.i); }
  });
  document.addEventListener("mousedown", (e) => { if (!menu.contains(e.target) && !e.target.closest(".og-tab-more")) menu.hidden = true; }, true);
  document.addEventListener("mousedown", (e) => { if (!item.contains(e.target)) item.classList.remove("open"); }, true);
  // 커서가 다른 탭으로 넘어가면(방향키 등) 그 탭으로 바꾼다 / 문서가 바뀌면 목차를 새로
  const bus = window.__ogolgyeStudio.eventBus;
  bus.on("cursor-rect-updated", () => {
    try {
      const pos = window.__ogolgyeStudio.inputHandler.cursor.getPosition();
      if (pos.parentParaIndex !== undefined) return;
      const k = ogTabOfPara(ogTabList(), pos.paragraphIndex);
      if (k !== ogTab.active) { ogTab.active = k; ogRedraw(); ogRenderTabs(); }
    } catch { /* 그대로 */ }
  });
  bus.on("document-changed", () => {
    ogInvalidateTabCache();
    clearTimeout(ogTabCache.timer);
    ogTabCache.timer = setTimeout(() => {
      if (!ogTabCache.dirty) return;
      const before = ogTabCache.list.map((t) => `${t.para}:${t.startPage}`).join("|");
      const after = ogTabList(true), next = after.map((t) => `${t.para}:${t.startPage}`).join("|");
      if (before !== next) ogRelayout();
      if (item.classList.contains("open")) ogRenderTabs();
    }, 600);
  });
  ogRenderTabs();
  return true;
}

// ── 본문 글 가져오기 ────────────────────────────────────────────────────────
// 사용자 API 도구가 선택 영역 또는 현재 페이지 목록 항목의 글을 가져올 때 쓴다.

function ogTextSegments(fromPara, toPara, startOffset = 0, endOffset = null) {
  const d = ogDoc(), segments = []; let text = "";
  if (!d) return { text, segments };
  for (let p = fromPara; p <= toPara; p++) {
    const len = d.getParagraphLength(0, p);
    const from = p === fromPara ? Math.max(0, startOffset) : 0;
    const to = p === toPara && endOffset !== null ? Math.min(len, endOffset) : len;
    if (to < from) continue;
    const value = d.getTextRange(0, p, from, to);
    const textStart = text.length;
    text += value;
    segments.push({ textStart, textEnd: text.length, sectionIndex: 0, paragraphIndex: p, charOffset: from });
    if (p < toPara) text += "\n";
  }
  return { text, segments };
}

function ogSelectionSource() {
  const og = window.__ogolgyeStudio, ih = og?.inputHandler, w = og?.wasm;
  const sel = ih?.cursor?.getSelectionOrdered?.();
  if (!sel || !ih.cursor.hasSelection?.()) return null;
  const { start, end } = sel;
  // 본문 선택은 글자 위치까지 연결한다. 표 안 선택도 원문 검사는 되지만, 복잡한 중첩 셀의
  // 위치 체계가 본문과 다르므로 결과 창에서만 보여 준다.
  if (start.parentParaIndex === undefined && end.parentParaIndex === undefined && start.sectionIndex === end.sectionIndex && start.sectionIndex === 0) {
    return { ...ogTextSegments(start.paragraphIndex, end.paragraphIndex, start.charOffset, end.charOffset), kind: "selection" };
  }
  try {
    if (start.parentParaIndex === undefined || end.parentParaIndex === undefined) return null;
    const nested = Array.isArray(start.cellPath) && start.cellPath.length > 1;
    const cellPara = (p) => p.cellParaIndex ?? p.cellPath?.[p.cellPath.length - 1]?.cellParaIndex ?? 0;
    if (nested) w.copySelectionInCellByPath(start.sectionIndex, start.parentParaIndex, JSON.stringify(start.cellPath), cellPara(start), start.charOffset, cellPara(end), end.charOffset);
    else w.copySelectionInCell(start.sectionIndex, start.parentParaIndex, start.controlIndex, start.cellIndex, start.cellParaIndex, start.charOffset, end.cellParaIndex, end.charOffset);
    return { text: w.getClipboardText() || "", segments: [], kind: "selection" };
  } catch { return null; }
}

function ogPageSource() {
  const d = ogDoc(), tabs = ogTabList();
  if (!d) return { text: "", segments: [], kind: "page" };
  const i = Math.max(0, Math.min(ogTab.active, tabs.length - 1));
  const from = tabs[i]?.para || 0;
  const to = Math.max(from, (tabs[i + 1]?.para ?? d.getParagraphCount(0)) - 1);
  return { ...ogTextSegments(from, to), kind: "page" };
}

// ── 사용자 API 도구 ────────────────────────────────────────────────────────
const ogAiWait = new Map();
let ogAiTools = [];
addEventListener("message", (e) => {
  if (e.origin !== location.origin || !e.data) return;
  if (e.data.type === "ogolgye:ai-result") { const done = ogAiWait.get(e.data.requestId); if (done) { ogAiWait.delete(e.data.requestId); done(e.data); } }
  if (e.data.type === "ogolgye:ai-tools-changed" && Array.isArray(e.data.tools)) { ogAiTools = e.data.tools; ogRenderAiButtons(); }
});
function ogAi(action, extra = {}) {
  const requestId = `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { if (ogAiWait.delete(requestId)) resolve({ ok: false, error: action === "run" ? "API 응답 시간이 초과되었습니다." : "API 도구는 데스크톱 앱에서 사용할 수 있습니다." }); }, action === "run" ? 125000 : 8000);
    ogAiWait.set(requestId, (value) => { clearTimeout(timer); resolve(value); });
    parent.postMessage({ type: "ogolgye:ai", requestId, action, ...extra }, location.origin);
  });
}
async function ogAiRefresh() {
  const r = await ogAi("list"); if (r.ok && Array.isArray(r.tools)) { ogAiTools = r.tools; ogRenderAiButtons(); } return r;
}
const OG_API_BODY_HTML = '<label>입력</label><textarea class="og-ai-input" placeholder="문서에서 글을 선택하거나 여기에 직접 입력하세요."></textarea><div class="og-ai-actions"><button type="button" class="primary" data-ai-do="run">실행</button><button type="button" data-ai-do="page">현재 페이지 가져오기</button><button type="button" data-ai-do="selection">선택 내용 가져오기</button></div><div class="og-ai-status"></div><label>실행 결과</label><textarea class="og-ai-output" readonly placeholder="API 실행 결과가 여기에 표시됩니다."></textarea><div class="og-ai-actions"><button type="button" data-ai-do="copy">결과 복사</button><button type="button" data-ai-do="replace">선택한 글 바꾸기</button></div>';
const OG_GOOGLE_TRANSLATE_BODY_HTML = '<style>.og-translate-tool{display:flex;flex-direction:column;gap:10px}.og-translate-langs{display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center}.og-translate-langs label{display:flex;flex-direction:column;gap:4px;color:#68736d;font-size:11px}.og-translate-langs select{width:100%;padding:7px;border:1px solid #dce3df;border-radius:7px;background:#fff}.og-translate-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;min-height:230px}.og-translate-pane{display:flex;flex-direction:column;gap:5px;min-width:0}.og-translate-pane b{font-size:12px}.og-translate-pane textarea{height:220px;min-height:220px;max-height:none!important;margin:0;padding:10px;border:1px solid #dce3df;border-radius:8px;resize:none}.og-translate-foot{display:flex;justify-content:space-between;align-items:center;gap:8px}.og-translate-foot .og-ai-status{flex:1}.og-translate-tool button{border:1px solid #ccd2c2;border-radius:6px;background:#fff;padding:6px 9px;cursor:pointer}.og-translate-tool button.primary{color:#fff;background:var(--ai-color);border-color:var(--ai-color)}@media(max-width:620px){.og-translate-grid{grid-template-columns:1fr}.og-translate-pane textarea{height:150px;min-height:150px}}</style><div class="og-translate-tool"><div class="og-translate-langs"><label>원문 언어<select data-api-param="sourceLanguage"><option value="ko">한국어</option><option value="en">영어</option><option value="ja">일본어</option></select></label><button type="button" data-ai-do="swap" title="언어와 내용을 맞바꾸기">⇄</button><label>번역 언어<select data-api-param="targetLanguage"><option value="ko">한국어</option><option value="en" selected>영어</option><option value="ja">일본어</option></select></label></div><div class="og-translate-grid"><div class="og-translate-pane"><b>원문 입력</b><textarea class="og-ai-input" data-api-auto="500" placeholder="번역할 문장을 입력하세요."></textarea></div><div class="og-translate-pane"><b>번역 결과</b><textarea class="og-ai-output" readonly placeholder="번역 결과가 여기에 표시됩니다."></textarea></div></div><div class="og-translate-foot"><div class="og-ai-status">입력을 멈추면 자동으로 번역합니다.</div><button type="button" data-ai-do="clear">지우기</button><button type="button" data-ai-do="copy">복사</button><button type="button" class="primary" data-ai-do="run">번역</button></div></div>';
const OG_API_DESIGN_EXAMPLE = '<label>입력</label>\n<textarea data-api-input placeholder="내용을 입력하세요"></textarea>\n<div>\n  <button data-api-action="run">실행</button>\n  <button data-api-action="page">현재 페이지</button>\n  <button data-api-action="selection">선택 내용</button>\n</div>\n<p data-api-status></p>\n<label>결과</label>\n<textarea data-api-output readonly></textarea>\n<div>\n  <button data-api-action="copy">복사</button>\n  <button data-api-action="replace">선택한 글 바꾸기</button>\n</div>';
function ogSafeApiDesign(html) {
  const t = document.createElement("template"); t.innerHTML = String(html || "");
  t.content.querySelectorAll("script,iframe,object,embed,link,meta,base,form").forEach((x) => x.remove());
  t.content.querySelectorAll("*").forEach((el) => {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase(), v = a.value.trim().toLowerCase();
      if (n.startsWith("on") || ((n === "href" || n === "src" || n === "action") && v.startsWith("javascript:"))) el.removeAttribute(a.name);
    }
  });
  const input = t.content.querySelector("[data-api-input]"), output = t.content.querySelector("[data-api-output]");
  if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) || !(output instanceof HTMLInputElement || output instanceof HTMLTextAreaElement) || !t.content.querySelector('[data-api-action="run"]')) return "";
  input.classList.add("og-ai-input"); output.classList.add("og-ai-output"); output.readOnly = true;
  let status = t.content.querySelector("[data-api-status]");
  if (!status) { status = document.createElement("p"); status.dataset.apiStatus = ""; t.content.appendChild(status); }
  status.classList.add("og-ai-status");
  t.content.querySelectorAll("[data-api-action]").forEach((b) => { b.dataset.aiDo = b.dataset.apiAction; if (b.dataset.apiAction === "run") b.classList.add("primary"); });
  return t.innerHTML;
}
function ogApplyApiDesign(panel, tool) {
  const body = panel.querySelector(".og-ai-body"), custom = ogSafeApiDesign(tool?.designHtml);
  body.innerHTML = custom || (tool?.provider === "google_cloud" ? OG_GOOGLE_TRANSLATE_BODY_HTML : OG_API_BODY_HTML);
  body.classList.toggle("custom", !!custom || tool?.provider === "google_cloud");
}
const ogApiGet = (el) => el && "value" in el ? el.value : (el?.textContent || "");
const ogApiSet = (el, value) => { if (!el) return; if ("value" in el) el.value = value; else el.textContent = value; };
function ogAiPanel() {
  let panel = document.querySelector(".og-ai-panel"); if (panel) return panel;
  panel = document.createElement("div"); panel.className = "og-ai-panel float"; panel.hidden = true;
  panel.innerHTML = '<div class="og-ai-head"><span class="og-ai-title-icon">API</span><b class="og-ai-title">API 도구</b><button type="button" class="og-ai-close" title="닫기">×</button></div><div class="og-ai-body">' + OG_API_BODY_HTML + '</div>';
  document.body.appendChild(panel);
  for (const ev of ["pointerdown", "pointerup", "mousedown", "mouseup", "dblclick", "keydown"]) panel.addEventListener(ev, (e) => e.stopPropagation());
  panel.querySelector(".og-ai-close").onclick = () => { panel.hidden = true; };
  panel.addEventListener("click", async (e) => {
    const act = e.target.closest("[data-ai-do]")?.dataset.aiDo; if (!act) return;
    const input = panel.querySelector(".og-ai-input"), output = panel.querySelector(".og-ai-output"), status = panel.querySelector(".og-ai-status");
    if (act === "page") { const s = ogPageSource(); ogApiSet(input, s.text); input.__ogSource = s; panel.__ogSource = s; return; }
    if (act === "selection") { const s = ogSelectionSource(); if (!s?.text) { status.textContent = "문서에서 글을 먼저 선택해 주세요."; return; } ogApiSet(input, s.text); input.__ogSource = s; panel.__ogSource = s; return; }
    if (act === "copy") { if (ogApiGet(output)) { await navigator.clipboard.writeText(ogApiGet(output)); status.textContent = "결과를 복사했습니다."; } return; }
    if (act === "clear") { ogApiSet(input, ""); ogApiSet(output, ""); status.textContent = "준비됨"; input.focus(); return; }
    if (act === "swap") {
      const source = panel.querySelector('[data-api-param="sourceLanguage"]'), target = panel.querySelector('[data-api-param="targetLanguage"]');
      if (source && target) [source.value, target.value] = [target.value, source.value];
      if (ogApiGet(output)) { const oldInput = ogApiGet(input); ogApiSet(input, ogApiGet(output)); ogApiSet(output, oldInput); }
      return;
    }
    if (act === "replace") { ogAiReplaceSelection(panel); return; }
    if (act === "run") {
      if (!ogApiGet(input).trim()) { status.textContent = "API에 보낼 내용을 넣어 주세요."; return; }
      e.target.disabled = true; status.textContent = "API를 실행하고 있습니다…"; ogApiSet(output, "");
      const options = {}; panel.querySelectorAll("[data-api-param]").forEach((x) => { options[x.dataset.apiParam] = "value" in x ? x.value : x.textContent; });
      const r = await ogAi("run", { id: panel.dataset.tool, input: ogApiGet(input), options });
      e.target.disabled = false;
      if (!r.ok) { status.textContent = "실행하지 못했습니다: " + (r.error || "알 수 없는 오류"); return; }
      ogApiSet(output, r.output || ""); status.textContent = "완료했습니다.";
    }
  });
  panel.addEventListener("input", (e) => {
    if (!e.target.matches?.(".og-ai-input")) return;
    if (e.target.__ogSource?.text !== ogApiGet(e.target)) { e.target.__ogSource = null; panel.__ogSource = null; }
    const delay = Number(e.target.dataset.apiAuto); if (!Number.isFinite(delay) || delay < 0) return;
    clearTimeout(panel.__ogAutoTimer); panel.__ogAutoTimer = setTimeout(() => { if (ogApiGet(e.target).trim()) panel.querySelector('[data-ai-do="run"]')?.click(); }, Math.min(5000, delay));
  });
  const head = panel.querySelector(".og-ai-head"); let drag = null;
  head.addEventListener("mousedown", (e) => { if (!panel.classList.contains("float") || e.target.closest("button")) return; const r = panel.getBoundingClientRect(); drag = { x: e.clientX - r.left, y: e.clientY - r.top }; e.preventDefault(); });
  addEventListener("mousemove", (e) => { if (!drag) return; panel.style.left = `${Math.max(0, Math.min(innerWidth - panel.offsetWidth, e.clientX - drag.x))}px`; panel.style.top = `${Math.max(90, Math.min(innerHeight - 80, e.clientY - drag.y))}px`; panel.style.right = "auto"; });
  addEventListener("mouseup", () => { drag = null; });
  return panel;
}
function ogAiReplaceSelection(panel) {
  const output = panel.querySelector(".og-ai-output"), status = panel.querySelector(".og-ai-status"), source = panel.__ogSource;
  if (!ogApiGet(output) || source?.kind !== "selection" || !source.segments?.length) { status.textContent = "본문에서 선택한 글로 실행한 경우에만 문서를 바로 바꿀 수 있습니다."; return; }
  const first = source.segments[0], last = source.segments[source.segments.length - 1], ih = window.__ogolgyeStudio?.inputHandler;
  if (!ih || first.sectionIndex !== last.sectionIndex) { status.textContent = "이 선택 영역은 바로 바꿀 수 없습니다."; return; }
  const end = last.charOffset + (last.textEnd - last.textStart);
  try {
    ih.cursor.clearSelection();
    ih.executeOperation({ kind: "snapshot", operationType: "aiRewrite", operation: (wasm) => {
      wasm.deleteRange(first.sectionIndex, first.paragraphIndex, first.charOffset, last.paragraphIndex, end);
      wasm.insertText(first.sectionIndex, first.paragraphIndex, first.charOffset, ogApiGet(output));
      return { sectionIndex: first.sectionIndex, paragraphIndex: first.paragraphIndex, charOffset: first.charOffset + ogApiGet(output).length };
    }});
    status.textContent = "선택한 글을 API 실행 결과로 바꿨습니다."; panel.__ogSource = null;
  } catch (err) { status.textContent = "문서에 넣지 못했습니다: " + String(err?.message || err); }
}
function ogOpenAiTool(tool, preview = false) {
  const panel = ogAiPanel(); ogApplyApiDesign(panel, tool);
  const input = panel.querySelector(".og-ai-input"), selected = ogSelectionSource();
  panel.dataset.tool = tool.id; panel.style.setProperty("--ai-color", tool.color); panel.querySelector(".og-ai-title").textContent = tool.name; panel.querySelector(".og-ai-title-icon").textContent = tool.icon;
  panel.className = `og-ai-panel ${tool.view === "side" ? `side ${tool.side}` : "float"}`; panel.style.left = panel.style.right = panel.style.top = "";
  const source = preview ? { text: "안녕하세요. 만나서 반갑습니다.", segments: [], kind: "preview" } : selected?.text ? selected : ogPageSource(); ogApiSet(input, source.text); input.__ogSource = source; panel.__ogSource = source;
  ogApiSet(panel.querySelector(".og-ai-output"), preview ? "Hello. Nice to meet you." : ""); const status = panel.querySelector(".og-ai-status"); if (status) status.textContent = preview ? "디자인 미리보기 · API는 호출하지 않았습니다." : selected?.text ? "선택한 글을 가져왔습니다." : "현재 페이지의 글을 가져왔습니다."; panel.hidden = false;
}
// ── 칸 바탕색(서식 줄의 단추) ────────────────────────────────────
// 편집기에는 "표 > 셀 테두리/배경" 창이 있지만 메뉴 안쪽에 있어 찾기 어렵다(칸 색을 바꾸는 기능이 없는 줄 알았다).
// 표 칸에 커서를 두거나 칸을 여러 개 고른 뒤 이 단추에서 색을 고르면 바로 칠한다. 되돌리기 한 번에 되돌아간다.
const OG_CELL_COLORS = ["#ffffff", "#f2f2f2", "#d9d9d9", "#a6a6a6", "#595959", "#000000", "#fde9d9", "#fff2cc", "#e2efda", "#ddebf7", "#e4dfec", "#f8cbad", "#ffe699", "#c6e0b4", "#bdd7ee", "#ccc0da", "#c00000", "#ffc000", "#70ad47", "#2e75b6", "#7030a0"];
function ogCellTargets() {
  const og = window.__ogolgyeStudio || {}, ih = og.inputHandler;
  if (!ih || !og.wasm) return null;
  let pos; try { pos = ih.getCursorPosition?.() ?? ih.cursor.getPosition(); } catch { return null; }
  if (!pos || pos.parentParaIndex === undefined || pos.controlIndex === undefined || pos.cellIndex === undefined) return null;
  const t = { sec: pos.sectionIndex, ppi: pos.parentParaIndex, ci: pos.controlIndex, cells: [pos.cellIndex] };
  try {
    const range = ih.isInCellSelectionMode?.() ? ih.getSelectedCellRange?.() : null;
    if (range) {
      const picked = og.wasm.getTableCellBboxes(t.sec, t.ppi, t.ci).filter((b) => b.row <= range.endRow && b.row + Math.max(1, b.rowSpan) - 1 >= range.startRow && b.col <= range.endCol && b.col + Math.max(1, b.colSpan) - 1 >= range.startCol).map((b) => b.cellIdx);
      if (picked.length) t.cells = [...new Set(picked)];
    }
  } catch { /* 고른 범위를 못 읽으면 커서가 있는 칸만 */ }
  return t;
}
// color: "#rrggbb" 또는 null(바탕 없음)
function ogSetCellFill(color) {
  const og = window.__ogolgyeStudio || {}, ih = og.inputHandler, t = ogCellTargets();
  if (!t) return false;
  const props = color ? { fillType: "solid", fillColor: color } : { fillType: "none" };
  ih.executeOperation({ kind: "snapshot", operationType: "cellFill", operation: (wasm) => {
    const run = () => { for (const c of t.cells) wasm.setCellProperties(t.sec, t.ppi, t.ci, c, props); };
    if (typeof wasm.runInBatch === "function") wasm.runInBatch(run); else run();
    return ih.cursor.getPosition();
  } });
  return true;
}
function ogInstallCellFill() {
  const alignHost = document.querySelector(".sb-overflow-host"), track = alignHost?.parentElement;
  if (!alignHost || !track) return false;
  if (track.querySelector(".og-cell-fill")) return true;
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "sb-btn og-cell-fill"; btn.title = "칸 바탕색 (표 칸에 커서를 두거나 칸을 고른 뒤)";
  btn.innerHTML = '<span class="og-cell-fill-icon"></span>';
  const pop = document.createElement("div");
  pop.className = "og-cell-fill-pop"; pop.hidden = true;
  pop.innerHTML = '<div class="og-cell-fill-grid">' + OG_CELL_COLORS.map((c) => `<button type="button" data-color="${c}" title="${c}" style="background:${c}"></button>`).join("") + '</div>'
    + '<div class="og-cell-fill-row"><button type="button" data-color="">바탕 없음</button><label>다른 색 <input type="color" value="#ffff00"></label></div><div class="og-cell-fill-note" hidden>표 칸 안에 커서를 두세요.</div>';
  document.body.appendChild(pop);
  const close = () => { pop.hidden = true; };
  const apply = (color) => { const ok = ogSetCellFill(color || null); pop.querySelector(".og-cell-fill-note").hidden = ok; if (ok) close(); };
  btn.addEventListener("mousedown", (e) => e.preventDefault());                 // 편집 화면의 커서·칸 선택을 잃지 않게
  pop.addEventListener("mousedown", (e) => { if (e.target.tagName !== "INPUT") e.preventDefault(); });
  btn.addEventListener("click", () => {
    if (!pop.hidden) { close(); return; }
    pop.querySelector(".og-cell-fill-note").hidden = !!ogCellTargets();
    const r = btn.getBoundingClientRect();
    pop.hidden = false;
    pop.style.top = `${Math.round(r.bottom + 4)}px`;
    pop.style.left = `${Math.round(Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)))}px`;
  });
  pop.addEventListener("click", (e) => { const b = e.target.closest("button[data-color]"); if (b) apply(b.dataset.color); });
  pop.querySelector('input[type="color"]').addEventListener("change", (e) => apply(e.target.value));
  document.addEventListener("mousedown", (e) => { if (!pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) close(); }, true);
  addEventListener("keydown", (e) => { if (e.key === "Escape") close(); }, true);
  alignHost.after(btn);
  return true;
}
function ogRenderAiButtons() {
  const alignHost = document.querySelector(".sb-overflow-host"), track = alignHost?.parentElement; if (!alignHost || !track) return;
  let host = track.querySelector(".og-ai-tools"); if (!host) { host = document.createElement("div"); host.className = "og-ai-tools"; alignHost.after(host); }
  host.replaceChildren();
  for (const tool of ogAiTools) {
    const b = document.createElement("button"); b.type = "button"; b.className = "sb-btn og-ai-tool-btn"; b.style.setProperty("--ai-color", tool.color); b.title = `${tool.name} (${tool.model})`;
    const icon = document.createElement("span"); icon.className = "og-ai-tool-icon"; icon.textContent = tool.icon;
    const label = document.createElement("span"); label.className = "og-ai-tool-label"; label.textContent = tool.name; b.append(icon, label);
    b.addEventListener("mousedown", (e) => e.preventDefault()); b.addEventListener("click", () => ogOpenAiTool(tool)); host.appendChild(b);
  }
}
function ogInstallAiTools() { if (!OG_IS_MAIN || !document.querySelector(".sb-overflow-host")) return false; ogRenderAiButtons(); if (!document.documentElement.__ogAiLoaded) { document.documentElement.__ogAiLoaded = true; ogAiRefresh(); } return true; }

// ── 진짜 페이지 없음 ─────────────────────────────────────────────
// 편집 엔진(rhwp + 오골계 워드 패치, engine/patches)의 "보기 전용 용지"로 글이 창 폭에 맞춰 흐르게 한다.
// 문서의 용지 설정은 바꾸지 않는다. 저장·내보내기는 엔진이 원래 용지의 줄 나눔으로 기록하고,
// 되돌리기 기록은 하나뿐이다. 보기 방식은 책갈피로 파일 안에 적어 둔다.
const OG_MARK = "오골계워드:보기=";          // 책갈피 이름 앞부분(뒤에 "페이지없음" 또는 "페이지")
const PX_HU = 75;                          // 1px(96dpi) = 75 HWPUNIT
const ogPL = { active: false, view: null, defaultPageless: true };   // view: 구역별 보기 전용 용지
const ogW = () => window.__ogolgyeStudio && window.__ogolgyeStudio.wasm;
const ogDoc = () => { const w = ogW(); return w && w.doc; };
function ogSectionCount() { try { return ogDoc().getSectionCount(); } catch { return 1; } }
function ogViewDef(orig) {
  const ih = window.__ogolgyeStudio.inputHandler, zoom = ih.viewportManager.getZoom() || 1;
  // Google 문서의 페이지 없음처럼 바탕은 창 전체가 흰색이지만 실제 글은 가운데의 읽기 좋은 폭에서 흐른다.
  // 바깥 40px은 편집기의 가로 배치 여유이므로 제외하고, 좁은 창에서는 최소 32px 여백을 남긴다.
  const viewPx = Math.max(360, (ih.container.clientWidth || 900) / zoom - 40);
  const textPx = Math.min(816, Math.max(296, viewPx - 64));
  const sideMarginPx = Math.max(32, (viewPx - textPx) / 2);
  // 보기용 쪽 높이는 원래 용지의 긴 변(A4면 약 1,123px). 쪽은 화면에서 이어 붙이므로 보이지 않고,
  // 높을수록 쪽 하나를 그리는 시간이 길어진다(22만 자 문서 실측: A4 3배 0.47초 → A4 0.16초, 입력 뒤 다시 그리기도 같은 비율).
  return { ...orig, landscape: false, width: Math.round(viewPx * PX_HU), height: Math.max(orig.width, orig.height),
    marginLeft: Math.round(sideMarginPx * PX_HU), marginRight: Math.round(sideMarginPx * PX_HU),
    marginTop: 28 * PX_HU, marginBottom: 28 * PX_HU, marginHeader: 0, marginFooter: 0, marginGutter: 0 };
}
const OG_DEF_KEYS = ["width", "height", "marginLeft", "marginRight", "marginTop", "marginBottom", "marginHeader", "marginFooter"];
const ogSameDef = (a, b) => !!a && !!b && OG_DEF_KEYS.every((k) => Math.abs((a[k] || 0) - (b[k] || 0)) <= 2);
// 보기 전용 용지를 지원하는 엔진인가(npm 원본 엔진에는 없다: npm run build-engine → build-studio)
function ogViewEngine() { const d = ogDoc(); return d && typeof d.setViewPageDef === "function" ? d : null; }
// 문서의 원래 용지(구역별). 페이지 없음 중에도 엔진은 원래 용지를 돌려준다.
function ogPaperDefs() { const w = ogW(); return Array.from({ length: ogSectionCount() }, (_, i) => w.getPageDef(i)); }
function ogApplyViewDefs(defs) {
  const d = ogViewEngine(); if (!d) return;
  defs.forEach((def, i) => { try { d.setViewPageDef(i, JSON.stringify(def)); } catch { /* 구역 없음 */ } });
}
// 페이지 없음에서는 종이 여백 모서리 표시(ㄱ자 꺾쇠)를 아예 그리지 않는다. 예전에는 본문 좌우 경계로 잘라 가렸는데,
// 꺾쇠 선이 경계에 걸치거나 내용이 본문 맨 위에서 시작하는 쪽(그림·제목으로 시작)에서는 조각이 남아 보였다.
function ogGuardMarginGuides() {
  const pr = window.__ogolgyeStudio?.canvasView?.pageRenderer;
  if (!pr || pr.__ogGuides || typeof pr.drawMarginGuides !== "function") return;
  const draw = pr.drawMarginGuides;
  pr.drawMarginGuides = function (...args) { if (ogPageless()) return; return draw.apply(this, args); };
  pr.__ogGuides = true;
}
let ogRedrawToken = 0;
function ogRedraw() {
  ogGuardMarginGuides();
  // 쪽 크기를 다시 읽어 배치·그리기(문서를 "수정됨"으로 만들지 않는 경로). 다 그리면 끝나는 약속을 돌려준다.
  const cv = window.__ogolgyeStudio && window.__ogolgyeStudio.canvasView;
  const token = ++ogRedrawToken;
  let done;
  const settled = new Promise((resolve) => { done = resolve; });
  const finish = () => {
    if (token !== ogRedrawToken) { done(); return; }
    ogRelayout();
    ogFrame(() => ogFrame(() => {
    const ih = window.__ogolgyeStudio?.inputHandler, c = ih?.container;
    if (ogPL.active && c) c.scrollLeft = 0;
    // 용지 폭·여백이 바뀌면 논리 위치는 같아도 CursorState 안의 쪽 번호·사각형은 예전 용지 기준으로 남는다.
    // 그 사각형을 그대로 그리기만 하면 방향키도 예전 좌표에서 hitTest해 엉뚱한 줄로 간다. 현재 논리 위치를
    // 같은 자리에 다시 놓아 엔진에서 새 사각형을 받은 뒤, 스크롤을 움직이지 않고 커서만 다시 그린다.
    try {
      if (ih?.isActive?.()) {
        // 선택 중 moveTo를 호출하면 엔진이 선택 기준점(anchor)을 버려 전체 선택이나 드래그 범위가
        // 첫/마지막 줄만 남거나 한 점으로 접힌다. 선택은 논리 시작·끝을 그대로 두고 표시만 다시 계산한다.
        if (!ogRefreshSelection()) {
          const pos = ih.cursor?.getPosition?.();
          if (pos) ih.cursor.moveTo(pos);
          ih.updateCaret?.(true);
        }
      }
    } catch { /* 편집 준비 중 */ }
    done();
    }));
  };
  try {
    // setPageDef는 쪽 수와 글 배치를 바꾼다. 단순 refreshPages는 이전 렌더러 문서 상태를 계속
    // 그릴 수 있으므로, 입력 때와 같은 mutation 갱신을 먼저 끝낸 뒤 좌표와 커서를 맞춘다.
    const refreshed = cv && typeof cv.refreshPagesForMutation === "function"
      ? cv.refreshPagesForMutation()
      : (cv && typeof cv.refreshPages === "function" ? cv.refreshPages() : window.__ogolgyeStudio.eventBus.emit("document-view-changed"));
    if (refreshed && typeof refreshed.then === "function") refreshed.then(finish, finish); else finish();
  } catch { finish(); }
  return settled;
}

let ogViewportResizeTimer = 0;
function ogScheduleViewportResize(delay = 80) {
  clearTimeout(ogViewportResizeTimer);
  ogViewportResizeTimer = setTimeout(() => {
    if (!ogPL.active) return;
    // 창 폭이 바뀌면 보기 전용 용지만 바꾼다(엔진이 줄을 다시 나눈다. 문서·되돌리기 기록은 그대로)
    const next = ogPaperDefs().map(ogViewDef);
    if (!ogPL.view || next.some((d, i) => !ogSameDef(d, ogPL.view[i]))) { ogPL.view = next; ogApplyViewDefs(next); }
    // 폭이 같더라도 부모 flex 배치 직후에는 캔버스·스크롤 좌표가 이전 값일 수 있다.
    ogRedraw();
  }, delay);
}
function ogEnterPageless() {
  const w = ogW(); if (!w || !ogDoc()) return;
  if (!ogViewEngine()) {
    console.error("[오골계 워드] 편집 엔진에 페이지 없음 보기 기능이 없습니다. npm run build-engine 뒤 build-studio 로 편집 화면을 다시 만드세요.");
    ogPL.active = false; ogRoot.classList.remove("og-pageless"); ogRedraw(); return;
  }
  ogPL.view = ogPaperDefs().map(ogViewDef);
  ogApplyViewDefs(ogPL.view);
  ogPL.active = true;
  ogRoot.classList.add("og-pageless");
  ogRedraw();
}
function ogLeavePageless() {
  if (ogPL.active) { try { ogViewEngine()?.clearViewPageDefs(); } catch { /* 문서 없음 */ } ogPL.active = false; ogPL.view = null; }
  ogRoot.classList.remove("og-pageless");
  ogRedraw();
}
// 저장·내보내기 전에 보기 방식을 파일(책갈피)에 적어 둔다. 줄 나눔은 엔진이 원래 용지 기준으로 기록한다.
function ogMarkViewMode() { if (ogDoc()) ogWriteMark(ogPL.active ? "페이지없음" : "페이지"); }
// PDF처럼 원래 용지의 쪽 모양이 필요한 내보내기: 그동안만 페이지 없음을 끄고 끝나면 다시 켠다(문서 데이터는 그대로).
function ogWithPaperPages(fn) {
  ogMarkViewMode();
  const d = ogViewEngine();
  if (!ogPL.active || !d) return fn();
  d.clearViewPageDefs();
  try { return fn(); } finally { ogApplyViewDefs(ogPL.view); }
}
// 스트리밍 PDF는 여러 메시지에 걸쳐 쪽을 한 장씩 만든다. 매 장마다 보기 배치를 왕복하지 않고
// 시작할 때 한 번만 원래 용지 배치로 전환한 뒤 끝에서 한 번 복원한다.
let ogPdfExportRestore = null;
function ogEndPdfExport() {
  const restore = ogPdfExportRestore; ogPdfExportRestore = null;
  if (restore) restore();
}
function ogBeginPdfExport() {
  ogEndPdfExport();
  ogMarkViewMode();
  const w = ogW(), d = ogViewEngine();
  if (!w || !ogDoc()) throw new Error("열린 문서가 없습니다.");
  if (ogPL.active && d) {
    d.clearViewPageDefs();
    ogPdfExportRestore = () => ogApplyViewDefs(ogPL.view);
  }
  return { pageCount: w.pageCount };
}
// 문서 전체 HTML: 엔진의 문단 HTML 뽑기(exportSelectionHtml)는 글자만 담고 표·그림이 든 문단을 빠뜨리므로,
// 문단을 하나씩 돌면서 글자(문단 HTML) · 표(exportControlHtml) · 그림(getControlImageData)을 원래 순서대로 모은다.
function ogExportContext(d) {
  let controls = [];
  try { controls = JSON.parse(d.getControls()); } catch { controls = []; }
  const controlsByParagraph = new Map();
  for (const c of controls) {
    const key = `${c.list || 0}:${c.para}`;
    let list = controlsByParagraph.get(key);
    if (!list) controlsByParagraph.set(key, list = []);
    list.push(c);
  }
  for (const list of controlsByParagraph.values()) list.sort((a, b) => a.pos - b.pos);
  return { controlsByParagraph, paragraphHtml: new Map() };
}
function ogDocumentHtml(w, range = null, context = null) {       // range: { from, to } — 첫 구역의 문단 범위(탭 하나)
  const d = ogDoc();
  const fragment = (html) => {
    const marked = String(html).match(/<!--StartFragment-->([\s\S]*?)<!--EndFragment-->/i);
    if (marked) return marked[1].trim();
    const body = String(html).match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    return (body ? body[1] : String(html)).trim();
  };
  const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  context ||= ogExportContext(d);
  const sections = [];
  for (let sec = 0; sec < w.getSectionCount(); sec++) {
    const count = w.getParagraphCount(sec); if (!count) continue;
    const parts = [];
    for (let i = 0; i < count; i++) {
      if (range && (sec !== 0 || i < range.from || i > range.to)) continue;
      const key = `${sec}:${i}`;
      let paragraph = context.paragraphHtml.get(key);
      if (!paragraph) {
        const len = w.getParagraphLength(sec, i);
        let text = len > 0 ? fragment(w.exportSelectionHtml(sec, i, 0, i, len)) : "";
        // Google 문서식 스타일(제목·부제목·제목 1~6)은 내보내기에서 제목 구조로 쓰이도록 표시해 둔다
        try { const sn = JSON.parse(d.getStyleAt(sec, i)).name, st = OG_STYLES.find((x) => x.name === sn); if (text && st) text = text.replace(/<p\b/i, `<p data-og-style="${st.key}"`); } catch { /* 표시 없이 */ }
        const before = [], after = [], objs = context.controlsByParagraph.get(key) || [];
        for (const c of objs) {
          const kind = String(c.ctrlId).trim();
          try {
            let html = "";
            if (kind === "tbl") html = fragment(d.exportControlHtml(sec, i, "[]", c.controlIndex));
            else if (kind === "gso") {
              const data = d.getControlImageData(sec, i, "[]", c.controlIndex);
              if (!data || !data.length) continue;
              const mime = d.getControlImageMime(sec, i, "[]", c.controlIndex) || "image/png";
              let size = "";
              try { const pp = JSON.parse(d.getPictureProperties(sec, i, c.controlIndex)); size = ` width="${Math.round(pp.width / 75)}" height="${Math.round(pp.height / 75)}"`; } catch { /* 크기 모름 */ }
              html = `<p><img src="data:${mime};base64,${b64(data)}"${size} alt=""></p>`;
            }
            if (html) (c.pos === 0 ? before : after).push(html);
          } catch { /* 꺼낼 수 없는 개체는 건너뛴다 */ }
        }
        paragraph = [...before];
        if (text && (!(objs.length) || text.replace(/<[^>]+>/g, "").trim())) paragraph.push(text);
        paragraph.push(...after);
        context.paragraphHtml.set(key, paragraph);
      }
      parts.push(...paragraph);
    }
    sections.push(`<section class="og-section" data-section="${sec + 1}">${parts.join("\n")}</section>`);
  }
  return sections.join("\n");
}
// 내보내기 HTML 의 그림(data:…;base64,…)을 "og-img:번호" 로 바꾸고 바이트 목록을 돌려준다. 같은 그림은 한 번만 담는다.
function ogLiftExportImages(data) {
  const images = [], seen = new Map();
  const lift = (html) => String(html || "").replace(/(<img\b[^>]*?\bsrc=["'])data:([^;,"']+);base64,([^"']+)(["'])/gi, (_all, before, mime, b64, quote) => {
    let k = seen.get(b64);
    if (k === undefined) {
      const bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      k = images.length; images.push({ mime, bytes }); seen.set(b64, k);
    }
    return before + "og-img:" + k + quote;
  });
  if (typeof data.html === "string") data.html = lift(data.html);
  if (Array.isArray(data.tabs)) for (const t of data.tabs) t.html = lift(t.html);
  return images;
}
function ogBuildExport(format) {
  const w = ogW(); if (!w || !ogDoc()) throw new Error("열린 문서가 없습니다.");
  // PDF만 실제 쪽 배치가 필요하다. TXT·Markdown·HTML·Word·ODT·RTF·EPUB과 Google 전송은
  // 문단/표/그림 구조를 읽으므로, 페이지 없음 문서를 원래 용지로 통째로 복제·재배치하지 않는다.
  // 긴 문서에서 이 불필요한 왕복 직렬화가 내보내기 시작 지연의 대부분이었다.
  if (format === "pdf") return ogWithPaperPages(() => {
    const svgs = []; for (let i = 0; i < w.pageCount; i++) svgs.push(w.renderPageSvg(i));
    return { svgs };
  });
  {
    // 탭이 둘 이상이면 탭별 내용도 함께(Google 문서로 보낼 때 탭을 만든다)
    let tabs = null; const context = ogExportContext(ogDoc());
    const list = ogTabList();
    if (list.length > 1) tabs = list.map((t, k) => ({ name: t.name, html: ogDocumentHtml(w, { from: t.para, to: (k + 1 < list.length ? list[k + 1].para : w.getParagraphCount(0)) - 1 }, context) }));
    return { html: ogDocumentHtml(w, null, context), pageless: !!ogPL.active, tabs };
  }
}
// 파일 안의 보기 방식 표시(책갈피)
function ogReadMark() {
  try { const b = JSON.parse(ogDoc().getBookmarks()).find((x) => String(x.name).startsWith(OG_MARK)); return b ? b.name.slice(OG_MARK.length) : null; } catch { return null; }
}
function ogWriteMark(mode) {
  const d = ogDoc(); if (!d) return;
  const name = OG_MARK + mode;
  try {
    const b = JSON.parse(d.getBookmarks()).find((x) => String(x.name).startsWith(OG_MARK));
    if (b) { if (b.name !== name) d.renameBookmark(b.sec, b.para, b.ctrlIdx, name); }
    else d.addBookmark(0, 0, 0, name);
  } catch { /* 책갈피를 쓸 수 없는 문서 */ }
}
// 문서를 열거나 새로 만들면: 책갈피가 있으면 그 보기 방식, 없으면 기본 보기 방식
// ── Google 문서식 서식: 일반 텍스트 / 제목 / 부제목 / 제목 1~6 ─────────────────────
// 실제 한글 스타일로 문서에 만들어 둔다(한컴에서 열어도 같은 이름의 스타일). 원래 한글 스타일은 지우지 않는다.
const OG_STYLES = [
  { key: "normal", name: "일반 텍스트", en: "Normal Text", size: 11, color: "#000000", before: 0, after: 0 },
  { key: "title", name: "제목", en: "Title", size: 26, color: "#000000", before: 0, after: 300 },
  { key: "subtitle", name: "부제목", en: "Subtitle", size: 15, color: "#666666", before: 0, after: 1600 },
  { key: "h1", name: "제목 1", en: "Heading 1", size: 20, color: "#000000", before: 2000, after: 600, level: 1 },
  { key: "h2", name: "제목 2", en: "Heading 2", size: 16, color: "#000000", before: 1800, after: 600, level: 2 },
  { key: "h3", name: "제목 3", en: "Heading 3", size: 14, color: "#434343", before: 1600, after: 400, level: 3 },
  { key: "h4", name: "제목 4", en: "Heading 4", size: 12, color: "#666666", before: 1400, after: 400, level: 4 },
  { key: "h5", name: "제목 5", en: "Heading 5", size: 11, color: "#666666", before: 1200, after: 400, level: 5 },
  { key: "h6", name: "제목 6", en: "Heading 6", size: 11, color: "#666666", italic: true, before: 1200, after: 400, level: 6 },
];
const ogStyleIds = {};                                   // key → 스타일 번호(문서마다)
// create=false: 문서에 이미 있는 오골계 스타일 번호만 찾는다(문서를 바꾸지 않는다).
// create=true: 없는 스타일을 만든다. 스타일을 만들 때마다 엔진이 문서 전체를 다시 조판해 긴 문서에서 느리고
// (22만 자 실측 약 3초) 문서도 바뀌므로, 열 때가 아니라 새 빈 문서이거나 처음 스타일을 적용할 때만 만든다.
function ogEnsureStyles(create = false) {
  const d = ogDoc(); if (!d) return false;
  let list; try { list = JSON.parse(d.getStyleList()); } catch { return false; }
  const byName = new Map(list.map((x) => [x.name, x.id]));
  for (const key of Object.keys(ogStyleIds)) delete ogStyleIds[key];   // 다른 문서의 번호가 남지 않게
  for (const st of OG_STYLES) if (byName.has(st.name)) ogStyleIds[st.key] = byName.get(st.name);
  if (!create || OG_STYLES.every((st) => ogStyleIds[st.key] !== undefined)) return true;
  const defaultFontId = d.findOrCreateFontId("맑은 고딕");
  const created = [];
  for (const st of OG_STYLES) {
    if (ogStyleIds[st.key] !== undefined) continue;
    const id = d.createStyle(JSON.stringify({ name: st.name, englishName: st.en, type: 0, nextStyleId: 0 }));
    if (typeof id !== "number" || id < 0) continue;
    d.updateStyleShapes(id, JSON.stringify({ fontId: defaultFontId, fontSize: Math.round(st.size * 100), bold: false, italic: !!st.italic, textColor: st.color }),
      JSON.stringify({ spacingBefore: st.before, spacingAfter: st.after, lineSpacing: 150, lineSpacingType: "Percent", alignment: "left" }));
    ogStyleIds[st.key] = id; created.push(st);
  }
  // 새로 만든 스타일은 엔터 뒤에 "일반 텍스트"로 이어지게
  for (const st of created) { try { d.updateStyle(ogStyleIds[st.key], JSON.stringify({ name: st.name, englishName: st.en, nextStyleId: ogStyleIds.normal })); } catch { /* 그대로 */ } }
  return true;
}
// 새 빈 문서면 첫 문단을 "일반 텍스트"로(열어 둔 한글 문서의 문단은 건드리지 않는다)
function ogPrepareNewDocument() {
  const d = ogDoc(); if (!d) return;
  try {
    if (d.getSectionCount() !== 1 || d.getParagraphCount(0) !== 1 || d.getParagraphLength(0, 0) !== 0) return;
    if (JSON.parse(d.getStyleAt(0, 0)).id !== 0) return;
    ogEnsureStyles(true);                                   // 빈 문서는 작아서 스타일을 바로 만들어도 빠르다
    if (ogStyleIds.normal === undefined) return;
    d.applyStyle(0, 0, ogStyleIds.normal);
    window.__ogolgyeStudio.canvasView?.refreshPages?.();
  } catch { /* 새 문서가 아니다 */ }
}
function ogApplyStyleKey(key) {
  const ih = window.__ogolgyeStudio?.inputHandler;
  if (ih && ogStyleIds[key] === undefined) ogEnsureStyles(true);    // 이 문서에서 처음 쓰는 스타일이면 지금 만든다
  if (!ih || ogStyleIds[key] === undefined) return;
  ih.applyStyle(ogStyleIds[key]);                          // 편집 화면의 실행 취소 되는 경로(선택한 문단·표 칸 포함)
  ogUpdateStyleButton();
  try { ih.focus(); } catch { /* 초점 */ }
}
function ogCurrentStyle() {
  const og = window.__ogolgyeStudio, ih = og && og.inputHandler, d = ogDoc();
  if (!ih || !d) return null;
  try {
    const pos = ih.cursor.getPosition();
    const s = pos.parentParaIndex !== undefined ? d.getCellStyleAt(pos.sectionIndex, pos.parentParaIndex, pos.controlIndex, pos.cellIndex, pos.cellParaIndex) : d.getStyleAt(pos.sectionIndex, pos.paragraphIndex);
    return typeof s === "string" ? JSON.parse(s) : s;
  } catch { return null; }
}
// 스타일 목록을 Google 문서식으로: 원래 선택 상자는 숨기고 같은 자리에 단추 + 목록
function ogUpdateStyleButton() {
  const btn = document.querySelector(".og-style-btn"); if (!btn) return;
  const cur = ogCurrentStyle();
  btn.querySelector(".og-style-cur").textContent = cur ? cur.name : "일반 텍스트";
}
function ogInstallStyleMenu() {
  const sel = document.getElementById("style-name");
  if (!sel || sel.parentElement.querySelector(".og-style-btn")) return !!sel;
  const wrap = document.createElement("div"); wrap.className = "og-style";
  wrap.innerHTML = '<button type="button" class="og-style-btn" title="스타일 (Ctrl+Alt+0~6)"><span class="og-style-cur">일반 텍스트</span><span class="og-style-arrow">▾</span></button><div class="og-style-menu" hidden></div>';
  sel.style.display = "none";
  sel.parentElement.insertBefore(wrap, sel);
  const menu = wrap.querySelector(".og-style-menu");
  const build = () => {
    const d = ogDoc(); let others = [];
    try { const mine = new Set(OG_STYLES.map((x) => x.name)); others = JSON.parse(d.getStyleList()).filter((x) => !mine.has(x.name)); } catch { /* 없음 */ }
    const cur = ogCurrentStyle();
    menu.innerHTML = OG_STYLES.map((st) => `<div class="og-style-item${cur && cur.name === st.name ? " on" : ""}" data-key="${st.key}"><span style="font-size:${Math.min(22, Math.max(12, st.size * 1.05))}px;color:${st.color};${st.italic ? "font-style:italic;" : ""}">${st.name}</span>${st.key === "normal" ? '<kbd>Ctrl+Alt+0</kbd>' : st.level ? `<kbd>Ctrl+Alt+${st.level}</kbd>` : ""}</div>`).join("") +
      (others.length ? `<details class="og-style-more"><summary>한글 스타일</summary>${others.map((x) => `<div class="og-style-item" data-id="${x.id}">${x.name.replace(/[<&]/g, "")}</div>`).join("")}</details>` : "");
  };
  wrap.querySelector(".og-style-btn").addEventListener("mousedown", (e) => { e.preventDefault(); if (menu.hidden) { build(); menu.hidden = false; } else menu.hidden = true; });
  menu.addEventListener("mousedown", (e) => {
    if (e.target.closest("summary")) return;
    const it = e.target.closest(".og-style-item"); if (!it) return;
    e.preventDefault(); menu.hidden = true;
    if (it.dataset.key) ogApplyStyleKey(it.dataset.key);
    else { window.__ogolgyeStudio?.inputHandler?.applyStyle(+it.dataset.id); ogUpdateStyleButton(); }
  });
  document.addEventListener("mousedown", (e) => { if (!wrap.contains(e.target)) menu.hidden = true; }, true);
  // 글자를 입력할 때마다 현재 스타일을 다시 묻지 않는다. 커서/서식이 실제로
  // 바뀌는 이벤트와 스타일을 직접 적용한 경로에서만 표시를 갱신한다.
  try { window.__ogolgyeStudio.eventBus.on("cursor-format-changed", ogUpdateStyleButton); } catch { /* 없음 */ }
  ogUpdateStyleButton();
  return true;
}
// 제목·부제목 "끝"에서 엔터: 다음 문단은 일반 텍스트(rhwp 는 스타일의 "다음 스타일"을 따르지 않아 여기서 맞춘다)
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
  const og = window.__ogolgyeStudio, ih = og && og.inputHandler, d = ogDoc();
  if (!ih || !d || ogStyleIds.normal === undefined) return;
  let before;
  try {
    const pos = ih.cursor.getPosition();
    if (pos.parentParaIndex !== undefined) return;                       // 표 칸 안은 그대로
    const cur = JSON.parse(d.getStyleAt(pos.sectionIndex, pos.paragraphIndex));
    const heading = OG_STYLES.find((x) => x.name === cur.name && x.key !== "normal");
    if (!heading || pos.charOffset < d.getParagraphLength(pos.sectionIndex, pos.paragraphIndex)) return;
    before = pos;
  } catch { return; }
  // 편집 화면이 엔터를 처리한 "바로 뒤"에 바꾼다(다음 차례로 미루면 빠른 입력이 먼저 처리돼 제목으로 되돌아간다).
  // 같은 입력 요소에 나중에 붙인 듣기 함수는 편집 화면의 듣기 함수 다음에 불린다. 거기까지 못 오면 다음 차례에 한 번 더.
  let done = false;
  const after = () => {
    if (done) return;
    try {
      const now = ih.cursor.getPosition();
      if (now.paragraphIndex !== before.paragraphIndex + 1 || d.getParagraphLength(now.sectionIndex, now.paragraphIndex) !== 0) return;
      done = true;
      ogApplyStyleKey("normal");
    } catch { /* 그대로 */ }
  };
  e.target.addEventListener("keydown", after, { once: true });
  setTimeout(after, 0);
}, true);

// Google 문서 단축키: Ctrl+Alt+0 일반 텍스트, Ctrl+Alt+1~6 제목 1~6
document.addEventListener("keydown", (e) => {
  if (!e.ctrlKey || !e.altKey || e.shiftKey || e.metaKey) return;
  const m = /^Digit([0-6])$/.exec(e.code); if (!m) return;
  e.preventDefault(); e.stopImmediatePropagation();
  ogApplyStyleKey(m[1] === "0" ? "normal" : "h" + m[1]);
}, true);

// 파일을 읽은 직후(편집 화면이 그리기 전) 할 일: 오골계 스타일 준비와 보기 방식 적용.
// 스타일은 찾기만 하고(만들기는 처음 적용할 때), 페이지 없음 문서는 용지 모양으로 먼저 그리지 않게
// 곧바로 보기 전용 용지를 건다(22만 자 문서 실측: 열기 6.6초의 대부분이 이 둘이었다).
const ogWantsPageless = () => { const mark = ogReadMark(); return mark ? mark === "페이지없음" : ogPL.defaultPageless; };
function ogPrepareLoadedDocument() {
  const d = ogDoc(); if (!d) return;
  ogPL.active = false; ogPL.view = null;
  try { d.beginBatch(); } catch { /* 묶음 처리 없음 */ }
  try {
    ogEnsureStyles(false);
    if (ogWantsPageless() && ogViewEngine() && window.__ogolgyeStudio?.inputHandler?.container) {
      ogPL.view = ogPaperDefs().map(ogViewDef);
      ogApplyViewDefs(ogPL.view);
      ogPL.active = true;
      ogRoot.classList.add("og-pageless");
    }
  } finally { try { d.endBatch(); } catch { /* 묶음 처리 없음 */ } }
  ogPL.prepared = d;
}
function ogOnDocumentLoaded() {
  ogTab.active = 0;
  clearTimeout(ogTabCache.timer); ogInvalidateTabCache(true); ogInvalidatePageEdges(true);
  setTimeout(() => ogRenderTabs(true), 0);
  if (ogPL.prepared !== ogDoc()) ogPrepareLoadedDocument();         // 읽은 직후에 못 했으면(편집 화면 준비 전 등) 지금
  ogPL.prepared = null;
  ogPrepareNewDocument();
  setTimeout(ogUpdateStyleButton, 0);
  if (!ogWantsPageless()) ogLeavePageless();
  else if (ogPL.active) ogRedraw();                                     // 이미 걸었다: 화면만 맞춘다
  else ogEnterPageless();
}
function ogInstallTruePageless() {
  const og = window.__ogolgyeStudio, w = og && og.wasm;
  if (!w || w.__ogTrue) return !!w;
  w.__ogTrue = true;
  // 불러오기·새 문서
  for (const name of ["loadDocument", "loadDocumentWithPassword", "createNewDocument"]) {
    const f = w[name]; if (typeof f !== "function") continue;
    w[name] = function (...a) {
      const r = f.apply(this, a);
      try { ogPrepareLoadedDocument(); } catch (err) { console.error("[오골계 워드] 문서 준비 실패", err); }
      setTimeout(ogOnDocumentLoaded, 0);
      return r;
    };
  }
  // 모든 파일 내보내기(저장·자동 저장 포함): 보기 방식을 적어 둔 뒤 내보낸다(원래 용지 줄 나눔은 엔진이 기록)
  let depth = 0;
  const proto = Object.getPrototypeOf(w);
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (!/^export/.test(name) || /Selection|Control/.test(name) || typeof w[name] !== "function") continue;
    const f = w[name];
    w[name] = function (...a) {
      if (depth > 0) return f.apply(this, a);
      depth++;
      try { ogMarkViewMode(); return f.apply(this, a); } finally { depth--; }
    };
  }
  // 창 폭이 바뀌면 글 폭도 다시 맞춘다
  addEventListener("resize", () => ogScheduleViewportResize(120));
  if (ogDoc()) ogOnDocumentLoaded();
  return true;
}
// 그림 모서리 끌기: 편집 화면은 회전한 그림에서만 비율을 지키고 '비율 유지' 설정은 보지 않는다.
// 설정이 켜져 있으면(또는 Shift를 누르면) 마우스 위치를 대각선 위로 옮겨 넘겨 가로세로 비율을 지킨다.
function ogKeepRatioOn() {
  try { return JSON.parse(localStorage.getItem("rhwp-settings") || "{}")?.dialog?.picturePropsKeepRatio !== false; } catch { return true; }
}
function ogRatioEvent(ih, e) {
  const st = ih.pictureResizeState;
  if (!st || !/^(nw|ne|sw|se)$/.test(st.dir) || (st.rotationAngle ?? 0) % 360 !== 0) return e;
  if (!(ogKeepRatioOn() || e.shiftKey)) return e;
  const z = ih.viewportManager.getZoom() || 1, w = st.bbox.w, h = st.bbox.h;
  if (!(w > 0 && h > 0)) return e;
  const sx = st.dir.includes("e") ? 1 : -1, sy = st.dir.includes("s") ? 1 : -1;
  const dx = (e.clientX - st.startClientX) / z, dy = (e.clientY - st.startClientY) / z;
  const diag = Math.hypot(w, h), k = Math.max((diag + (sx * dx * w + sy * dy * h) / diag) / diag, 1 / Math.max(w, h, 1));
  return { clientX: st.startClientX + sx * w * (k - 1) * z, clientY: st.startClientY + sy * h * (k - 1) * z, shiftKey: e.shiftKey, button: e.button };
}
// 커서가 문서 밖을 가리키지 않게 한다. 편집 화면은 마지막 문단에 그림을 넣으면 커서를 "그림 문단 + 1"(없는 문단)로
// 옮기는데, 그 뒤로는 입력·붙여넣기·그리기가 모두 "문단 인덱스 범위 초과"로 실패해 문서가 사라진 것처럼 보인다.
function ogClampCursor(ih) {
  try {
    const d = ogDoc(), pos = ih.cursor.getPosition();
    if (!d || !pos || pos.parentParaIndex !== undefined) return;
    const count = d.getParagraphCount(pos.sectionIndex);
    if (pos.paragraphIndex < count) return;
    const last = count - 1;
    ih.moveCursorTo({ sectionIndex: pos.sectionIndex, paragraphIndex: last, charOffset: ogParaEnd(d, last) });
  } catch { /* 편집 준비 중 */ }
}
function ogInstallCursorGuard() {
  const ih = window.__ogolgyeStudio?.inputHandler;
  if (!ih || typeof ih.executeOperation !== "function") return false;
  if (ih.__ogCursorGuard) return true;
  const run = ih.executeOperation;
  ih.executeOperation = function (...a) { try { return run.apply(this, a); } finally { ogClampCursor(this); } };
  ih.__ogCursorGuard = true; return true;
}
// 문단 모양 창은 기본/확장 탭에서 들여쓰기·여백만 바꿔도 변경하지 않은 배경 기본값
// { patternType: -1, fillType: "none" }을 함께 보낸다. rhwp 엔진은 이 둘을 새 BorderFill로
// 해석하면서 기본 실선 테두리까지 만들어 버린다. 실제 배경 변경이 아닌 경우 두 값을 빼서
// 현재 문단의 테두리/배경을 그대로 보존한다.
function ogInstallParaFormatGuard() {
  const ih = window.__ogolgyeStudio?.inputHandler;
  if (!ih || typeof ih.executeParaFormatCommand !== "function" || ih.__ogParaFormatGuard) return !!ih?.__ogParaFormatGuard;
  const run = ih.executeParaFormatCommand;
  ih.executeParaFormatCommand = function (targets, props) {
    let next = props;
    if (props && props.patternType === -1 && props.fillType === "none") {
      const layoutKeys = ["alignment", "marginLeft", "marginRight", "indent", "lineSpacing", "lineSpacingType",
        "spacingBefore", "spacingAfter", "headType", "paraLevel", "numberingId", "widowOrphan", "keepWithNext",
        "keepLines", "pageBreakBefore", "fontLineHeight", "singleLine", "autoSpaceKrEn", "autoSpaceKrNum", "verticalAlign"];
      const hasLayoutChange = layoutKeys.some((key) => Object.prototype.hasOwnProperty.call(props, key));
      const hasExplicitFill = ["fillColor", "patternColor", "fillAlpha", "patternAlpha", "gradient", "imageFill"]
        .some((key) => Object.prototype.hasOwnProperty.call(props, key));
      if (hasLayoutChange && !hasExplicitFill) { next = { ...props }; delete next.patternType; delete next.fillType; }
    }
    return run.call(this, targets, next);
  };
  ih.__ogParaFormatGuard = true; return true;
}

// 한/글의 '첫 줄 들여쓰기' 명령은 한 글자만큼 들여쓴다. 문단 모양 창은 들여쓰기를 골라도
// 값이 0.0pt인 채라 화면상 거의 움직이지 않으므로, 0일 때만 현재 글자 크기(1em)를 기본값으로 넣는다.
// 기존 문단에 값이 있거나 사용자가 직접 입력한 값은 그대로 둔다.
function ogInstallOneCharIndent() {
  if (document.documentElement.__ogOneCharIndent) return true;
  document.documentElement.__ogOneCharIndent = true;
  document.addEventListener("change", (event) => {
    const radio = event.target;
    if (!(radio instanceof HTMLInputElement) || radio.type !== "radio" || radio.name !== "ps-first-line" || radio.value !== "indent" || !radio.checked) return;
    const amount = radio.parentElement?.querySelector('input[type="number"]');
    if (!(amount instanceof HTMLInputElement) || Math.abs(Number.parseFloat(amount.value) || 0) > 0.001) return;
    const fontSize = Number.parseFloat(document.getElementById("font-size")?.value || "") || 11;
    amount.value = fontSize.toFixed(1);
    amount.dispatchEvent(new Event("input", { bubbles: true }));
    amount.dispatchEvent(new Event("change", { bubbles: true }));
  });
  return true;
}
function ogInstallKeepRatio() {
  const ih = window.__ogolgyeStudio?.inputHandler;
  if (!ih || typeof ih.updatePictureResizeDrag !== "function" || ih.__ogKeepRatio) return !!ih?.__ogKeepRatio;
  const update = ih.updatePictureResizeDrag, finish = ih.finishPictureResizeDrag;
  ih.updatePictureResizeDrag = function (e) { return update.call(this, ogRatioEvent(this, e)); };
  ih.finishPictureResizeDrag = function (e) { return finish.call(this, ogRatioEvent(this, e)); };
  ih.__ogKeepRatio = true; return true;
}

// 그림을 선택했을 때만 보이는 배치 도구. 엔진의 개체 속성 창에만 있던 기능을
// 자주 쓰는 항목(글자처럼, 본문 배치, 가로 정렬)으로 바로 꺼내 쓴다.
function ogInstallPictureTools() {
  const og = window.__ogolgyeStudio, ih = og?.inputHandler, bus = og?.eventBus, w = og?.wasm;
  const track = document.querySelector("#icon-toolbar .tb-scroll-track");
  if (!ih || !bus || !w || !track) return false;
  if (track.querySelector(".og-picture-tools")) return true;

  const sep = document.createElement("span");
  sep.className = "tb-sep og-picture-tools-sep";
  sep.hidden = true;
  const group = document.createElement("div");
  group.className = "tb-group og-picture-tools";
  group.hidden = true;
  group.setAttribute("aria-label", "그림 배치");
  group.innerHTML =
    '<button type="button" class="tb-btn og-picture-btn" data-og-picture="inline" title="글자처럼 취급: 그림을 글자 사이에 놓습니다"><span class="tb-icon-text">가▣</span><span class="tb-label">글자처럼</span></button>' +
    '<button type="button" class="tb-btn og-picture-btn" data-og-picture="wrap" data-value="TopAndBottom" title="그림 위아래로만 글을 배치합니다"><span class="tb-icon-text">↕</span><span class="tb-label">자리 차지</span></button>' +
    '<button type="button" class="tb-btn og-picture-btn" data-og-picture="wrap" data-value="Square" title="그림의 네모난 경계를 따라 글을 배치합니다"><span class="tb-icon-text">▤</span><span class="tb-label">어울림</span></button>' +
    '<button type="button" class="tb-btn og-picture-btn" data-og-picture="wrap" data-value="Tight" title="그림의 빈 공간을 따라 글을 배치합니다"><span class="tb-icon-text">◫</span><span class="tb-label">빈 공간</span></button>' +
    '<button type="button" class="tb-btn og-picture-btn" data-og-picture="wrap" data-value="BehindText" title="그림을 글 뒤로 보냅니다"><span class="tb-icon-text">글▣</span><span class="tb-label">글 뒤로</span></button>' +
    '<button type="button" class="tb-btn og-picture-btn" data-og-picture="wrap" data-value="InFrontOfText" title="그림을 글 앞으로 가져옵니다"><span class="tb-icon-text">▣글</span><span class="tb-label">글 앞으로</span></button>' +
    '<button type="button" class="tb-btn og-picture-btn" data-og-picture="align" data-value="Left" title="그림을 문단 왼쪽에 맞춥니다"><span class="tb-icon-text">≡</span><span class="tb-label">왼쪽</span></button>' +
    '<button type="button" class="tb-btn og-picture-btn" data-og-picture="align" data-value="Center" title="그림을 문단 가운데에 맞춥니다"><span class="tb-icon-text">≡</span><span class="tb-label">가운데</span></button>' +
    '<button type="button" class="tb-btn og-picture-btn" data-og-picture="align" data-value="Right" title="그림을 문단 오른쪽에 맞춥니다"><span class="tb-icon-text">≡</span><span class="tb-label">오른쪽</span></button>' +
    '<button type="button" class="tb-btn og-picture-btn" data-og-picture="detail" title="그림의 크기와 배치를 자세히 설정합니다"><span class="tb-sprite icon-obj-props"></span><span class="tb-label">상세 설정</span></button>';
  const rotate = track.querySelector(".tb-rotate-group");
  if (rotate) rotate.before(sep, group); else track.append(sep, group);

  const selected = () => {
    const ref = ih.getSelectedPictureRef?.();
    return ih.isInPictureObjectSelection?.() && ref?.type === "image" ? ref : null;
  };
  const props = (ref) => {
    try {
      let value = ref.cellPath?.length && typeof w.getCellPicturePropertiesByPath === "function"
        ? w.getCellPicturePropertiesByPath(ref.sec, ref.ppi, ref.cellPath, ref.ci)
        : w.getPictureProperties(ref.sec, ref.ppi, ref.ci);
      if (typeof value === "string") value = JSON.parse(value);
      return value || {};
    } catch { return {}; }
  };
  const update = () => {
    const ref = selected(), show = !!ref;
    group.hidden = sep.hidden = !show;
    if (!show) return;
    const value = props(ref);
    group.querySelectorAll("[data-og-picture]").forEach((button) => {
      const kind = button.dataset.ogPicture, wanted = button.dataset.value;
      const active = kind === "inline" ? !!value.treatAsChar
        : kind === "wrap" ? !value.treatAsChar && value.textWrap === wanted
          : kind === "align" ? !value.treatAsChar && value.horzAlign === wanted : false;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  };
  const apply = (patch) => {
    const ref = selected(); if (!ref) return;
    try {
      let failure = "";
      const outside = ih.getPositionOutsideSelectedPicture?.() || ih.getCursorPosition?.() || ih.getPosition?.();
      const change = (engine) => {
        let result = ref.cellPath?.length && typeof engine.setCellPicturePropertiesByPath === "function"
          ? engine.setCellPicturePropertiesByPath(ref.sec, ref.ppi, ref.cellPath, ref.ci, patch)
          : engine.setPictureProperties(ref.sec, ref.ppi, ref.ci, patch);
        if (typeof result === "string") result = JSON.parse(result);
        if (result?.ok === false) { failure = result.error || "그림 배치를 바꾸지 못했습니다."; return null; }
        return outside;
      };
      if (typeof ih.executeOperation === "function" && outside) {
        ih.executeOperation({ kind: "snapshot", operationType: "pictureLayout", operation: change, meta: { refresh: "none" } });
      } else {
        change(w);
        bus.emit("document-changed");
      }
      if (failure) throw new Error(failure);
      ih.renderPictureObjectSelection?.();
      requestAnimationFrame(update);
    } catch (err) { alert(String(err?.message || err)); }
  };
  group.addEventListener("mousedown", (event) => event.preventDefault());
  group.addEventListener("click", (event) => {
    const button = event.target.closest("[data-og-picture]"); if (!button) return;
    const kind = button.dataset.ogPicture, value = button.dataset.value;
    if (kind === "inline") apply({ treatAsChar: true });
    else if (kind === "wrap") apply({ treatAsChar: false, textWrap: value });
    else if (kind === "align") apply({ treatAsChar: false, horzRelTo: "Paragraph", horzAlign: value });
    else if (kind === "detail") document.querySelector('[data-cmd="format:object-properties"]')?.click();
  });
  let updateFrame = 0;
  const scheduleVisibleUpdate = () => {
    // 선택 시작/해제는 picture-object-selection-changed가 즉시 처리한다. 문서 변경은
    // 그림 도구가 실제로 보이는 동안 속성 대화상자 등의 변경을 반영할 때만 필요하다.
    if (group.hidden || updateFrame) return;
    updateFrame = requestAnimationFrame(() => { updateFrame = 0; update(); });
  };
  bus.on("picture-object-selection-changed", update);
  bus.on("document-changed", scheduleVisibleUpdate);
  update();
  return true;
}
addEventListener("message", (e) => {
  if (e.origin !== location.origin || !e.data) return;
  if (e.data.type === "ogolgye:view") ogApplyView(e.data);
  if (e.data.type === "ogolgye:host-resize") ogScheduleViewportResize(30);
});
(function ogWaitStudio() {
  if (!ogInstallPageless() || !ogInstallTruePageless()) { setTimeout(ogWaitStudio, 100); return; }
  if (!ogInstallSelectionGuard()) { setTimeout(ogWaitStudio, 100); return; }
  ogInstallKeepRatio();
  ogInstallCursorGuard();
  ogInstallParaFormatGuard();
  ogInstallOneCharIndent();
  ogInstallPictureTools();
  for (const install of [ogInstallTabs, ogInstallAiTools, ogInstallStyleMenu, ogInstallCellFill]) ogWhenReady(install);
  const content = document.getElementById("scroll-content");
  if (content) new MutationObserver((records) => {
    // 커서·선택 표시 등 scroll-content 안의 모든 style 변경에 반응하면 입력 중
    // 관찰자가 계속 깨어난다. 쪽 캔버스가 추가되거나 이동한 경우에만 잘림을 맞춘다.
    const canvas = ".document-page-canvas";
    const layer = "[data-rhwp-overlay-page], [data-rhwp-grid-page], [data-rhwp-hf-edit-page]";   // 쪽의 받침 층(흰 종이 판·그림 층 등)
    const relevant = records.some((r) => r.target?.matches?.(canvas) || r.target?.matches?.(layer) || [...r.addedNodes].some((n) => n.nodeType === 1 && (n.matches?.(canvas) || n.matches?.(layer) || n.querySelector?.(canvas))));
    if (!relevant) return;
    // 쪽 그림이나 받침 층이 새로 놓였으면 화면에 그려지기 전에 바로 자른다(다음 프레임까지 미루면 그 한 프레임 동안
    // 잘리지 않은 흰 판이 이웃 쪽 글을 덮어 깜빡인다). 자르기 값이 같으면 아무것도 바꾸지 않으므로 되풀이되지 않는다.
    if (ogPageless() && records.some((r) => r.addedNodes.length)) ogClipPages();
    ogQueueClip();
  }).observe(content, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
  const container = window.__ogolgyeStudio?.inputHandler?.container;
  if (container && !container.__ogResizeObserver) {
    container.__ogResizeObserver = new ResizeObserver(() => ogScheduleViewportResize(100));
    container.__ogResizeObserver.observe(container);
  }
  ogRelayout();
})();

// ── 제품 정보: 오골계 워드 라이선스 + 사용한 오픈소스 목록(누르면 원래 라이선스 원문) ─────────
// 편집 화면의 제품 정보(rhwp 정보만 보인다) 대신 연다. 내용은 서버의 /api/licenses(core/licenses.js)에서 받는다.
function ogShowAbout() {
  document.querySelector(".og-about-back")?.remove();
  const back = document.createElement("div");
  back.className = "og-about-back";
  back.innerHTML = '<div class="og-about" role="dialog" aria-modal="true" aria-label="제품 정보">' +
    '<div class="og-about-head"><span class="og-about-title">제품 정보</span><button class="og-about-x" title="닫기">✕</button></div>' +
    '<div class="og-about-body"><div class="og-about-wait">불러오는 중…</div></div>' +
    '<div class="og-about-foot"><button class="og-about-prev">이전</button><button class="og-about-close">닫기</button></div></div>';
  document.body.appendChild(back);
  const body = back.querySelector(".og-about-body"), prev = back.querySelector(".og-about-prev"), title = back.querySelector(".og-about-title");
  const el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text !== undefined) x.textContent = text; return x; };
  const link = (href, text) => { const a = el("a", "og-about-link", text); a.href = href; a.target = "_blank"; a.rel = "noopener"; return a; };
  // 화면 이동: 보던 화면을 쌓아 두고 "이전"으로 돌아간다
  const history = [];
  let current = null;
  const open = (view) => { if (current) history.push(current); current = view; render(); };
  const render = () => { body.replaceChildren(); body.scrollTop = 0; current(); prev.style.visibility = history.length ? "" : "hidden"; };
  prev.onclick = () => { if (!history.length) return; current = history.pop(); render(); };
  const close = () => { back.remove(); removeEventListener("keydown", onKey, true); };
  const onKey = (e) => {
    if (e.key !== "Escape" || back.hidden) return;                  // rhwp 제품 정보가 떠 있는 동안은 그 창이 처리한다
    e.preventDefault(); e.stopPropagation();
    if (history.length) prev.click(); else close();
  };
  addEventListener("keydown", onKey, true);
  back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
  back.querySelector(".og-about-x").onclick = close;
  back.querySelector(".og-about-close").onclick = close;
  let summary = null;
  const textView = (heading, meta, sections, chromium) => () => {
    title.textContent = heading;
    if (meta) body.appendChild(meta());
    for (const s of sections) {
      if (s.title) body.appendChild(el("div", "og-about-sec-title", s.title));
      body.appendChild(el("pre", "og-about-text", s.text));
    }
    if (chromium) {
      const b = el("button", "og-about-row-btn", "Chromium 라이선스 모음 보기 ›");
      b.onclick = () => { const f = el("iframe", "og-about-frame"); f.src = "/licenses/chromium"; b.replaceWith(f); };
      body.appendChild(el("div", "og-about-sec-title", "Chromium (Electron에 포함)")); body.appendChild(b);
    }
  };
  // 오픈소스의 라이선스 원문
  const openDetail = async (id) => {
    const d = await (await fetch("/api/licenses/" + encodeURIComponent(id))).json();
    const meta = () => {
      const m = el("div", "og-about-meta");
      m.append(el("span", "og-about-badge", d.license || ""), el("span", "", " " + (d.use || "") + " · "), link(d.homepage, d.homepage.replace(/^https?:\/\//, "")));
      return m;
    };
    open(textView(d.name, meta, d.sections || [], d.chromium));
  };
  // rhwp 는 편집 화면에 자기 제품 정보가 있으므로 그 창을 그대로 보여 준다. 그 창의 닫기 반대편에 "이전"을 붙이고,
  // 창이 닫히면 이 창으로 돌아온다. (rhwp 가 쓰는 오픈소스 전체 원문은 "라이선스 원문"에서 본다)
  const openRhwpAbout = () => {
    back.hidden = true;
    ogAboutPassThrough = true;
    try { document.querySelector('[data-cmd="file:about"]')?.click(); } finally { ogAboutPassThrough = false; }
    const overlay = [...document.querySelectorAll(".modal-overlay")].find((o) => o.querySelector(".about-body"));
    if (!overlay) { back.hidden = false; openDetail("rhwp"); return; }
    let showDetail = false;
    const foot = overlay.querySelector(".dialog-footer");
    if (foot) {
      const closeRhwp = () => overlay.querySelector(".dialog-close")?.click();
      const pb = el("button", "dialog-btn og-about-native-prev", "이전"); pb.onclick = closeRhwp;
      const lb = el("button", "dialog-btn", "라이선스 원문"); lb.onclick = () => { showDetail = true; closeRhwp(); };
      foot.prepend(pb, lb);
    }
    const watch = new MutationObserver(() => {
      if (overlay.isConnected) return;
      watch.disconnect();
      back.hidden = false;
      if (showDetail) openDetail("rhwp");
    });
    watch.observe(document.body, { childList: true });
  };
  const mainView = () => {
    title.textContent = "제품 정보";
    const s = summary;
    const hero = el("div", "og-about-hero");
    const img = el("img", "og-about-pic"); img.src = "/assets/icons/ogolgye-profile.png"; img.alt = "";
    const who = el("div", "og-about-who");
    who.append(el("div", "og-about-name", s.app.name), el("div", "og-about-ver", s.app.version ? "버전 " + s.app.version.replace(/\.0$/, "") : ""));
    const by = el("div", "og-about-by", "만든 사람 오골계 "); by.appendChild(link("https://x.com/5golgyeo", "@5golgyeo")); who.appendChild(by);
    hero.append(img, who); body.appendChild(hero);
    const base = el("div", "og-about-note");
    base.append("문서 편집 화면과 문서 엔진은 ", link("https://github.com/edwardkim/rhwp", "rhwp"), "(© Edward Kim)를 바탕으로 만들었습니다. rhwp는 한글과컴퓨터의 한글 문서 파일(.hwp) 공개 문서를 참고하여 개발되었습니다.");
    body.appendChild(base);
    body.appendChild(el("div", "og-about-sec-title", "오골계 워드 라이선스"));
    body.appendChild(el("div", "og-about-summary", "누구나 무료로 사용·수정·재배포할 수 있습니다. 배포할 때는 저작권과 모든 라이선스를 수정하지 않고 원본을 유지해야 하며, 수정·재배포로 수익을 창출할 수 없습니다."));
    const full = el("button", "og-about-row-btn", "라이선스 전문 보기 ›");
    full.onclick = () => open(textView("오골계 워드 라이선스", null, [{ title: "", text: s.license || "라이선스 파일(LICENSE)을 찾지 못했습니다." }]));
    body.appendChild(full);
    body.appendChild(el("div", "og-about-sec-title", "사용한 오픈소스"));
    const list = el("div", "og-about-list");
    for (const it of s.items) {
      const row = el("button", "og-about-item");
      const left = el("span", "og-about-item-main"); left.append(el("b", "", it.name), el("span", "og-about-item-use", it.use));
      row.append(left, el("span", "og-about-badge", it.license), el("span", "og-about-arrow", "›"));
      row.onclick = async () => {
        if (it.id === "rhwp") { openRhwpAbout(); return; }
        row.disabled = true;
        try { await openDetail(it.id); } catch { /* 불러오지 못함 */ } finally { row.disabled = false; }
      };
      list.appendChild(row);
    }
    body.appendChild(list);
  };
  fetch("/api/licenses").then((r) => r.json()).then((s) => { summary = s; open(mainView); })
    .catch(() => { body.replaceChildren(el("div", "og-about-wait", "제품 정보를 불러오지 못했습니다.")); });
}
let ogAboutPassThrough = false;                                     // rhwp 제품 정보를 열 때만 편집 화면의 원래 동작을 그대로 둔다
addEventListener("click", (e) => {
  if (ogAboutPassThrough || !e.target.closest?.('[data-cmd="file:about"]')) return;
  e.preventDefault(); e.stopImmediatePropagation();
  document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  document.querySelectorAll(".menu-item.open").forEach((m) => m.classList.remove("open"));
  ogShowAbout();
}, true);

// ── 주 문서 이름을 앱에 알린다(창 제목에 표시). 열기·저장·다른 이름으로 저장은 편집 화면 안에서 일어난다.
if (OG_IS_MAIN) {
  let ogLastName = null;
  setInterval(() => {
    const name = ogW()?.fileName;
    if (!name || name === ogLastName) return;
    ogLastName = name;
    parent.postMessage({ type: "ogolgye:doc-name", name }, location.origin);
  }, 700);
}

// ── 환경 설정 창의 오골계 워드 탭 ────────────────────────────────────────────
// 편집 화면은 환경 설정을 열 때마다 창을 새로 만든다. 새 창이 보이면 등록한 탭을 한 번씩 붙인다.
// setup(panel, body)는 탭을 고를 때 부를 함수를 돌려줄 수 있다.
const OG_OPTION_TABS = [];
const ogOptionTab = (key, label, html, setup) => OG_OPTION_TABS.push({ key, label, html, setup });
function ogInstallOptionTabs() {
  for (const body of document.querySelectorAll(".modal-overlay .opt-body")) {
    const tabs = body.querySelector(".dialog-tabs"); if (!tabs) continue;
    for (const t of OG_OPTION_TABS) {
      if (body.querySelector(`.dialog-tab[data-tab="${t.key}"]`)) continue;
      const tab = document.createElement("button"); tab.className = "dialog-tab"; tab.dataset.tab = t.key; tab.textContent = t.label;
      const panel = document.createElement("div"); panel.className = "dialog-tab-panel opt-tab-panel"; panel.dataset.tab = t.key; panel.innerHTML = t.html;
      tabs.appendChild(tab); body.appendChild(panel);
      const onShow = t.setup(panel, body);
      tab.addEventListener("click", () => {
        body.querySelectorAll(".dialog-tab,.dialog-tab-panel").forEach((x) => x.classList.remove("active"));
        tab.classList.add("active"); panel.classList.add("active");
        onShow?.();
      });
    }
  }
}

// 그림 속 글자(OCR) 언어 탭. 선택한 언어 자료만 한 번 내려받고 이후 인식은 모두 컴퓨터 안에서 한다.
ogOptionTab("og-ocr", "OCR 언어",
  '<div class="dialog-section"><div class="dialog-section-title">그림 속 글자 언어</div>' +
      '<p class="opt-desc">스캔 PDF와 그림 속 글자를 읽을 언어를 고릅니다. 처음 추가할 때만 공식 Tesseract 언어 자료를 내려받고, 문서 이미지는 외부로 보내지 않습니다. 최대 8개까지 선택할 수 있습니다.</p>' +
      '<div id="og-ocr-list" style="display:grid;grid-template-columns:repeat(2,minmax(150px,1fr));gap:7px 18px;margin:12px 0"></div>' +
      '<div class="dialog-row opt-row" style="gap:6px"><label for="og-ocr-custom" style="min-width:94px">언어 코드 추가</label><input id="og-ocr-custom" type="text" spellcheck="false" style="width:150px" placeholder="예: pol"><button type="button" class="dialog-btn" data-og-ocr-add>추가</button></div>' +
      '<p class="opt-desc">목록에 없는 언어는 Tesseract 코드(영문 소문자)를 입력할 수 있습니다.</p>' +
      '<div class="dialog-row opt-row" style="gap:8px"><button type="button" class="dialog-btn dialog-btn-primary" data-og-ocr-save>적용</button><span id="og-ocr-status" class="opt-desc"></span></div></div>',
  (panel) => {
    const list = panel.querySelector("#og-ocr-list"), status = panel.querySelector("#og-ocr-status"), custom = panel.querySelector("#og-ocr-custom");
    let state = null;
    const render = () => {
      if (!state) return;
      list.innerHTML = state.languages.map((x) => '<label style="display:flex;align-items:center;gap:7px"><input type="checkbox" value="' + x.code + '" ' + (state.selected.includes(x.code) ? 'checked' : '') + '><span>' + x.name + ' <small style="opacity:.65">(' + x.code + ')' + (x.installed ? ' · 설치됨' : '') + '</small></span></label>').join("");
    };
    const load = async () => {
      status.style.color = ""; status.textContent = "언어 목록을 확인하고 있습니다…";
      try { state = await (await fetch("/api/ocr-languages", { cache: "no-store" })).json(); render(); status.textContent = ""; }
      catch { status.style.color = "#b3261e"; status.textContent = "언어 목록을 불러오지 못했습니다."; }
    };
    panel.querySelector("[data-og-ocr-add]").addEventListener("click", (e) => {
      e.preventDefault(); const code = custom.value.trim().toLowerCase();
      if (!/^[a-z][a-z0-9_]{1,19}$/.test(code)) { status.style.color = "#b3261e"; status.textContent = "올바른 Tesseract 언어 코드를 입력해 주세요."; return; }
      if (!state) return;
      if (!state.languages.some((x) => x.code === code)) state.languages.push({ code, name: code, installed: false });
      if (!state.selected.includes(code)) state.selected.push(code);
      custom.value = ""; render(); status.textContent = "";
    });
    panel.querySelector("[data-og-ocr-save]").addEventListener("click", async (e) => {
      e.preventDefault(); e.stopPropagation();
      const languages = [...list.querySelectorAll('input[type="checkbox"]:checked')].map((x) => x.value);
      if (!languages.length) { status.style.color = "#b3261e"; status.textContent = "언어를 하나 이상 골라 주세요."; return; }
      if (languages.length > 8) { status.style.color = "#b3261e"; status.textContent = "언어는 최대 8개까지 고를 수 있습니다."; return; }
      const button = e.currentTarget; button.disabled = true; status.style.color = ""; status.textContent = "필요한 언어 자료를 내려받고 있습니다…";
      try {
        const r = await fetch("/api/ocr-languages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ languages }) });
        const data = await r.json(); if (!r.ok) throw Error(data.error || "저장하지 못했습니다.");
        state = data; render();
        status.textContent = data.downloaded?.length ? "언어 자료를 설치하고 적용했습니다." : "OCR 언어를 적용했습니다.";
        parent.postMessage({ type: "ogolgye:ocr-updated", languages: data.selected }, location.origin);
      } catch (err) { status.style.color = "#b3261e"; status.textContent = String(err?.message || err); }
      finally { button.disabled = false; }
    });
    return load;
  });

// 사용자 API 도구 탭
const OG_AI_DEFAULTS = {
  openai: ["https://api.openai.com/v1/responses", "gpt-5.6-luna"],
  anthropic: ["https://api.anthropic.com/v1/messages", "claude-sonnet-4-6"],
  gemini: ["https://generativelanguage.googleapis.com/v1beta", "gemini-3.8-flash"],
  vertex: ["https://aiplatform.googleapis.com/v1", ""],
  google_cloud: ["", ""],
  compatible: ["http://127.0.0.1:11434/v1/chat/completions", ""],
  custom: ["http://127.0.0.1:8000/", ""],
};
ogOptionTab("og-ai", "API 도구",
      '<div class="dialog-section"><div class="dialog-section-title">API 목록</div><div class="og-ai-config-list"></div><div class="dialog-row opt-row" style="gap:6px"><button type="button" class="dialog-btn" data-ai-new>새 API</button><button type="button" class="dialog-btn" data-ai-delete>선택 API 삭제</button></div></div>' +
      '<div class="dialog-section og-ai-config-grid"><div class="og-api-identity-row"><label>이름<input data-ai-field="name" maxlength="30" placeholder="예: 번역"></label><label>아이콘<input data-ai-field="icon" maxlength="4" placeholder="예: 🌐"></label><label>색상<input data-ai-field="color" type="color" value="#6b7b3a"></label></div><label>API 종류</label><select data-ai-field="provider"><option value="custom">사용자 지정/로컬 HTTP API</option><option value="google_cloud">Google Cloud API</option><option value="openai">OpenAI</option><option value="anthropic">Claude (Anthropic)</option><option value="gemini">Gemini API</option><option value="vertex">Vertex AI의 Gemini</option><option value="compatible">OpenAI 호환/로컬</option></select><label data-ai-model>모델</label><input data-ai-model data-ai-field="model" spellcheck="false" placeholder="사용할 모델 이름"><label data-ai-endpoint-label>API 주소</label><input data-ai-field="endpoint" spellcheck="false" placeholder="비우면 기본 주소를 사용합니다"><label data-ai-key-label>API 키 (선택)</label><input data-ai-field="apiKey" type="password" spellcheck="false" placeholder="키가 필요 없는 로컬 API는 비워 두세요"><label>기본 프롬프트</label><textarea data-ai-field="prompt" placeholder="{{text}}를 넣으면 그 자리에 선택한 글이 들어갑니다."></textarea><label data-ai-custom>요청 JSON</label><textarea data-ai-custom data-ai-field="requestJson" spellcheck="false" placeholder=\'{"input":"{{prompt}}"}\'></textarea><label data-ai-custom>결과 위치</label><input data-ai-custom data-ai-field="resultPath" spellcheck="false" placeholder="예: result 또는 data.text"><label data-ai-auth>인증 헤더</label><input data-ai-auth data-ai-field="authHeader" spellcheck="false" placeholder="Authorization"><label data-ai-auth>키 앞 글자</label><input data-ai-auth data-ai-field="authPrefix" spellcheck="false" placeholder="예: Bearer "><label>창 형태</label><select data-ai-field="view"><option value="float">플로팅 창</option><option value="side">사이드 창</option></select><label>사이드 위치</label><select data-ai-field="side"><option value="right">오른쪽</option><option value="left">왼쪽</option></select><label>창 디자인 HTML</label><div><textarea data-ai-field="designHtml" class="og-api-design-html" spellcheck="false" placeholder="비워 두면 기본 디자인을 사용합니다."></textarea><div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="dialog-btn" data-ai-design-example>기본 HTML 불러오기</button><button type="button" class="dialog-btn" data-ai-preview>창 미리보기</button></div></div></div>' +
      '<div class="dialog-section"><div class="dialog-row opt-row" style="gap:8px"><button type="button" class="dialog-btn dialog-btn-primary" data-ai-save>API 저장</button><span class="opt-desc" data-ai-status></span></div><p class="opt-desc">Google Cloud를 비롯한 기본 제공 API는 주소를 비우면 공식 기본 주소를 사용합니다. 직접 만든 서버나 프록시를 쓸 때만 주소를 입력하세요. HTML에는 <code>data-api-input</code>, <code>data-api-output</code>, <code>data-api-action="run"</code>이 필요합니다.</p></div>',
  (panel) => {
    const list = panel.querySelector(".og-ai-config-list"), status = panel.querySelector("[data-ai-status]"), field = (n) => panel.querySelector(`[data-ai-field="${n}"]`);
    let current = null;
    const blank = () => ({ id: "", name: "", icon: "API", color: "#6b7b3a", provider: "custom", endpoint: OG_AI_DEFAULTS.custom[0], model: "", prompt: "{{text}}", requestJson: '{"input":"{{prompt}}"}', resultPath: "", authHeader: "Authorization", authPrefix: "Bearer ", designHtml: "", view: "float", side: "right" });
    const updateKind = () => {
      const provider = field("provider").value, custom = provider === "custom";
      panel.querySelectorAll("[data-ai-custom]").forEach((x) => x.hidden = !custom);
      panel.querySelectorAll("[data-ai-auth]").forEach((x) => x.hidden = !custom);
      panel.querySelectorAll("[data-ai-model]").forEach((x) => x.hidden = custom || provider === "google_cloud");
      panel.querySelector("[data-ai-key-label]").textContent = provider === "custom" || provider === "compatible" ? "API 키 (선택)" : "API 키";
      panel.querySelector("[data-ai-endpoint-label]").textContent = provider === "custom" ? "API 주소" : "API 주소 (선택)";
    };
    const fill = (tool) => {
      current = tool?.id || null; const v = tool || blank();
      for (const n of ["name", "icon", "color", "provider", "endpoint", "model", "prompt", "requestJson", "resultPath", "authHeader", "authPrefix", "designHtml", "view", "side"]) field(n).value = v[n] || "";
      field("apiKey").value = ""; field("apiKey").placeholder = tool?.hasKey ? "키가 안전하게 저장되어 있습니다" : "API 키 입력";
      updateKind(); field("side").disabled = field("view").value !== "side";
      list.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.id === current));
    };
    const draw = () => {
      list.replaceChildren();
      for (const tool of ogAiTools) { const b = document.createElement("button"); b.type = "button"; b.dataset.id = tool.id; b.textContent = `${tool.icon} ${tool.name}`; b.style.borderTopColor = tool.color; b.onclick = () => fill(tool); list.appendChild(b); }
      if (current && !ogAiTools.some((x) => x.id === current)) current = null;
      if (!current) fill(ogAiTools[0] || null); else fill(ogAiTools.find((x) => x.id === current));
    };
    const load = async () => { status.style.color = ""; status.textContent = "도구 목록을 확인하고 있습니다…"; const r = await ogAiRefresh(); if (!r.ok) { status.style.color = "#b3261e"; status.textContent = r.error; return; } status.textContent = ""; draw(); };
    panel.querySelector("[data-ai-new]").onclick = () => { current = null; fill(null); status.textContent = "새 API 정보를 입력해 주세요."; };
    panel.querySelector("[data-ai-delete]").onclick = async () => {
      if (!current) { status.textContent = "삭제할 도구를 선택해 주세요."; return; }
      const t = ogAiTools.find((x) => x.id === current); if (!confirm(`“${t?.name || "이 도구"}”을(를) 삭제할까요?`)) return;
      const r = await ogAi("remove", { id: current }); if (!r.ok) { status.style.color = "#b3261e"; status.textContent = r.error; return; }
      ogAiTools = r.tools; current = null; ogRenderAiButtons(); draw(); status.textContent = "도구를 삭제했습니다.";
    };
    field("provider").addEventListener("change", () => { const [endpoint, model] = OG_AI_DEFAULTS[field("provider").value]; field("endpoint").value = endpoint; field("model").value = model; updateKind(); });
    field("view").addEventListener("change", () => { field("side").disabled = field("view").value !== "side"; });
    panel.querySelector("[data-ai-design-example]").onclick = () => { field("designHtml").value = OG_API_DESIGN_EXAMPLE; status.textContent = "기본 동작이 연결된 HTML 예시를 넣었습니다. 원하는 모양으로 수정한 뒤 저장하세요."; };
    const readTool = () => { const tool = { id: current || "preview" }; for (const n of ["name", "icon", "color", "provider", "endpoint", "model", "apiKey", "prompt", "requestJson", "resultPath", "authHeader", "authPrefix", "designHtml", "view", "side"]) tool[n] = field(n).value; return tool; };
    panel.querySelector("[data-ai-preview]").onclick = () => { const tool = readTool(); tool.name ||= "API 미리보기"; tool.icon ||= "API"; ogOpenAiTool(tool, true); status.textContent = "현재 입력값으로 창 미리보기를 열었습니다. 실제 API는 호출하지 않았습니다."; };
    panel.querySelector("[data-ai-save]").onclick = async () => {
      const tool = readTool(); if (!current) delete tool.id;
      status.style.color = ""; status.textContent = "안전하게 저장하고 있습니다…";
      const r = await ogAi("save", { tool });
      if (!r.ok) { status.style.color = "#b3261e"; status.textContent = r.error; return; }
      ogAiTools = r.tools; current = current || r.tools[r.tools.length - 1]?.id; ogRenderAiButtons(); draw(); status.textContent = "저장했습니다. 문단 정렬 기능 오른쪽에서 사용할 수 있습니다.";
    };
    return load;
  });

// Google 드라이브 연결 탭: 사용자가 각자 등록한 OAuth 클라이언트로 연결한다(데스크톱 앱에서만)
const ogGoogleWait = new Map();
addEventListener("message", (e) => {
  if (e.origin !== location.origin || e.data?.type !== "ogolgye:google-result") return;
  const done = ogGoogleWait.get(e.data.requestId); if (done) { ogGoogleWait.delete(e.data.requestId); done(e.data); }
});
function ogGoogle(action, extra = {}) {
  const requestId = `g-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve) => { ogGoogleWait.set(requestId, resolve); parent.postMessage({ type: "ogolgye:google", requestId, action, ...extra }, location.origin); });
}
// 클라이언트 만드는 방법(현재 Google Cloud 콘솔의 "Google 인증 플랫폼" 화면 기준). 링크는 기본 브라우저로 열린다(main.js).
const ogLink = (url, text) => `<a href="${url}" target="_blank" rel="noopener noreferrer" class="og-ext-link">${text}</a>`;
const OG_GOOGLE_GUIDE =
  '<details class="opt-desc og-g-guide"><summary>처음이라면: 최신 Google Cloud 설정 방법</summary>' +
  '<p>Google 계정으로 로그인한 브라우저에서 아래 순서대로 진행합니다. 밑줄 친 글씨(↗)를 누르면 해당 화면이 열립니다. 개인용 설정에는 결제 정보가 필요하지 않습니다.</p><ol>' +
  `<li><b>프로젝트 준비</b> — ${ogLink("https://console.cloud.google.com/", "Google Cloud 콘솔")}을 엽니다. 화면 맨 위 왼쪽의 프로젝트 선택 칸을 누릅니다.<ul class="og-g-steps">` +
    '<li><b>이미 프로젝트가 있으면</b>(예: "My First Project") 그것을 고르면 됩니다. 새로 만들 필요 없습니다.</li>' +
    '<li><b>없으면</b> 창 오른쪽 위의 <b>새 프로젝트</b>를 누르고, 프로젝트 이름(예: <code>오골계 워드</code>)만 넣은 뒤 <b>만들기</b>를 누릅니다. <b>위치</b> 칸이 "조직 없음"으로 되어 있어도 그대로 두세요. 조직은 만들 필요가 없습니다. 만든 뒤 프로젝트 선택 칸에서 그 프로젝트를 고릅니다.</li>' +
    '<li>아래 단계는 모두 이 프로젝트가 선택된 상태에서 합니다.</li></ul></li>' +
  `<li><b>API 사용 설정</b> — ${ogLink("https://console.cloud.google.com/apis/library/drive.googleapis.com", "Google Drive API")}를 열고 파란 <b>사용</b> 단추를 누릅니다. 이어서 ${ogLink("https://console.cloud.google.com/apis/library/docs.googleapis.com", "Google Docs API")}도 열고 <b>사용</b>을 누릅니다. (콘솔 왼쪽 메뉴 <b>API 및 서비스 → 라이브러리</b>에서 이름으로 찾아도 됩니다.)</li>` +
  `<li><b>Google 인증 플랫폼 등록</b> — ${ogLink("https://console.cloud.google.com/auth/overview", "Google 인증 플랫폼 개요")}에서 <b>시작하기</b>를 누릅니다. 이미 등록되어 개요 화면이 보이면 다음 단계로 넘어갑니다.<ul class="og-g-steps">` +
    '<li><b>앱 정보</b>: 앱 이름 <code>오골계 워드</code>, 사용자 지원 이메일은 본인 계정</li>' +
    '<li><b>대상</b>: 일반 Gmail은 <b>외부</b>. Google Workspace 조직 안에서만 쓸 때만 <b>내부</b></li>' +
    '<li><b>연락처 정보</b>: 알림을 받을 본인 이메일</li>' +
    '<li>Google API 서비스 사용자 데이터 정책에 동의하고 <b>만들기</b></li></ul></li>' +
  `<li><b>데이터 액세스에 권한 등록</b> — ${ogLink("https://console.cloud.google.com/auth/scopes", "데이터 액세스")} → <b>범위 추가 또는 삭제</b>에서 아래 두 범위를 찾아 체크하고 <b>업데이트</b>한 뒤 <b>저장</b>합니다. 목록에 없으면 아래 주소를 직접 추가합니다.<ul class="og-g-steps">` +
    '<li><code>https://www.googleapis.com/auth/drive.file</code> — 오골계 워드가 만든 파일 올리기</li>' +
    '<li><code>https://www.googleapis.com/auth/drive.readonly</code> — 기존 드라이브 파일 목록 보기·받기</li></ul>' +
    '<div class="og-g-tip"><code>drive.readonly</code>는 드라이브 전체를 읽을 수 있는 <b>제한된 범위</b>입니다. 오골계 워드는 사용자가 고른 파일을 열기 위해 사용하고, 수정이나 삭제는 하지 않습니다.</div></li>' +
  `<li><b>테스트 사용자에 본인 추가</b> — ${ogLink("https://console.cloud.google.com/auth/audience", "대상")}에서 게시 상태가 <b>테스트</b>라면 <b>테스트 사용자 → 사용자 추가</b>에 실제로 로그인할 Google 계정을 넣습니다. 넣지 않은 계정은 <code>access_denied</code>로 막힙니다.</li>` +
  `<li><b>데스크톱 클라이언트 만들기</b> — ${ogLink("https://console.cloud.google.com/auth/clients", "클라이언트")} → <b>클라이언트 만들기</b> → 애플리케이션 유형 <b>데스크톱 앱</b> → 이름 <code>오골계 워드</code> → <b>만들기</b>. 만들어진 <b>클라이언트 ID</b>(<code>…apps.googleusercontent.com</code>)를 복사합니다. 데스크톱 앱의 보안 비밀은 OAuth에서 선택 사항이므로 아래 칸은 비워도 됩니다. Google이 값을 보여 주고 함께 보관하려는 경우에만 입력하세요.</li>` +
  '<li><b>오골계 워드에 넣고 연결</b> — 복사한 <b>클라이언트 ID</b>를 위 칸에 붙여 넣고 <b>저장 → 연결하기</b>를 누릅니다. 브라우저가 열리면:<ul>' +
    '<li>테스트 사용자로 추가한 계정을 고릅니다.</li>' +
    '<li>테스트 앱 안내는 <b>계속</b>. "Google에서 이 앱을 확인하지 않았습니다"가 나오면 본인이 만든 클라이언트인지 확인한 뒤 <b>고급 → 오골계 워드(으)로 이동</b>을 누릅니다.</li>' +
    '<li>권한 항목을 모두 체크하고 <b>계속</b>을 누릅니다.</li>' +
    '<li>연결되었다는 안내가 보이면 브라우저 탭을 닫고 이 창으로 돌아옵니다. 아래 상태가 "연결되어 있습니다"로 바뀝니다.</li></ul></li>' +
  `<li><b>7일마다 다시 연결</b> — 이 방법으로 만든 연결은 7일이 지나면 만료됩니다. 만료되면 구글 드라이브를 다시 연결해 Google 계정으로 인증해 주세요. 클라이언트 ID와 비밀번호는 그대로 두고 인증만 다시 하면 됩니다.</li>` +
  '</ol></details>';
ogOptionTab("og-google", "Google 드라이브 연결",
      '<div class="dialog-section"><div class="dialog-section-title">Google 드라이브 연결</div>' +
      '<p class="opt-desc">Google 드라이브에 문서를 <b>보내고</b>(Google 문서로 변환), 드라이브의 Google 문서·Word·PDF·한글 파일을 <b>가져올</b> 수 있습니다. 본인의 Google Cloud 프로젝트에서 만든 <b>데스크톱 앱</b> OAuth 클라이언트를 넣어 주세요.</p>' +
      '<p class="opt-desc">요청하는 권한: 오골계 워드가 만든 파일 올리기(drive.file), 드라이브 파일 보기·받기(drive.readonly, 읽기 전용). 드라이브의 파일을 고치거나 지우지 않으며, 이 기능을 쓸 때만 인터넷을 사용합니다.</p>' +
      '<div class="dialog-row opt-row"><label for="og-g-id" style="min-width:92px">클라이언트 ID</label><input id="og-g-id" type="text" spellcheck="false" style="flex:1;min-width:260px" placeholder="…apps.googleusercontent.com"></div>' +
      '<div class="dialog-row opt-row"><label for="og-g-secret" style="min-width:92px">보안 비밀 (선택)</label><input id="og-g-secret" type="password" spellcheck="false" style="flex:1;min-width:260px" placeholder="비워도 연결할 수 있습니다"></div>' +
      '<div class="dialog-row opt-row" style="gap:6px"><button type="button" class="dialog-btn" data-og-g="save">저장</button><button type="button" class="dialog-btn" data-og-g="connect">연결하기</button><button type="button" class="dialog-btn" data-og-g="disconnect">연결 끊기</button></div>' +
      '<p class="opt-desc" id="og-g-status">상태를 확인하고 있습니다…</p>' +
      OG_GOOGLE_GUIDE + '</div>',
  (panel) => {
    const $g = (sel) => panel.querySelector(sel), status = $g("#og-g-status");
    const show = (r) => {
      if (!r.ok) { status.textContent = r.error || "처리하지 못했습니다."; status.style.color = "#b3261e"; return; }
      status.style.color = "";
      if (r.clientId) $g("#og-g-id").value = r.clientId;
      else $g(".og-g-guide").open = true;
      status.textContent = !r.clientId ? "아직 클라이언트 ID를 넣지 않았습니다. 아래 방법을 따라 만들어 주세요." : r.connected && r.canBrowse === false ? "보내기만 연결되어 있습니다. 가져오기를 쓰려면 \"연결하기\"를 한 번 더 눌러 주세요." : r.connected ? "Google 드라이브에 연결되어 있습니다." : "클라이언트 ID를 저장했습니다. \"연결하기\"를 눌러 로그인해 주세요.";
    };
    panel.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-og-g]"); if (!b) return;
      e.preventDefault(); e.stopPropagation();
      const act = b.dataset.ogG;
      panel.querySelectorAll("[data-og-g]").forEach((x) => (x.disabled = true));
      status.style.color = ""; status.textContent = act === "connect" ? "브라우저에서 Google 로그인과 허용을 마쳐 주세요…" : "처리하고 있습니다…";
      let r;
      if (act === "save") { r = await ogGoogle("setClient", { clientId: $g("#og-g-id").value, clientSecret: $g("#og-g-secret").value }); if (r.ok) $g("#og-g-secret").value = ""; }
      else r = await ogGoogle(act);
      panel.querySelectorAll("[data-og-g]").forEach((x) => (x.disabled = false));
      show(r);
    });
    return () => ogGoogle("status").then(show);
  });

// PDF 창의 그림을 끌어다 놓기: 편집 화면의 "그림 끌어다 놓기" 기능으로 놓은 자리에 넣는다
const OG_IMG = "application/x-ogolgye-pdf-image";
document.addEventListener("dragover", (e) => {
  if (![...(e.dataTransfer?.types || [])].includes(OG_IMG)) return;
  e.preventDefault(); e.dataTransfer.dropEffect = "copy";
}, true);
document.addEventListener("drop", async (e) => {
  if (![...(e.dataTransfer?.types || [])].includes(OG_IMG)) return;
  e.preventDefault(); e.stopImmediatePropagation();
  // 편집 화면은 끌고 들어오는 동안 편집 영역에 파란 점선(drag-over)을 붙이고 자기 놓기 처리에서 떼는데,
  // 여기서 놓기를 가로챘으므로 직접 뗀다
  document.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
  const x = e.clientX, y = e.clientY;
  let info; try { info = JSON.parse(e.dataTransfer.getData(OG_IMG)); } catch { return; }
  const report = (ok, error) => parent.postMessage({ type: "ogolgye:image-dropped", ok, error }, location.origin);
  try {
    const ih = window.__ogolgyeStudio?.inputHandler;
    if (!ih) throw new Error("편집 화면을 다시 빌드해야 합니다(npm run build-studio).");
    const r = await fetch(info.url);
    if (!r.ok) throw new Error("PDF 에서 그림을 꺼내지 못했습니다.");
    const blob = await r.blob();
    const ext = (blob.type.split("/")[1] || "png").replace("jpeg", "jpg");
    const img = new Image(), url = URL.createObjectURL(blob);
    try { img.src = url; await img.decode(); } finally { URL.revokeObjectURL(url); }
    const data = new Uint8Array(await blob.arrayBuffer());
    const res = ih.insertDroppedImageAtClientPoint(data, ext, img.naturalWidth, img.naturalHeight, `${info.name}.${ext}`, x, y);
    if (res && res.ok === false) throw new Error(res.error || "놓은 자리에 그림을 넣지 못했습니다.");
    report(true, "");
  } catch (err) { report(false, String(err?.message || err)); }
}, true);

// 편집기 iframe 위에 PDF를 놓아도 바깥 앱의 서브뷰로 전달한다.
document.addEventListener("dragover", (e) => {
  if ([...(e.dataTransfer?.items || [])].some((x) => x.kind === "file")) e.preventDefault();
}, true);
document.addEventListener("drop", async (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (!file || !/\.pdf$/i.test(file.name)) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const bytes = await file.arrayBuffer();
  parent.postMessage({ type: "ogolgye:subview-drop", file: { name: file.name, path: file.path || null, bytes } }, location.origin, [bytes]);
}, true);

(() => {
  if (!OG_IS_MAIN) return;
  // 보기 메뉴에 "테마색" 넣기
  const PRESETS = [["올리브그린", "#6b7b3a"], ["포레스트", "#3f6e4e"], ["세이지", "#7f9a82"], ["네이비", "#2f4b7c"], ["스카이", "#3f86bf"],
    ["테라코타", "#c0663f"], ["로즈", "#c06c84"], ["라벤더", "#8b7bb8"], ["머스터드", "#b8932f"], ["차콜", "#4a4a4a"]];
  function installTheme() {
    const view = document.querySelector('.menu-item[data-menu="view"] .menu-dropdown');
    if (!view) return false;
    if (view.querySelector(".og-theme")) return true;
    const cur = () => getComputedStyle(document.documentElement).getPropertyValue("--og-accent").trim().toLowerCase();
    const box = document.createElement("div");
    box.className = "og-theme";
    box.innerHTML = '<div class="md-sep"></div><div class="md-item disabled" style="opacity:1;cursor:default"><span class="md-icon"></span><span class="md-label">테마색</span></div>' +
      '<div class="og-swatches">' + PRESETS.map(([n, c]) => `<button class="og-swatch" title="${n}" data-color="${c}" style="background:${c}"></button>`).join("") + "</div>" +
      '<label class="og-custom">직접 고르기 <input type="color"></label>';
    view.appendChild(box);
    const mark = () => box.querySelectorAll(".og-swatch").forEach((b) => b.classList.toggle("on", b.dataset.color === cur()));
    const pick = (color) => { parent.postMessage({ type: "ogolgye:theme-pick", color }, location.origin); };
    box.addEventListener("mousedown", (e) => e.stopPropagation());
    box.addEventListener("click", (e) => { e.stopPropagation(); const b = e.target.closest(".og-swatch"); if (b) pick(b.dataset.color); });
    box.querySelector("input").addEventListener("input", (e) => pick(e.target.value));
    view.parentElement.addEventListener("mouseenter", () => { mark(); box.querySelector("input").value = cur() || "#6b7b3a"; });
    new MutationObserver(mark).observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    return true;
  }
  function installViewMenu() {
    const view = document.querySelector('.menu-item[data-menu="view"] .menu-dropdown');
    if (!view) return false;
    if (view.querySelector(".og-view")) return true;
    const box = document.createElement("div");
    box.className = "og-view";
    // 페이지 보기 방식: 편집 화면을 쪽 구분 없이 이어서 볼지(Google 문서의 페이지 없음), 인쇄되는 쪽 모양대로 볼지
    box.innerHTML =
      '<div class="md-sub og-pagemode"><span class="md-icon"></span><span class="md-label">페이지 보기 방식</span><span class="md-arrow">▶</span><div class="md-sub-panel">' +
        '<div class="md-item" data-og-pagemode="pageless"><span class="md-icon"></span><span class="md-label">페이지 없음 (쪽 구분 없이 이어서)</span></div>' +
        '<div class="md-item" data-og-pagemode="paper"><span class="md-icon"></span><span class="md-label">용지 (인쇄되는 쪽 모양대로)</span></div>' +
      '</div></div>' +
      '<div class="md-item" data-og-ruler><span class="md-icon"></span><span class="md-label">눈금자 표시</span></div>' +
      '<div class="md-sep"></div>';
    view.insertBefore(box, view.firstChild);
    // 편집 화면은 메뉴를 열 때 명령(data-cmd)이 없는 하위 메뉴를 비활성으로 바꾸므로 바로 되돌린다
    const sub = box.querySelector(".og-pagemode");
    new MutationObserver(() => { if (sub.classList.contains("disabled")) sub.classList.remove("disabled"); }).observe(sub, { attributes: true, attributeFilter: ["class"] });
    const mark = () => {
      box.querySelectorAll("[data-og-pagemode]").forEach((x) => { x.querySelector(".md-icon").textContent = (x.dataset.ogPagemode === "paper") === !ogPageless() ? "✓" : ""; });
      box.querySelector("[data-og-ruler] .md-icon").textContent = ogRoot.classList.contains("og-noruler") ? "" : "✓";
    };
    mark();
    new MutationObserver(mark).observe(ogRoot, { attributes: true, attributeFilter: ["class"] });
    box.addEventListener("click", (e) => {
      const pm = e.target.closest("[data-og-pagemode]"), rl = e.target.closest("[data-og-ruler]");
      if (!pm && !rl) return;
      e.stopPropagation();
      const next = pm ? { pageMode: pm.dataset.ogPagemode } : { ruler: ogRoot.classList.contains("og-noruler") };
      ogApplyView(next);
      parent.postMessage({ type: "ogolgye:view-pick", ...next }, location.origin);
      // 편집 화면 방식대로 닫는다(메뉴 바깥을 누른 것처럼) — 직접 닫으면 편집 화면은 열려 있다고 알고 있어 다음 클릭이 어긋난다
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      document.querySelectorAll(".menu-item.open").forEach((m) => m.classList.remove("open"));
    });
    return true;
  }
  function installExportMenu() {
    const menu = document.querySelector('.menu-item[data-menu="file"] .menu-dropdown');
    if (!menu) return false;
    if (menu.querySelector(".og-export")) return true;
    const box = document.createElement("div"); box.className = "md-sub og-export";
    box.innerHTML = '<span class="md-icon"></span><span class="md-label">다른 형식으로 내보내기</span><span class="md-arrow">▶</span><div class="md-sub-panel">' +
      '<div class="md-item" data-og-export="txt"><span class="md-icon"></span><span class="md-label">일반 텍스트 (.txt)…</span></div>' +
      '<div class="md-item" data-og-export="md"><span class="md-icon"></span><span class="md-label">Markdown (.md)…</span></div>' +
      '<div class="md-item" data-og-export="html"><span class="md-icon"></span><span class="md-label">웹페이지 압축 파일 (.zip)…</span></div>' +
      '<div class="md-sep"></div>' +
      '<div class="og-doc-slot"></div>' +
      '<div class="md-item" data-og-export="odt"><span class="md-icon"></span><span class="md-label">OpenDocument 형식 (.odt)…</span></div>' +
      '<div class="md-item" data-og-export="rtf"><span class="md-icon"></span><span class="md-label">서식 있는 텍스트 (.rtf)…</span></div>' +
      '<div class="md-item" data-og-export="epub"><span class="md-icon"></span><span class="md-label">EPUB 출판물 (.epub)…</span></div>' +
      '<div class="md-sep"></div>' +
      '<div class="md-item" data-og-export="gdocs"><span class="md-icon"></span><span class="md-label">Google 문서로 보내기…</span></div></div>';
    const pageSetup = menu.querySelector('[data-cmd="file:page-setup"]');
    const divider = pageSetup?.previousElementSibling;
    menu.insertBefore(box, divider?.classList.contains("md-sep") ? divider : pageSetup || null);
    // Word: 파일 메뉴에는 요즘 형식(.docx)을 두고, 편집 화면의 .doc 내보내기는 "다른 형식으로 내보내기" 안으로 옮긴다
    const slot = box.querySelector(".og-doc-slot"), docItem = menu.querySelector('[data-cmd="file:export-doc"]');
    const docxTop = document.createElement("div"); docxTop.className = "md-item"; docxTop.dataset.ogExport = "docx";
    docxTop.innerHTML = '<span class="md-icon"></span><span class="md-label">Word 문서(.docx)로 내보내기…</span>';
    if (docItem) {
      docItem.replaceWith(docxTop);
      const label = docItem.querySelector(".md-label"); if (label) label.textContent = "Word 97-2003 문서 (.doc)…";
      slot.replaceWith(docItem);
    } else { slot.remove(); menu.insertBefore(docxTop, box); }
    // 파일 → Google 드라이브에서 열기("열기" 바로 아래)
    const drive = document.createElement("div"); drive.className = "md-item og-drive";
    drive.innerHTML = '<span class="md-icon"></span><span class="md-label">Google 드라이브에서 열기…</span>';
    const open = menu.querySelector('[data-cmd="file:open"]');
    if (open) open.after(drive); else menu.insertBefore(drive, box);
    drive.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      document.querySelectorAll(".menu-item.open").forEach((m) => m.classList.remove("open"));
      parent.postMessage({ type: "ogolgye:drive-open" }, location.origin);
    });
    new MutationObserver(() => { if (box.classList.contains("disabled")) box.classList.remove("disabled"); })
      .observe(box, { attributes: true, attributeFilter: ["class"] });
    menu.addEventListener("click", (e) => {
      const item = e.target.closest("[data-og-export]"); if (!item) return;
      e.preventDefault(); e.stopPropagation();
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      document.querySelectorAll(".menu-item.open").forEach((m) => m.classList.remove("open"));
      parent.postMessage({ type: "ogolgye:export-pick", format: item.dataset.ogExport }, location.origin);
    });
    return true;
  }
  for (const install of [installViewMenu, installExportMenu, installTheme]) ogWhenReady(install);
  // 파일 → "PDF로 저장…": 데스크톱 앱에서는 앱의 PDF 저장을 쓴다. 편집 화면 자체의 방식(브라우저 인쇄)은
  // 페이지 없음 보기에서 화면용 임시 용지(창 폭 × 긴 세로)로 인쇄하지만, 앱의 저장은 원래 용지로 만들고 바로 파일로 저장한다.
  let hostNative = false;
  addEventListener("message", (e) => { if (e.origin === location.origin && e.data?.type === "ogolgye:host-info") hostNative = !!e.data.native; });
  addEventListener("click", (e) => {
    const item = e.target.closest?.('[data-cmd="file:print-to-pdf"]');
    if (!item || !hostNative || item.classList.contains("disabled")) return;
    e.preventDefault(); e.stopImmediatePropagation();
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    document.querySelectorAll(".menu-item.open").forEach((m) => m.classList.remove("open"));
    parent.postMessage({ type: "ogolgye:export-pick", format: "pdf" }, location.origin);
  }, true);
  function install() {
    const bar = document.getElementById("menu-bar");
    if (!bar) return false;
    if (bar.querySelector('[data-menu="ogolgye-subview"]')) return true;
    const item = document.createElement("div");
    item.className = "menu-item";
    item.dataset.menu = "ogolgye-subview";
    item.innerHTML = '<span class="menu-title">서브뷰</span><div class="menu-dropdown">' +
      '<div class="md-item" data-ogolgye="computer"><span class="md-icon"></span><span class="md-label">내 컴퓨터에서 열기…</span></div>' +
      '<div class="md-item" data-ogolgye="drive"><span class="md-icon"></span><span class="md-label">Google 드라이브에서 열기…</span></div>' +
      '<div class="md-item" data-ogolgye="blank"><span class="md-icon"></span><span class="md-label">새 문서</span></div>' +
      '<div class="md-sep"></div>' +
      '<div class="md-sub"><span class="md-label">위치</span><span class="md-arrow">▶</span><div class="md-sub-panel">' +
        '<div class="md-item" role="menuitemradio" data-og-position="right"><span class="md-icon"></span><span class="md-label">오른쪽</span></div>' +
        '<div class="md-item" role="menuitemradio" data-og-position="left"><span class="md-icon"></span><span class="md-label">왼쪽</span></div>' +
      '</div></div>' +
      '<div class="md-sep"></div>' +
      '<div class="md-item" data-ogolgye="close"><span class="md-icon"></span><span class="md-label">서브뷰 닫기</span></div></div>';
    // "도구" 메뉴 바로 뒤에(없으면 맨 끝에)
    const tool = [...bar.querySelectorAll(".menu-item")].find((m) => m.querySelector(".menu-title")?.textContent.trim() === "도구");
    tool ? tool.after(item) : bar.appendChild(item);
    markSubviewPosition();
    // 편집 화면은 메뉴를 열 때마다 "편집 화면 명령(data-cmd)"이 없는 하위 메뉴를 비활성으로 바꿔 펼치지 않는다.
    // "위치"는 오골계 워드 기능이라 명령이 없으므로, 비활성 표시가 붙으면 바로 뗀다.
    item.querySelectorAll(".md-sub").forEach((sub) => {
      new MutationObserver(() => { if (sub.classList.contains("disabled")) sub.classList.remove("disabled"); })
        .observe(sub, { attributes: true, attributeFilter: ["class"] });
    });
    const title = item.querySelector(".menu-title"), dd = item.querySelector(".menu-dropdown");
    const close = () => item.classList.remove("open");
    // 편집 화면이 이 메뉴에도 자기 열기/닫기를 걸었을 수도, 안 걸었을 수도 있다(초기화 순서에 따라).
    // 누르기 직전 상태를 기억해 두고, 누른 뒤에는 그 반대가 되도록 맞춘다.
    let wasOpen = false;
    item.addEventListener("mousedown", () => { wasOpen = item.classList.contains("open"); }, true);
    title.addEventListener("click", (e) => {
      e.stopPropagation();
      bar.querySelectorAll(".menu-item.open").forEach((m) => { if (m !== item) m.classList.remove("open"); });
      item.classList.toggle("open", !wasOpen);
    });
    // 어떤 방식으로 열리든(누르기, 다른 메뉴에서 마우스 이동) 열릴 때마다 목록 위치를 제목 아래로
    new MutationObserver(() => {
      if (!item.classList.contains("open")) return;
      // 넓은 화면에서는 제목 기준(absolute)으로 저절로 놓이고, 좁은 화면에서는 화면 기준(fixed)이라 위치를 잡아 준다
      dd.style.left = dd.style.top = "";
      if (getComputedStyle(dd).position === "fixed") {
        const r = title.getBoundingClientRect();
        Object.assign(dd.style, { left: r.left + "px", top: r.bottom + "px" });
      }
      dd.style.zIndex = 3000;
    }).observe(item, { attributes: true, attributeFilter: ["class"] });
    dd.addEventListener("click", (e) => {
      const pos = e.target.closest("[data-og-position]");
      if (pos) {
        close();
        parent.postMessage({ type: "ogolgye:subview-position", position: pos.dataset.ogPosition }, location.origin);
        return;
      }
      const it = e.target.closest("[data-ogolgye]");
      if (!it) return;
      close();
      parent.postMessage({ type: "ogolgye:subview", action: it.dataset.ogolgye }, location.origin);
    });
    document.addEventListener("click", (e) => { if (!item.contains(e.target)) close(); });
    return true;
  }
  // 메뉴 줄은 편집 화면이 뜬 뒤에 만들어질 수 있으므로 생길 때까지 지켜본다
  ogWhenReady(install);
})();
