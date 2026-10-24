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
    const flowParts = [];
    const tlHtml = (l, pid, join = "", blank = 0) => {
      const g = l.glyphs.find((q) => !/\s/.test(q.c)) || l.glyphs[0];
      const head = `<div class="tl" data-pid="${pid}" data-flow="${esc(l.group || "")}" data-join="${join}"${blank ? ` data-blank="${blank}"` : ""} data-w="${(l.x1 - l.x0).toFixed(2)}" style="left:${l.x0}pt;top:${l.oy - l.size * 0.88}pt;font-size:${l.size}pt;font-family:${esc(fontCss(g.font))}">`;
      // 낱말마다 원래 자리에 둔다: 줄 전체를 한 번에 늘이면(scaleX) 화면 글꼴과 PDF 글꼴의 글자 폭 차이·양쪽 정렬로 벌어진
      // 띄어쓰기가 줄 가운데로 갈수록 쌓여, 드래그할 때 마우스와 선택 위치가 어긋났다. 낱말(띄어쓰기로 나뉜 덩이)마다 시작 자리와
      // 폭을 주면 어긋남이 낱말 하나 안으로 줄어든다. 낱말 수가 글 줄과 맞지 않으면(문장부호 복구로 글이 바뀐 줄 등) 예전처럼 줄 통째로.
      const words = [];
      if (l.gaps && l.gaps.length === l.glyphs.length - 1) {
        let cur = null;
        l.glyphs.forEach((q, i) => {
          if (!cur || l.gaps[i - 1]?.isSp) { cur = { x0: q.x0, x1: q.x1 }; words.push(cur); }
          else cur.x1 = Math.max(cur.x1, q.x1);
        });
      }
      const texts = l.text.split(/[ \t]+/).filter(Boolean);
      if (words.length < 2 || texts.length !== words.length) return head + esc(l.text.replace(/\t/g, " ")) + "</div>";
      const inner = words.map((w, k) => `<span class="tw" data-w="${(w.x1 - w.x0).toFixed(2)}" style="left:${(w.x0 - l.x0).toFixed(2)}pt">${esc(texts[k])}</span>`).join(" ");
      return head + inner + "</div>";
    };
    const groupedLines = new Set();
    const lineBox = (l) => [l.x0, l.oy - l.size, l.x1, l.oy];
    const mergeBox = (a, b) => a ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] : b;
    // 복사할 때 PDF 에서 문단 사이가 한 줄 이상 비어 있던 곳에 빈 줄을 넣도록, 문단 첫 줄에 빈 줄 수(data-blank)를 둔다.
    // 문서화의 "빈 줄 살리기"(session.js blankLinesBetween)와 같은 잣대: 같은 단에서 줄 간격의 0.75배 넘게 더 벌어졌으면.
    // 본문 다음에 오는 제목 앞에도 빈 줄 하나(문서화와 같다). 제목 바로 뒤 본문은 PDF 에 빈 줄이 있을 때만 띄운다.
    let prevLast = null, prevHeading = null;
    const blanksBefore = (b) => {
      const a = prevLast;
      if (!a || b.x1 <= a.x0 || b.x0 >= a.x1) return 0;
      const pitch = Math.max(a.pitch || b.pitch || 0, Math.max(a.size, b.size) * 1.2);
      const extra = (b.oy - a.oy) / pitch - 1;
      return Number.isFinite(extra) && extra >= 0.75 ? Math.min(3, Math.round(extra)) : 0;
    };
    res.paragraphs.forEach((p, pid) => {
      const lines = p.lines.map((li, k) => ({ li, k, l: res.lines[li] })).filter(({ l }) => l.page === page.index && !l.rotated);
      if (!lines.length) return;
      const heading = !!opts.isHeading?.(pid);
      const blank = Math.max(prevHeading === false && heading ? 1 : 0, blanksBefore(lines[0].l));
      prevLast = lines.at(-1).l; prevHeading = heading;
      lines.forEach(({ li }) => groupedLines.add(li));
      // 한 문단이 왼쪽 단 끝에서 오른쪽 단 첫 줄로 이어질 수 있다. 브라우저의 기본 선택은
      // 절대 배치된 두 단을 하나의 상자로 취급해 반대 단까지 튀므로, 같은 단 흐름끼리 나눈다.
      let flow = null, inner = "", box = null;
      const flush = () => { if (inner) flowParts.push({ flow, box, html: `<div class="opara" data-pid="p${pid}">${inner}</div>` }); inner = ""; box = null; };
      lines.forEach(({ li, k, l }) => {
        const nextFlow = l.group || `line:${li}`;
        if (flow !== null && nextFlow !== flow) flush();
        flow = nextFlow;
        box = mergeBox(box, lineBox(l));
        inner += tlHtml(l, `p${pid}`, k < p.lines.length - 1 ? (res.joins[li]?.kind || "") : "", l === lines[0].l ? blank : 0);
      });
      flush();
    });
    res.lines.forEach((l, i) => { if (!groupedLines.has(i) && l.page === page.index && !l.rotated) flowParts.push({ flow: l.group || `line:${i}`, box: lineBox(l), html: tlHtml(l, `l${i}`) }); });
    res.furniture.forEach((l, i) => { if (l.page === page.index && !l.rotated) flowParts.push({ flow: l.group || `furniture:${i}`, box: lineBox(l), html: tlHtml(l, `f${i}`) }); });

    // 같은 구역 안에 단 번호가 둘 이상 있을 때만 드래그 경계를 켠다. 제목/표처럼 별도 흐름인
    // 요소까지 무조건 가두지 않아, 일반 문서의 여러 문단 선택과 Ctrl+A는 그대로 동작한다.
    const familyCols = new Map();
    for (const { flow } of flowParts) {
      const m = String(flow).match(/^(\d+):(\d+):(-?\d+(?:\.\d+)?):(-?\d+)/);
      if (!m) continue;
      const family = `${m[1]}:${m[2]}:${m[4]}`;
      if (!familyCols.has(family)) familyCols.set(family, new Set());
      familyCols.get(family).add(m[3]);
    }
    const multiColumnFlows = new Set();
    const flowBoxes = new Map();
    for (const { flow, box } of flowParts) flowBoxes.set(flow, mergeBox(flowBoxes.get(flow), box));
    const boxes = [...flowBoxes];
    for (let i = 0; i < boxes.length; i++) for (let k = i + 1; k < boxes.length; k++) {
      const [af, a] = boxes[i], [bf, b] = boxes[k];
      const horizontalGap = Math.max(b[0] - a[2], a[0] - b[2]);
      const verticalOverlap = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
      // 단 번호가 다르게 잡히지 않은 글상자·사이드바도 실제 좌표가 좌우로 나란하면 독립 선택 영역이다.
      // 제목 한 줄끼리 우연히 나란한 경우를 피하려고 세로로 4pt 이상 겹칠 때만 적용한다.
      if (horizontalGap > 3 && verticalOverlap > 4) { multiColumnFlows.add(af); multiColumnFlows.add(bf); }
    }
    const isMultiColumnFlow = (flow) => {
      const m = String(flow).match(/^(\d+):(\d+):(-?\d+(?:\.\d+)?):(-?\d+)/);
      return multiColumnFlows.has(flow) || (!!m && (familyCols.get(`${m[1]}:${m[2]}:${m[4]}`)?.size || 0) > 1);
    };
    // 같은 단의 제목·본문 사이에 다른 단의 문단이 끼어 검출된 경우에도 DOM에서는 한 덩이로 둔다.
    // 그렇지 않으면 같은 오른쪽 단을 위→아래로 드래그할 때 그 사이에 있던 왼쪽 글상자가 함께 선택된다.
    const flowHtml = new Map();
    for (const part of flowParts) {
      flowHtml.set(part.flow, (flowHtml.get(part.flow) || "") + part.html);
    }
    for (const [flow, html] of flowHtml) {
      const multi = isMultiColumnFlow(flow) ? " multicol" : "";
      textLayer += `<div class="oflow${multi}" data-flow="${esc(flow)}">${html}</div>`;
    }
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
