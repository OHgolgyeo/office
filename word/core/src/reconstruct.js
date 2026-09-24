// PDF 글자(glyph) → 줄 → 단(column) → 문단 → 줄바꿈 이음새 판정.
// PDF 엔진과 무관하다. 입력은 extract-*.js 가 만든 { pages: [{width,height,glyphs}] }.
//
// 원칙(조건 3): 글자는 절대 바꾸지 않는다. 이 모듈이 결정하는 것은
//   (1) 줄 사이 이음새에 공백을 넣을지, (2) 줄 끝 하이픈을 뺄지, (3) 문단 경계
// 세 가지뿐이고, 모든 결정은 joins[] 에 근거와 확신도와 함께 기록된다.
// verifyIntegrity() 가 이를 기계적으로 검사한다.

// ───────── 문자 분류 ─────────
const isSpace = (c) => /\s/.test(c) || c === "\u00a0";
const isHangul = (c) => /[\uac00-\ud7a3\u3131-\u318e]/.test(c);
const isHanKana = (c) => /[\u4e00-\u9fff\u3040-\u30ff\u3400-\u4dbf]/.test(c);
const isLatin = (c) => /[A-Za-z\u00c0-\u024f]/.test(c);
const isLetter = (c) => isHangul(c) || isHanKana(c) || isLatin(c) || /\d/.test(c);
const HYPHENS = new Set(["-", "\u2010", "\u00ad"]);
const CLOSE_PUNCT = /^[.,!?;:…)\]}」』》〉”’"'%·]/;
const END_PUNCT = /[.,!?;:…)\]}」』》〉”’"'·]$/;
const EDGE_PUNCT = /^[\s"'“”‘’()[\]{}「」『』《》〈〉.,!?;:…·]+|[\s"'“”‘’()[\]{}「」『』《》〈〉.,!?;:…·]+$/g;
const SYMBOL_FONT = /(symbol|ding|wing|zapf|zymbol|webding|marlett)/i;
const BULLET_CHARS = /^[•◦▪■□●○◆◇▶▷※]$/;
const BULLET = /^([•◦▪■□●○◆◇▶▷※\-–—*]|\d{1,3}[.)]|[①-⑳]|[가-하][.)]|\(\d{1,3}\)|[A-Za-z][.)])$/;

// 뒤에 붙기만 하고 단독 어절로는 거의 쓰이지 않는 조사
const PARTICLES = ["에서부터", "으로부터", "에게서", "으로서", "으로써", "에서", "에게", "까지", "부터", "처럼",
  "보다", "께서", "으로", "하고", "마다", "조차", "밖에", "이나", "이라", "을", "를", "은", "는", "의", "에", "와", "과", "로", "만", "도"];
// 어절 끝에 오는 두 글자 이상 조사·어미 (단어 중간에 올 일이 드문 것만)
const ENDINGS_STRONG = ["에서부터", "으로부터", "에게서", "부터", "까지", "에서", "에게", "처럼", "보다", "으로",
  "께서", "면서", "지만", "는데", "도록", "하여", "해서", "하고", "이며", "였고", "했고", "었고", "았고", "라는", "이라"];
const STRONG_PARTICLE_TOKENS = new Set(["을", "를", "는", "은", "의", "에", "와", "과", "로", "으로", "에서", "에게", "까지", "부터", "처럼", "께서"]);

const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))]; };
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

export const DEFAULTS = {
  flagBelow: 0.8,        // 이 확신도 미만 이음새는 사용자 확인 대상으로 표시
  wrapMode: "auto",      // "auto" | "char"(글자 단위 줄바꿈) | "word"(어절 단위 줄바꿈)
  dropFurniture: true,   // 머리글/꼬리글/쪽번호를 본문에서 분리
  sentenceEndDoubt: true, // 문장이 줄 끝에서 끝나는 곳을 "새 문단일 수도 있음"으로 표시
};

/**
 * @returns {{
 *   paragraphs: {role, lines:number[], text:string, page:number}[],
 *   joins: {between:[number,number], kind, conf, flagged, reasons:string[]}[],
 *   lines: Line[], furniture: Line[], stats: object
 * }}
 */
export function reconstruct(input, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  let glyphId = 0;
  const allLines = [];
  // 이미지·그래픽 속 글자는 변환하지 않는다(변환 보기에서도 원본 그대로 보인다):
  //  - 보이지 않는 글자 층(스캔본 위 검색용 글자)
  //  - 기울어지거나 회전한 글자(기울어진 지도 카드, 세로 표제 같은 그래픽의 일부)
  const tilt = (g) => { const a = (((g.angle || 0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); return a > 0.02 && a < 2 * Math.PI - 0.02; };
  const graphicText = (g) => g.invisible || tilt(g);
  let imageTextChars = 0;
  for (const page of input.pages) {
    if (page.imageText) continue;                     // 이미 나눴다(같은 입력으로 두 번 부른 경우)
    page.imageText = page.glyphs.filter(graphicText);
    if (page.imageText.length) page.glyphs = page.glyphs.filter((g) => !graphicText(g));
  }
  for (const page of input.pages) imageTextChars += page.imageText.filter((g) => !isSpace(g.c)).length;
  for (const page of input.pages) {
    for (const g of page.glyphs) g.id = glyphId++;
    allLines.push(...buildPageLines(page));
  }
  const bodySize = median(allLines.flatMap((l) => l.glyphs.map((g) => g.size)));

  // 머리글·꼬리글·쪽번호
  const furniture = [];
  const lines = [];
  for (const l of allLines) (o.dropFurniture && isFurniture(l, input.pages, allLines, bodySize) ? furniture : lines).push(l);
  lines.forEach((l, i) => (l.idx = i));

  // 단(그룹)별 왼쪽/오른쪽 끝, 줄 간격
  const groups = new Map();
  for (const l of lines) { if (!groups.has(l.group)) groups.set(l.group, []); groups.get(l.group).push(l); }
  for (const [, gl] of groups) {
    const body = gl.filter((l) => Math.abs(l.size - bodySize) < bodySize * 0.12);
    const ref = body.length ? body : gl;
    const L = pct(ref.map((l) => l.x0), 0.1);
    // 오른쪽 끝: 여러 줄이 같은 위치에서 끝나면(양쪽 정렬) 그 위치, 아니면 가장 긴 줄
    // (문장부호 내어쓰기로 살짝 튀어나온 줄에 끌려가지 않도록)
    const tolR = bodySize * 0.12;
    let bestX = 0, bestN = 0;
    for (const l of ref) {
      const n = ref.filter((m) => Math.abs(m.x1 - l.x1) <= tolR).length;
      if (n > bestN || (n === bestN && l.x1 > bestX)) { bestN = n; bestX = l.x1; }
    }
    const cluster = ref.filter((m) => Math.abs(m.x1 - bestX) <= tolR).map((m) => m.x1);
    // 진짜 양쪽 정렬이면 "끝에 거의 닿았지만 조금 모자란 줄"이 없어야 한다.
    // (왼쪽 정렬 + 고정폭 한글은 우연히 같은 위치에서 끝나는 줄이 많지만, 모자란 줄도 많다)
    const nearMiss = ref.filter((m) => bestX - m.x1 > tolR && bestX - m.x1 < m.size * 1.2).length;
    const justifiedByEdge = ref.length >= 4 && bestN / ref.length >= 0.4 && bestN >= 3
      && nearMiss <= Math.max(1, ref.length * 0.1);
    const R = justifiedByEdge ? Math.max(...cluster) : Math.max(...ref.map((l) => l.x1));
    const pitches = [];
    for (let i = 1; i < ref.length; i++) {
      const d = ref[i].oy - ref[i - 1].oy;
      if (d > 0 && Math.abs(ref[i].size - ref[i - 1].size) < 0.5) pitches.push(d);
    }
    const justified = justifiedByEdge;
    // 이 단의 글머리 목록 내어쓰기 위치(기호 뒤 본문 시작점의 대푯값)
    const hangs = gl.filter((l) => l.contentStart - l.x0 > 0.5 && l.contentStart - l.x0 < l.size * 3).map((l) => l.contentStart);
    const hang = hangs.length ? median(hangs) : null;
    const tableGroup = gl.filter((l) => l.cells).length >= 2;
    if (tableGroup) {
      const numRight = median(gl.filter((l) => l.cells).map((l) => l.x1));
      for (const l of gl) {
        if (l.cells) continue;
        const m = l.text.match(/ (\d{1,4})$/);
        if (!m || Math.abs(l.x1 - numRight) > l.size * 0.6) continue;
        const at = l.text.length - m[1].length;
        const gp = l.gaps.find((g) => g.at === at);
        if (!gp) continue;
        gp.cell = true;
        l.cells = [l.text.slice(0, at - 1), m[1]];
        l.text = l.cells.join("\t");
      }
    }
    for (const l of gl) {
      l.tableGroup = tableGroup;
      l.L = L; l.R = R; l.pitch = pitches.length ? pct(pitches, 0.3) : l.size * 1.5; l.justified = justified; l.hang = hang;
      // 양쪽 정렬 단의 줄 안에 글자 1.8개 이상 빈 곳 = 텍스트층에 없는 글자 의심
      l.suspectGaps = justified && !l.cells && Math.abs(l.size - bodySize) < bodySize * 0.12
        ? l.gaps.filter((g) => {
            // 양쪽 정렬로 넓어진 어절 간격과 구별: 같은 줄의 다른 띄어쓰기보다 훨씬 넓어야 한다
            const others = l.gaps.filter((h) => h !== g && h.isSp).map((h) => h.gap);
            return g.gap - l.tracking > l.size * 1.8 && others.length >= 2 && g.gap > median(others) * 2.5;
          }).map((g) => g.at) : [];
      const isBulletLine = l.symbolBullet || BULLET_CHARS.test(l.glyphs[0].c) || BULLET.test(l.text.split(" ")[0]);
      const bulletLines = gl.filter((q) => q.symbolBullet || BULLET_CHARS.test(q.glyphs[0].c) || BULLET.test(q.text.split(" ")[0])).length;
      if (isBulletLine && bulletLines >= 2 && l.x0 - L < l.size * 2 && hang !== null && l.contentStart - hang > l.size * 1.2 && !l.suspectGaps.length) l.suspectGaps.push(l.text.indexOf(l.text.split(" ")[0]) + 1);
    }
  }

  const spaceW = estimateSpaceWidth(lines, bodySize);
  for (const l of lines) l.natEnd = naturalEnd(l, spaceW);

  // 문서 안 어휘 사전: 줄 "안"에서만 만든다(줄바꿈 판단과 독립이어야 하므로)
  const dict = buildDictionary(lines);

  // ── 1차: 구조적 문단 경계 + 여유폭(slack) 수집 → 줄바꿈 방식 추정
  const pairs = [];
  for (let i = 1; i < lines.length; i++) pairs.push(analyzePair(lines[i - 1], lines[i], lines[i + 1], bodySize, spaceW, lines[i - 2]));
  let mode = o.wrapMode;
  let modeEvidence = null;
  if (mode === "auto") {
    const cand = pairs.filter((p) => !p.structuralBreak && p.firstCharW > 0);
    const tol = (p) => p.prev.size * 0.1;
    // 글자 단위라면 다음 글자가 들어갔어야 하는데(=문단 끝이어야 하는데) 문장이 안 끝난 줄
    const wordOnly = cand.filter((p) => p.slack >= p.firstCharW + spaceW + tol(p)
      && p.slack < p.firstTokW + spaceW + tol(p) && !END_PUNCT.test(p.prev.text)).length;
    const roomy = cand.filter((p) => p.slack >= p.firstCharW * 0.95).length;
    const ratio = cand.length ? roomy / cand.length : 0;
    const midWord = cand.filter((p) => {
      const B = firstToken(p.cur).replace(EDGE_PUNCT, "");
      return STRONG_PARTICLE_TOKENS.has(B) || /^(니다|습니다|었다|였다|했다|이다|하다|된다|한다)/.test(B)
        || /^[\uac00-\ud7a3][.,!?]/.test(firstToken(p.cur));
    }).length;
    if (midWord >= 2 && midWord >= cand.length * 0.04) mode = "char";
    else mode = (wordOnly >= 2 && wordOnly >= cand.length * 0.08) || ratio > 0.45 ? "word" : "char";
    modeEvidence = { candidates: cand.length, midWordBreaks: midWord, wordOnlyBreaks: wordOnly, roomyRatio: +ratio.toFixed(3) };
  }
  const spaceRatio = dict.spaceRatio; // 줄 안 글자 대비 공백 비율 → 글자 단위 문서의 사전확률

  // 이 문서는 문단을 들여쓰기로 나누는가, 줄 간격으로 나누는가
  const nIndent = pairs.filter((p) => p.structuralBreak === "첫 줄 들여쓰기").length;
  const nGap = pairs.filter((p) => p.structuralBreak === "줄 간격 벌어짐").length;
  o._paraStyle = nIndent >= 2 && nIndent > nGap * 2 ? "indent" : nGap >= 2 ? "gap" : "unknown";

  // ── 2차: 각 이음새 판정
  const joins = pairs.map((p) => decideJoin(p, mode, spaceW, dict, spaceRatio, o));

  if (o.spacer && mode === "char") refineWithSpacer(joins, lines, dict, o);

  // ── 문단 조립
  const paragraphs = [];
  let cur = null;
  const dropped = new Set();
  lines.forEach((l, i) => {
    const j = i > 0 ? joins[i - 1] : null;
    if (!cur || j.kind === "para") {
      cur = { role: l.size > bodySize * 1.15 ? "heading" : "body", lines: [i], page: l.page, text: l.text, cell: l.cell || undefined, highlight: l.highlight || undefined };
      paragraphs.push(cur);
      return;
    }
    cur.lines.push(i);
    if (j.kind === "hyphen-drop") { cur.text = cur.text.slice(0, -1); dropped.add(lines[i - 1].glyphs.at(-1).id); }
    cur.text += (j.kind === "space" ? " " : "") + l.text;
  });

  for (const para of paragraphs) para.layout = paragraphLayout(para.lines.map((i) => lines[i]));

  // 그림: 배경·재단선 밖·글자 바탕(상자)이 아닌 이미지를 읽기 순서 속 위치와 함께
  const figures = [];
  for (const page of input.pages) {
    const regs = page._regions || [];
    for (const im of page.images || []) {
      if (im.background) continue;
      const b = [Math.max(0, im.bbox[0]), Math.max(0, im.bbox[1]), Math.min(page.width, im.bbox[2]), Math.min(page.height, im.bbox[3])];
      if (b[2] - b[0] < 5 || b[3] - b[1] < 5) continue;
      const reg = regs.find((r) => r.id === im.id);
      const kind = reg?.kind === "panel" ? "panel-background" : "figure";
      // 같은 쪽에서 그림 위쪽보다 아래에 있고 그림과 가로로 겹치는 첫 문단 앞에 놓는다
      let before = paragraphs.findIndex((p) => {
        const l = lines[p.lines[0]];
        return l.page === page.index && l.oy - l.size > b[1] && l.x1 > b[0] && l.x0 < b[2];
      });
      if (before < 0) { const last = paragraphs.map((p, k) => [p, k]).filter(([p]) => p.page === page.index).at(-1); before = last ? last[1] + 1 : paragraphs.length; }
      figures.push({ id: im.id, page: page.index, bbox: b, px: im.px, kind, beforeParagraph: before, file: im.file || null });
    }
  }

  const result = {
    paragraphs, joins, lines, furniture, figures,
    stats: {
      pages: input.pages.length, lines: lines.length, bodySize: +bodySize.toFixed(2),
      spaceWidth: +spaceW.toFixed(2), wrapMode: mode, modeEvidence, paragraphStyle: o._paraStyle,
      flagged: joins.filter((j) => j.flagged).length,
      missingSuspects: joins.filter((j) => j.missing).length + lines.reduce((n, l) => n + (l.suspectGaps?.length || 0), 0),
      unreadableChars: input.pages.reduce((n, p) => n + p.glyphs.filter((g) => g.unreadable).length, 0),
      rotatedLines: lines.filter((l) => l.rotated).length,
      imageTextChars,
      italicChars: input.pages.reduce((n, p) => n + p.glyphs.filter((g) => g.italic && !isSpace(g.c)).length, 0),
      unicodeErrors: input.pages.reduce((n, p) => n + p.glyphs.filter((g) => g.unicodeError).length, 0),
    },
    _dropped: dropped,
  };
  // 그림 속 글자(기울어진·회전한·보이지 않는 글자): 본문과 따로, 기울기를 되돌린 좌표에서 똑같이 복원한다.
  // 화면에서는 그림을 원본 그대로 두고 이 결과를 투명한 글자 층으로 겹친다(드래그·복사용).
  if (!o._sub) result.graphics = buildGraphicText(input, o);
  return result;
}

function buildGraphicText(input, o) {
  const out = [];
  const norm = (a) => { let x = ((a || 0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); if (x > Math.PI) x -= 2 * Math.PI; return x; };
  for (const page of input.pages) {
    const gl = (page.imageText || []).filter((g) => !(isSpace(g.c) && g.generated));
    if (!gl.length) continue;
    // 같은 기울기(0.01 라디안 단위)·같은 종류(보이는/보이지 않는)끼리 묶는다
    const clusters = new Map();
    for (const g of gl) {
      const key = (g.invisible ? "i" : "v") + Math.round(norm(g.angle) * 100);
      if (!clusters.has(key)) clusters.set(key, []);
      clusters.get(key).push(g);
    }
    for (const gs of clusters.values()) {
      const a = median(gs.map((g) => norm(g.angle)));
      const c = Math.cos(a), sn = Math.sin(a);
      // 화면 좌표 p 를 기울기를 되돌린 좌표 q = R(a)·p 로(글자 진행 방향이 가로가 되도록)
      const toQ = (x, y) => [x * c - y * sn, x * sn + y * c];
      const tmp = gs.map((g) => {
        const [qx, qy] = toQ(g.ox, g.oy);
        // 기울어진 글자 상자(가로세로로 둘러싼 상자)에서 글자 폭을 되돌려 구한다
        const bw = g.x1 - g.x0, bh = g.y1 - g.y0, ac = Math.abs(c), as = Math.abs(sn), det = ac * ac - as * as;
        let w = Math.abs(det) > 0.3 ? (ac * bw - as * bh) / det : (bw + bh) / (2 * (ac + as));
        if (!(w > 0)) w = g.size * 0.5;
        return { g, qx, qy, w };
      });
      const minx = Math.min(...tmp.map((t) => t.qx)) - 20, miny = Math.min(...tmp.map((t) => t.qy - t.g.size)) - 20;
      const glyphs = tmp.map(({ g, qx, qy, w }) => ({
        ...g, ox: qx - minx, oy: qy - miny, x0: qx - minx, x1: qx - minx + w,
        y0: qy - miny - g.size * 0.85, y1: qy - miny + g.size * 0.2, angle: 0, invisible: false, italic: false, rawBox: null,
      }));
      const fake = { index: page.index, width: Math.max(...glyphs.map((g) => g.x1)) + 40, height: Math.max(...glyphs.map((g) => g.y1)) + 40, glyphs, images: [], paths: [] };
      const sub = reconstruct({ pages: [fake] }, { ...o, _sub: true, dropFurniture: false });
      out.push({ id: out.length, page: page.index, angle: a, t: [minx, miny], invisible: !!gs[0].invisible, input: { pages: [fake] }, res: sub });
    }
  }
  return out;
}

// ───────── 쪽 안 이미지·도형 영역 ─────────
// panel: 글자가 위에 얹힌 바탕(사이드바 상자) → 별도 흐름
// figure: 글이 피해서 흐르는 그림 → 주변 줄 길이가 짧아도 문단 끝 아님
function pageRegions(page) {
  const W = page.width, H = page.height;
  const regions = [];
  const cands = [
    ...(page.images || []).filter((im) => !im.background).map((im) => ({ bbox: im.bbox, id: im.id, kind: "image" })),
    ...(page.paths || []).filter((p) => (p.bbox[2] - p.bbox[0]) * (p.bbox[3] - p.bbox[1]) > W * H * 0.05 && !(page._tables || detectTables(page)).some((t) => inBox([t.bbox[0] - 3, t.bbox[1] - 3, t.bbox[2] + 3, t.bbox[3] + 3], (p.bbox[0] + p.bbox[2]) / 2, (p.bbox[1] + p.bbox[3]) / 2))).map((p, k) => ({ bbox: p.bbox, id: `p${page.index}-path${k}`, kind: "path" })),
  ];
  for (const c of cands) {
    const [x0, y0, x1, y1] = [Math.max(0, c.bbox[0]), Math.max(0, c.bbox[1]), Math.min(W, c.bbox[2]), Math.min(H, c.bbox[3])];
    if (x1 - x0 < 5 || y1 - y0 < 5) continue;                       // 재단선 밖이거나 선 하나
    let ink = 0;
    for (const g of page.glyphs) {
      if (isSpace(g.c)) continue;
      const cx = (g.x0 + g.x1) / 2, cy = (g.y0 + g.y1) / 2;
      if (cx > x0 && cx < x1 && cy > y0 && cy < y1) ink += (g.x1 - g.x0) * (g.y1 - g.y0);
    }
    const cover = ink / ((x1 - x0) * (y1 - y0));
    // 쪽 전체를 감싸는 테두리는 흐름을 나누지 않는다
    if ((x1 - x0) * (y1 - y0) > W * H * 0.8) continue;
    regions.push({ id: c.id, bbox: [x0, y0, x1, y1], kind: cover >= 0.28 ? "panel" : "figure", cover: +cover.toFixed(3) });
  }
  return regions;
}
const inBox = (b, x, y) => x > b[0] && x < b[2] && y > b[1] && y < b[3];

// ───────── 선으로 그은 표(격자 표) ─────────
// PDF의 선·사각형에서 세로선/가로선을 모아 표 영역과 칸을 만든다.
// 칸 = 가로선 사이 띠(행) × 그 띠를 실제로 지나는 세로선 사이(병합된 칸은 세로선이 없으므로 자연히 합쳐짐)
function detectTables(page) {
  const V = [], Hs = [];
  const inkAll = page.glyphs.filter((g) => !isSpace(g.c));
  page._highlights = [];
  for (const p of page.paths || []) {
    const [x0, y0, x1, y1] = p.bbox, w = x1 - x0, h = y1 - y0;
    // 글자 배경색(형광펜·음영): 높이가 한 줄 정도이고 안에 글자가 딱 한 줄만 있는 사각형 → 표의 선이 아니다
    if (w > 8 && h > 3) {
      const inside = inkAll.filter((g) => { const cx = (g.x0 + g.x1) / 2, cy = (g.y0 + g.y1) / 2; return cx > x0 && cx < x1 && cy > y0 && cy < y1; });
      if (inside.length) {
        const sz = median(inside.map((g) => g.size));
        const oys = inside.map((g) => g.oy);
        if (h <= sz * 2.0 && Math.max(...oys) - Math.min(...oys) < sz * 0.5) { page._highlights.push([x0, y0, x1, y1]); continue; }
      }
    }
    if (w <= 3 && h >= 8) V.push({ x: (x0 + x1) / 2, y0, y1 });
    else if (h <= 3 && w >= 8) Hs.push({ y: (y0 + y1) / 2, x0, x1 });
    else if (w > 8 && h > 8 && w < page.width * 0.95 && h < page.height * 0.95) {     // 사각형 테두리 → 네 변
      V.push({ x: x0, y0, y1 }, { x: x1, y0, y1 }); Hs.push({ y: y0, x0, x1 }, { y: y1, x0, x1 });
    }
  }
  if (V.length < 3) return [];
  // 서로 닿는 선끼리 묶기
  const segs = [...V.map((v) => ({ b: [v.x - 1, v.y0 - 1, v.x + 1, v.y1 + 1], v })), ...Hs.map((h) => ({ b: [h.x0 - 1, h.y - 1, h.x1 + 1, h.y + 1], h }))];
  const parent = segs.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const touch = (a, b) => a[0] <= b[2] + 2 && b[0] <= a[2] + 2 && a[1] <= b[3] + 2 && b[1] <= a[3] + 2;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (touch(segs[i].b, segs[j].b)) parent[find(i)] = find(j);
  const comps = new Map();
  segs.forEach((sg, i) => { const r = find(i); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(sg); });
  const ink = page.glyphs.filter((g) => !isSpace(g.c));
  const tables = [];
  for (const cs of comps.values()) {
    const vs = cs.filter((c) => c.v).map((c) => c.v), hs = cs.filter((c) => c.h).map((c) => c.h);
    const bx0 = Math.min(...cs.map((c) => c.b[0])), by0 = Math.min(...cs.map((c) => c.b[1])), bx1 = Math.max(...cs.map((c) => c.b[2])), by1 = Math.max(...cs.map((c) => c.b[3]));
    const uniqX = [...new Set(vs.map((v) => Math.round(v.x)))].sort((a, b) => a - b).filter((x, k, a) => k === 0 || x - a[k - 1] > 3);
    if (uniqX.length < 3) continue;                                  // 칸이 2개 이상은 되어야 표
    const inside = ink.filter((g) => { const cx = (g.x0 + g.x1) / 2, cy = (g.y0 + g.y1) / 2; return cx > bx0 && cx < bx1 && cy > by0 && cy < by1; });
    if (inside.length < 4) continue;
    // 표 높이 안의 글자가 표 밖으로 많이 삐져나오면 표가 아니라 장식(라벨 상자 등)
    const spill = ink.filter((g) => { const cy = (g.y0 + g.y1) / 2; const cx = (g.x0 + g.x1) / 2; return cy > by0 && cy < by1 && (cx < bx0 - 2 || cx > bx1 + 2) && cx > bx0 - 40 && cx < bx1 + 40; });
    if (spill.length > inside.length * 0.1) continue;
    const ys = [...new Set([by0 + 1, by1 - 1, ...hs.map((h) => h.y)].map((y) => Math.round(y)))].sort((a, b) => a - b).filter((y, k, a) => k === 0 || y - a[k - 1] > 3);
    const rows = [];
    for (let r = 0; r < ys.length - 1; r++) {
      const mid = (ys[r] + ys[r + 1]) / 2;
      const cuts = uniqX.filter((x) => vs.some((v) => Math.abs(v.x - x) < 3 && v.y0 <= mid + 1 && v.y1 >= mid - 1));
      const xs = [...new Set([Math.round(bx0 + 1), ...cuts, Math.round(bx1 - 1)])].sort((a, b) => a - b).filter((x, k, a) => k === 0 || x - a[k - 1] > 3);
      rows.push({ y0: ys[r], y1: ys[r + 1], cells: xs.slice(0, -1).map((x, c) => ({ x0: x, x1: xs[c + 1] })) });
    }
    tables.push({ id: tables.length, bbox: [bx0, by0, bx1, by1], rows });
  }
  return tables;
}
function cellOf(tables, g) {
  const cx = (g.x0 + g.x1) / 2, cy = (g.y0 + g.y1) / 2;
  for (const t of tables) {
    if (!inBox(t.bbox, cx, cy)) continue;
    for (let r = 0; r < t.rows.length; r++) {
      const row = t.rows[r];
      if (cy < row.y0 || cy > row.y1) continue;
      for (let c = 0; c < row.cells.length; c++) if (cx >= row.cells[c].x0 && cx <= row.cells[c].x1) return { t: t.id, r, c, id: `T${t.id}r${r}c${c}` };
    }
  }
  return null;
}

// ───────── 줄 만들기 + 다단 분리 ─────────
function buildPageLines(page) {
  const regions = pageRegions(page);
  page._regions = regions;
  const panels = regions.filter((r) => r.kind === "panel");
  const upright = (g) => { const a = ((g.angle || 0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); return a < 0.3 || a > 2 * Math.PI - 0.3; };
  const gs = page.glyphs.filter(upright);
  const rotated = page.glyphs.filter((g) => !upright(g));   // 공백 글자도 함께(띄어쓰기 판단용)
  const ink = gs.filter((g) => !isSpace(g.c));
  const spaceGlyphs = gs.filter((g) => isSpace(g.c));

  // 1) 베이스라인으로 행(row) 묶기
  ink.sort((a, b) => a.oy - b.oy || a.x0 - b.x0);
  const tables = detectTables(page);
  page._tables = tables;
  for (const g of ink) g._cell = tables.length ? cellOf(tables, g) : null;
  const tableInk = ink.filter((g) => g._cell);
  const panelOf = (g) => { const cx = (g.x0 + g.x1) / 2, cy = (g.y0 + g.y1) / 2; const i = panels.findIndex((p) => inBox(p.bbox, cx, cy)); return i; };
  for (const g of ink) g._panel = panelOf(g);
  const rows = [];
  for (const g of ink.filter((g) => !g._cell)) {
    const r = rows.at(-1);
    if (r && Math.abs(g.oy - r.oy) <= Math.min(g.size, r.size) * 0.3) r.gs.push(g);
    else rows.push({ oy: g.oy, size: g.size, gs: [g] });
  }
  for (const r of rows) r.gs.sort((a, b) => a.x0 - b.x0);

  // 상자(사이드바) 안과 밖은 단 구조가 다를 수 있으므로 흐름마다 따로 단을 나눈다.
  // 상자 밖(본문) 흐름을 먼저, 상자들은 위치 순서대로 그 뒤에 둔다.
  const ordered = [];
  let section = 0;
  const flowIds = [...new Set(rows.flatMap((r) => r.gs.map((g) => g._panel)))].sort((a, b) =>
    (a === -1 ? -1 : b === -1 ? 1 : panels[a].bbox[1] - panels[b].bbox[1] || panels[a].bbox[0] - panels[b].bbox[0]));
  for (const pid of flowIds) {
    const rowsP = rows.map((r) => ({ oy: r.oy, size: r.size, gs: r.gs.filter((g) => g._panel === pid) })).filter((r) => r.gs.length);
    flow(rowsP, pid);
  }

  function flow(rows, pid) {
  // 1-1) 번호 열(목차 쪽 번호, 표의 숫자 칸): 오른쪽 끝이 한 세로선에 맞춰 정렬된 숫자 덩어리들.
    //      먼저 떼어 두고 나머지 글자로 단을 나눈 뒤, 같은 행의 칸으로 다시 붙인다.
    const numCells = takeNumberColumns(rows);
    for (let k = rows.length - 1; k >= 0; k--) if (!rows[k].gs.length) rows.splice(k, 1);

    // 2) 단 사이 여백(gutter) 찾기: 대부분의 행이 비어 있는 세로 띠
    const gutters = findGutters(rows, page.width, page.height);
    const flowBody = median(rows.map((r) => r.size));
    // 흐름의 가로 범위(떼어 둔 번호 칸까지 포함해야 가운데를 제대로 잡는다)
    const flowSpan = [Math.min(...rows.map((r) => r.gs[0].x0), ...numCells.map((c) => c.gs[0].x0)),
      Math.max(...rows.map((r) => r.gs.at(-1).x1), ...numCells.map((c) => c.gs.at(-1).x1))];

    // 3) 행을 단 경계에서 자르고, 단을 가로지르는 행(제목 등)은 통째로 둔다
    const segs = [];
    for (const r of rows) {
      if (!gutters.length) { segs.push({ gs: r.gs, col: 0, oy: r.oy }); continue; }
      const covered = gutters.map((gt) => rowCovers(r, gt, flowBody, flowSpan));
      if (covered.every(Boolean)) { segs.push({ gs: r.gs, col: -1, oy: r.oy }); continue; }
      // 건너지 않는 경계에서만 자른다. 조각의 단 번호는 조각이 시작하는 단
      const cuts = gutters.map((gt) => gt[2] ?? (gt[0] + gt[1]) / 2);
      let c = 0, part = [], startCol = 0;
      const colOf = (x) => cuts.filter((v) => x >= v).length;
      for (const g of r.gs) {
        const gc = colOf((g.x0 + g.x1) / 2);
        if (part.length && gc !== c) {
          // c → gc 사이의 경계 중 하나라도 건너지 않았다면 자른다
          const crossedAll = covered.slice(c, gc).every(Boolean);
          if (!crossedAll) { segs.push({ gs: part, col: startCol, oy: r.oy }); part = []; startCol = gc; }
        }
        if (!part.length) startCol = gc;
        part.push(g); c = gc;
      }
      if (part.length) segs.push({ gs: part, col: startCol, oy: r.oy });
    }

    // 3-0) 표가 있는 쪽: 표의 왼쪽 가장자리를 사이에 두고 양쪽에 걸친 줄은 거기서 자른다
    for (const t of page._tables || []) {
      const edge = t.bbox[0];
      for (let k = segs.length - 1; k >= 0; k--) {
        const sg = segs[k];
        if (sg.oy < t.bbox[1] - 80 || sg.oy > t.bbox[3]) continue;
        const L = sg.gs.filter((g) => g.x1 <= edge + 1), Rr = sg.gs.filter((g) => g.x1 > edge + 1);
        if (!L.length || !Rr.length || Rr[0].x0 - L.at(-1).x1 < L[0].size) continue;
        segs.splice(k, 1, { ...sg, gs: L }, { ...sg, gs: Rr, col: sg.col + 0.5 });
      }
    }
    // 3-1) 상자 안/밖이 한 조각에 섞였으면 나눈다
    for (let k = segs.length - 1; k >= 0; k--) {
      const sgm = segs[k];
      const ids = [...new Set(sgm.gs.map((g) => g._panel))];
      if (ids.length > 1) segs.splice(k, 1, ...ids.map((id) => ({ ...sgm, gs: sgm.gs.filter((g) => g._panel === id) })));
    }
    for (const sgm of segs) sgm.panel = sgm.gs[0]._panel;

    // 3-1b) 떼어 둔 숫자 칸을 같은 행, 바로 왼쪽 조각에 칸으로 붙인다
    for (const nc of numCells) {
      const host = segs.filter((x) => Math.abs(x.oy - nc.oy) < nc.size * 0.35 && x.gs.at(-1).x1 <= nc.gs[0].x0 + 1)
        .sort((a, b) => b.gs.at(-1).x1 - a.gs.at(-1).x1)[0];
      if (host && !host.cells) { host.cells = [host.gs, nc.gs]; host.gs = [...host.gs, ...nc.gs]; }
      else segs.push({ gs: nc.gs, col: host ? host.col : 0, oy: nc.oy, panel: nc.gs[0]._panel });
    }

    // 3-2) 목차·표: 폭이 좁고 왼쪽 단과 행 높이가 하나하나 맞는 단(쪽 번호 등)은 별도 단이 아니라 같은 행의 칸이다
    const cols = [...new Set(segs.filter((x) => x.col > 0).map((x) => x.col))];
    for (const c of cols) {
      const mine = segs.filter((x) => x.col === c);
      const left = segs.filter((x) => x.col === c - 1);
      if (!mine.length || !left.length) continue;
      const size = median(mine.flatMap((x) => x.gs.map((g) => g.size)));
      const narrow = mine.every((x) => x.gs.at(-1).x1 - x.gs[0].x0 <= size * 5);
      const match = mine.map((x) => left.find((l) => l.panel === x.panel && Math.abs(l.oy - x.oy) < size * 0.35)).filter(Boolean);
      if (!narrow || match.length < mine.length * 0.6 || match.length < 3) continue;
      for (const x of mine) {
        const l = left.find((q) => q.panel === x.panel && Math.abs(q.oy - x.oy) < size * 0.35);
        if (!l) continue;
        (l.cells ||= [l.gs]).push(x.gs);
        x.merged = true;
      }
    }
    for (let k = segs.length - 1; k >= 0; k--) if (segs[k].merged) segs.splice(k, 1);

    // 4) 읽기 순서: 가로지르는 행을 기준으로 구역을 나누고, 구역 안에서는 왼쪽 단부터 위→아래
    let bucket = [];
    const flush = () => {
      // 같은 단 안에서는 상자 안 흐름과 밖 흐름을 따로 모으되, 상자가 놓인 위치 순서를 지킨다
      const top = new Map();
      for (const x of bucket) { const k = `${x.col}:${x.panel}`; top.set(k, Math.min(top.get(k) ?? Infinity, x.oy)); }
      bucket.sort((a, b) => a.col - b.col || top.get(`${a.col}:${a.panel}`) - top.get(`${b.col}:${b.panel}`) || a.oy - b.oy);
      for (const s of bucket) ordered.push({ ...s, section });
      bucket = [];
      section++;
    };
    for (const s of segs.sort((a, b) => a.oy - b.oy)) {
      if (s.col === -1) { flush(); ordered.push({ ...s, section, col: 0 }); section++; }
      else bucket.push(s);
    }
    flush();

  }

  // 4-1) 표: 칸마다 줄을 만들고(행→칸→위에서 아래), 표보다 아래에 오는 첫 본문 줄 앞에 끼워 넣는다
  for (const t of tables) {
    const tg = tableInk.filter((g) => g._cell.t === t.id);
    if (!tg.length) continue;
    const cellSegs = [];
    const byCell = new Map();
    for (const g of tg) { if (!byCell.has(g._cell.id)) byCell.set(g._cell.id, []); byCell.get(g._cell.id).push(g); }
    for (const [id, gs] of byCell) {
      gs.sort((a, b) => a.oy - b.oy || a.x0 - b.x0);
      const cellRows = [];
      for (const g of gs) { const r = cellRows.at(-1); if (r && Math.abs(g.oy - r.oy) <= g.size * 0.3) r.gs.push(g); else cellRows.push({ oy: g.oy, gs: [g] }); }
      for (const r of cellRows) { r.gs.sort((a, b) => a.x0 - b.x0); cellSegs.push({ gs: r.gs, col: 0, oy: r.oy, section: 900 + t.id, panel: -1, cell: gs[0]._cell }); }
    }
    cellSegs.sort((a, b) => a.cell.r - b.cell.r || a.cell.c - b.cell.c || a.oy - b.oy);
    const at = ordered.findIndex((sg) => sg.panel === -1 && sg.oy > t.bbox[1] && sg.gs.some((g) => g.x1 > t.bbox[0] && g.x0 < t.bbox[2]));
    ordered.splice(at < 0 ? ordered.length : at, 0, ...cellSegs);
  }

  // 4-2) 글자 배경색이 깔린 줄 표시(편집기로 옮길 때 배경색으로, 미리보기에서도 회색으로)
  // (표 인식이 먼저 돌아야 page._highlights 가 채워진다)
  // 5) 줄 객체 + 줄 안 띄어쓰기
  const out = ordered.map((sg) => {
    if (!sg.cells) return makeLine(sg, page, spaceGlyphs);
    const parts = sg.cells.map((gs) => makeLine({ ...sg, gs, cells: null }, page, spaceGlyphs));
    const l = parts[0];
    for (const q of parts.slice(1)) {
      l.gaps.push({ gap: q.x0 - l.x1, isSp: true, cell: true, at: l.text.length + 1 });
      for (const g of q.gaps) l.gaps.push({ ...g, at: g.at + l.text.length + 1 });
      l.text += "\t" + q.text;
      l.glyphs = [...l.glyphs, ...q.glyphs];
      l.x1 = q.x1;
    }
    l.cells = parts.map((q) => q.text);
    return l;
  });
  for (const l of out) {
    const cx = (l.x0 + l.x1) / 2, cy = l.oy - l.size * 0.35;
    const hb = (page._highlights || []).find((b) => cx > b[0] - 1 && cx < b[2] + 1 && cy > b[1] - 1 && cy < b[3] + 1);
    if (hb) { l.highlight = true; l.hlRect = hb; }
  }
  // 그림(figure) 옆을 지나는 줄 표시: 오른쪽/왼쪽이 그림에 막혔는가
  for (const l of out) {
    const cy = l.oy - l.size * 0.35;
    for (const f of regions.filter((r) => r.kind === "figure")) {
      if (cy < f.bbox[1] - l.size || cy > f.bbox[3] + l.size) continue;
      if (l.x1 <= f.bbox[2] && l.x1 >= f.bbox[0] - l.size * 2 && l.x0 < f.bbox[0]) l.wrapRight = f.id;
      if (l.x0 >= f.bbox[0] && l.x0 <= f.bbox[2] + l.size * 2 && l.x1 > f.bbox[2]) l.wrapLeft = f.id;
    }
  }
  // 회전된 글자(세로 글씨 등)는 쪽 끝에 따로 붙인다 — 버리지 않는다.
  // 회전 각도와 "진행 방향에 수직인 위치"로 줄을 나누고, 간격은 진행 방향을 따라 잰다.
  if (rotated.length) {
    const groups = new Map();
    for (const g of rotated) {
      if (isSpace(g.c) && g.generated) continue;
      const r = g.angle, cos = Math.cos(r), sin = Math.sin(r);
      g._u = g.ox * cos - g.oy * sin;            // 진행 방향 좌표(화면 좌표계는 y가 아래로)
      const v = g.ox * sin + g.oy * cos;          // 수직 방향 좌표
      const key = `${Math.round(r * 20)}:${Math.round(v / 5)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(g);
    }
    for (const all of groups.values()) {
      all.sort((a, b) => a._u - b._u);
      const gs = all.filter((g) => !isSpace(g.c));
      if (!gs.length) continue;
      const steps = gs.slice(1).map((g, k) => g._u - gs[k]._u).filter((d) => d > 0);
      const step = steps.length ? pct(steps, 0.3) : gs[0].size;
      let text = gs[0].c;
      for (let k = 1; k < gs.length; k++) {
        const explicit = all.some((sg) => isSpace(sg.c) && sg._u > gs[k - 1]._u && sg._u < gs[k]._u);
        text += (explicit || gs[k]._u - gs[k - 1]._u > step * 1.2 + gs[k].size * 0.1 ? " " : "") + gs[k].c;
      }
      const l = makeLine({ gs, col: 99, oy: page.height, section: 99 }, page, []);
      l.text = text; l.gaps = []; l.rotated = true;
      out.push(l);
    }
  }
  return out;
}

function takeNumberColumns(rows) {
  const cand = [];
  for (const r of rows) {
    // 행 안의 숫자 덩어리: 앞에 반 글자 이상 틈, 뒤는 행 끝이거나 한 글자 반 이상 틈
    let i = 0;
    while (i < r.gs.length) {
      if (!/\d/.test(r.gs[i].c)) { i++; continue; }
      let j = i;
      while (j + 1 < r.gs.length && /\d/.test(r.gs[j + 1].c) && r.gs[j + 1].x0 - r.gs[j].x1 < r.gs[j].size * 0.3) j++;
      const g0 = r.gs[i], g1 = r.gs[j], prev = r.gs[i - 1], next = r.gs[j + 1];
      const gapL = prev ? g0.x0 - prev.x1 : Infinity, gapR = next ? next.x0 - g1.x1 : Infinity;
      if (j - i < 4 && gapL > g0.size * 0.5 && gapR > g0.size * 3) cand.push({ r, i, j, x1: g1.x1, size: g0.size, oy: r.oy });
      i = j + 1;
    }
  }
  // 오른쪽 끝 x 로 모으기: 4행 이상이 같은 세로선에서 끝나면 번호 열
  const out = [];
  const used = new Set();
  for (const c of cand) {
    if (used.has(c)) continue;
    const same = cand.filter((d) => !used.has(d) && Math.abs(d.x1 - c.x1) < Math.max(c.size, d.size) * 0.4);
    if (same.length < 4) continue;
    for (const d of same) used.add(d);
  }
  // 행에서 떼어 내기(뒤에서부터 잘라야 인덱스가 안 흔들린다)
  const byRow = new Map();
  for (const c of used) { if (!byRow.has(c.r)) byRow.set(c.r, []); byRow.get(c.r).push(c); }
  for (const [r, cs] of byRow) {
    cs.sort((a, b) => b.i - a.i);
    for (const c of cs) {
      const gs = r.gs.splice(c.i, c.j - c.i + 1);
      out.push({ gs, oy: r.oy, size: c.size });
    }
  }
  return out;
}

function findGutters(allRows, W, H) {
  // 머리글·꼬리글 영역(위아래 7%)의 줄과 본문보다 작은 글씨(쪽 번호 등)는 단 경계 판단에서 뺀다
  const bodySz = median(allRows.map((r) => r.size));
  const rows = allRows.filter((r) => !(H && (r.oy < H * 0.07 || r.oy > H * 0.93) && r.size < bodySz * 1.2) && r.size >= bodySz * 0.75);
  if (rows.length < 6) return [];
  const occ = new Float32Array(Math.ceil(W) + 1);
  const bridged = rows.map((r) => {
    const mark = new Uint8Array(occ.length);
    for (let i = 0; i < r.gs.length; i++) {
      const g = r.gs[i], n = r.gs[i + 1];
      let b = g.x1;
      if (n && n.x0 - g.x1 < g.size * 1.0) b = n.x0;   // 어절 사이 좁은 틈은 메워서 본다
      for (let x = Math.max(0, Math.floor(g.x0)); x <= Math.min(occ.length - 1, Math.ceil(b)); x++) mark[x] = 1;
    }
    for (let x = 0; x < occ.length; x++) occ[x] += mark[x];
    return mark;
  });
  const minW = median(rows.map((r) => r.size)) * 0.8;
  const inkL = Math.min(...rows.map((r) => r.gs[0].x0));
  const inkR = Math.max(...rows.map((r) => r.gs.at(-1).x1));
  const gutters = [];
  let start = -1;
  const check = (a, b) => {
    // 이 띠 양쪽에 글자가 있고 띠를 건너지 않는 행(=단이 나뉜 행)이 충분하고,
    // 띠를 가로지르는 행(제목·목차 등)은 그보다 훨씬 적어야 한다
    let mid = Math.round((a + b) / 2), best = Infinity;
    for (let q = a; q < b; q++) { const sc = occ[q] * 1000 + Math.abs(q - (a + b) / 2); if (sc < best) { best = sc; mid = q; } }
    let split = 0, cross = 0, leftOnly = 0, rightOnly = 0;
    rows.forEach((r, i) => {
      if (bridged[i][mid]) { cross++; return; }
      const hasL = r.gs[0].x0 < a, hasR = r.gs.at(-1).x1 > b;
      if (hasL && hasR) split++; else if (hasL) leftOnly++; else if (hasR) rightOnly++;
    });
    return (split >= 3 || (leftOnly >= 3 && rightOnly >= 3)) && cross <= Math.max(2, (split + Math.min(leftOnly, rightOnly)) * 0.5);
  };
  for (let x = Math.ceil(inkL); x <= Math.floor(inkR) + 1; x++) {
    // 거의 모든 행이 비어 있어야 한다(가로지르는 제목·표 행 몇 개는 허용)
    const low = x <= Math.floor(inkR) && occ[x] <= Math.max(3, rows.length * 0.1);
    if (low) { if (start < 0) start = x; }
    else if (start >= 0) {
      if (x - start >= minW && check(start, x)) {
        // 경계 위치: 띠의 한가운데가 아니라 띠 안에서 가장 비어 있는 곳(같으면 가운데에 가까운 곳)
        let cut = Math.round((start + x) / 2), best = Infinity;
        for (let q = start; q < x; q++) {
          const score = occ[q] * 1000 + Math.abs(q - (start + x) / 2);
          if (score < best) { best = score; cut = q; }
        }
        gutters.push([start, x, cut]);
      }
      start = -1;
    }
  }
  return gutters;
}

// 행이 단 사이 빈 띠 "안쪽"에 글자를 두고 있으면(가운데 큰 제목 등) 띠를 가로지르는 행이다
// 행이 단 경계를 가로지르는가.
//  - 경계 위치에 글자가 걸치거나 띄어쓰기 정도의 틈만 있으면 가로지름
//  - 본문보다 확실히 큰 글자(쪽 제목 등)가 빈 띠 안쪽까지 들어와 있으면 가로지름("목 차"처럼 글자 사이가 넓은 제목)
function rowCovers(r, gt, bodySz, span) {
  const [a, b] = gt, cut = gt[2] ?? (a + b) / 2;
  if (rowCoversAt(r, cut)) return true;
  if (bodySz) {
    // 큰 글자들만 본다(같은 높이에 우연히 놓인 작은 글자와 섞이지 않도록)
    const big = r.gs.filter((g) => g.size >= bodySz * 1.4);
    if (big.length) {
      const inBand = big.filter((g) => g.x1 > a + 1 && g.x0 < b - 1).length;
      const left = big.some((g) => (g.x0 + g.x1) / 2 < cut), right = big.some((g) => (g.x0 + g.x1) / 2 >= cut);
      // 흐름 전체의 가운데에 놓인 큰 제목(쪽 제목) / 큰 글자가 경계 양쪽에 걸친 제목
      const c = (big[0].x0 + big.at(-1).x1) / 2;
      const isCentered = span && Math.abs(c - (span[0] + span[1]) / 2) < big[0].size * 1.5;
      if ((inBand && isCentered) || (inBand && left && right)) return true;
    }
  }
  return false;
}
function rowCoversAt(r, mid) {
  for (let i = 0; i < r.gs.length; i++) {
    const g = r.gs[i], n = r.gs[i + 1];
    if (g.x0 <= mid && g.x1 >= mid) return true;
    // 단 경계를 "가로지른다"고 보려면 그 자리의 틈이 띄어쓰기 정도(반 글자 이하)여야 한다
    if (n && g.x1 <= mid && n.x0 >= mid && n.x0 - g.x1 < g.size * 0.5) return true;
  }
  return false;
}

function makeLine(seg, page, spaceGlyphs) {
  const gs = seg.gs;
  const size = median(gs.map((g) => g.size));
  const top = Math.min(...gs.map((g) => g.y0)), bot = Math.max(...gs.map((g) => g.y1));
  const spaces = spaceGlyphs.filter((s) => s.oy > top && s.oy < bot + size * 0.3);
  let text = "";
  const gaps = [];
  // 자간을 넓힌 줄("수 호 자")은 글자 사이 틈이 모두 벌어져 있다 → 그 틈을 기준으로 삼는다
  const raw = [];
  for (let i = 1; i < gs.length; i++) raw.push(gs[i].x0 - gs[i - 1].x1);
  const small = raw.filter((g) => g < size * 0.6);
  // 자간은 "대부분의 글자 사이가 고르게 벌어져 있을 때"만 인정한다(짧은 줄에서 띄어쓰기 틈을 자간으로 착각하지 않도록)
  let base = 0;
  if (small.length >= 3) {
    const b0 = Math.max(0, pct(small, 0.25));
    const uniform = small.filter((g) => Math.abs(g - b0) < size * 0.08).length / small.length;
    if (uniform >= 0.6) base = b0;
  }
  for (let i = 0; i < gs.length; i++) {
    const g = gs[i];
    if (i > 0) {
      const p = gs[i - 1];
      const gap = g.x0 - p.x1;
      const between = spaces.filter((s) => s.x0 >= p.x1 - 1 && s.x1 <= g.x0 + 1 && s.x0 < g.x0);
      const explicit = between.some((s) => !s.generated);
      const generated = between.some((s) => s.generated);
      const isSp = explicit || gap - base > size * 0.15 || (generated && gap - base > size * 0.08);
      gaps.push({ gap, isSp });
      if (isSp) text += " ";
      gaps[gaps.length - 1].at = text.length;      // 이 틈 바로 뒤 글자의 위치(텍스트 기준)
    }
    text += g.c;
  }
  // 줄 끝에 실제(생성되지 않은) 공백 글자가 있는가
  const last = gs.at(-1);
  const trailingSpace = spaces.some((s) => !s.generated && s.x0 >= last.x1 - 1 && s.x0 - last.x1 < size);
  // 글머리 기호(•, 1. 등)로 시작하면 기호 다음 글자의 위치 = 내어쓰기 기준
  let contentStart = gs[0].x0;
  const ft = text.split(" ")[0];
  if (BULLET.test(ft) && gs.length > ft.length) contentStart = gs[ft.length].x0;
  else if (BULLET_CHARS.test(gs[0].c) && gs.length > 1) contentStart = gs[1].x0;
  // 기호 전용 글꼴(Zymbols, Wingdings 등)의 첫 글자 = 글머리 기호 (PDF가 영문자로 매핑해 둔 경우가 많다)
  const symbolBullet = gs.length > 1 && SYMBOL_FONT.test(gs[0].font || "") && !SYMBOL_FONT.test(gs[1].font || "") && gs[1].x0 - gs[0].x1 > size * 0.3;
  if (symbolBullet) contentStart = gs[1].x0;
  return {
    symbolBullet,
    page: page.index, group: `${page.index}:${seg.section}:${seg.col}:${seg.panel ?? -1}${seg.cell ? ":" + seg.cell.id : ""}`, contentStart, panel: seg.panel ?? -1,
    cell: seg.cell ? { table: `p${page.index}-t${seg.cell.t}`, row: seg.cell.r, col: seg.cell.c } : null,
    glyphs: gs, text, gaps, trailingSpace,
    x0: gs[0].x0, x1: last.x1, oy: seg.oy, size,
    weight: median(gs.map((g) => g.weight || 400)),
    tracking: base,
    pageH: page.height,
  };
}

// ───────── 머리글/꼬리글/쪽번호 ─────────
function isFurniture(l, pages, all, bodySize) {
  const inTop = l.oy < l.pageH * 0.12, inBottom = l.oy > l.pageH * 0.88;
  if (!inTop && !inBottom) return false;
  const norm = l.text.replace(/\d+/g, "#").trim();
  // 쪽번호: "3", "- 3 -", "3 / 10", "iv"
  if (/^[#\s\-–—/|.·()]*$/.test(norm) || /^[ivxlcdm]+$/i.test(l.text.trim())) return true;
  // 여러 쪽에 같은 위치·같은 내용으로 반복되는 줄
  if (pages.length >= 2) {
    const same = all.filter((m) => m !== l && m.page !== l.page && Math.abs(m.oy - l.oy) < 8
      && m.text.replace(/\d+/g, "#").trim() === norm).length;
    if (same >= 1) return true;
  }
  // 한 쪽짜리라도 위쪽 여백의 작은 글씨는 머리글로 본다(아래쪽은 각주일 수 있어 제외)
  return inTop && l.size < bodySize * 0.8;
}

// ───────── 공백 폭 / 자연 폭 ─────────
function estimateSpaceWidth(lines, bodySize) {
  // 오른쪽 끝까지 늘어나지 않은 줄(문단 마지막 줄, 왼쪽 정렬 줄)의 띄어쓰기가 본래 폭이다
  const nat = [], all = [];
  for (const l of lines) {
    const loose = l.x1 < l.R - l.size;
    for (const g of l.gaps) if (g.isSp && !g.cell) { all.push(g.gap - l.tracking); if (loose) nat.push(g.gap - l.tracking); }
  }
  const v = nat.length >= 5 ? median(nat) : all.length >= 5 ? pct(all, 0.15) : bodySize * 0.25;
  return Math.min(Math.max(v, bodySize * 0.15), bodySize * 0.5);
}

// 양쪽정렬로 늘어난 공백을 되돌렸을 때 줄이 끝났을 위치
function naturalEnd(l, spaceW) {
  let stretch = 0;
  for (const g of l.gaps) if (g.isSp && !g.cell && g.gap - l.tracking > spaceW) stretch += g.gap - l.tracking - spaceW;
  return l.x1 - stretch;
}

// ───────── 문서 내부 어휘 ─────────
function stripParticle(t) {
  for (const p of PARTICLES) if (t.length > p.length && t.endsWith(p)) return t.slice(0, -p.length);
  return t;
}
// 문서 안의 동일 어휘 대조용. 후보 어휘 뒤에 붙은 조사만 다른 표기도 같은 말로 센다.
// stripParticle에 한 글자 '이/가'를 넣으면 '이야기' 같은 일반 명사를 잘못 자를 수 있으므로,
// 후보(base)에 조사형을 붙여 실제 관측 어절과 정확히 비교한다.
const REFERENCE_SUFFIXES = [...new Set(["", ...PARTICLES, "이", "가", "께", "이라고", "라고", "이라", "라"])];
function wordFamilyCount(dict, base) {
  if (!base || base.length < 2) return 0;
  const source = dict.allTokens || dict.tokens;
  return REFERENCE_SUFFIXES.reduce((n, suffix) => n + (source.get(base + suffix) || 0), 0);
}
function buildDictionary(lines) {
  const tokens = new Map(), stems = new Map(), allTokens = new Map();
  let chars = 0, spaces = 0;
  for (const l of lines) {
    const parts = l.text.split(/[ \t]/);
    spaces += parts.length - 1;
    chars += l.text.replace(/ /g, "").length;
    // 동일 어휘의 다른 출현을 찾을 때는 줄의 처음·끝도 포함한다. 여기서는 후보와 완전히
    // 일치하는 어절(또는 그 뒤에 조사만 붙은 어절)만 조회하므로 줄 경계 조각과 혼동하지 않는다.
    for (const raw of parts) {
      const t = raw.replace(/\u00ad/g, "").replace(EDGE_PUNCT, "");
      if (t) allTokens.set(t, (allTokens.get(t) || 0) + 1);
    }
    // 줄의 첫/마지막 어절은 줄바꿈으로 잘렸을 수 있으므로 사전에서 뺀다
    for (let i = 1; i < parts.length - 1; i++) {
      const t = parts[i].replace(/\u00ad/g, "").replace(EDGE_PUNCT, "");
      if (!t) continue;
      tokens.set(t, (tokens.get(t) || 0) + 1);
      const s = stripParticle(t);
      stems.set(s, (stems.get(s) || 0) + 1);
    }
  }
  // 글자별 "뒤에 공백이 오는 비율", "앞에 공백이 오는 비율" (이 문서의 줄 안 텍스트에서만 학습)
  const after = new Map(), before = new Map();
  const bump = (m, c, sp) => { const v = m.get(c) || { sp: 0, n: 0 }; v.n++; if (sp) v.sp++; m.set(c, v); };
  for (const l of lines) {
    const t = l.text;
    // 문장부호가 끼면 통계에서 뺀다("다." 의 '다' 는 공백 경향을 알려 주지 않음)
    const P = /[^\p{L}\p{N} ]/u;
    for (let i = 0; i < t.length - 1; i++) {
      if (t[i] === " " || P.test(t[i]) || P.test(t[i + 1])) continue;
      bump(after, t[i], t[i + 1] === " ");
    }
    for (let i = 1; i < t.length; i++) {
      if (t[i] === " " || P.test(t[i]) || P.test(t[i - 1])) continue;
      bump(before, t[i], t[i - 1] === " ");
    }
  }
  return { tokens, stems, allTokens, after, before, spaceRatio: chars ? spaces / (chars + spaces) : 0.2 };
}

// ───────── 이음새 분석 ─────────
function firstToken(l) { return l.text.split(" ")[0]; }
function lastToken(l) { return l.text.split(" ").at(-1); }
function glyphWidth(g) { return Math.max(0, g.x1 - g.x0); }

// 단 가운데에 맞춰 놓인 줄(인용문, 제목)
const centered = (l) => l.x0 - l.L > l.size && l.R - l.x1 > l.size && Math.abs((l.x0 + l.x1) / 2 - (l.L + l.R) / 2) < l.size * 0.6;
// 본문보다 큰(작은) 글자가 이어지면 줄 간격도 그 비율만큼 넓다(좁다)
function expectPitch(prev, cur, bodySize) {
  const same = Math.abs(prev.size - cur.size) < 0.5;
  return same && Math.abs(cur.size - bodySize) > bodySize * 0.12 ? cur.pitch * (cur.size / bodySize) : cur.pitch;
}
// 기준 줄 간격: 단 전체 대푯값과 앞뒤 줄 간격 중 큰 쪽(줄 간격이 넓은 문단이 섞여 있어도 오판하지 않도록)
function localPitch(prev, cur, next, prevprev, bodySize) {
  const base = expectPitch(prev, cur, bodySize);
  const nb = [];
  const ok = (a, b) => a && b && a.group === b.group && Math.abs(a.size - b.size) < 0.5 && b.oy > a.oy;
  if (ok(prevprev, prev)) nb.push(prev.oy - prevprev.oy);
  if (ok(cur, next)) nb.push(next.oy - cur.oy);
  return nb.length ? Math.max(base, Math.min(...nb)) : base;
}
function analyzePair(prev, cur, next, bodySize, spaceW, prevprev) {
  const reasons = [];
  let structuralBreak = null;
  const sameGroup = prev.group === cur.group;
  const cellKey = (l) => (l.cell ? `${l.cell.table}:${l.cell.row}:${l.cell.col}` : "");
  if (cellKey(prev) !== cellKey(cur)) structuralBreak = cur.cell || prev.cell ? "표 칸 경계" : null;
  if (structuralBreak) {}
  else if (!!prev.highlight !== !!cur.highlight && prev.page === cur.page) structuralBreak = "글자 배경색 경계";
  else if (prev.cells) structuralBreak = "표/목차의 행 끝(오른쪽 칸이 있음)";
  else if (prev.panel !== cur.panel && prev.page === cur.page) structuralBreak = "상자(사이드바) 경계";
  else if (prev.rotated || cur.rotated) structuralBreak = "회전된 글씨";
  if (structuralBreak) return { prev, cur, structuralBreak, slack: 0, firstCharW: 0, firstTokW: 0, reasons, sameGroup, missingSuspect: false };

  if (Math.abs(cur.size - prev.size) > Math.max(prev.size, cur.size) * 0.12) structuralBreak = "글자 크기 변화";
  else if (Math.abs((cur.weight || 400) - (prev.weight || 400)) >= 250
    && Math.abs((cur.glyphs[0].weight || 400) - (prev.glyphs.at(-1).weight || 400)) >= 250
    && (END_PUNCT.test(prev.text) || prev.R - prev.x1 > prev.size)) structuralBreak = "굵기 변화";
  else if (sameGroup && prev.hlRect && cur.hlRect && prev.hlRect !== cur.hlRect) {
    // 배경색이 깔린 줄끼리는 글자 기준선보다 배경 상자 사이 틈이 정확하다
    if (cur.hlRect[1] - prev.hlRect[3] > cur.size * 0.8) structuralBreak = "배경 상자 사이 간격 벌어짐";
  }
  else if (sameGroup && cur.oy - prev.oy > localPitch(prev, cur, next, prevprev, bodySize) + Math.max(cur.size * 0.3, cur.pitch * 0.15)) structuralBreak = "줄 간격 벌어짐";
  else if (sameGroup && cur.oy < prev.oy) structuralBreak = "위치 역행";
  else {
    const ind = cur.x0 - cur.L;
    const nextInd = next && next.group === cur.group ? next.x0 - next.L : 0;
    // 앞 줄의 본문 시작점(글머리 기호 뒤) 또는 앞 줄 시작점과 같은 위치 = 내어쓰기/이어지는 줄
    const prevIsBullet = prev.symbolBullet || BULLET_CHARS.test(prev.glyphs[0].c) || BULLET.test(firstToken(prev));
    const alignedWithPrev = sameGroup && (Math.abs(cur.x0 - prev.contentStart) < cur.size * 0.35
      || (Math.abs(cur.x0 - prev.x0) < cur.size * 0.35 && prev.x0 - prev.L > cur.size * 0.3)
      || (cur.hang !== null && Math.abs(cur.x0 - cur.hang) < cur.size * 0.35
          && (prevIsBullet || Math.abs(prev.x0 - cur.hang) < cur.size * 0.35)));
    if (cur.wrapLeft) {
      // 그림 윤곽을 따라 줄 시작이 조금씩 바뀐다 → 앞뒤 줄보다 확 들어간 경우만 들여쓰기
      const ref = Math.max(prev.x0, next && next.group === cur.group ? next.x0 : prev.x0);
      if (sameGroup && cur.x0 - ref > cur.size * 0.6) structuralBreak = "첫 줄 들여쓰기(그림 옆)";
    } else if (ind > cur.size * 0.6 && !alignedWithPrev && !cur.tableGroup && !(centered(prev) && centered(cur))
      && !(nextInd > cur.size * 0.6 && Math.abs(nextInd - ind) < cur.size * 0.3)) structuralBreak = "첫 줄 들여쓰기";
    else if ((cur.symbolBullet || BULLET.test(firstToken(cur)) || BULLET_CHARS.test(cur.glyphs[0].c)) && cur.text.includes(" ")
      && (END_PUNCT.test(prev.text) || prev.text.endsWith(":") || prev.R - prev.natEnd > cur.size * 2)) structuralBreak = "글머리 기호/번호";
  }

  // 여유폭: 앞 줄이 (양쪽정렬을 되돌렸을 때) 오른쪽 끝까지 얼마나 비어 있었나
  const slack = prev.R - prev.natEnd;
  // 줄 머리 금칙: 마침표·쉼표 등은 앞 글자와 함께 넘어가므로 한 단위로 본다
  let k = 1;
  while (k < cur.glyphs.length && CLOSE_PUNCT.test(cur.glyphs[k].c) && cur.glyphs[k].x0 - cur.glyphs[k - 1].x1 < cur.size * 0.1) k++;
  const firstCharW = cur.glyphs[k - 1].x1 - cur.glyphs[0].x0;
  const ft = firstToken(cur);
  const firstTokW = cur.glyphs.slice(0, ft.length).reduce((s, g) => s + glyphWidth(g), 0);

  // 빠진 글자 의심: 같은 단, 줄 간격은 평소대로인데 앞 줄이 일찍 끝나고
  // 이 줄은 있어야 할 시작점보다 한참 오른쪽에서 시작 → 그 사이에 텍스트층에 없는 글자가 있다
  let missingSuspect = false;
  if (sameGroup && !cur.wrapLeft && !prev.wrapRight && !prev.tableGroup && !(centered(prev) && centered(cur)) && cur.oy - prev.oy <= cur.pitch * 1.15 && cur.oy > prev.oy) {
    const anchor = Math.abs(prev.contentStart - prev.x0) > 0.1 ? prev.contentStart
      : prev.x0 - prev.L > prev.size * 0.3 ? prev.x0 : prev.L;
    // (빠진 글자가 앞 줄 끝에 있으면 앞 줄이 일찍 끝나고, 이 줄 앞머리에 있으면 이 줄이 안쪽에서 시작한다)
    if (cur.x0 - anchor > cur.size * 2.5 && !END_PUNCT.test(prev.text) && !BULLET.test(firstToken(cur))
      && !BULLET_CHARS.test(cur.glyphs[0].c)) missingSuspect = true;
  }
  return { prev, cur, prevprev, structuralBreak: missingSuspect ? null : structuralBreak, slack, firstCharW, firstTokW, reasons, sameGroup, missingSuspect };
}

function decideJoin(p, mode, spaceW, dict, spaceRatio, o) {
  const { prev, cur, slack, firstCharW, firstTokW } = p;
  const reasons = [];
  const mk = (kind, conf) => ({ between: [prev.idx, cur.idx], kind, conf: +conf.toFixed(3), flagged: conf < o.flagBelow, reasons });

  if (p.missingSuspect) {
    reasons.push("빠진 글자 의심: 앞 줄이 일찍 끝나고 다음 줄이 안쪽에서 시작함(PDF 텍스트층에 없는 글자가 있을 수 있음)");
    const j = mk("space", 0.3); j.missing = true; j.locked = true; return j;
  }
  if (p.structuralBreak) { reasons.push(p.structuralBreak); return mk("para", 0.97); }

  if (prev.wrapRight) {
    // 그림 윤곽을 따라 줄 끝이 조금씩 바뀐다 → 이웃 줄보다 확 짧고 문장이 끝났을 때만 문단 끝
    const pp = p.prevprev && p.prevprev.group === prev.group ? p.prevprev.x1 : cur.x1;
    const ref = Math.min(pp, p.sameGroup ? cur.x1 : pp);
    if (ref - prev.x1 > prev.size * 1.5 && END_PUNCT.test(prev.text)) {
      reasons.push(`그림 옆 줄이 이웃 줄보다 ${(ref - prev.x1).toFixed(1)}pt 짧고 문장이 끝남`);
      return mk("para", 0.85);
    }
    reasons.push("그림을 피해 짧아진 줄 — 줄 길이로 문단 끝을 판단하지 않음");
  } else if (prev.tableGroup) {
    reasons.push("표/목차 칸 안에서 이어지는 줄");
  } else if (centered(prev) && centered(cur)) {
    reasons.push("가운데 정렬된 줄끼리 — 줄 길이로 문단 끝을 판단하지 않음");
  } else if (prev.justified) {
    const actual = prev.R - prev.x1;
    // 다음 줄 첫 단위조차 들어갈 수 없는 좁은 여백이면 문단 끝의 증거가 아니다
    if (actual >= prev.size * 0.2 && (actual >= p.firstCharW || END_PUNCT.test(prev.text))) {
      reasons.push(`양쪽 정렬 단에서 오른쪽 끝까지 차지 않은 줄(${actual.toFixed(1)}pt 남음)`);
      const boldStart = (cur.glyphs[0].weight || 400) - (prev.glyphs.at(-1).weight || 400) >= 100;
      if (boldStart) reasons.push("다음 줄이 굵은 글씨로 시작(새 항목)");
      return mk("para", END_PUNCT.test(prev.text) || boldStart ? 0.95 : 0.78);
    }
  }
  // 여유폭 검사: 다음 줄 첫 단위가 앞 줄에 들어갈 수 있었는데 안 들어갔다 → 의도적인 줄 끝 = 문단 끝
  const unit = mode === "word" ? firstTokW : firstCharW;
  const lengthExempt = prev.wrapRight || prev.tableGroup || (centered(prev) && centered(cur));
  if (!prev.justified && !lengthExempt && slack >= unit + spaceW + prev.size * 0.1) {
    reasons.push(`여유폭 ${slack.toFixed(1)}pt ≥ 다음 ${mode === "word" ? "어절" : "글자"} 폭 ${unit.toFixed(1)}pt`);
    const strong = END_PUNCT.test(prev.text) || slack > prev.size * 3;
    if (!strong) reasons.push("문장부호로 끝나지 않음");
    return mk("para", strong ? 0.93 : 0.72);
  }

  const a = prev.glyphs.at(-1).c, b = cur.glyphs[0].c;
  const A = lastToken(prev), B = firstToken(cur);
  let boundaryDoubt = false;
  if (!p.sameGroup && END_PUNCT.test(prev.text)) {
    if (o._paraStyle === "indent") { reasons.push("단/쪽이 바뀌었지만 들여쓰기가 없어 문단이 이어짐"); }
    else { boundaryDoubt = true; reasons.push("단/쪽 경계에서 문장이 끝남 — 새 문단일 수도 있음"); }
  }

  // 하이픈
  const visible = prev.glyphs.filter((g) => g.c !== "\u00ad");
  const shyBefore = prev.glyphs.length > 1 && prev.glyphs.at(-2).c === "\u00ad";
  if (HYPHENS.has(a) && a !== "\u00ad" && shyBefore && isLatin(b)) {
    reasons.push("소프트 하이픈 자리에서 끊긴 줄(보이는 하이픈은 조판이 만든 것)");
    return mk("hyphen-drop", 0.97);
  }
  if (HYPHENS.has(a) && visible.length > 1 && isLatin(visible.at(-2).c) && isLatin(b)) {
    const stemA = A.replace(EDGE_PUNCT, "").replace(/[-\u2010\u00ad]$/, "");
    const Bc = B.replace(EDGE_PUNCT, "");
    if (a === "\u00ad") { reasons.push("소프트 하이픈(보이지 않는 글자, 그대로 둠)"); return mk("none", 0.95); }
    if (dict.tokens.has(stemA + Bc)) { reasons.push(`'${stemA + Bc}'가 문서에 붙은 형태로 있음`); return mk("hyphen-drop", 0.92); }
    if (dict.tokens.has(stemA + "-" + Bc)) { reasons.push(`'${stemA}-${Bc}'가 문서에 하이픈 형태로 있음`); return mk("none", 0.92); }
    reasons.push(prev.glyphs.at(-1).hyphen ? "PDF가 줄끝 하이픈으로 표시" : "줄끝 하이픈(근거 부족)");
    return mk("hyphen-drop", prev.glyphs.at(-1).hyphen ? 0.78 : 0.6);
  }

  // 점수(로그 오즈): +면 띄움, −면 붙임
  let score, strong = false, locked = false;
  if (mode === "word") { score = 3; reasons.push("어절 단위 줄바꿈 문서"); }
  else {
    const pr = Math.min(Math.max(spaceRatio, 0.05), 0.5);
    score = Math.log(pr / (1 - pr));
    reasons.push(`글자 단위 줄바꿈 문서(띄어쓰기 사전확률 ${(pr * 100).toFixed(0)}%)`);
    if (!prev.justified && !lengthExempt && slack >= firstCharW * 0.95) { score += 3; reasons.push("다음 글자는 들어갈 수 있었으나 공백까지는 안 들어감"); strong = true; locked = true; }
  }
  if (prev.trailingSpace) { score += 6; reasons.push("줄 끝에 실제 공백 문자"); strong = true; locked = true; }
  if (isHanKana(a) && isHanKana(b)) { score -= 6; reasons.push("한자/가나 연속"); strong = true; locked = true; }
  if (CLOSE_PUNCT.test(b)) { score -= 6; reasons.push("다음 줄이 닫는 문장부호로 시작"); strong = true; locked = true; }
  else if (END_PUNCT.test(a) && isLetter(b)) { score += 3; reasons.push("앞 줄이 문장부호로 끝남"); strong = true; locked = true; }

  // 문서 자체에서 배운 글자별 띄어쓰기 경향
  if (mode === "char") {
    const pr = Math.min(Math.max(spaceRatio, 0.05), 0.5), lp = Math.log(pr / (1 - pr));
    const est = (v) => { const q = ((v?.sp || 0) + 2 * pr) / ((v?.n || 0) + 2); return Math.log(q / (1 - q)) - lp; };
    const ea = est(dict.after.get(a)), eb = est(dict.before.get(b));
    const na = dict.after.get(a)?.n || 0, nb = dict.before.get(b)?.n || 0;
    if (na >= 5 || nb >= 5) {
      const d = 0.6 * (na >= 5 ? ea : 0) + 0.6 * (nb >= 5 ? eb : 0);
      score += d;
      if (Math.abs(d) > 0.3) reasons.push(`문서 통계: '${a}' 뒤 공백 ${dict.after.get(a)?.sp || 0}/${na}, '${b}' 앞 공백 ${dict.before.get(b)?.sp || 0}/${nb}`);
    }
  }
  const Ac = A.replace(/\u00ad/g, "").replace(EDGE_PUNCT, ""), Bc = B.replace(/\u00ad/g, "").replace(EDGE_PUNCT, "");
  if (Ac && Bc) {
    const joined = Ac + Bc;
    const joinedBase = stripParticle(joined);
    const familyCount = wordFamilyCount(dict, joinedBase);
    // 같은 문서에 완성된 어휘가 한 번이라도 있으면 기하학적 여유폭이나 Kiwi의 일반
    // 띄어쓰기 추측보다 우선한다. 예: 니알라/토텝은 ↔ 니알라토텝이.
    if (familyCount > 0) {
      reasons.push(`문서 전체에서 '${joinedBase}'와 같은 어휘(조사만 다름)를 ${familyCount}회 확인`);
      const exact = mk("none", 0.97); exact.locked = true; exact.A = A; exact.B = B; exact.docMatch = true; return exact;
    }
    const jc = (dict.tokens.get(joined) || 0) + (dict.stems.get(joinedBase) || 0);
    const sepA = (dict.tokens.get(Ac) || 0) + (dict.stems.get(stripParticle(Ac)) || 0);
    const sepB = (dict.tokens.get(Bc) || 0) + (dict.stems.get(stripParticle(Bc)) || 0);
    if (jc > 0) { score -= 2.5 + Math.log(jc); reasons.push(`'${joined}'가 문서 안에 ${jc}회`); strong = true; }
    else if (sepA > 0 && sepB > 0 && Ac.length > 1 && Bc.length > 1) { score += 1.5; reasons.push(`'${Ac}', '${Bc}'가 각각 문서 안에 있음`); }
    if (isHangul(b) && STRONG_PARTICLE_TOKENS.has(Bc)) { score -= 2.5; reasons.push(`'${Bc}'는 단독 어절이 되기 어려운 조사`); strong = true; }
    if (mode === "char" && isHangul(a) && isHangul(b) && Ac.length >= 2) {
      const e2 = ENDINGS_STRONG.find((e) => Ac.endsWith(e) && Ac.length > e.length);
      if (e2) { score += 2.5; reasons.push(`앞 어절이 '${e2}'(조사/어미)로 끝남`); strong = true; }
      else if (/[을를]$/.test(Ac)) { score += 2.2; reasons.push("앞 어절이 목적격 조사로 끝남"); strong = true; }
      else if (/[는은의에고며면서와과도로]$/.test(Ac)) { score += 1.2; reasons.push(`앞 어절 끝 '${Ac.at(-1)}'(조사/어미일 수 있음)`); }
    }
  }

  let conf = sigmoid(Math.abs(score));
  if (boundaryDoubt) conf = Math.min(conf, 0.6);
  // 문장이 줄 끝에서 딱 끝났고 다음 줄이 들여쓰기·간격 없이 이어지면, 원본에서 새 문단이었는지 PDF만으로는 알 수 없다
  // (들여쓰기로 문단을 나누는 문서라면 들여쓰기가 없다는 것이 "이어짐"의 증거이므로 제외)
  const sentenceEnd = /(다|요|죠|까|네|군|음|함|임|[A-Za-z0-9)"'”’」』])[.!?…]["'”’」』)]*$/.test(prev.text) || /[.!?][”’"']?$/.test(prev.text);
  const lineFull = prev.justified ? prev.R - prev.x1 < prev.size * 0.2 : true;
  if (o.sentenceEndDoubt && p.sameGroup && sentenceEnd && lineFull && o._paraStyle !== "indent" && !prev.tableGroup && score > 0) {
    reasons.push("문장이 줄 끝에서 끝남 — 원본에서는 새 문단이었을 수도 있음");
    conf = Math.min(conf, 0.7);
  }
  if (mode === "char" && !strong) conf = Math.min(conf, o.flagBelow - 0.01);
  const res = mk(score > 0 ? "space" : "none", conf);
  res.locked = locked || boundaryDoubt;
  res.A = A; res.B = B;
  return res;
  // 글자 단위 문서에서 사전확률 말고 아무 근거도 없으면 확신도를 낮춰 반드시 표시

}

// ───────── Kiwi + 문서 전체 대조 ─────────
// 1단계: Kiwi가 확실하게 말해 주는 이음새(형태소 안쪽 / 조사·어미로 시작 / 조사·어미 뒤 새 말)를 먼저 정한다.
// 2단계: 그 결과까지 포함해 "이 문서에서 한 덩어리로 쓰인 말"과 "띄어 쓰인 말"을 모은다.
// 3단계: 명사+명사처럼 Kiwi도 모르는 이음새는 문서 전체 증거로 정하고, 증거가 없을 때만 Kiwi의 문맥 추측을 약하게 쓴다.
const HANGUL_EDGE = /[\uac00-\ud7a3]/;
const CONTENT_TAG = /^(NN|NP|NR|VV|VA|VX|MM|MA|IC|XR|SL|SH|SN|XP)/;
function contextLeft(l) { const p = l.text.split(" "); return p.slice(-2).join(" "); }
function contextRight(l) { const p = l.text.split(" "); return p.slice(0, 2).join(" "); }
function clean(t) { return (t || "").replace(/\u00ad/g, "").replace(EDGE_PUNCT, ""); }

function refineWithSpacer(joins, lines, dict, o) {
  const sp = o.spacer;
  const pending = [];
  joins.forEach((j, i) => {
    if (j.kind !== "space" && j.kind !== "none") return;
    if (j.locked) return;
    const prev = lines[i], cur = lines[i + 1];
    const a = prev.glyphs.at(-1).c, b = cur.glyphs[0].c;
    if (!HANGUL_EDGE.test(a) || !HANGUL_EDGE.test(b)) return;
    const L = contextLeft(prev).replace(/\u00ad/g, ""), R = contextRight(cur).replace(/\u00ad/g, "");
    const info = sp.boundary(L, R);
    const set = (kind, conf, why) => {
      j.kind = kind; j.conf = +conf.toFixed(3); j.flagged = conf < o.flagBelow; j.reasons = [...j.reasons.filter((r) => !r.startsWith("Kiwi")), why];
      j.byKiwi = true;
    };
    // 문서 안에 두 말이 각각 따로 나오고 붙은 형태는 없으면, Kiwi의 "한 단어" 판단보다 문서를 믿는다
    const Ac0 = clean(j.A), Bc0 = clean(j.B);
    const docSep = Ac0.length > 1 && Bc0.length > 1 && dict.tokens.has(Ac0) && dict.tokens.has(Bc0)
      && wordFamilyCount(dict, stripParticle(Ac0 + Bc0)) === 0;
    // 조사·어미 안쪽에서 끊긴 경우("앞에|서서" ↔ "앞에서|서")는 양쪽 다 말이 될 수 있어 점수 차이가 클 때만 확정
    const functional = /^(J|E)/.test(info.insideTag || "");
    if (info.inside && info.diff >= (functional ? 8 : 2) && !docSep) set("none", 0.96, `Kiwi: '${info.insideForm}' 한 형태소 안에서 끊김`);
    else if (info.inside) pending.push({ j, i, info });
    else if (!info.inside && /^(J|E|XS|VCP)/.test(info.rightTag || "")) set("none", 0.93, `Kiwi: 다음 줄이 ${info.rightTag}('${info.rightForm}')로 시작 — 앞말에 붙는 말`);
    // 보조 용언: 맞춤법상 "-어지다", "-어하다"는 항상 붙여 쓰고, "-아/어 + 보조 용언"은 붙여 써도 되고(허용)
    // 띄어 써도 된다(원칙) → 문서 증거로 정한다. 그 밖의 어미 + 보조 용언("-지 않다")은 띄어 쓴다.
    else if (!info.inside && info.leftTag === "EC" && info.rightTag === "VX" && /^[아어여]$|[아어여]$/.test(info.leftForm || "") && /^(지|하)$/.test(info.rightForm || ""))
      set("none", 0.93, `Kiwi: '-${info.leftForm}${info.rightForm}다'는 붙여 씀(맞춤법 제47항 예외 없음)`);
    else if (!info.inside && info.leftTag === "EC" && info.rightTag === "VX" && /[아어여]$/.test(info.leftForm || ""))
      pending.push({ j, i, info });
    else if (!info.inside && /^(J|E)/.test(info.leftTag || "") && CONTENT_TAG.test(info.rightTag || "")) set("space", 0.9, `Kiwi: 앞이 ${info.leftTag}('${info.leftForm}')로 끝나고 새 말 ${info.rightTag}('${info.rightForm}')이 시작`);
    else pending.push({ j, i, info });
  });

  // 2단계: 문서 안에서 확인된 덩어리/띄어쓰기
  const joinedSeen = new Map(), spacedSeen = new Map();
  const bump = (m, k) => k && m.set(k, (m.get(k) || 0) + 1);
  for (const [t, n] of dict.tokens) { joinedSeen.set(t, (joinedSeen.get(t) || 0) + n); bump(joinedSeen, stripParticle(t)); }
  for (const l of lines) {                                          // 줄 안에서 띄어 쓰인 두 어절
    const ps = l.text.replace(/\u00ad/g, "").split(" ").map(clean);
    for (let k = 0; k < ps.length - 1; k++) if (ps[k] && ps[k + 1]) bump(spacedSeen, ps[k] + " " + ps[k + 1]);
  }
  joins.forEach((j) => {                                            // 확실하게 정해진 이음새도 증거가 된다
    if (!j.A || !j.B || j.conf < 0.9) return;
    const A = clean(j.A), B = clean(j.B);
    if (j.kind === "none") { bump(joinedSeen, A + B); bump(joinedSeen, stripParticle(A + B)); }
    if (j.kind === "space") bump(spacedSeen, A + " " + B);
  });

  // 3단계
  for (const { j, info } of pending) {
    const A = clean(j.A), B = clean(j.B);
    const nJ0 = (joinedSeen.get(A + B) || 0) + (joinedSeen.get(stripParticle(A + B)) || 0);
    const nJ = Math.max(nJ0, wordFamilyCount(dict, stripParticle(A + B)));
    const nS = spacedSeen.get(A + " " + B) || 0;
    const why = (k) => `문서 전체: '${A + B}' 붙여 쓴 곳 ${nJ}, '${A} ${B}' 띄어 쓴 곳 ${nS}${k}`;
    const set = (kind, conf, r) => { j.kind = kind; j.conf = +conf.toFixed(3); j.flagged = conf < o.flagBelow; j.reasons = [...j.reasons, r]; j.byKiwi = true; };
    if (nJ > 0 && nS === 0) set("none", 0.92, why(" → 붙임"));
    else if (nS > 0 && nJ === 0) set("space", 0.92, why(" → 띄움"));
    else if (nJ > 0 && nS > 0) set(nJ >= nS ? "none" : "space", 0.6, why(" → 문서 안에서도 섞여 있음"));
    else {
      const g = sp.glue(contextLeft(lines[j.between[0]]), contextRight(lines[j.between[1]]));
      set(g ? "space" : "none", 0.62, `Kiwi 문맥 추측(${info.leftTag || info.insideTag}|${info.rightTag || ""}): ${g ? "띄움" : "붙임"} — 문서에 같은 말이 없어 확인 필요`);
    }
  }
}

// ───────── 문단 서식(지면 그대로 모드·HWPX 변환용) ─────────
// 원본 좌표를 그대로 보존하면서, 편집기에 넘길 문단 속성을 추정한다.
function paragraphLayout(ls) {
  const first = ls[0], size = median(ls.map((l) => l.size));
  const L = first.L, R = first.R;
  const body = ls.length > 1 ? ls.slice(0, -1) : ls;
  const tol = size * 0.3;
  const leftOk = body.filter((l, i) => Math.abs(l.x0 - L) < tol || (i === 0 && l.x0 > L)).length / body.length;
  const rightOk = body.filter((l) => Math.abs(l.x1 - R) < tol).length / body.length;
  const centered = ls.every((l) => Math.abs((l.x0 - L) - (R - l.x1)) < tol && l.x0 - L > size);
  const align = centered ? "center" : rightOk > 0.8 && leftOk > 0.8 && ls.length > 1 ? "justify"
    : rightOk > 0.8 && leftOk < 0.5 ? "right" : "left";
  // 자간: 어절 안에서 글자 상자 사이의 틈(글자 상자 = 글자 폭이므로 틈 = 추가 자간)
  const inner = [];
  for (const l of ls) l.gaps.forEach((g) => { if (!g.isSp) inner.push(g.gap); });
  const pitches = ls.slice(1).map((l, i) => l.oy - ls[i].oy).filter((d) => d > 0);
  return {
    page: first.page,
    bbox: [Math.min(...ls.map((l) => l.x0)), Math.min(...ls.map((l) => l.oy - l.size)), Math.max(...ls.map((l) => l.x1)), Math.max(...ls.map((l) => l.oy))],
    columnBox: [L, R],
    align,
    firstLineIndent: +(first.x0 - L).toFixed(2),
    fontSize: +size.toFixed(2),
    font: first.glyphs[0].font || "",
    weight: first.weight,
    lineHeight: pitches.length ? +median(pitches).toFixed(2) : null,          // 행간(베이스라인 간격, pt)
    letterSpacing: inner.length ? +median(inner).toFixed(3) : 0,             // 자간(pt, 0이면 기본)
    lineBreaksInSource: ls.length - 1,
  };
}

// ───────── 무결성 검사(조건 3) ─────────
// 결과에서 공백을 모두 뺀 문자열 == 원본 글자 순서(공백·기록된 하이픈 제외).
export function verifyIntegrity(res, input) {
  const src = res.lines.map((l) => l.glyphs.filter((g) => !res._dropped.has(g.id)).map((g) => g.c).join("")).join("").replace(/\s/g, "");
  const out = res.paragraphs.map((p) => p.text).join("").replace(/\s/g, "");
  if (src !== out) {
    let i = 0; while (i < src.length && src[i] === out[i]) i++;
    return { ok: false, at: i, expected: src.slice(i, i + 20), got: out.slice(i, i + 20) };
  }
  // 추출된 모든 글자가 본문 또는 머리글/꼬리글 중 한 곳에 정확히 한 번 들어갔는가
  if (input) {
    const used = new Set();
    for (const l of [...res.lines, ...res.furniture]) for (const g of l.glyphs) used.add(g.id);
    const lost = input.pages.flatMap((p) => p.glyphs).filter((g) => !isSpace(g.c) && !used.has(g.id));
    if (lost.length) return { ok: false, lost: lost.length, sample: lost.slice(0, 20).map((g) => g.c).join("") };
  }
  return { ok: true, chars: src.length, droppedHyphens: res._dropped.size };
}

export function toPlainText(res) {
  return res.paragraphs.map((p) => p.text).join("\n\n");
}
