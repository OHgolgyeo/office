// 중간 구조(model) → 한글 문서(HWPX). Word·Google 문서 가져오기에서 쓴다.
// 편집 화면에 붙여넣지 않고 엔진으로 직접 만든다(표가 든 HTML 붙여넣기 엔진 버그를 피하고, 결과를 확실히 검사할 수 있다).
// model 형식은 core/export-office.js 와 같다.
import fs from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
// 한글 엔진(WASM)은 프로세스에서 한 번만 초기화한다(서버의 빈 문서 만들기도 이것을 쓴다)
let core = null;
export async function rhwpEngine() {
  if (core) return core;
  const mod = await import("@rhwp/core");
  mod.initSync({ module: fs.readFileSync(require.resolve("@rhwp/core/rhwp_bg.wasm")) });
  core = mod;
  return core;
}

const PX_HU = 75;                                             // 1px(96dpi) = 75 HWPUNIT
const BODY_W_PX = 642;                                        // A4 본문 폭(여백 2cm 기준)과 비슷하게
export const DEFAULT_FONT = "맑은 고딕";                               // 새 문서·가져온 문서에서 별도 글꼴이 없는 글자의 기본값
// Google 문서식 스타일(편집 화면의 OG_STYLES 와 같다)
const OG_STYLES = [
  { key: "normal", name: "일반 텍스트", en: "Normal Text", size: 11, color: "#000000", before: 0, after: 0 },
  { key: "title", name: "제목", en: "Title", size: 26, color: "#000000", before: 0, after: 300 },
  { key: "subtitle", name: "부제목", en: "Subtitle", size: 15, color: "#666666", before: 0, after: 1600 },
  { key: "h1", name: "제목 1", en: "Heading 1", size: 20, color: "#000000", before: 2000, after: 600 },
  { key: "h2", name: "제목 2", en: "Heading 2", size: 16, color: "#000000", before: 1800, after: 600 },
  { key: "h3", name: "제목 3", en: "Heading 3", size: 14, color: "#434343", before: 1600, after: 400 },
  { key: "h4", name: "제목 4", en: "Heading 4", size: 12, color: "#666666", before: 1400, after: 400 },
  { key: "h5", name: "제목 5", en: "Heading 5", size: 11, color: "#666666", before: 1200, after: 400 },
  { key: "h6", name: "제목 6", en: "Heading 6", size: 11, color: "#666666", italic: true, before: 1200, after: 400 },
];
function ensureStyles(d) {
  const ids = {};
  const have = new Map(JSON.parse(d.getStyleList()).map((x) => [x.name, x.id]));
  const defaultFontId = d.findOrCreateFontId(DEFAULT_FONT);
  for (const st of OG_STYLES) {
    if (have.has(st.name)) { ids[st.key] = have.get(st.name); continue; }
    const id = d.createStyle(JSON.stringify({ name: st.name, englishName: st.en, type: 0, nextStyleId: 0 }));
    d.updateStyleShapes(id, JSON.stringify({ fontId: defaultFontId, fontSize: Math.round(st.size * 100), bold: false, italic: !!st.italic, textColor: st.color }),
      JSON.stringify({ spacingBefore: st.before, spacingAfter: st.after, lineSpacing: 150, lineSpacingType: "Percent", alignment: "left" }));
    ids[st.key] = id;
  }
  for (const st of OG_STYLES) try { d.updateStyle(ids[st.key], JSON.stringify({ name: st.name, englishName: st.en, nextStyleId: ids.normal })); } catch { /* 그대로 */ }
  return ids;
}
const styleKeyOf = (b) => b.style === "title" || b.style === "subtitle" ? b.style : b.heading ? "h" + Math.min(6, b.heading) : "normal";
const ALIGN = { left: "left", center: "center", right: "right", justify: "justify" };
const j = (s) => { try { return JSON.parse(s); } catch { return {}; } };

export async function hwpxFromModel(model, { pageless = null } = {}) {
  if (!model || !(Array.isArray(model.blocks) || Array.isArray(model.tabs))) throw new Error("한글 문서로 바꿀 내용이 없습니다.");   // 모양이 틀리면 빈 문서를 만들지 않고 알린다
  const { HwpDocument } = await rhwpEngine();
  const d = HwpDocument.createEmpty();
  d.createBlankDocument();
  const styleIds = ensureStyles(d);
  const fontIds = new Map();
  const fontId = (name) => { if (!fontIds.has(name)) fontIds.set(name, d.findOrCreateFontId(name)); return fontIds.get(name); };
  // 글자 모양: 조각에 없는 항목은 그 문단 스타일의 값으로(스타일 크기·색이 조각 기본값에 덮이지 않게)
  const charProps = (r, def = OG_STYLES[0]) => {
    const p = {
      bold: !!r.b, italic: !!(r.i || def.italic), underline: !!r.u, strikethrough: !!r.s,
      textColor: r.color ? "#" + r.color : def.color,
      fontSize: Math.round((r.size || def.size) * 100),
    };
    const id = fontId(r.font || DEFAULT_FONT);
    if (id >= 0) p.fontId = id;
    return p;
  };
  const imgSize = (img, maxW = BODY_W_PX) => {
    let w = Math.max(1, Math.round(img.w || 200)), h = Math.max(1, Math.round(img.h || 150));
    if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
    return { w, h };
  };
  const extOf = (mime) => ({ "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/bmp": "bmp" })[String(mime).toLowerCase()] || "png";

  let para = 0, first = true;
  const objectsIn = (p) => { try { return JSON.parse(d.getControls()).filter((c) => (c.list || 0) === 0 && c.para === p && /^(gso|tbl)/.test(String(c.ctrlId).trim())).length; } catch { return 0; } };
  const endOf = (p) => d.getParagraphLength(0, p) + objectsIn(p);
  const newPara = () => {                                      // 문서 끝에 새 문단을 만들고 그 번호를 돌려준다
    if (first) { first = false; return para; }
    const last = d.getParagraphCount(0) - 1;
    const r = j(d.splitParagraph(0, last, endOf(last)));
    para = r.paraIdx ?? last + 1;
    return para;
  };
  // 본문 문단 하나 쓰기(줄바꿈은 문단 나누기로)
  const writeParagraph = (b) => {
    let p = newPara();
    const def = OG_STYLES.find((x) => x.key === styleKeyOf(b));
    const applyStyleTo = (pi) => { if (styleIds[def.key] !== undefined) d.applyStyle(0, pi, styleIds[def.key]); };
    applyStyleTo(p);
    const align = ALIGN[b.align] || "left";
    const setAlign = (pi) => d.applyParaFormat(0, pi, JSON.stringify({ alignment: align }));   // 앞 문단 정렬이 번지지 않게 늘 명시
    setAlign(p);
    for (const r of b.runs || []) {
      if (r.br) { p = j(d.splitParagraph(0, p, endOf(p))).paraIdx ?? p + 1; para = p; applyStyleTo(p); setAlign(p); continue; }
      if (r.img) {
        try {
          const bytes = Buffer.from(r.img.b64, "base64"), { w, h } = imgSize(r.img);
          const res = j(d.insertPicture(0, p, endOf(p), "", new Uint8Array(bytes), w * PX_HU, h * PX_HU, Math.round(r.img.w || w), Math.round(r.img.h || h), extOf(r.img.mime), ""));
          if (res.ok !== false && res.controlIdx !== undefined) d.setPictureProperties(0, res.paraIdx ?? p, res.controlIdx, JSON.stringify({ treatAsChar: true }));
        } catch { /* 넣을 수 없는 그림은 건너뛴다 */ }
        continue;
      }
      const text = String(r.text || "").replace(/[\r\n]+/g, " ");
      if (!text) continue;
      const start = endOf(p);
      d.insertText(0, p, start, text);
      d.applyCharFormat(0, p, start, start + text.length, JSON.stringify(charProps(r, def)));
    }
  };
  // 표: 1×1 칸 격자로 만들고 글자를 채운 뒤, 합친 칸은 뒤에서부터 합친다(앞 칸 번호가 바뀌지 않게)
  const writeTable = (b) => {
    const grid = [];
    let cols = 0;
    b.rows.forEach((row, r) => {
      grid[r] = grid[r] || [];
      let c = 0;
      for (const cell of row) {
        while (grid[r][c]) c++;
        const cs = Math.max(1, cell.colspan || 1), rs = Math.max(1, cell.rowspan || 1);
        for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) { grid[r + dr] = grid[r + dr] || []; grid[r + dr][c + dc] = dr || dc ? { covered: true } : { cell, cs, rs }; }
        c += cs; cols = Math.max(cols, c);
      }
    });
    const rows = b.rows.length;
    if (!rows || !cols) return;
    const p = newPara();
    const t = j(d.createTable(0, p, 0, rows, cols));
    if (t.ok === false) return;
    const tp = t.paraIdx ?? p, tc = t.controlIdx ?? 0;
    const origins = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const g = grid[r][c];
      if (!g || g.covered) continue;
      const idx = r * cols + c;
      const blocks = (g.cell.blocks || []).filter((bb) => bb.t === "p");
      let cp = 0;
      blocks.forEach((bb, k) => {
        if (k > 0) { const len = d.getCellParagraphLength(0, tp, tc, idx, cp); cp = j(d.splitParagraphInCell(0, tp, tc, idx, cp, len)).cellParaIdx ?? cp + 1; }
        d.applyParaFormatInCell(0, tp, tc, idx, cp, JSON.stringify({ alignment: ALIGN[bb.align] || "left" }));
        for (const r2 of bb.runs || []) {
          const text = String(r2.text || "").replace(/[\r\n]+/g, " ");
          if (!text) continue;
          const start = d.getCellParagraphLength(0, tp, tc, idx, cp);
          d.insertTextInCell(0, tp, tc, idx, cp, start, text);
          d.applyCharFormatInCell(0, tp, tc, idx, cp, start, start + text.length, JSON.stringify(charProps(r2)));
        }
      });
      if (g.cs > 1 || g.rs > 1) origins.push({ r, c, cs: g.cs, rs: g.rs });
    }
    for (const o of origins.reverse()) { try { d.mergeTableCells(0, tp, tc, o.r, o.c, o.r + o.rs - 1, o.c + o.cs - 1); } catch { /* 합치지 못하면 나뉜 채로 둔다 */ } }
    para = tp;
  };

  // 탭: 첫 탭은 문서 맨 앞, 둘째 탭부터는 쪽 나누기 뒤 새 문단에서 시작하고 탭 이름 책갈피를 단다(편집 화면의 문서 탭과 같은 방식)
  const tabs = Array.isArray(model.tabs) && model.tabs.length ? model.tabs : [{ name: null, blocks: model.blocks || [] }];
  const tabStarts = [];
  tabs.forEach((tab, k) => {
    if (k > 0) {
      const last = d.getParagraphCount(0) - 1;
      const r = j(d.insertPageBreak(0, last, endOf(last)));
      para = r.paraIdx ?? last + 1; first = true;
      if (styleIds.normal !== undefined) d.applyStyle(0, para, styleIds.normal);
      d.applyParaFormat(0, para, JSON.stringify({ alignment: "left" }));
    }
    tabStarts.push(first ? para : null);
    for (const b of tab.blocks || []) { if (b.t === "table") writeTable(b); else writeParagraph(b); }
    if (first) first = false;                                   // 빈 탭도 자기 문단을 갖는다
  });
  // 표로 끝나면 뒤에 빈 문단을 하나 둔다(이어 쓰기 쉽게)
  if (!first) { const last = d.getParagraphCount(0) - 1; const r = j(d.splitParagraph(0, last, endOf(last))); const np = r.paraIdx ?? last + 1; if (styleIds.normal !== undefined) d.applyStyle(0, np, styleIds.normal); d.applyParaFormat(0, np, JSON.stringify({ alignment: "left" })); }
  // 새로 만든 문서이므로, 표 앞뒤로 엔진이 만든 문단 등 "바탕글"로 남은 문단은 일반 텍스트로 맞춘다
  if (styleIds.normal !== undefined) for (let i = 0; i < d.getParagraphCount(0); i++) { try { if (JSON.parse(d.getStyleAt(0, i)).id === 0) d.applyStyle(0, i, styleIds.normal); } catch { /* 그대로 */ } }
  if (tabs.length > 1) tabs.forEach((tab, k) => { if (tabStarts[k] !== null) { try { d.addBookmark(0, tabStarts[k], 0, "오골계워드:탭=" + (tab.name || `탭 ${k + 1}`)); } catch { /* 표시를 못 넣어도 내용은 남는다 */ } } });
  // 보기 방식 표시: true=페이지 없음, false=페이지(용지), 그 밖=표시 없음(오골계 워드 기본 보기)
  if (pageless === true || pageless === false) { try { d.addBookmark(0, 0, 0, "오골계워드:보기=" + (pageless ? "페이지없음" : "페이지")); } catch { /* 표시를 못 넣어도 문서는 만든다 */ } }
  return Buffer.from(d.exportHwpx());
}
