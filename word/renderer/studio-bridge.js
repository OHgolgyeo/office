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
function ogReplyPaste(requestId, handled, error = "", refresh = false) {
  const reply = () => parent.postMessage({ type: "ogolgye:paste-result", requestId, handled, error }, location.origin);
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
new MutationObserver(() => {
  for (const install of ogPending) if (install()) ogPending.delete(install);
  ogInstallOptionTabs();                                   // 환경 설정 창은 열 때마다 새로 만들어진다
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
        parent.postMessage({ type: "ogolgye:export-result", requestId: e.data.requestId, ok: true, ...data }, location.origin);
      } catch (err) {
        parent.postMessage({ type: "ogolgye:export-result", requestId: e.data.requestId, ok: false, error: String(err?.message || err) }, location.origin);
      }
    }, 0);
  }
  if (e.data.type === "ogolgye:paste-step") {
    // 문서화 한 단계: text(글자 HTML) / break(문단 나누기) / image(그림 파일 — 편집기의 그림 넣기 경로)
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
      if (st.kind === "inline") {
        // 방금 넣은 그림(커서 바로 앞 문단의 첫 개체)을 "글자처럼 취급"으로: 문장 흐름 속에 자리 잡아 본문과 겹치지 않는다
        const og = window.__ogolgyeStudio || {};           // 빌드할 때 열어 둔 연결 통로(scripts/build-studio.js)
        const w = og.wasm, ih = og.inputHandler, bus = og.eventBus;
        let ok = false, why = "";
        try {
          const pos = ih.cursor.getPosition();
          let r = w.setPictureProperties(pos.sectionIndex, pos.paragraphIndex - 1, 0, { treatAsChar: true });   // 편집 화면의 연결 함수는 객체를 받고 객체를 돌려준다
          if (typeof r === "string") r = JSON.parse(r);
          ok = !!r && r.ok !== false; if (!ok) why = (r && r.error) || "그림 배치를 바꾸지 못했습니다.";
          bus?.emit("document-changed");
        } catch (err) { why = window.__ogolgyeStudio ? String(err?.message || err) : "편집 화면을 다시 빌드해야 합니다(npm run build-studio)."; }
        parent.postMessage({ type: "ogolgye:paste-result", requestId: e.data.requestId, handled: ok, error: why }, location.origin);
        return;
      }
      if (st.kind === "up") {
        // 커서를 한 줄 위로(그림을 넣을 빈 문단으로). 편집기의 키 처리 경로를 그대로 쓴다
        const kev = new KeyboardEvent("keydown", { key: "ArrowUp", code: "ArrowUp", keyCode: 38, bubbles: true, cancelable: true });
        target.dispatchEvent(kev);
        parent.postMessage({ type: "ogolgye:paste-result", requestId: e.data.requestId, handled: true, error: "" }, location.origin);
        return;
      }
      if (st.kind === "text") { data.setData("text/plain", st.text || ""); if (st.html) data.setData("text/html", st.html); }
      else if (st.kind === "break") data.setData("text/plain", "\n");
      else if (st.kind === "image") {
        const bin = Uint8Array.from(atob(st.b64), (c) => c.charCodeAt(0));
        data.items.add(new File([bin], st.name || "image.png", { type: st.mime || "image/png" }));
      }
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
      if (e.data.html) data.setData("text/html", String(e.data.html));
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
const ogEdges = { key: "", list: [], timer: 0 };
function ogPageEdges(n, bandOf) {
  const w = ogW();
  let key = "";
  try {
    if (!w.doc.__ogId) w.doc.__ogId = Math.random();                // 문서를 다시 읽어 바꿔 끼우면 새로 읽는다
    key = `${w.doc.__ogId}|${n}|${JSON.stringify(w.getPageDef(0))}`;
  } catch { key = String(n); }
  const read = () => Array.from({ length: n }, (_, i) => { const [t, b] = bandOf(i); return ogPageContentEdge(i, t, b); });
  if (ogEdges.key !== key) { ogEdges.key = key; ogEdges.list = read(); return ogEdges.list; }
  clearTimeout(ogEdges.timer);
  ogEdges.timer = setTimeout(() => {
    if (ogEdges.key !== key) return;
    const fresh = read();
    const moved = fresh.some((e, i) => !ogEdges.list[i] || Math.abs(e.start - ogEdges.list[i].start) > 0.5 || Math.abs(e.end - ogEdges.list[i].end) > 0.5);
    ogEdges.list = fresh;
    if (moved) ogRelayout();
  }, 400);
  return ogEdges.list;
}
function ogPageContentEdge(i, t, b) {
  const w = ogW(), inBody = (y) => y >= t - 1 && y <= b + 1;
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
    const infos = [], body = [];
    for (let i = 0; i < n; i++) {
      let info = null;
      try { info = og.wasm.getPageInfo(i); } catch { info = null; }
      infos.push(info);
      body.push(info ? ogBodyBand(info) : [0, this.pageHeights[i] / zoom]);
    }
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
      const top = edge.start * zoom, bottom = (i < n - 1 ? edge.end : b) * zoom;
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
      return { pageIdx: best.pageIdx, pageX: (clientX - best.rect.left) / scaleX, pageY: (clientY - best.rect.top) / scaleY };
    } catch { return original(clientX, clientY); }
  };
}
// 쪽 캔버스마다 여백 잘라 내기(캔버스가 그리는 쪽 번호의 본문 경계로)
function ogClipPages() {
  const vs = window.__ogolgyeStudio?.inputHandler?.virtualScroll;
  const byCanvas = new Map(ogPageCanvases().map(([i, c]) => [c, i]));
  document.querySelectorAll("#scroll-content .document-page-canvas").forEach((c) => {
    const idx = byCanvas.get(c);
    // 페이지 없음이 아니거나 어느 쪽인지 모르면 자르지 않는다(예전 쪽의 자르기가 남아 글이 가려지지 않게)
    if (!ogPageless() || !vs || !vs.__ogBands || idx === undefined || !vs.__ogBands[idx]) { if (c.style.clipPath) c.style.clipPath = ""; return; }
    // 쪽 배치를 다시 계산했는데 캔버스가 예전 자리에 남아 있으면 계산된 자리로 옮긴다
    // (커서·선택 표시는 계산된 자리를 기준으로 그리므로, 캔버스가 어긋나 있으면 커서가 글과 다른 곳에 보인다)
    const want = vs.pageOffsets?.[idx];
    if (Number.isFinite(want) && Math.abs(parseFloat(c.style.top) - want) > 0.5) c.style.top = `${want}px`;
    // 본문 경계에 딱 맞춰 자른다(여백 모서리 표시는 본문 경계 바로 바깥에 그려진다)
    // 여백 모서리 표시는 본문 경계선 위에 그려지고 본문 "바깥"(좌우 여백, 위아래 여백)으로만 뻗는다.
    // 본문 폭 안쪽은 경계까지 그대로 보여 주고(쪽 맨 윗줄 글자가 잘리지 않게), 좌우 여백만 경계에서 3px 안쪽까지 잘라 표시를 가린다.
    const [t, b, h, l, r, w] = vs.__ogBands[idx];
    const e = 3, T = t.toFixed(1), B = b.toFixed(1), Ti = (t + e).toFixed(1), Bi = (b - e).toFixed(1), L = l.toFixed(1), R = r.toFixed(1), W = (w || c.width).toFixed(1);
    const clip = l && r ? `polygon(${L}px ${T}px, ${R}px ${T}px, ${R}px ${Ti}px, ${W}px ${Ti}px, ${W}px ${Bi}px, ${R}px ${Bi}px, ${R}px ${B}px, ${L}px ${B}px, ${L}px ${Bi}px, 0px ${Bi}px, 0px ${Ti}px, ${L}px ${Ti}px)`
      : `inset(${(t + 1).toFixed(1)}px 0 ${Math.max(0, h - b + 1).toFixed(1)}px 0)`;
    if (c.style.clipPath !== clip) c.style.clipPath = clip;
  });
}
let ogClipQueued = false;
function ogQueueClip() { if (ogClipQueued) return; ogClipQueued = true; ogFrame(() => { ogClipQueued = false; ogClipPages(); }); }
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
const ogTab = { active: 0 };
function ogTabList() {
  const d = ogDoc(); if (!d) return [];
  let bms = [];
  try { bms = JSON.parse(d.getBookmarks()).filter((b) => String(b.name).startsWith(OG_TAB) && (b.sec || 0) === 0); } catch { bms = []; }
  const tabs = bms.map((b) => ({ name: b.name.slice(OG_TAB.length) || "이름 없는 페이지", para: b.para, bm: b })).sort((a, b) => a.para - b.para);
  if (!tabs.length || tabs[0].para !== 0) tabs.unshift({ name: "페이지 1", para: 0, bm: null });
  for (const t of tabs) { try { t.startPage = JSON.parse(d.getCursorRect(0, t.para, 0)).pageIndex; } catch { t.startPage = -1; } }
  return tabs;
}
const ogTabOfPara = (tabs, para) => { let k = 0; tabs.forEach((t, i) => { if (t.para <= para) k = i; }); return k; };
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
  ogRedraw(); ogRenderTabs();
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
  ogRedraw(); ogRenderTabs();
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
  ogRedraw(); ogRenderTabs();
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
function ogRenderTabs() {
  const panel = document.querySelector(".og-tabs"); if (!panel || !ogDoc()) return;
  const tabs = ogTabList();
  if (ogTab.active >= tabs.length) ogTab.active = tabs.length - 1;
  const list = panel.querySelector(".og-tabs-list");
  list.innerHTML = tabs.map((t, i) => {
    const on = i === ogTab.active;
    const heads = on ? ogTabHeadings(tabs, i).map((h) => `<div class="og-ol" data-para="${h.para}" style="padding-left:${14 + (h.level - 1) * 12}px" title="${ogEsc(h.text)}">${ogEsc(h.text)}</div>`).join("") : "";
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
    if (item.classList.contains("open")) ogRenderTabs();
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
  let rt = 0;
  bus.on("document-changed", () => { clearTimeout(rt); rt = setTimeout(ogRenderTabs, 250); });
  ogRenderTabs();
  return true;
}

// ── 본문 글 가져오기 ────────────────────────────────────────────────────────
// 사용자 AI 글쓰기 도구가 선택 영역 또는 현재 페이지 목록 항목의 글을 가져올 때 쓴다.

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

// ── 사용자 AI 글쓰기 도구 ──────────────────────────────────────────────────
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
    const timer = setTimeout(() => { if (ogAiWait.delete(requestId)) resolve({ ok: false, error: action === "run" ? "AI 응답 시간이 초과되었습니다." : "AI 도구는 데스크톱 앱에서 사용할 수 있습니다." }); }, action === "run" ? 125000 : 8000);
    ogAiWait.set(requestId, (value) => { clearTimeout(timer); resolve(value); });
    parent.postMessage({ type: "ogolgye:ai", requestId, action, ...extra }, location.origin);
  });
}
async function ogAiRefresh() {
  const r = await ogAi("list"); if (r.ok && Array.isArray(r.tools)) { ogAiTools = r.tools; ogRenderAiButtons(); } return r;
}
function ogAiPanel() {
  let panel = document.querySelector(".og-ai-panel"); if (panel) return panel;
  panel = document.createElement("div"); panel.className = "og-ai-panel float"; panel.hidden = true;
  panel.innerHTML = '<div class="og-ai-head"><span class="og-ai-title-icon">AI</span><b class="og-ai-title">AI 도구</b><button type="button" class="og-ai-close" title="닫기">×</button></div><div class="og-ai-body"><label>AI에 보낼 글</label><textarea class="og-ai-input" placeholder="문서에서 글을 선택하거나 여기에 직접 입력하세요."></textarea><div class="og-ai-actions"><button type="button" class="primary" data-ai-do="run">실행</button><button type="button" data-ai-do="page">현재 페이지 가져오기</button><button type="button" data-ai-do="selection">선택 내용 가져오기</button></div><div class="og-ai-status"></div><label>결과</label><textarea class="og-ai-output" readonly placeholder="AI의 결과가 여기에 표시됩니다."></textarea><div class="og-ai-actions"><button type="button" data-ai-do="copy">결과 복사</button><button type="button" data-ai-do="replace">선택한 글 바꾸기</button></div></div>';
  document.body.appendChild(panel);
  for (const ev of ["pointerdown", "pointerup", "mousedown", "mouseup", "dblclick", "keydown"]) panel.addEventListener(ev, (e) => e.stopPropagation());
  panel.querySelector(".og-ai-close").onclick = () => { panel.hidden = true; };
  panel.addEventListener("click", async (e) => {
    const act = e.target.closest("[data-ai-do]")?.dataset.aiDo; if (!act) return;
    const input = panel.querySelector(".og-ai-input"), output = panel.querySelector(".og-ai-output"), status = panel.querySelector(".og-ai-status");
    if (act === "page") { const s = ogPageSource(); input.value = s.text; input.__ogSource = s; panel.__ogSource = s; return; }
    if (act === "selection") { const s = ogSelectionSource(); if (!s?.text) { status.textContent = "문서에서 글을 먼저 선택해 주세요."; return; } input.value = s.text; input.__ogSource = s; panel.__ogSource = s; return; }
    if (act === "copy") { if (output.value) { await navigator.clipboard.writeText(output.value); status.textContent = "결과를 복사했습니다."; } return; }
    if (act === "replace") { ogAiReplaceSelection(panel); return; }
    if (act === "run") {
      if (!input.value.trim()) { status.textContent = "AI에 보낼 글을 넣어 주세요."; return; }
      e.target.disabled = true; status.textContent = "AI가 처리하고 있습니다…"; output.value = "";
      const r = await ogAi("run", { id: panel.dataset.tool, input: input.value });
      e.target.disabled = false;
      if (!r.ok) { status.textContent = "실행하지 못했습니다: " + (r.error || "알 수 없는 오류"); return; }
      output.value = r.output || ""; status.textContent = "완료했습니다.";
    }
  });
  panel.querySelector(".og-ai-input").addEventListener("input", (e) => { if (e.target.__ogSource?.text !== e.target.value) { e.target.__ogSource = null; panel.__ogSource = null; } });
  const head = panel.querySelector(".og-ai-head"); let drag = null;
  head.addEventListener("mousedown", (e) => { if (!panel.classList.contains("float") || e.target.closest("button")) return; const r = panel.getBoundingClientRect(); drag = { x: e.clientX - r.left, y: e.clientY - r.top }; e.preventDefault(); });
  addEventListener("mousemove", (e) => { if (!drag) return; panel.style.left = `${Math.max(0, Math.min(innerWidth - panel.offsetWidth, e.clientX - drag.x))}px`; panel.style.top = `${Math.max(90, Math.min(innerHeight - 80, e.clientY - drag.y))}px`; panel.style.right = "auto"; });
  addEventListener("mouseup", () => { drag = null; });
  return panel;
}
function ogAiReplaceSelection(panel) {
  const output = panel.querySelector(".og-ai-output"), status = panel.querySelector(".og-ai-status"), source = panel.__ogSource;
  if (!output.value || source?.kind !== "selection" || !source.segments?.length) { status.textContent = "본문에서 선택한 글로 실행한 경우에만 문서를 바로 바꿀 수 있습니다."; return; }
  const first = source.segments[0], last = source.segments[source.segments.length - 1], ih = window.__ogolgyeStudio?.inputHandler;
  if (!ih || first.sectionIndex !== last.sectionIndex) { status.textContent = "이 선택 영역은 바로 바꿀 수 없습니다."; return; }
  const end = last.charOffset + (last.textEnd - last.textStart);
  try {
    ih.cursor.clearSelection();
    ih.executeOperation({ kind: "snapshot", operationType: "aiRewrite", operation: (wasm) => {
      wasm.deleteRange(first.sectionIndex, first.paragraphIndex, first.charOffset, last.paragraphIndex, end);
      wasm.insertText(first.sectionIndex, first.paragraphIndex, first.charOffset, output.value);
      return { sectionIndex: first.sectionIndex, paragraphIndex: first.paragraphIndex, charOffset: first.charOffset + output.value.length };
    }});
    status.textContent = "선택한 글을 AI 결과로 바꿨습니다."; panel.__ogSource = null;
  } catch (err) { status.textContent = "문서에 넣지 못했습니다: " + String(err?.message || err); }
}
function ogOpenAiTool(tool) {
  const panel = ogAiPanel(), input = panel.querySelector(".og-ai-input"), selected = ogSelectionSource();
  panel.dataset.tool = tool.id; panel.style.setProperty("--ai-color", tool.color); panel.querySelector(".og-ai-title").textContent = tool.name; panel.querySelector(".og-ai-title-icon").textContent = tool.icon;
  panel.className = `og-ai-panel ${tool.view === "side" ? `side ${tool.side}` : "float"}`; panel.style.left = panel.style.right = panel.style.top = "";
  const source = selected?.text ? selected : ogPageSource(); input.value = source.text; input.__ogSource = source; panel.__ogSource = source;
  panel.querySelector(".og-ai-output").value = ""; panel.querySelector(".og-ai-status").textContent = selected?.text ? "선택한 글을 가져왔습니다." : "현재 페이지의 글을 가져왔습니다."; panel.hidden = false;
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
// 편집하는 동안에만 용지를 "화면 폭 × 긴 세로"로 바꿔 글이 창 폭에 맞춰 흐르게 한다.
// 저장·내보내기 때는 원래 용지로 잠깐 되돌려 내보내고, 보기 방식은 책갈피로 파일 안에 적어 둔다.
const OG_MARK = "오골계워드:보기=";          // 책갈피 이름 앞부분(뒤에 "페이지없음" 또는 "페이지")
const PX_HU = 75;                          // 1px(96dpi) = 75 HWPUNIT
const ogPL = { active: false, orig: null, view: null, busy: 0, defaultPageless: true };
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
  return { ...orig, landscape: false, width: Math.round(viewPx * PX_HU), height: Math.round(Math.max(orig.width, orig.height) * 3),
    marginLeft: Math.round(sideMarginPx * PX_HU), marginRight: Math.round(sideMarginPx * PX_HU),
    marginTop: 28 * PX_HU, marginBottom: 28 * PX_HU, marginHeader: 0, marginFooter: 0, marginGutter: 0 };
}
const OG_DEF_KEYS = ["width", "height", "marginLeft", "marginRight", "marginTop", "marginBottom", "marginHeader", "marginFooter"];
const ogSameDef = (a, b) => !!a && !!b && OG_DEF_KEYS.every((k) => Math.abs((a[k] || 0) - (b[k] || 0)) <= 2);
// 글이 흐르는 폭(용지 폭 - 좌우 여백)
const ogTextWidth = (d) => (d.landscape ? d.height : d.width) - (d.marginLeft || 0) - (d.marginRight || 0) - (d.marginGutter || 0);
// 편집 엔진(rhwp)은 용지 설정으로 글 폭을 바꾸면 쪽 나눔을 잘못 계산할 때가 많다(문단 몇 개마다 새 쪽으로 넘겨
// 글 사이에 큰 빈 곳이 생기고 쪽 수가 몇 배로 늘어난다. 높이만 바꾸는 것은 괜찮다).
// 문서를 HWPX로 내보냈다 다시 읽으면 바르게 배치되므로, 글 폭이 바뀐 문서는 그렇게 다시 배치한다.
function ogWidthChanged(doc, defs) {
  return defs.some((d, i) => { try { return Math.abs(ogTextWidth(d) - ogTextWidth(JSON.parse(doc.getPageDef(i)))) > 2; } catch { return false; } });
}
function ogRebuiltDoc(doc) {
  const fresh = new doc.constructor(doc.exportHwpx());
  try { fresh.convertToEditable?.(); } catch { /* 이미 편집 가능 */ }
  return fresh;
}
// 편집 중인 문서를 같은 내용의 다시 배치한 문서로 바꿔 끼운다. 되돌리기 기록은 예전 문서 안에 있으므로 비운다.
function ogRebuildLiveDoc() {
  const w = ogW(), old = w && w.doc, ih = window.__ogolgyeStudio?.inputHandler;
  if (!old) return false;
  let fresh = null;
  try {
    fresh = ogRebuiltDoc(old);
    w.ensureParagraphStableIdsFor?.(fresh);
    try { fresh.setFileName(w.fileName); } catch { /* 이름 없음 */ }
  } catch { try { fresh?.free(); } catch { /* 없음 */ } return false; }
  w.doc = fresh;
  if (typeof w._documentGeneration === "number") w._documentGeneration += 1;   // 그림 등 화면 캐시를 새 문서 기준으로
  try { old.free(); } catch { /* 이미 해제 */ }
  try { ih?.history?.clear(); } catch { /* 기록 없음 */ }
  return true;
}
function ogSetDefs(defs) {
  const w = ogW(); ogPL.busy++;
  try {
    const reflow = !!w.doc && ogWidthChanged(w.doc, defs);
    defs.forEach((d, i) => { try { w.setPageDef(i, d); } catch { /* 구역 없음 */ } });
    if (reflow) ogRebuildLiveDoc();
  } finally { ogPL.busy--; }
}
let ogRedrawToken = 0;
function ogRedraw() {
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
        const pos = ih.cursor?.getPosition?.();
        if (pos) ih.cursor.moveTo(pos);
        ih.updateCaret?.(true);
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
    if (!ogPL.active || !ogPL.orig) return;
    const next = ogPL.orig.map(ogViewDef);
    if (next.some((d, i) => !ogSameDef(d, ogPL.view[i]))) { ogPL.view = next; ogSetDefs(ogPL.view); }
    // 폭이 같더라도 부모 flex 배치 직후에는 캔버스·스크롤 좌표가 이전 값일 수 있다.
    ogRedraw();
  }, delay);
}
function ogEnterPageless() {
  const w = ogW(); if (!w || !ogDoc()) return;
  if (!ogPL.active) { ogPL.orig = []; for (let i = 0; i < ogSectionCount(); i++) ogPL.orig.push(w.getPageDef(i)); }
  ogPL.view = ogPL.orig.map(ogViewDef);
  ogSetDefs(ogPL.view);
  ogPL.active = true;
  ogRoot.classList.add("og-pageless");
  ogRedraw();
}
function ogLeavePageless() {
  if (ogPL.active) { ogSetDefs(ogPL.orig); ogPL.active = false; }
  ogRoot.classList.remove("og-pageless");
  ogRedraw();
}
// 내보내기는 페이지 없음용 임시 용지가 아니라 문서의 원래 용지 설정으로 만든다.
// 편집 중인 문서의 용지를 바꿨다 되돌리면 편집기가 원래 용지 기준 쪽 나눔을 그대로 남겨(쪽 수가 늘고 글 사이에 빈 곳이 생김)
// 화면과 편집기 속 배치가 달라지고 클릭이 엉뚱한 곳에 커서를 놓는다. 그래서 복사본을 만들어 복사본의 용지만 바꾼다.
function ogWithOriginalPages(fn) {
  const w = ogW(), real = ogDoc();
  if (!real) return fn();
  ogWriteMark(ogPL.active ? "페이지없음" : "페이지");
  if (!ogPL.active) return fn();
  let copy = new real.constructor(real.exportHwp());
  ogPL.busy++;
  try {
    const reflow = ogWidthChanged(copy, ogPL.orig);
    ogPL.orig.forEach((d, i) => { try { copy.setPageDef(i, JSON.stringify(d)); } catch { /* 구역 없음 */ } });
    if (reflow) { const bad = copy; copy = ogRebuiltDoc(bad); bad.free(); }   // 원래 용지 기준 쪽 나눔을 바르게(PDF·파일 속 줄 배치)
    w.doc = copy;                                                     // 내보내기 함수들은 w.doc 을 읽는다
    return fn();
  } finally { w.doc = real; ogPL.busy--; try { copy.free(); } catch { /* 이미 해제 */ } }
}
// 문서 전체 HTML: 엔진의 문단 HTML 뽑기(exportSelectionHtml)는 글자만 담고 표·그림이 든 문단을 빠뜨리므로,
// 문단을 하나씩 돌면서 글자(문단 HTML) · 표(exportControlHtml) · 그림(getControlImageData)을 원래 순서대로 모은다.
function ogDocumentHtml(w, range = null) {                       // range: { from, to } — 첫 구역의 문단 범위(탭 하나)
  const d = ogDoc();
  const fragment = (html) => {
    const marked = String(html).match(/<!--StartFragment-->([\s\S]*?)<!--EndFragment-->/i);
    if (marked) return marked[1].trim();
    const body = String(html).match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    return (body ? body[1] : String(html)).trim();
  };
  const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  let controls = [];
  try { controls = JSON.parse(d.getControls()); } catch { controls = []; }
  const sections = [];
  for (let sec = 0; sec < w.getSectionCount(); sec++) {
    const count = w.getParagraphCount(sec); if (!count) continue;
    const mine = controls.filter((c) => (c.list || 0) === sec);
    const parts = [];
    for (let i = 0; i < count; i++) {
      if (range && (sec !== 0 || i < range.from || i > range.to)) continue;
      const len = w.getParagraphLength(sec, i);
      let text = len > 0 ? fragment(w.exportSelectionHtml(sec, i, 0, i, len)) : "";
      // Google 문서식 스타일(제목·부제목·제목 1~6)은 내보내기에서 제목 구조로 쓰이도록 표시해 둔다
      try { const sn = JSON.parse(d.getStyleAt(sec, i)).name, st = OG_STYLES.find((x) => x.name === sn); if (text && st) text = text.replace(/<p\b/i, `<p data-og-style="${st.key}"`); } catch { /* 표시 없이 */ }
      const objs = [];
      for (const c of mine.filter((x) => x.para === i).sort((a, b) => a.pos - b.pos)) {
        const kind = String(c.ctrlId).trim();
        try {
          if (kind === "tbl") objs.push({ pos: c.pos, html: fragment(d.exportControlHtml(sec, i, "[]", c.controlIndex)) });
          else if (kind === "gso") {
            const data = d.getControlImageData(sec, i, "[]", c.controlIndex);
            if (!data || !data.length) continue;
            const mime = d.getControlImageMime(sec, i, "[]", c.controlIndex) || "image/png";
            let size = "";
            try { const pp = JSON.parse(d.getPictureProperties(sec, i, c.controlIndex)); size = ` width="${Math.round(pp.width / 75)}" height="${Math.round(pp.height / 75)}"`; } catch { /* 크기 모름 */ }
            objs.push({ pos: c.pos, html: `<p><img src="data:${mime};base64,${b64(data)}"${size} alt=""></p>` });
          }
        } catch { /* 꺼낼 수 없는 개체는 건너뛴다 */ }
      }
      // 글자 앞에 놓인 개체(위치 0)는 글자보다 먼저, 나머지는 뒤에
      for (const o of objs.filter((o) => o.pos === 0)) parts.push(o.html);
      if (text && !(objs.length && !text.replace(/<[^>]+>/g, "").trim())) parts.push(text);
      for (const o of objs.filter((o) => o.pos !== 0)) parts.push(o.html);
    }
    sections.push(`<section class="og-section" data-section="${sec + 1}">${parts.join("\n")}</section>`);
  }
  return sections.join("\n");
}
function ogBuildExport(format) {
  const w = ogW(); if (!w || !ogDoc()) throw new Error("열린 문서가 없습니다.");
  return ogWithOriginalPages(() => {
    if (format === "pdf") {
      const svgs = []; for (let i = 0; i < w.pageCount; i++) svgs.push(w.renderPageSvg(i));
      return { svgs };
    }
    // 탭이 둘 이상이면 탭별 내용도 함께(Google 문서로 보낼 때 탭을 만든다)
    let tabs = null;
    const list = ogTabList();
    if (list.length > 1) tabs = list.map((t, k) => ({ name: t.name, html: ogDocumentHtml(w, { from: t.para, to: (k + 1 < list.length ? list[k + 1].para : w.getParagraphCount(0)) - 1 }) }));
    return { html: ogDocumentHtml(w), pageless: !!ogPL.active, tabs };
  });
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
function ogEnsureStyles() {
  const d = ogDoc(); if (!d) return false;
  let list; try { list = JSON.parse(d.getStyleList()); } catch { return false; }
  const byName = new Map(list.map((x) => [x.name, x.id]));
  const defaultFontId = d.findOrCreateFontId("맑은 고딕");
  const created = [];
  for (const st of OG_STYLES) {
    if (byName.has(st.name)) { ogStyleIds[st.key] = byName.get(st.name); continue; }
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
  const d = ogDoc(); if (!d || ogStyleIds.normal === undefined) return;
  try {
    if (d.getSectionCount() !== 1 || d.getParagraphCount(0) !== 1 || d.getParagraphLength(0, 0) !== 0) return;
    if (JSON.parse(d.getStyleAt(0, 0)).id !== 0) return;
    d.applyStyle(0, 0, ogStyleIds.normal);
    window.__ogolgyeStudio.canvasView?.refreshPages?.();
  } catch { /* 새 문서가 아니다 */ }
}
function ogApplyStyleKey(key) {
  const ih = window.__ogolgyeStudio?.inputHandler;
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
  try { const bus = window.__ogolgyeStudio.eventBus; bus.on("cursor-format-changed", ogUpdateStyleButton); bus.on("document-changed", ogUpdateStyleButton); } catch { /* 없음 */ }
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

function ogOnDocumentLoaded() {
  ogTab.active = 0;
  setTimeout(ogRenderTabs, 0);
  ogEnsureStyles();
  ogPrepareNewDocument();
  setTimeout(ogUpdateStyleButton, 0);
  ogPL.active = false; ogPL.orig = null; ogPL.view = null;
  const mark = ogReadMark();
  const pageless = mark ? mark === "페이지없음" : ogPL.defaultPageless;
  if (pageless) ogEnterPageless(); else ogLeavePageless();
}
function ogInstallTruePageless() {
  const og = window.__ogolgyeStudio, w = og && og.wasm;
  if (!w || w.__ogTrue) return !!w;
  w.__ogTrue = true;
  // 불러오기·새 문서
  for (const name of ["loadDocument", "loadDocumentWithPassword", "createNewDocument"]) {
    const f = w[name]; if (typeof f !== "function") continue;
    w[name] = function (...a) { const r = f.apply(this, a); setTimeout(ogOnDocumentLoaded, 0); return r; };
  }
  // 모든 파일 내보내기(저장·자동 저장 포함): 원래 용지로 잠깐 되돌리고 보기 방식을 적어 둔 뒤 내보낸다
  let depth = 0;
  const proto = Object.getPrototypeOf(w);
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (!/^export/.test(name) || /Selection|Control/.test(name) || typeof w[name] !== "function") continue;
    const f = w[name];
    w[name] = function (...a) {
      if (depth > 0) return f.apply(this, a);
      depth++;
      try { return ogWithOriginalPages(() => f.apply(this, a)); } finally { depth--; }
    };
  }
  // 편집 화면의 쪽 설정(여백·용지 크기)으로 글 폭이 바뀌어도 쪽 나눔이 깨지므로, 그 작업이 끝난 뒤 문서를 다시 배치한다
  const setDef = w.setPageDef;
  w.setPageDef = function (i, d) {
    const defs = []; defs[i] = d;                                    // 바꾸는 구역만(빈 칸은 건너뛴다)
    const reflow = !ogPL.busy && !!this.doc && ogWidthChanged(this.doc, defs);
    const r = setDef.apply(this, arguments);
    if (reflow) setTimeout(() => { if (ogRebuildLiveDoc()) ogRedraw(); }, 0);
    return r;
  };
  // 실행 취소 등으로 용지가 바뀌면: 원래 용지로 돌아온 경우는 다시 페이지 없음으로, 쪽 설정을 바꾼 경우는 그 설정을 원래 용지로 삼는다
  og.eventBus.on("document-changed", () => {
    if (!ogPL.active || ogPL.busy) return;
    let fix = false;
    for (let i = 0; i < ogSectionCount(); i++) {
      const cur = w.getPageDef(i);
      if (ogSameDef(cur, ogPL.view[i])) continue;
      if (!ogSameDef(cur, ogPL.orig[i])) ogPL.orig[i] = cur;
      fix = true;
    }
    if (fix) setTimeout(() => { if (ogPL.active) { ogPL.view = ogPL.orig.map(ogViewDef); ogSetDefs(ogPL.view); ogRedraw(); } }, 0);
  });
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
function ogInstallKeepRatio() {
  const ih = window.__ogolgyeStudio?.inputHandler;
  if (!ih || typeof ih.updatePictureResizeDrag !== "function" || ih.__ogKeepRatio) return !!ih?.__ogKeepRatio;
  const update = ih.updatePictureResizeDrag, finish = ih.finishPictureResizeDrag;
  ih.updatePictureResizeDrag = function (e) { return update.call(this, ogRatioEvent(this, e)); };
  ih.finishPictureResizeDrag = function (e) { return finish.call(this, ogRatioEvent(this, e)); };
  ih.__ogKeepRatio = true; return true;
}
addEventListener("message", (e) => {
  if (e.origin !== location.origin || !e.data) return;
  if (e.data.type === "ogolgye:view") ogApplyView(e.data);
  if (e.data.type === "ogolgye:host-resize") ogScheduleViewportResize(30);
});
(function ogWaitStudio() {
  if (!ogInstallPageless() || !ogInstallTruePageless()) { setTimeout(ogWaitStudio, 100); return; }
  ogInstallKeepRatio();
  ogInstallCursorGuard();
  for (const install of [ogInstallTabs, ogInstallAiTools, ogInstallStyleMenu]) ogWhenReady(install);
  const content = document.getElementById("scroll-content");
  if (content) new MutationObserver(ogQueueClip).observe(content, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
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

// 사용자 AI 도구 탭
const OG_AI_DEFAULTS = {
  openai: ["https://api.openai.com/v1/responses", "gpt-5.6-luna"],
  anthropic: ["https://api.anthropic.com/v1/messages", "claude-sonnet-4-6"],
  gemini: ["https://generativelanguage.googleapis.com/v1beta", "gemini-3.8-flash"],
  compatible: ["http://127.0.0.1:11434/v1/chat/completions", ""],
};
ogOptionTab("og-ai", "AI 도구",
      '<div class="dialog-section"><div class="dialog-section-title">글쓰기 도구 버튼</div><p class="opt-desc">등록한 도구는 문단 정렬 기능 오른쪽에 나타납니다. API 키는 운영체제 보안 저장소에 암호화되며 편집 화면이나 일반 설정 파일에 저장되지 않습니다.</p><div class="og-ai-config-list"></div><div class="dialog-row opt-row" style="gap:6px"><button type="button" class="dialog-btn" data-ai-new>새 도구</button><button type="button" class="dialog-btn" data-ai-delete>선택 도구 삭제</button></div></div>' +
      '<div class="dialog-section og-ai-config-grid"><label>버튼 이름</label><input data-ai-field="name" maxlength="30" placeholder="예: 문장 다듬기"><label>아이콘</label><input data-ai-field="icon" maxlength="4" placeholder="AI 또는 ✨"><label>색상</label><input data-ai-field="color" type="color" value="#6b7b3a"><label>AI 제공자</label><select data-ai-field="provider"><option value="openai">OpenAI</option><option value="anthropic">Claude (Anthropic)</option><option value="gemini">Gemini (Google)</option><option value="compatible">OpenAI 호환/로컬</option></select><label>모델</label><input data-ai-field="model" spellcheck="false"><label>API 주소</label><input data-ai-field="endpoint" spellcheck="false"><label>API 키</label><input data-ai-field="apiKey" type="password" spellcheck="false" placeholder="저장된 키를 유지하려면 비워 두세요"><label>기본 프롬프트</label><textarea data-ai-field="prompt" placeholder="{{text}}를 넣으면 그 자리에 선택한 글이 들어갑니다."></textarea><label>창 형태</label><select data-ai-field="view"><option value="float">플로팅 창</option><option value="side">사이드 창</option></select><label>사이드 위치</label><select data-ai-field="side"><option value="right">오른쪽</option><option value="left">왼쪽</option></select></div>' +
      '<div class="dialog-section"><div class="dialog-row opt-row" style="gap:8px"><button type="button" class="dialog-btn dialog-btn-primary" data-ai-save>도구 저장</button><span class="opt-desc" data-ai-status></span></div><p class="opt-desc">OpenAI 호환은 Chat Completions 형식의 주소를 사용합니다. localhost는 http도 허용하며 그 밖의 주소는 안전한 https만 허용합니다.</p></div>',
  (panel) => {
    const list = panel.querySelector(".og-ai-config-list"), status = panel.querySelector("[data-ai-status]"), field = (n) => panel.querySelector(`[data-ai-field="${n}"]`);
    let current = null;
    const blank = () => ({ id: "", name: "", icon: "AI", color: "#6b7b3a", provider: "openai", endpoint: OG_AI_DEFAULTS.openai[0], model: OG_AI_DEFAULTS.openai[1], prompt: "다음 글을 자연스럽고 정확하게 다듬어 주세요. 결과 문장만 출력하세요.", view: "float", side: "right" });
    const fill = (tool) => {
      current = tool?.id || null; const v = tool || blank();
      for (const n of ["name", "icon", "color", "provider", "endpoint", "model", "prompt", "view", "side"]) field(n).value = v[n] || "";
      field("apiKey").value = ""; field("apiKey").placeholder = tool?.hasKey ? "키가 안전하게 저장되어 있습니다" : "API 키 입력";
      list.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.id === current));
    };
    const draw = () => {
      list.replaceChildren();
      for (const tool of ogAiTools) { const b = document.createElement("button"); b.type = "button"; b.dataset.id = tool.id; b.textContent = `${tool.icon} ${tool.name}`; b.style.borderTopColor = tool.color; b.onclick = () => fill(tool); list.appendChild(b); }
      if (current && !ogAiTools.some((x) => x.id === current)) current = null;
      if (!current) fill(ogAiTools[0] || null); else fill(ogAiTools.find((x) => x.id === current));
    };
    const load = async () => { status.style.color = ""; status.textContent = "도구 목록을 확인하고 있습니다…"; const r = await ogAiRefresh(); if (!r.ok) { status.style.color = "#b3261e"; status.textContent = r.error; return; } status.textContent = ""; draw(); };
    panel.querySelector("[data-ai-new]").onclick = () => { current = null; fill(null); status.textContent = "새 도구 정보를 입력해 주세요."; };
    panel.querySelector("[data-ai-delete]").onclick = async () => {
      if (!current) { status.textContent = "삭제할 도구를 선택해 주세요."; return; }
      const t = ogAiTools.find((x) => x.id === current); if (!confirm(`“${t?.name || "이 도구"}”을(를) 삭제할까요?`)) return;
      const r = await ogAi("remove", { id: current }); if (!r.ok) { status.style.color = "#b3261e"; status.textContent = r.error; return; }
      ogAiTools = r.tools; current = null; ogRenderAiButtons(); draw(); status.textContent = "도구를 삭제했습니다.";
    };
    field("provider").addEventListener("change", () => { const [endpoint, model] = OG_AI_DEFAULTS[field("provider").value]; field("endpoint").value = endpoint; field("model").value = model; });
    field("view").addEventListener("change", () => { field("side").disabled = field("view").value !== "side"; });
    panel.querySelector("[data-ai-save]").onclick = async () => {
      const tool = { id: current || undefined };
      for (const n of ["name", "icon", "color", "provider", "endpoint", "model", "apiKey", "prompt", "view", "side"]) tool[n] = field(n).value;
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
  `<li><b>(선택) 7일 만료 없애기</b> — 테스트 상태의 외부 앱은 오프라인 연결도 7일 뒤 만료됩니다. ${ogLink("https://console.cloud.google.com/auth/audience", "대상")}에서 <b>앱 게시</b>를 눌러 프로덕션으로 바꾼 뒤 다시 연결합니다. 본인 또는 직접 아는 소수만 쓰는 개인용 앱은 미확인 경고와 100명 한도 안에서 검증 예외를 적용받을 수 있습니다. 불특정 사용자에게 배포하려면 <code>drive.readonly</code> 제한 범위에 대한 Google 검증이 필요합니다.</li>` +
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
      '<div class="md-item" data-ogolgye="pdf"><span class="md-icon"></span><span class="md-label">PDF 열기…</span></div>' +
      '<div class="md-item" data-ogolgye="doc"><span class="md-icon"></span><span class="md-label">문서 열기…</span></div>' +
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
