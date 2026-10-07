// 서브뷰·드라이브에서 여는 여러 문서 형식 → 오골계 워드가 여는 모양으로
//  - pdf: 그대로(PDF 보기) / hwp·hwpx: 그대로(편집기)
//  - docx: Word 부품(본문·스타일·관계·그림) → app.js modelFromDocx
//  - odt·rtf·txt·md·html·epub·csv·tsv·xlsx·pptx: HTML 로 바꿔 → app.js modelFromHtml → 한글 문서(HWPX)
//  - doc·xls·ppt(예전 바이너리 형식): 읽을 수 없으니 새 형식으로 저장해 달라고 알린다
// 모두 이 컴퓨터 안에서 바꾼다(인터넷 안 씀). zip 풀기는 브라우저 내장 DecompressionStream.

export const SUBVIEW_EXTENSIONS = ["pdf", "hwp", "hwpx", "docx", "odt", "rtf", "txt", "md", "markdown", "html", "htm", "xhtml", "epub", "csv", "tsv", "xlsx", "pptx"];
const LEGACY = { doc: "Word 97-2003(.doc)", xls: "Excel 97-2003(.xls)", ppt: "PowerPoint 97-2003(.ppt)" };

const extOf = (name) => (String(name || "").match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp", svg: "image/svg+xml", emf: "image/emf", wmf: "image/wmf" };

/** 글자 파일 읽기: BOM(UTF-8·UTF-16) → UTF-8 → 안 되면 한국어 윈도 인코딩(CP949) */
export function decodeText(u8) {
  if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) return new TextDecoder("utf-8").decode(u8.subarray(3));
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder("utf-16le").decode(u8.subarray(2));
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder("utf-16be").decode(u8.subarray(2));
  try { return new TextDecoder("utf-8", { fatal: true }).decode(u8); } catch { /* UTF-8 아님 */ }
  try { return new TextDecoder("euc-kr").decode(u8); } catch { return new TextDecoder("utf-8").decode(u8); }
}

/** zip 풀기 → Map(이름 → Uint8Array). 무압축·deflate 만(오피스 문서·EPUB 는 이 둘) */
export async function unzip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("압축(zip) 문서가 아니거나 손상되었습니다.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map(), td = new TextDecoder("utf-8");
  const inflate = async (data) => new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("압축 목록이 손상되었습니다.");
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), local = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nlen));
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = u8.subarray(start, start + csize);
    if (!name.endsWith("/")) out.set(name, method === 0 ? data : method === 8 ? await inflate(data) : null);
    p += 46 + nlen + xlen + clen;
  }
  return out;
}
const zipText = (z, name) => (z.get(name) ? new TextDecoder("utf-8").decode(z.get(name)) : "");
const xmlDoc = (t) => new DOMParser().parseFromString(t || "<x/>", "application/xml");
const imgTag = (mime, data, w = 0, h = 0) => `<img src="data:${mime};base64,${b64(data)}"${w ? ` width="${Math.round(w)}"` : ""}${h ? ` height="${Math.round(h)}"` : ""}>`;

/** HTML 다듬기: 스크립트·스타일 빼기, 목록 항목은 기호·번호를 붙인 문단으로, <pre> 는 줄마다 문단으로 */
export function tidyHtml(html, imageOf = null) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  doc.querySelectorAll("script,style,noscript,template,iframe,object,embed,head,link,meta").forEach((n) => n.remove());
  for (const pre of [...doc.querySelectorAll("pre")]) {
    const frag = doc.createDocumentFragment();
    for (const line of (pre.textContent || "").replace(/\r/g, "").split("\n")) { const p = doc.createElement("p"); p.style.fontFamily = "D2Coding"; p.textContent = line || " "; frag.appendChild(p); }
    pre.replaceWith(frag);
  }
  // 목록: 바깥 목록부터 항목마다 문단으로 푼다. 항목 안의 목록은 그 문단 뒤로 빼고 깊이를 하나 늘린다(들여쓰기만큼 앞에 빈칸)
  let list;
  while ((list = doc.querySelector("ul,ol"))) {
    const depth = +(list.dataset.ogDepth || 0);
    const frag = doc.createDocumentFragment();
    let n = +(list.getAttribute("start") || 1);
    for (const li of [...list.children].filter((c) => c.tagName === "LI")) {
      const p = doc.createElement("p");
      const mark = list.tagName === "OL" ? `${n++}. ` : depth ? "◦ " : "• ";
      p.append("    ".repeat(depth) + mark);
      const nested = [];
      for (const c of [...li.childNodes]) {
        if (c.nodeType === 1 && /^(UL|OL)$/.test(c.tagName)) { c.dataset.ogDepth = String(depth + 1); nested.push(c); }
        else if (c.nodeType === 1 && c.tagName === "TABLE") nested.push(c);
        else if (c.nodeType === 1 && /^(P|DIV)$/.test(c.tagName)) p.append(...c.childNodes, " ");
        else p.append(c);
      }
      frag.append(p, ...nested);
    }
    list.replaceWith(frag);
  }
  if (imageOf) for (const img of doc.querySelectorAll("img")) {
    const src = img.getAttribute("src") || "";
    if (/^data:/i.test(src)) continue;
    const found = imageOf(src);
    if (found) img.setAttribute("src", `data:${found.mime};base64,${b64(found.data)}`); else img.remove();
  }
  return doc.body.innerHTML;
}

// ── 형식별 ───────────────────────────────────────────────
function htmlFromTxt(text) {
  return text.replace(/\r\n?/g, "\n").split("\n").map((l) => `<p>${l ? esc(l).replace(/\t/g, "&#9;") : "<br>"}</p>`).join("");
}
function inlineMd(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, (_, c) => `<span style="font-family:D2Coding">${c}</span>`)
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<b>${a || b}</b>`)
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<i>$2</i>").replace(/(^|[^_])_([^_]+)_/g, "$1<i>$2</i>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>")
    .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, "[$1]")
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, "$1");
}
function htmlFromMd(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n"), out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*```/.test(l)) { out.push("<pre>"); i++; const code = []; while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]); out[out.length - 1] = `<pre>${esc(code.join("\n"))}</pre>`; continue; }
    let m;
    if ((m = l.match(/^(#{1,6})\s+(.*)$/))) { out.push(`<h${m[1].length}>${inlineMd(m[2].replace(/\s+#+\s*$/, ""))}</h${m[1].length}>`); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { out.push("<p>――――――――――</p>"); continue; }
    // 표: | a | b | 다음 줄 |---|---|
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || "")) {
      const row = (s) => s.trim().replace(/^\||\|$/g, "").split("|").map((c) => `<td>${inlineMd(c.trim())}</td>`).join("");
      const rows = [`<tr>${row(l).replace(/td>/g, "td>")}</tr>`]; i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(`<tr>${row(lines[i++])}</tr>`);
      i--; out.push(`<table>${rows.join("")}</table>`); continue;
    }
    if ((m = l.match(/^(\s*)[-*+]\s+(.*)$/))) { out.push(`<p>${" ".repeat(Math.min(8, m[1].length))}• ${inlineMd(m[2])}</p>`); continue; }
    if ((m = l.match(/^(\s*)(\d+)[.)]\s+(.*)$/))) { out.push(`<p>${" ".repeat(Math.min(8, m[1].length))}${m[2]}. ${inlineMd(m[3])}</p>`); continue; }
    if ((m = l.match(/^>\s?(.*)$/))) { out.push(`<p>│ ${inlineMd(m[1])}</p>`); continue; }
    out.push(l.trim() ? `<p>${inlineMd(l)}</p>` : "<p><br></p>");
  }
  return out.join("");
}
/** RTF → 글(문단·굵게·기울임·밑줄, \\uN 유니코드, \\'hh 코드 페이지 글자). 표·그림은 글만 */
function htmlFromRtf(rtf) {
  const cpm = rtf.match(/\\ansicpg(\d+)/), cp = cpm ? +cpm[1] : 1252;
  const dec = (() => { try { return new TextDecoder(cp === 949 ? "euc-kr" : cp === 65001 ? "utf-8" : `windows-${cp}`); } catch { return new TextDecoder("windows-1252"); } })();
  const out = []; let para = "", bytes = [];
  const st = [{ b: false, i: false, u: false, skip: false, uc: 1 }];
  const cur = () => st[st.length - 1];
  const flushBytes = () => { if (bytes.length) { para += esc(dec.decode(new Uint8Array(bytes))); bytes = []; } };
  const put = (t) => { flushBytes(); const s = cur(); let h = esc(t); if (s.u) h = `<u>${h}</u>`; if (s.i) h = `<i>${h}</i>`; if (s.b) h = `<b>${h}</b>`; para += h; };
  const endPara = () => { flushBytes(); out.push(`<p>${para || "<br>"}</p>`); para = ""; };
  const SKIP = /^(fonttbl|colortbl|stylesheet|info|pict|object|header|footer|headerl|headerr|footerl|footerr|listtable|listoverridetable|rsidtbl|generator|xmlnstbl|themedata|colorschememapping|datastore|latentstyles|fldinst)$/;
  let skipChars = 0;
  for (let i = 0; i < rtf.length; i++) {
    const c = rtf[i];
    if (c === "{") { st.push({ ...cur() }); continue; }
    if (c === "}") { flushBytes(); if (st.length > 1) st.pop(); continue; }
    if (c === "\\") {
      const n = rtf[i + 1];
      if (n === "'") { const h = parseInt(rtf.substr(i + 2, 2), 16); i += 3; if (skipChars > 0) { skipChars--; continue; } if (!cur().skip) bytes.push(h); continue; }
      if (n === "*") { cur().skip = true; i++; continue; }
      if (/[\\{}]/.test(n)) { if (!cur().skip) put(n); i++; continue; }
      if (n === "~") { if (!cur().skip) put(" "); i++; continue; }
      const m = rtf.slice(i + 1).match(/^([a-zA-Z]+)(-?\d+)? ?/);
      if (!m) { i++; continue; }
      i += m[0].length;
      const word = m[1], arg = m[2] != null ? +m[2] : null, s = cur();
      if (SKIP.test(word)) { s.skip = true; continue; }
      if (s.skip) continue;
      if (word === "par" || word === "line" || word === "sect" || word === "page") endPara();
      else if (word === "row") endPara();
      else if (word === "cell") put("\t");
      else if (word === "tab") put("\t");
      else if (word === "b") s.b = arg !== 0; else if (word === "i") s.i = arg !== 0;
      else if (word === "ul") s.u = arg !== 0; else if (word === "ulnone") s.u = false;
      else if (word === "plain") { s.b = s.i = s.u = false; }
      else if (word === "uc") s.uc = arg ?? 1;
      else if (word === "u" && arg != null) { put(String.fromCharCode(arg < 0 ? arg + 65536 : arg)); skipChars = s.uc; }
      else if (word === "emdash") put("—"); else if (word === "endash") put("–"); else if (word === "bullet") put("•");
      else if (word === "lquote") put("‘"); else if (word === "rquote") put("’"); else if (word === "ldblquote") put("“"); else if (word === "rdblquote") put("”");
      continue;
    }
    if (c === "\r" || c === "\n") continue;
    if (skipChars > 0) { skipChars--; continue; }
    if (!cur().skip) put(c);
  }
  if (para) endPara();
  return out.join("");
}
/** ODT(OpenDocument 텍스트): content.xml 의 제목·문단·목록·표·글자 모양(굵게·기울임·밑줄)·그림 */
async function htmlFromOdt(z) {
  const doc = xmlDoc(zipText(z, "content.xml"));
  const T = "urn:oasis:names:tc:opendocument:xmlns:text:1.0", TB = "urn:oasis:names:tc:opendocument:xmlns:table:1.0";
  const FO = "urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0", ST = "urn:oasis:names:tc:opendocument:xmlns:style:1.0";
  const DR = "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0", XL = "http://www.w3.org/1999/xlink";
  // 자동 스타일(굵게·기울임·밑줄·가운데)
  const styles = {};
  for (const s of doc.getElementsByTagNameNS(ST, "style")) {
    const name = s.getAttributeNS(ST, "name"), tp = s.getElementsByTagNameNS(ST, "text-properties")[0], pp = s.getElementsByTagNameNS(ST, "paragraph-properties")[0];
    styles[name] = { b: tp?.getAttributeNS(FO, "font-weight") === "bold", i: tp?.getAttributeNS(FO, "font-style") === "italic", u: (tp?.getAttributeNS(ST, "text-underline-style") || "none") !== "none", align: pp?.getAttributeNS(FO, "text-align") || "" };
  }
  const inline = (el) => {
    let h = "";
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { h += esc(n.nodeValue); continue; }
      if (n.nodeType !== 1) continue;
      const ln = n.localName;
      if (ln === "s") h += " ".repeat(+(n.getAttributeNS(T, "c") || 1));
      else if (ln === "tab") h += "&#9;";
      else if (ln === "line-break") h += "<br>";
      else if (ln === "span" || ln === "a") { const s = styles[n.getAttributeNS(T, "style-name")] || {}; let t = inline(n); if (s.u) t = `<u>${t}</u>`; if (s.i) t = `<i>${t}</i>`; if (s.b) t = `<b>${t}</b>`; h += t; }
      else if (ln === "frame") { const im = n.getElementsByTagNameNS(DR, "image")[0], href = im?.getAttributeNS(XL, "href"); const data = href && z.get(href); if (data) h += imgTag(MIME[extOf(href)] || "image/png", data); }
      else if (n.namespaceURI === T && !/^(note|annotation|bookmark|reference-mark|soft-page-break)/.test(ln)) h += inline(n);
    }
    return h;
  };
  const block = (el, depth = 0) => {
    let h = "";
    for (const n of el.childNodes) {
      if (n.nodeType !== 1) continue;
      const ln = n.localName, s = styles[n.getAttributeNS(T, "style-name")] || {};
      const align = /center/.test(s.align) ? ' style="text-align:center"' : /end|right/.test(s.align) ? ' style="text-align:right"' : "";
      if (n.namespaceURI === T && ln === "h") { const lv = Math.min(6, +(n.getAttributeNS(T, "outline-level") || 1)); h += `<h${lv}${align}>${inline(n)}</h${lv}>`; }
      else if (n.namespaceURI === T && ln === "p") h += `<p${align}>${inline(n) || "<br>"}</p>`;
      else if (n.namespaceURI === T && ln === "list") { for (const it of n.childNodes) if (it.nodeType === 1) { const inner = block(it, depth + 1); h += `<ul><li>${inner.replace(/^<p[^>]*>|<\/p>$/g, "")}</li></ul>`; } }
      else if (n.namespaceURI === TB && ln === "table") {
        const rows = [...n.getElementsByTagNameNS(TB, "table-row")].map((r) => `<tr>${[...r.childNodes].filter((c) => c.nodeType === 1 && c.localName === "table-cell").map((c) => `<td${+(c.getAttributeNS(TB, "number-columns-spanned") || 1) > 1 ? ` colspan="${c.getAttributeNS(TB, "number-columns-spanned")}"` : ""}>${block(c)}</td>`).join("")}</tr>`);
        h += `<table>${rows.join("")}</table>`;
      }
      else if (n.namespaceURI === T && /^(section|list-item|list-header)$/.test(ln)) h += block(n, depth);
    }
    return h;
  };
  const body = doc.getElementsByTagNameNS("urn:oasis:names:tc:opendocument:xmlns:office:1.0", "text")[0];
  return body ? block(body) : "";
}
/** EPUB: 목차 순서(spine)대로 장(XHTML)을 이어 붙이고, 그림은 묶음 안에서 찾는다 */
async function htmlFromEpub(z) {
  const container = xmlDoc(zipText(z, "META-INF/container.xml"));
  const opfPath = container.getElementsByTagName("rootfile")[0]?.getAttribute("full-path");
  if (!opfPath) throw new Error("EPUB 목차(content.opf)를 찾지 못했습니다.");
  const base = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const opf = xmlDoc(zipText(z, opfPath));
  const items = {}; for (const it of opf.getElementsByTagName("item")) items[it.getAttribute("id")] = it.getAttribute("href");
  const resolve = (from, href) => { const parts = (from.includes("/") ? from.slice(0, from.lastIndexOf("/") + 1) : "").concat(decodeURIComponent(href.split("#")[0])).split("/"); const out = []; for (const p of parts) { if (p === "..") out.pop(); else if (p && p !== ".") out.push(p); } return out.join("/"); };
  let html = "";
  for (const ref of opf.getElementsByTagName("itemref")) {
    const href = items[ref.getAttribute("idref")]; if (!href) continue;
    const path = resolve(base, href), text = zipText(z, path); if (!text) continue;
    const chapter = new DOMParser().parseFromString(text, /\.x?html?$/i.test(path) ? "application/xhtml+xml" : "text/html");
    const bodyHtml = (chapter.body || chapter.getElementsByTagName("body")[0])?.innerHTML || "";
    html += tidyHtml(bodyHtml, (src) => { const p = resolve(path, src); const data = z.get(p); return data ? { mime: MIME[extOf(p)] || "image/png", data } : null; });
  }
  return html;
}
function htmlFromCsv(text, sep) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true; else if (c === sep) { row.push(cell); cell = ""; } else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; } else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return `<table>${rows.slice(0, 2000).map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</table>`;
}
/** XLSX: 시트마다 제목 + 표(공유 문자열·숫자·인라인 글자). 수식은 계산된 값 */
async function htmlFromXlsx(z) {
  const sst = [...xmlDoc(zipText(z, "xl/sharedStrings.xml")).getElementsByTagName("si")].map((si) => [...si.getElementsByTagName("t")].map((t) => t.textContent).join(""));
  const wb = xmlDoc(zipText(z, "xl/workbook.xml")), rels = xmlDoc(zipText(z, "xl/_rels/workbook.xml.rels"));
  const target = {}; for (const r of rels.getElementsByTagName("Relationship")) target[r.getAttribute("Id")] = r.getAttribute("Target");
  const colIdx = (ref) => { const m = ref.match(/^[A-Z]+/)[0]; let n = 0; for (const ch of m) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  let html = "";
  for (const sh of wb.getElementsByTagName("sheet")) {
    const rid = sh.getAttribute("r:id") || sh.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const path = "xl/" + String(target[rid] || "").replace(/^\/?xl\//, "").replace(/^\//, "");
    const doc = xmlDoc(zipText(z, path)); const rows = [];
    for (const r of doc.getElementsByTagName("row")) {
      const cells = [];
      for (const c of r.getElementsByTagName("c")) {
        const t = c.getAttribute("t"), v = c.getElementsByTagName("v")[0]?.textContent ?? "";
        const val = t === "s" ? sst[+v] ?? "" : t === "inlineStr" ? [...c.getElementsByTagName("t")].map((x) => x.textContent).join("") : v;
        cells[colIdx(c.getAttribute("r") || "A1")] = val;
      }
      if (cells.some((x) => x !== undefined && x !== "")) rows.push(cells);
    }
    if (!rows.length) continue;
    const width = Math.min(60, Math.max(...rows.map((r) => r.length)));
    html += `<h2>${esc(sh.getAttribute("name") || "시트")}</h2><table>${rows.slice(0, 2000).map((r) => `<tr>${Array.from({ length: width }, (_, k) => `<td>${esc(r[k] ?? "")}</td>`).join("")}</tr>`).join("")}</table><p><br></p>`;
  }
  return html;
}
/** PPTX: 슬라이드 차례대로 제목(슬라이드 번호) + 글 상자 문단 + 그림 */
async function htmlFromPptx(z) {
  const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const names = [...z.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
  let html = "";
  for (const [k, name] of names.entries()) {
    const doc = xmlDoc(zipText(z, name));
    const rels = xmlDoc(zipText(z, name.replace("slides/", "slides/_rels/") + ".rels")); const target = {};
    for (const r of rels.getElementsByTagName("Relationship")) target[r.getAttribute("Id")] = r.getAttribute("Target");
    html += `<h2>슬라이드 ${k + 1}</h2>`;
    for (const p of doc.getElementsByTagNameNS(A, "p")) {
      const t = [...p.getElementsByTagNameNS(A, "t")].map((x) => esc(x.textContent)).join("");
      if (t.trim()) html += `<p>${p.getElementsByTagNameNS(A, "buChar").length || p.getElementsByTagNameNS(A, "buAutoNum").length ? "• " : ""}${t}</p>`;
    }
    for (const blip of doc.getElementsByTagNameNS(A, "blip")) {
      const id = blip.getAttribute("r:embed") || blip.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "embed");
      const path = target[id] ? "ppt/" + target[id].replace(/^\.\.\//, "") : null, data = path && z.get(path);
      if (data && MIME[extOf(path)] && !/emf|wmf/.test(extOf(path))) html += `<p>${imgTag(MIME[extOf(path)], data)}</p>`;
    }
    html += "<p><br></p>";
  }
  return html;
}

/** 문서 하나를 여는 모양으로: { kind: "pdf" } / { kind: "hwp" } / { kind: "docx", parts } / { kind: "html", html } */
export async function importDocument(name, bytes) {
  const ext = extOf(name), u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (ext === "pdf") return { kind: "pdf" };
  if (ext === "hwp" || ext === "hwpx") return { kind: "hwp" };
  if (LEGACY[ext]) throw new Error(`${LEGACY[ext]} 형식은 열 수 없습니다. 원래 프로그램에서 새 형식(.${ext}x)으로 저장한 뒤 열어 주세요.`);
  if (ext === "docx") {
    const z = await unzip(u8), text = (n) => zipText(z, n);
    const document = text("word/document.xml");
    if (!document) throw new Error("Word 문서의 본문을 찾지 못했습니다.");
    const media = {};
    for (const [n, data] of z) if (n.startsWith("word/media/") && data) media[n.slice(5)] = b64(data);
    return { kind: "docx", parts: { document, styles: text("word/styles.xml"), rels: text("word/_rels/document.xml.rels"), media } };
  }
  if (ext === "odt") return { kind: "html", html: tidyHtml(await htmlFromOdt(await unzip(u8))) };
  if (ext === "epub") return { kind: "html", html: await htmlFromEpub(await unzip(u8)) };
  if (ext === "xlsx") return { kind: "html", html: await htmlFromXlsx(await unzip(u8)) };
  if (ext === "pptx") return { kind: "html", html: await htmlFromPptx(await unzip(u8)) };
  const text = decodeText(u8);
  if (ext === "rtf" || /^\{\\rtf/.test(text)) return { kind: "html", html: htmlFromRtf(text) };
  if (ext === "md" || ext === "markdown") return { kind: "html", html: tidyHtml(htmlFromMd(text)) };
  if (ext === "html" || ext === "htm" || ext === "xhtml") {
    const body = new DOMParser().parseFromString(text, "text/html").body?.innerHTML || text;
    return { kind: "html", html: tidyHtml(body) };
  }
  if (ext === "csv" || ext === "tsv") return { kind: "html", html: htmlFromCsv(text, ext === "tsv" ? "\t" : (text.split("\n")[0].split(";").length > text.split("\n")[0].split(",").length ? ";" : ",")) };
  if (ext === "txt" || ext === "text" || ext === "log" || !ext) return { kind: "html", html: htmlFromTxt(text) };
  throw new Error(`.${ext} 파일은 서브뷰에서 열 수 없습니다.`);
}
