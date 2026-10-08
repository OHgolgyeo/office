// 다른 형식으로 내보내기 3단계: Word(.docx), OpenDocument(.odt), RTF, EPUB.
// 앱 화면이 문서 HTML을 아래 "중간 구조"로 정리해 넘기면, 각 형식의 실제 파일 구조로 쓴다.
//
// model = { title, blocks: Block[] }
//   Block = { t: "p", align: "left|center|right|justify", heading: 0..3, runs: Run[] }
//         | { t: "table", rows: Cell[][] }            Cell = { blocks: Block[], colspan, rowspan }
//   Run   = { text, b, i, u, s, color: "RRGGBB"|null, size: pt|null, font: 이름|null }
//         | { img: { mime, b64, w, h } }              w·h: 화면 px(96dpi)
//         | { br: true }
import crypto from "crypto";
import { zipBytes } from "./export-files.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");          // XML 에 쓸 수 없는 제어 문자
const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/bmp": "bmp", "image/webp": "webp" };
const imgExt = (mime) => EXT[String(mime).toLowerCase()] || "png";
// 그림 바이트: 따로 넘어온 것(data — 복사하지 않고 그대로 본다)이 있으면 그것, 없으면 base64 를 푼다
const imgBytes = (img) => (img.data ? Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength) : Buffer.from(img.b64 || "", "base64"));
// 중간 구조의 그림 참조({ img: { ref } })에 따로 넘어온 그림(images[ref] = { mime, bytes })을 이어 준다
function attachImages(node, images) {
  if (!node || typeof node !== "object" || !images?.length) return;
  if (Array.isArray(node)) { for (const x of node) attachImages(x, images); return; }
  if (node.img && Number.isInteger(node.img.ref) && images[node.img.ref]) { node.img.mime = images[node.img.ref].mime; node.img.data = images[node.img.ref].bytes; }
  for (const k of Object.keys(node)) if (k !== "data" && node[k] && typeof node[k] === "object") attachImages(node[k], images);
}
const TEXT_W_PX = 642;                                                  // A4, 좌우 여백 2cm 기준 본문 폭(96dpi)
function fitImage(img, maxW = TEXT_W_PX) {
  let w = Math.max(1, Math.round(img.w || 200)), h = Math.max(1, Math.round(img.h || 150));
  if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
  return { w, h };
}
const utf8 = (s) => Buffer.from(s, "utf8");
// Google 문서 기본 서식(편집 화면의 스타일과 같다): 크기 pt, 색, 위·아래 간격 pt
const GSTYLE = {
  title: { size: 26, color: "000000", before: 0, after: 3 }, subtitle: { size: 15, color: "666666", before: 0, after: 16 },
  1: { size: 20, color: "000000", before: 20, after: 6 }, 2: { size: 16, color: "000000", before: 18, after: 6 },
  3: { size: 14, color: "434343", before: 16, after: 4 }, 4: { size: 12, color: "666666", before: 14, after: 4 },
  5: { size: 11, color: "666666", before: 12, after: 4 }, 6: { size: 11, color: "666666", before: 12, after: 4, italic: true },
};
const blockStyle = (b) => b.style === "title" || b.style === "subtitle" ? b.style : b.heading ? Math.min(6, b.heading) : null;

// 표를 격자로 펼친다: 각 칸이 차지하는 행·열 위치와, 세로 합치기로 가려진 자리
function tableGrid(rows) {
  const grid = [];                       // grid[r][c] = { cell, origin: bool, r0, c0 }
  let cols = 0;
  rows.forEach((row, r) => {
    grid[r] = grid[r] || [];
    let c = 0;
    for (const cell of row) {
      while (grid[r][c]) c++;
      const cs = Math.max(1, cell.colspan || 1), rs = Math.max(1, cell.rowspan || 1);
      for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) {
        grid[r + dr] = grid[r + dr] || [];
        grid[r + dr][c + dc] = { cell, origin: dr === 0 && dc === 0, top: dr === 0, left: dc === 0, r0: r, c0: c, cs, rs };
      }
      c += cs;
      cols = Math.max(cols, c);
    }
  });
  for (const row of grid) for (let c = 0; c < cols; c++) if (!row[c]) row[c] = { cell: { blocks: [] }, origin: true, top: true, left: true, cs: 1, rs: 1 };
  return { grid: grid.slice(0, rows.length), cols };
}

// ───────────────────────────── Word (.docx) ─────────────────────────────
export function toDocx(model) {
  const media = [];
  const rels = [];
  let docPrId = 1;
  const runXml = (r) => {
    if (r.br) return "<w:r><w:br/></w:r>";
    if (r.img) {
      const { w, h } = fitImage(r.img);
      const n = media.length + 1, name = `image${n}.${imgExt(r.img.mime)}`, rid = `rIdImg${n}`;
      media.push({ name, data: imgBytes(r.img) });
      rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`);
      const cx = w * 9525, cy = h * 9525, id = docPrId++;
      return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="그림 ${id}"/>` +
        `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
        `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
        `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
        `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
        `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
        `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    }
    let pr = "";
    if (r.font) pr += `<w:rFonts w:ascii="${esc(r.font)}" w:hAnsi="${esc(r.font)}" w:eastAsia="${esc(r.font)}" w:cs="${esc(r.font)}"/>`;
    if (r.b) pr += "<w:b/><w:bCs/>";
    if (r.i) pr += "<w:i/><w:iCs/>";
    if (r.s) pr += "<w:strike/>";
    if (r.color) pr += `<w:color w:val="${r.color}"/>`;
    if (r.size) pr += `<w:sz w:val="${Math.round(r.size * 2)}"/><w:szCs w:val="${Math.round(r.size * 2)}"/>`;
    if (r.u) pr += `<w:u w:val="single"/>`;
    const parts = String(r.text || "").split("\t");
    return parts.map((t, k) => `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ""}${k ? "<w:tab/>" : ""}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`).join("");
  };
  const JC = { left: "left", center: "center", right: "right", justify: "both" };
  const blockXml = (b, widthTw = 9638) => {
    if (b.t === "table") {
      const { grid, cols } = tableGrid(b.rows);
      if (!cols) return "";
      const colW = Math.floor(widthTw / cols);
      const border = ["top", "left", "bottom", "right", "insideH", "insideV"].map((k) => `<w:${k} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`).join("");
      let x = `<w:tbl><w:tblPr><w:tblW w:w="${colW * cols}" w:type="dxa"/><w:tblBorders>${border}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${`<w:gridCol w:w="${colW}"/>`.repeat(cols)}</w:tblGrid>`;
      for (const row of grid) {
        x += "<w:tr>";
        for (let c = 0; c < cols; c++) {
          const g = row[c];
          if (!g.left) continue;                                   // 가로로 합쳐져 가려진 자리
          const span = g.cs > 1 ? `<w:gridSpan w:val="${g.cs}"/>` : "";
          const vm = g.rs > 1 ? (g.top ? '<w:vMerge w:val="restart"/>' : "<w:vMerge/>") : "";
          const inner = g.top ? (g.cell.blocks || []).map((bb) => blockXml(bb, colW * g.cs)).join("") : "";
          x += `<w:tc><w:tcPr><w:tcW w:w="${colW * g.cs}" w:type="dxa"/>${span}${vm}</w:tcPr>${inner.includes("<w:p>") || inner.includes("<w:p ") ? inner : inner + "<w:p/>"}</w:tc>`;
        }
        x += "</w:tr>";
      }
      return x + "</w:tbl><w:p/>";
    }
    let ppr = "";
    const bs = blockStyle(b);
    if (bs) ppr += `<w:pStyle w:val="${bs === "title" ? "Title" : bs === "subtitle" ? "Subtitle" : "Heading" + bs}"/>`;
    if (b.align && JC[b.align]) ppr += `<w:jc w:val="${JC[b.align]}"/>`;
    return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}${(b.runs || []).map(runXml).join("")}</w:p>`;
  };
  const body = model.blocks.map((b) => blockXml(b)).join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const pstyle = (id, name, g, level) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${g.before * 20}" w:after="${g.after * 20}"/>${level ? `<w:outlineLvl w:val="${level - 1}"/>` : ""}</w:pPr><w:rPr>${g.italic ? "<w:i/><w:iCs/>" : ""}<w:color w:val="${g.color}"/><w:sz w:val="${g.size * 2}"/><w:szCs w:val="${g.size * 2}"/></w:rPr></w:style>`;
  const heading = (n) => pstyle(`Heading${n}`, `heading ${n}`, GSTYLE[n], n);
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="맑은 고딕" w:hAnsi="맑은 고딕" w:eastAsia="맑은 고딕" w:cs="맑은 고딕"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="ko-KR" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>${pstyle("Title", "Title", GSTYLE.title, 0)}${pstyle("Subtitle", "Subtitle", GSTYLE.subtitle, 0)}${[1, 2, 3, 4, 5, 6].map(heading).join("")}</w:styles>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${rels.join("")}</Relationships>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Default Extension="bmp" ContentType="image/bmp"/><Default Extension="webp" ContentType="image/webp"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(model.title || "문서")}</dc:title><dc:creator>오골계 워드</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>오골계 워드</Application></Properties>`;
  return zipBytes([
    { name: "[Content_Types].xml", data: utf8(types) }, { name: "_rels/.rels", data: utf8(rootRels) },
    { name: "word/document.xml", data: utf8(document) }, { name: "word/styles.xml", data: utf8(styles) },
    { name: "word/_rels/document.xml.rels", data: utf8(docRels) }, { name: "docProps/core.xml", data: utf8(core) }, { name: "docProps/app.xml", data: utf8(app) },
    ...media.map((m) => ({ name: `word/media/${m.name}`, data: m.data })),
  ]);
}

// ───────────────────────────── OpenDocument (.odt) ─────────────────────────────
export function toOdt(model) {
  const pics = [];
  const textStyles = new Map(), paraStyles = new Map(), fonts = new Set(["맑은 고딕"]);
  const textStyle = (r) => {
    const props = [];
    if (r.font) { fonts.add(r.font); props.push(`style:font-name="${esc(r.font)}" style:font-name-asian="${esc(r.font)}"`); }
    if (r.b) props.push('fo:font-weight="bold" style:font-weight-asian="bold"');
    if (r.i) props.push('fo:font-style="italic" style:font-style-asian="italic"');
    if (r.u) props.push('style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"');
    if (r.s) props.push('style:text-line-through-style="solid"');
    if (r.color) props.push(`fo:color="#${r.color}"`);
    if (r.size) props.push(`fo:font-size="${r.size}pt" style:font-size-asian="${r.size}pt"`);
    if (!props.length) return null;
    const key = props.join(" ");
    if (!textStyles.has(key)) textStyles.set(key, `T${textStyles.size + 1}`);
    return textStyles.get(key);
  };
  const paraStyle = (b) => {
    const bs = blockStyle(b);
    const parent = bs === "title" ? "Title" : bs === "subtitle" ? "Subtitle" : bs ? `Heading_20_${bs}` : "Standard";
    const align = { left: "start", center: "center", right: "end", justify: "justify" }[b.align] || "";
    if (!align) return parent;
    const key = parent + "|" + align;
    if (!paraStyles.has(key)) paraStyles.set(key, { name: `P${paraStyles.size + 1}`, parent, align });
    return paraStyles.get(key).name;
  };
  const textXml = (t) => esc(t).replace(/\t/g, "<text:tab/>").replace(/ {2,}/g, (m) => ` <text:s text:c="${m.length - 1}"/>`);
  const runXml = (r) => {
    if (r.br) return "<text:line-break/>";
    if (r.img) {
      const { w, h } = fitImage(r.img), n = pics.length + 1, name = `Pictures/image${n}.${imgExt(r.img.mime)}`;
      pics.push({ name, data: imgBytes(r.img), mime: r.img.mime });
      return `<draw:frame draw:name="그림${n}" text:anchor-type="as-char" svg:width="${(w * 0.75).toFixed(2)}pt" svg:height="${(h * 0.75).toFixed(2)}pt" draw:z-index="${n}"><draw:image xlink:href="${name}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>`;
    }
    const st = textStyle(r), body = textXml(r.text || "");
    return st ? `<text:span text:style-name="${st}">${body}</text:span>` : body;
  };
  let tableNo = 0;
  const blockXml = (b) => {
    if (b.t === "table") {
      const { grid, cols } = tableGrid(b.rows);
      if (!cols) return "";
      let x = `<table:table table:name="표${++tableNo}" table:style-name="Tbl"><table:table-column table:style-name="TblCol" table:number-columns-repeated="${cols}"/>`;
      for (const row of grid) {
        x += "<table:table-row>";
        for (let c = 0; c < cols; c++) {
          const g = row[c];
          if (!g.origin) { x += "<table:covered-table-cell/>"; continue; }
          const span = (g.cs > 1 ? ` table:number-columns-spanned="${g.cs}"` : "") + (g.rs > 1 ? ` table:number-rows-spanned="${g.rs}"` : "");
          const inner = (g.cell.blocks || []).map(blockXml).join("") || '<text:p text:style-name="Standard"/>';
          x += `<table:table-cell table:style-name="TblCell" office:value-type="string"${span}>${inner}</table:table-cell>`;
        }
        x += "</table:table-row>";
      }
      return x + "</table:table>";
    }
    const st = paraStyle(b), inner = (b.runs || []).map(runXml).join("");
    const lv = typeof blockStyle(b) === "number" ? blockStyle(b) : 0;
    return lv ? `<text:h text:style-name="${st}" text:outline-level="${lv}">${inner}</text:h>` : `<text:p text:style-name="${st}">${inner}</text:p>`;
  };
  const body = model.blocks.map(blockXml).join("");
  const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"';
  const fontDecls = `<office:font-face-decls>${[...fonts].map((f) => `<style:font-face style:name="${esc(f)}" svg:font-family="'${esc(f)}'"/>`).join("")}</office:font-face-decls>`;
  const auto = `<office:automatic-styles>` +
    [...paraStyles.values()].map((p) => `<style:style style:name="${p.name}" style:family="paragraph" style:parent-style-name="${p.parent}"><style:paragraph-properties fo:text-align="${p.align}"/></style:style>`).join("") +
    [...textStyles].map(([props, name]) => `<style:style style:name="${name}" style:family="text"><style:text-properties ${props}/></style:style>`).join("") +
    `<style:style style:name="Tbl" style:family="table"><style:table-properties style:width="17cm" table:align="left"/></style:style>` +
    `<style:style style:name="TblCol" style:family="table-column"/>` +
    `<style:style style:name="TblCell" style:family="table-cell"><style:table-cell-properties fo:padding="0.1cm" fo:border="0.5pt solid #000000"/></style:style>` +
    `</office:automatic-styles>`;
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${NS} office:version="1.3">${fontDecls}${auto}<office:body><office:text>${body || '<text:p text:style-name="Standard"/>'}</office:text></office:body></office:document-content>`;
  const ostyle = (name, display, g, level) => `<style:style style:name="${name}" style:display-name="${display}" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard"${level ? ` style:default-outline-level="${level}"` : ""} style:class="text"><style:paragraph-properties fo:margin-top="${g.before}pt" fo:margin-bottom="${g.after}pt" fo:keep-with-next="always"/><style:text-properties fo:font-size="${g.size}pt" style:font-size-asian="${g.size}pt" fo:color="#${g.color}"${g.italic ? ' fo:font-style="italic" style:font-style-asian="italic"' : ""}/></style:style>`;
  const heading = (n) => ostyle(`Heading_20_${n}`, `Heading ${n}`, GSTYLE[n], n);
  const styles = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles ${NS} office:version="1.3">${fontDecls}<office:styles><style:default-style style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.14cm" fo:line-height="150%"/><style:text-properties style:font-name="맑은 고딕" style:font-name-asian="맑은 고딕" fo:font-size="10pt" style:font-size-asian="10pt" fo:language="ko" fo:country="KR" style:language-asian="ko" style:country-asian="KR"/></style:default-style><style:style style:name="Standard" style:family="paragraph" style:class="text"><style:text-properties fo:font-size="11pt" style:font-size-asian="11pt"/></style:style>${ostyle("Title", "Title", GSTYLE.title, 0)}${ostyle("Subtitle", "Subtitle", GSTYLE.subtitle, 0)}${[1, 2, 3, 4, 5, 6].map(heading).join("")}</office:styles><office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" fo:margin-top="2cm" fo:margin-bottom="2cm" fo:margin-left="2cm" fo:margin-right="2cm"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles></office:document-styles>`;
  const meta = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta ${NS} office:version="1.3"><office:meta><dc:title>${esc(model.title || "문서")}</dc:title><meta:generator>오골계 워드</meta:generator><dc:date>${new Date().toISOString()}</dc:date></office:meta></office:document-meta>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>${pics.map((p) => `<manifest:file-entry manifest:full-path="${p.name}" manifest:media-type="${esc(p.mime)}"/>`).join("")}</manifest:manifest>`;
  return zipBytes([
    { name: "mimetype", data: utf8("application/vnd.oasis.opendocument.text"), store: true },
    { name: "META-INF/manifest.xml", data: utf8(manifest) }, { name: "content.xml", data: utf8(content) },
    { name: "styles.xml", data: utf8(styles) }, { name: "meta.xml", data: utf8(meta) },
    ...pics.map((p) => ({ name: p.name, data: p.data })),
  ]);
}

// ───────────────────────────── RTF ─────────────────────────────
export function toRtf(model) {
  const fonts = ["맑은 고딕"], colors = [];
  const fontIdx = (f) => { const i = fonts.indexOf(f); if (i >= 0) return i; fonts.push(f); return fonts.length - 1; };
  const colorIdx = (c) => { const i = colors.indexOf(c); if (i >= 0) return i + 1; colors.push(c); return colors.length; };
  // 한글 등 ASCII 밖의 글자는 \uN? 으로(16비트 부호 있는 정수, 보조 평면 글자는 두 개로)
  const rtfText = (s) => {
    let out = "";
    for (const ch of String(s)) {
      const cp = ch.codePointAt(0);
      if (ch === "\\" || ch === "{" || ch === "}") out += "\\" + ch;
      else if (ch === "\t") out += "\\tab ";
      else if (cp < 0x20) continue;
      else if (cp < 0x80) out += ch;
      else for (const unit of (cp > 0xffff ? [0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)] : [cp])) out += `\\u${unit > 32767 ? unit - 65536 : unit}?`;
    }
    return out;
  };
  const runRtf = (r) => {
    if (r.br) return "\\line ";
    if (r.img) {
      const mime = String(r.img.mime).toLowerCase();
      const kind = mime.includes("png") ? "\\pngblip" : /jpe?g/.test(mime) ? "\\jpegblip" : null;
      if (!kind) return "";                                            // RTF 는 PNG·JPEG 만 표준
      const { w, h } = fitImage(r.img), hex = imgBytes(r.img).toString("hex");
      return `{\\*\\shppict{\\pict${kind}\\picw${w}\\pich${h}\\picwgoal${w * 15}\\pichgoal${h * 15} ${hex.replace(/(.{128})/g, "$1\n")}}}`;
    }
    let ctl = "";
    if (r.font) ctl += `\\f${fontIdx(r.font)}`;
    if (r.size) ctl += `\\fs${Math.round(r.size * 2)}`;
    if (r.b) ctl += "\\b"; if (r.i) ctl += "\\i"; if (r.u) ctl += "\\ul"; if (r.s) ctl += "\\strike";
    if (r.color) ctl += `\\cf${colorIdx(r.color)}`;
    return `{${ctl}${ctl ? " " : ""}${rtfText(r.text || "")}}`;
  };
  const Q = { left: "\\ql", center: "\\qc", right: "\\qr", justify: "\\qj" };
  const paraRtf = (b, inTable) => {
    const bs = blockStyle(b), g = bs ? GSTYLE[bs] : null;
    const head = g ? `${typeof bs === "number" ? `\\outlinelevel${bs - 1}` : ""}\\sb${g.before * 20}\\sa${g.after * 20}\\fs${g.size * 2}\\cf${colorIdx(g.color)}${g.italic ? "\\i" : ""}` : "";
    return `\\pard\\plain${inTable ? "\\intbl" : ""}${Q[b.align] || ""}\\sa120${head} ${(b.runs || []).map(runRtf).join("")}`;
  };
  const blockRtf = (b, widthTw = 9638) => {
    if (b.t === "table") {
      const { grid, cols } = tableGrid(b.rows);
      if (!cols) return "";
      const colW = Math.floor(widthTw / cols);
      let x = "";
      for (const row of grid) {
        let defs = "\\trowd\\trgaph108\\trleft0", cells = "";
        for (let c = 0; c < cols; c++) {
          const g = row[c];
          if (!g.left) continue;
          const merge = g.rs > 1 ? (g.top ? "\\clvmgf" : "\\clvmrg") : "";
          const brd = "\\clbrdrt\\brdrs\\brdrw10\\clbrdrl\\brdrs\\brdrw10\\clbrdrb\\brdrs\\brdrw10\\clbrdrr\\brdrs\\brdrw10";
          defs += `${merge}${brd}\\cellx${colW * (c + g.cs)}`;
          const inner = g.top ? (g.cell.blocks || []).filter((bb) => bb.t === "p").map((bb) => paraRtf(bb, true)) : [];
          cells += (inner.length ? inner.join("\\par ") : "\\pard\\plain\\intbl ") + "\\cell ";
        }
        x += `${defs}\n${cells}\\row\n`;
      }
      return x + "\\pard\\plain\\par\n";
    }
    return paraRtf(b, false) + "\\par\n";
  };
  const body = model.blocks.map((b) => blockRtf(b)).join("");
  const fonttbl = `{\\fonttbl${fonts.map((f, i) => `{\\f${i}\\fnil\\fcharset129 ${rtfText(f)};}`).join("")}}`;
  const colortbl = `{\\colortbl;${colors.map((c) => `\\red${parseInt(c.slice(0, 2), 16)}\\green${parseInt(c.slice(2, 4), 16)}\\blue${parseInt(c.slice(4, 6), 16)};`).join("")}}`;
  const info = `{\\info{\\title ${rtfText(model.title || "문서")}}{\\author ${rtfText("오골계 워드")}}}`;
  const rtf = `{\\rtf1\\ansi\\ansicpg949\\deff0\\uc1${fonttbl}${colortbl}${info}\\paperw11906\\paperh16838\\margl1134\\margr1134\\margt1134\\margb1134\\f0\\fs20\n${body}}`;
  return Buffer.from(rtf, "latin1");                                   // \uN 으로 모두 ASCII
}

// ───────────────────────────── EPUB 3 ─────────────────────────────
export function toEpub(model) {
  const title = model.title || "문서";
  const images = [];
  const css = `body{font-family:"맑은 고딕",sans-serif;line-height:1.7;margin:0 5%}p{margin:0 0 .6em}h1,h2,h3,h4,h5,h6{line-height:1.35;margin:1.2em 0 .5em;font-weight:normal}h1{font-size:20pt}h2{font-size:16pt}h3{font-size:14pt;color:#434343}h4{font-size:12pt;color:#666}h5{font-size:11pt;color:#666}h6{font-size:11pt;color:#666;font-style:italic}h1.title{font-size:26pt;color:#000}.subtitle{font-size:15pt;color:#666}img{max-width:100%;height:auto}table{border-collapse:collapse;margin:.8em 0}td{border:1px solid #888;padding:.25em .5em;vertical-align:top}`;
  const runX = (r) => {
    if (r.br) return "<br/>";
    if (r.img) {
      const n = images.length + 1, name = `images/image${n}.${imgExt(r.img.mime)}`, { w, h } = fitImage(r.img);
      images.push({ name, data: imgBytes(r.img), mime: r.img.mime });
      return `<img src="${name}" alt="" width="${w}" height="${h}"/>`;
    }
    let t = esc(r.text || "");
    const st = [];
    if (r.color) st.push(`color:#${r.color}`);
    if (r.size) st.push(`font-size:${r.size}pt`);
    if (r.font) st.push(`font-family:'${esc(r.font)}'`);
    if (st.length) t = `<span style="${st.join(";")}">${t}</span>`;
    if (r.s) t = `<del>${t}</del>`; if (r.u) t = `<u>${t}</u>`; if (r.i) t = `<em>${t}</em>`; if (r.b) t = `<strong>${t}</strong>`;
    return t;
  };
  const blockX = (b) => {
    if (b.t === "table") {
      const { grid, cols } = tableGrid(b.rows);
      if (!cols) return "";
      return "<table>" + grid.map((row) => "<tr>" + row.map((g) => {
        if (!g.origin) return "";
        const span = (g.cs > 1 ? ` colspan="${g.cs}"` : "") + (g.rs > 1 ? ` rowspan="${g.rs}"` : "");
        return `<td${span}>${(g.cell.blocks || []).map(blockX).join("")}</td>`;
      }).join("") + "</tr>").join("") + "</table>";
    }
    const inner = (b.runs || []).map(runX).join("");
    const align = b.align && b.align !== "left" ? ` style="text-align:${b.align}"` : "";
    const bs = blockStyle(b);
    if (bs === "title") return `<h1 class="title"${align}>${inner}</h1>`;
    if (bs === "subtitle") return `<p class="subtitle"${align}>${inner}</p>`;
    return bs ? `<h${bs}${align}>${inner}</h${bs}>` : `<p${align}>${inner || "<br/>"}</p>`;
  };
  // 장 나누기: 가장 높은 제목 수준마다 새 장(제목이 없으면 한 장)
  const top = Math.min(...model.blocks.filter((b) => b.heading).map((b) => b.heading), 9);
  const chapters = [];
  for (const b of model.blocks) {
    if (!chapters.length || (b.heading && b.heading === top && chapters.at(-1).blocks.length)) chapters.push({ title: "", blocks: [] });
    const ch = chapters.at(-1);
    if (b.heading === top && !ch.title) ch.title = (b.runs || []).map((r) => r.text || "").join("").trim();
    ch.blocks.push(b);
  }
  if (!chapters.length) chapters.push({ title, blocks: [] });
  // 장 이름: 제목이 없으면 그 장의 "제목(Title)" 문단, 그것도 없으면 문서 이름(첫 장) 또는 "N장"
  chapters.forEach((c, i) => {
    if (!c.title) { const t = c.blocks.find((b) => b.style === "title"); if (t) c.title = (t.runs || []).map((r) => r.text || "").join("").trim(); }
    if (!c.title) c.title = i === 0 ? title : `${i + 1}장`;
  });
  const xhtml = (t, body) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ko" lang="ko"><head><meta charset="UTF-8"/><title>${esc(t)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>${body}</body></html>`;
  const chapFiles = chapters.map((c, i) => ({ name: `chapter${i + 1}.xhtml`, title: c.title, data: xhtml(c.title, c.blocks.map(blockX).join("\n") || "<p><br/></p>") }));
  const uid = "urn:uuid:" + crypto.randomUUID();
  const modified = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const nav = xhtml(title, `<nav epub:type="toc" id="toc"><h1>목차</h1><ol>${chapFiles.map((c) => `<li><a href="${c.name}">${esc(c.title)}</a></li>`).join("")}</ol></nav>`);
  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${uid}"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head><docTitle><text>${esc(title)}</text></docTitle><navMap>${chapFiles.map((c, i) => `<navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(c.title)}</text></navLabel><content src="${c.name}"/></navPoint>`).join("")}</navMap></ncx>`;
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="ko"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">${uid}</dc:identifier><dc:title>${esc(title)}</dc:title><dc:language>ko</dc:language><dc:creator>오골계 워드</dc:creator><meta property="dcterms:modified">${modified}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="css" href="style.css" media-type="text/css"/>${chapFiles.map((c, i) => `<item id="c${i + 1}" href="${c.name}" media-type="application/xhtml+xml"/>`).join("")}${images.map((im, i) => `<item id="img${i + 1}" href="${im.name}" media-type="${esc(im.mime)}"/>`).join("")}</manifest><spine toc="ncx">${chapFiles.map((c, i) => `<itemref idref="c${i + 1}"/>`).join("")}</spine></package>`;
  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
  return zipBytes([
    { name: "mimetype", data: utf8("application/epub+zip"), store: true },
    { name: "META-INF/container.xml", data: utf8(container) },
    { name: "OEBPS/content.opf", data: utf8(opf) }, { name: "OEBPS/nav.xhtml", data: utf8(nav) }, { name: "OEBPS/toc.ncx", data: utf8(ncx) },
    { name: "OEBPS/style.css", data: utf8(css) },
    ...chapFiles.map((c) => ({ name: `OEBPS/${c.name}`, data: utf8(c.data) })),
    ...images.map((im) => ({ name: `OEBPS/${im.name}`, data: im.data })),
  ]);
}

export function officeExport(format, model, images = []) {
  if (!model || !Array.isArray(model.blocks)) throw new Error("내보낼 내용이 없습니다.");
  attachImages(model.blocks, images);
  if (format === "docx") return toDocx(model);
  if (format === "odt") return toOdt(model);
  if (format === "rtf") return toRtf(model);
  if (format === "epub") return toEpub(model);
  throw new Error("지원하지 않는 형식입니다: " + format);
}
