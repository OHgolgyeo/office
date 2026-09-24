// 편집 화면 안에서 도는 스크립트: 주 문서 편집 화면의 메뉴 줄에 "서브뷰" 메뉴를 넣고,
// 누르면 바깥 앱(오골계 워드)에 알린다. 서브뷰로 연 두 번째 문서에는 넣지 않는다.
// 테마색: 앱이 보내는 색을 적용한다(주·서브 편집 화면 모두)
// Studio 자체의 종료 차단은 바깥 앱의 저장 여부 관리와 겹치며 Electron 창을 닫지 못하게 한다.
// 이 스크립트는 Studio의 beforeunload보다 먼저 capture 단계에서 중복 차단을 끊는다.
addEventListener("beforeunload", (e) => e.stopImmediatePropagation(), true);

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
  if (e.data.type === "ogolgye:paste-content") {
    let handled = false, error = "";
    try {
      const target = document.activeElement?.matches?.('[aria-label="문서 편집 입력"]')
        ? document.activeElement : document.querySelector('[aria-label="문서 편집 입력"], textarea, [contenteditable="true"]');
      if (!target) throw new Error("문서 입력 위치를 찾지 못했습니다.");
      target.focus({ preventScroll: true });
      const data = new DataTransfer();
      data.setData("text/plain", String(e.data.text || ""));
      if (e.data.html) data.setData("text/html", String(e.data.html));
      const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      handled = event.defaultPrevented;
      if (!handled) error = "편집기가 붙여넣기 요청을 받지 않았습니다.";
    } catch (err) { error = String(err?.message || err); }
    parent.postMessage({ type: "ogolgye:paste-result", requestId: e.data.requestId, handled, error }, location.origin);
  }
});

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
  if (new URLSearchParams(location.search).get("ogolgye") !== "main") return;
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
  if (!installTheme()) { const mo = new MutationObserver(() => { if (installTheme()) mo.disconnect(); }); mo.observe(document.documentElement, { childList: true, subtree: true }); }
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
  if (!install()) {
    const mo = new MutationObserver(() => { if (install()) mo.disconnect(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
