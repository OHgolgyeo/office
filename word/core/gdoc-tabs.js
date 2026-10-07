// Google 문서 탭 연동.
//  - docsToModel: Google 문서 API 의 문서 JSON(includeTabsContent=true) → 중간 구조 { tabs:[{name, blocks}], pageless }
//  - tabRequests: 중간 구조 블록 → 한 탭을 채우는 batchUpdate 요청 목록
// 중간 구조 형식은 core/export-office.js 와 같다.

const ALIGN_IN = { START: "left", CENTER: "center", END: "right", JUSTIFIED: "justify" };
const ALIGN_OUT = { left: "START", center: "CENTER", right: "END", justify: "JUSTIFIED" };
const NAMED_IN = { TITLE: { style: "title" }, SUBTITLE: { style: "subtitle" } };
for (let n = 1; n <= 6; n++) NAMED_IN["HEADING_" + n] = { heading: n };
const hex2 = (v) => Math.round(Math.max(0, Math.min(1, v || 0)) * 255).toString(16).padStart(2, "0");
const colorOf = (fc) => { const c = fc && fc.color && fc.color.rgbColor; return c ? (hex2(c.red) + hex2(c.green) + hex2(c.blue)).toUpperCase() : null; };
const PT_PX = 96 / 72;

/** 탭 나무를 화면 순서(위에서 아래, 하위 탭 포함)대로 펼친다 */
function flattenTabs(tabs, out = []) { for (const t of tabs || []) { out.push(t); flattenTabs(t.childTabs, out); } return out; }

export async function docsToModel(doc, fetchImage) {
  let flat = flattenTabs(doc.tabs);
  if (!flat.length) flat = [{ tabProperties: { title: doc.title }, documentTab: { body: doc.body, inlineObjects: doc.inlineObjects, documentStyle: doc.documentStyle } }];
  // 탭과 그 안의 블록은 서로 독립적이다. 순서는 Promise.all이 보존하므로 그림 다운로드만 병렬화한다.
  const tabs = await Promise.all(flat.map(async (t, index) => {
    const dt = t.documentTab || {};
    const blocks = await contentToBlocks((dt.body && dt.body.content) || [], dt.inlineObjects || {}, fetchImage);
    return { name: (t.tabProperties && t.tabProperties.title) || `탭 ${index + 1}`, blocks };
  }));
  const mode = flat[0].documentTab && flat[0].documentTab.documentStyle && flat[0].documentTab.documentStyle.documentFormat && flat[0].documentTab.documentStyle.documentFormat.documentMode;
  return { tabs, pageless: mode ? mode === "PAGELESS" : null };
}

async function contentToBlocks(content, inlineObjects, fetchImage) {
  const blocks = (await Promise.all((content || []).map((el) => {
    if (el.paragraph) return paragraphBlock(el.paragraph, inlineObjects, fetchImage);
    if (el.table) return tableBlock(el.table, inlineObjects, fetchImage);
    return null;
  }))).filter(Boolean);
  // 문서 끝의 빈 문단 하나(Google 문서는 늘 끝에 빈 문단이 있다)는 뺀다
  while (blocks.length && blocks.at(-1).t === "p" && !blocks.at(-1).runs.length) blocks.pop();
  return blocks;
}

async function paragraphBlock(p, inlineObjects, fetchImage) {
  const ps = p.paragraphStyle || {};
  const named = NAMED_IN[ps.namedStyleType] || {};
  const chunks = await Promise.all((p.elements || []).map(async (e) => {
    if (e.textRun) {
      const ts = e.textRun.textStyle || {};
      const fmt = {
        b: !!ts.bold, i: !!ts.italic, u: !!ts.underline && !(ts.link), s: !!ts.strikethrough,
        color: colorOf(ts.foregroundColor), size: ts.fontSize && ts.fontSize.magnitude ? ts.fontSize.magnitude : null,
        font: ts.weightedFontFamily && ts.weightedFontFamily.fontFamily ? ts.weightedFontFamily.fontFamily : null,
      };
      const parts = String(e.textRun.content || "").replace(/\n$/, "").split("\u000b");   // \u000b = 줄바꿈(Shift+Enter)
      const out = [];
      parts.forEach((t, k) => { if (k) out.push({ br: true }); if (t) out.push({ text: t, ...fmt }); });
      return out;
    } else if (e.inlineObjectElement && fetchImage) {
      const obj = inlineObjects[e.inlineObjectElement.inlineObjectId];
      const em = obj && obj.inlineObjectProperties && obj.inlineObjectProperties.embeddedObject;
      const uri = em && em.imageProperties && em.imageProperties.contentUri;
      if (!uri) return [];
      try {
        const img = await fetchImage(uri);
        const w = em.size && em.size.width ? Math.round(em.size.width.magnitude * PT_PX) : 0;
        const h = em.size && em.size.height ? Math.round(em.size.height.magnitude * PT_PX) : 0;
        return img ? [{ img: { mime: img.mime, b64: img.b64, w, h } }] : [];
      } catch { /* 받지 못한 그림은 건너뛴다 */ }
    }
    return [];
  }));
  const runs = chunks.flat();
  return { t: "p", align: ALIGN_IN[ps.alignment] || "left", heading: named.heading || 0, style: named.style || null, runs };
}

async function tableBlock(tbl, inlineObjects, fetchImage) {
  const rows = [], taken = [];                       // taken[r][c] = 앞 칸의 합친 범위에 들어간 자리
  (tbl.tableRows || []).forEach((tr, r) => {
    const row = []; taken[r] = taken[r] || [];
    (tr.tableCells || []).forEach((cell, c) => {
      if (taken[r][c]) return;                       // 합친 칸에 가려진 자리(API 는 가려진 칸도 목록에 넣는다)
      const st = cell.tableCellStyle || {}, rs = st.rowSpan || 1, cs = st.columnSpan || 1;
      for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) { taken[r + dr] = taken[r + dr] || []; if (dr || dc) taken[r + dr][c + dc] = true; }
      row.push({ colspan: cs, rowspan: rs, blocksPromise: contentToBlocks(cell.content || [], inlineObjects, fetchImage) });
    });
    rows.push(row);
  });
  for (const row of rows) for (const cell of row) { cell.blocks = await cell.blocksPromise; delete cell.blocksPromise; }
  return { t: "table", rows };
}

// ── 중간 구조 → 한 탭을 채우는 요청 ─────────────────────────────
// 모든 내용을 탭 맨 앞(1번 위치)에 "뒤에서부터" 넣는다. 앞에 넣는 글이 뒤의 위치 번호를 밀어내지 않아 계산이 흔들리지 않는다.
const NAMED_OUT = (b) => b.style === "title" ? "TITLE" : b.style === "subtitle" ? "SUBTITLE" : b.heading ? "HEADING_" + Math.min(6, b.heading) : "NORMAL_TEXT";
const rgb = (hex) => ({ color: { rgbColor: { red: parseInt(hex.slice(0, 2), 16) / 255, green: parseInt(hex.slice(2, 4), 16) / 255, blue: parseInt(hex.slice(4, 6), 16) / 255 } } });
const RESET_FIELDS = "bold,italic,underline,strikethrough,foregroundColor,fontSize,weightedFontFamily";

function runsText(runs) {
  let text = "", skipped = 0; const spans = [];
  for (const r of runs || []) {
    if (r.br) { text += "\u000b"; continue; }
    if (r.img) { skipped++; continue; }
    if (!r.text) continue;
    spans.push({ start: text.length, end: text.length + r.text.length, r });
    text += r.text;
  }
  return { text, spans, skipped };
}
function textStyleRequests(tabId, base, spans, styled) {
  const out = [];
  for (const { start, end, r } of spans) {
    const ts = {}, f = [];
    if (r.b) { ts.bold = true; f.push("bold"); }
    if (r.i) { ts.italic = true; f.push("italic"); }
    if (r.u) { ts.underline = true; f.push("underline"); }
    if (r.s) { ts.strikethrough = true; f.push("strikethrough"); }
    if (r.color && r.color !== "000000") { Object.assign(ts, { foregroundColor: rgb(r.color) }); f.push("foregroundColor"); }
    if (r.size && !styled) { ts.fontSize = { magnitude: r.size, unit: "PT" }; f.push("fontSize"); }   // 제목류는 Google 스타일 크기를 따른다
    if (r.font) { ts.weightedFontFamily = { fontFamily: r.font }; f.push("weightedFontFamily"); }
    if (f.length) out.push({ updateTextStyle: { range: { startIndex: base + start, endIndex: base + end, tabId }, textStyle: ts, fields: f.join(",") } });
  }
  return out;
}

/** 한 탭을 채우는 요청들과 넣지 못한 그림 수 */
export function tabRequests(blocks, tabId) {
  const reqs = []; let skippedImages = 0;
  const at = (index) => ({ index, tabId });
  for (const b of [...(blocks || [])].reverse()) {
    if (b.t === "table") {
      const grid = [], origins = [];
      let cols = 0;
      b.rows.forEach((row, r) => { grid[r] = grid[r] || []; let c = 0;
        for (const cell of row) { while (grid[r][c]) c++;
          for (let dr = 0; dr < (cell.rowspan || 1); dr++) for (let dc = 0; dc < (cell.colspan || 1); dc++) { grid[r + dr] = grid[r + dr] || []; grid[r + dr][c + dc] = dr || dc ? { covered: true } : { cell }; }
          if ((cell.rowspan || 1) > 1 || (cell.colspan || 1) > 1) origins.push({ r, c, rs: cell.rowspan || 1, cs: cell.colspan || 1 });
          c += cell.colspan || 1; cols = Math.max(cols, c); } });
      const rowsN = b.rows.length;
      if (!rowsN || !cols) continue;
      reqs.push({ insertTable: { rows: rowsN, columns: cols, location: at(1) } });
      const S = 2;                                             // 1번 위치에 넣으면 앞에 줄바꿈이 생기고 표는 2번에서 시작한다
      // 칸 문단 위치 = 표 시작 + 3 + 행×(열×2+1) + 열×2. 마지막 칸부터 채워 앞 칸 위치가 밀리지 않게
      for (let r = rowsN - 1; r >= 0; r--) for (let c = cols - 1; c >= 0; c--) {
        const g = grid[r] && grid[r][c];
        if (!g || g.covered) continue;
        const paras = (g.cell.blocks || []).filter((x) => x.t === "p").map((x) => runsText(x.runs));
        const text = paras.map((x) => x.text).join("\n");
        paras.forEach((x) => (skippedImages += x.skipped));
        if (!text) continue;
        const idx = S + 3 + r * (cols * 2 + 1) + c * 2;
        reqs.push({ insertText: { text, location: at(idx) } });
        let off = 0;
        for (const x of paras) { reqs.push(...textStyleRequests(tabId, idx + off, x.spans, false)); off += x.text.length + 1; }
      }
      for (const o of origins.reverse()) reqs.push({ mergeTableCells: { tableRange: { tableCellLocation: { tableStartLocation: at(S), rowIndex: o.r, columnIndex: o.c }, rowSpan: o.rs, columnSpan: o.cs } } });
      continue;
    }
    const { text, spans, skipped } = runsText(b.runs);
    skippedImages += skipped;
    const styled = !!(b.heading || b.style);
    reqs.push({ insertText: { text: text + "\n", location: at(1) } });
    const range = { startIndex: 1, endIndex: 1 + text.length + 1, tabId };
    reqs.push({ updateParagraphStyle: { range, paragraphStyle: { namedStyleType: NAMED_OUT(b), alignment: ALIGN_OUT[b.align] || "START" }, fields: "namedStyleType,alignment" } });
    if (text) {
      // 넣은 글은 옆 글자의 모양을 물려받으므로 먼저 기본으로 되돌린 뒤 조각별 모양을 입힌다
      reqs.push({ updateTextStyle: { range: { startIndex: 1, endIndex: 1 + text.length, tabId }, textStyle: {}, fields: RESET_FIELDS } });
      reqs.push(...textStyleRequests(tabId, 1, spans, styled));
    }
  }
  return { requests: reqs, skippedImages };
}
