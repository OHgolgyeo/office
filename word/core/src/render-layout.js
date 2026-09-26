// 원본 보기의 투명 글자 층: 쪽 그림 위에 원래 줄 위치 그대로 투명한 글자를 겹쳐 드래그·복사·형광펜에 쓴다.
// 줄마다 복사할 때 쓸 문단 번호(data-pid)와 이음 방식(data-join)을 함께 싣는다.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// 글꼴 이름 → CSS. 원래 이름을 먼저 두고(컴퓨터에 있으면 그대로 쓰임) 명조/고딕 계열로 대체
function fontCss(name) {
  const base = (name || "").replace(/^[A-Z]{6}\+/, "").replace(/[-,](Bold|Regular|Medium|Light|SemiBold|ExtraBold|Italic|[a-z]{1,2}[A-Z][a-z]+).*$/, "");
  const spaced = base.replace(/([a-z])([A-Z])/g, "$1 $2");
  const serif = /myeong|batang|serif|book|명조|바탕|gowun|times|mincho/i.test(name || "");
  const list = [base, spaced].filter(Boolean).map((f) => `"${f}"`);
  list.push(serif ? '"Noto Serif KR","Noto Serif CJK KR","Nanum Myeongjo","Batang",serif' : '"Noto Sans KR","Noto Sans CJK KR","Nanum Gothic","Malgun Gothic",sans-serif');
  return list.join(",");
}

/** 쪽마다 { index, textLayer }. opts.pages 로 쪽 번호를 고를 수 있다. */
export function renderTextLayers(input, res, opts = {}) {
  const pages = [];
  for (const page of input.pages) {
    if (opts.pages && !opts.pages.includes(page.index)) continue;
    let textLayer = "";
    const tlHtml = (l, pid, join = "") => {
      const g = l.glyphs.find((q) => !/\s/.test(q.c)) || l.glyphs[0];
      return `<div class="tl" data-pid="${pid}" data-join="${join}" data-w="${(l.x1 - l.x0).toFixed(2)}" style="left:${l.x0}pt;top:${l.oy - l.size * 0.88}pt;font-size:${l.size}pt;font-family:${esc(fontCss(g.font))}">${esc(l.text.replace(/\t/g, " "))}</div>`;
    };
    const groupedLines = new Set();
    res.paragraphs.forEach((p, pid) => {
      const lines = p.lines.map((li, k) => ({ li, k, l: res.lines[li] })).filter(({ l }) => l.page === page.index && !l.rotated);
      if (!lines.length) return;
      lines.forEach(({ li }) => groupedLines.add(li));
      const inner = lines.map(({ li, k, l }) => tlHtml(l, `p${pid}`, k < p.lines.length - 1 ? (res.joins[li]?.kind || "") : "")).join("");
      textLayer += `<div class="opara" data-pid="p${pid}">${inner}</div>`;
    });
    res.lines.forEach((l, i) => { if (!groupedLines.has(i) && l.page === page.index && !l.rotated) textLayer += tlHtml(l, `l${i}`); });
    res.furniture.forEach((l, i) => { if (l.page === page.index && !l.rotated) textLayer += tlHtml(l, `f${i}`); });
    pages.push({ index: page.index, textLayer });
  }
  return pages;
}

/** 그림 속 글자의 투명 층. 그림은 원본 그대로 두고, 같은 위치·기울기로 투명한 글자를 겹친다. */
export function renderGraphicText(res, n) {
  return (res.graphics || []).filter((g) => g.page === n).map((g) => {
    // 화면 p = R(-a)·(q + t)  →  CSS: rotate(-a) translate(t)
    const tr = g.css || `rotate(${(-g.angle * 180 / Math.PI).toFixed(4)}deg) translate(${g.t[0].toFixed(2)}pt,${g.t[1].toFixed(2)}pt)`;
    const layer = renderTextLayers(g.input, g.res, { pages: [n] })[0]?.textLayer || "";
    return `<div class="gtext" data-g="${g.id}" style="transform:${tr}">${layer}</div>`;
  }).join("");
}
