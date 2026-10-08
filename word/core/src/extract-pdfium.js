// PDFium(MIT 래퍼 @hyzyla/pdfium, PDFium 자체는 BSD) 로 글자 단위 정보를 뽑는 어댑터.
// 결과 좌표계: 페이지 왼쪽 위가 (0,0), 단위 pt. y는 아래로 증가.
//
// 이 파일만 PDF 엔진에 의존한다. reconstruct.js 는 여기서 나온 glyph 배열만 본다.

import { PDFiumLibrary } from "@hyzyla/pdfium";
import { readPageObjects, pageOrigin, imageInk } from "./extract-objects.js";

let libPromise = null;
// 스몰캡·대문자 전용 글꼴(제목용 장식 글꼴 등): 소문자 코드에 대문자 모양을 그린다. 글자층에는 소문자로 남아
// "BERLIN THE WICKED CITY" 가 "the wicked city" 로 나왔다. 글꼴의 글자 윤곽선(FPDFFont_GetGlyphPath)으로
// 위로 솟는 소문자(b d f h k l t)와 x 높이 소문자(a c e m n o r s u v w x z)의 윗선을 견주어, 거의 같으면
// (보통 글꼴은 0.6~0.8배) 대문자로 바꾼다. 글자 상자(GetCharBox)는 많은 글꼴에서 모든 글자에 같은 높이를 돌려줘 쓸 수 없다.
const ASC = /[bdfhklt]/, XH = /[acemnorsuvwxz]/;
function glyphTop(M, font, ch, buf) {
  const path = M._FPDFFont_GetGlyphPath(font, ch.codePointAt(0), 1);
  if (!path) return null;
  const n = M._FPDFGlyphPath_CountGlyphSegments(path);
  let top = -Infinity, bot = Infinity;
  for (let i = 0; i < n; i++) {
    const seg = M._FPDFGlyphPath_GetGlyphPathSegment(path, i);
    if (seg && M._FPDFPathSegment_GetPoint(seg, buf, buf + 4)) { const y = M.HEAPF32[(buf >> 2) + 1]; if (y > top) top = y; if (y < bot) bot = y; }
  }
  return n > 0 && top > bot ? top : null;
}
function capsFontsOf(M, fontUse, buf) {
  const caps = new Set(), med = (a) => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
  for (const [name, e] of fontUse) {
    const f = M._FPDFTextObj_GetFont(e.obj);
    if (!f) continue;
    const asc = [], xh = [];
    for (const ch of e.chars) {
      if (!ASC.test(ch) && !XH.test(ch)) continue;
      const t = glyphTop(M, f, ch, buf);
      if (t == null || !(t > 0)) continue;
      (ASC.test(ch) ? asc : xh).push(t);
    }
    // 대문자형이면 소문자 윗선이 모두 고르다(한 높이, 둥근 글자의 넘침 정도만 차이). 기호를 알파벳 자리에 넣은
    // 수식 글꼴(exam_math)은 높이가 제각각이라 빠진다. 윗선은 글꼴 크기(1) 대비 대문자 높이 범위(0.5~0.9) — x 높이(0.4~0.45)에 머무는 수식 글꼴은 빠진다.
    const all = [...asc, ...xh], even = Math.max(...all) <= Math.min(...all) * 1.12;
    if (asc.length >= 1 && xh.length >= 2 && med(xh) >= med(asc) * 0.9 && even && med(all) >= 0.5 && med(all) <= 0.9) caps.add(name);
  }
  return caps;
}

export function getLibrary() {
  if (!libPromise) libPromise = PDFiumLibrary.init();
  return libPromise;
}

/**
 * @param {Uint8Array} bytes  PDF 파일 바이트
 * @returns {Promise<{pages: Page[]}>}
 *
 * Page  = { index, width, height, glyphs: Glyph[] }
 * Glyph = { c, x0, y0, x1, y1, ox, oy, size, font, weight, angle(진짜 회전, 라디안), italic, skew(기울기 c/d),
 *           generated, hyphen, unicodeError }
 *   x0..y1 : loose box(폰트 ascent~descent 기준, 줄 묶기에 안정적)
 *   ox, oy : 글자 원점(베이스라인)
 */
/** 쪽 닫기. 래퍼(@hyzyla/pdfium)의 getPage 는 쪽을 열기만 하고 render() 때만 닫는다 — 글자·개체만 읽은 쪽은
 *  문서를 닫아도 pdfium(wasm) 메모리에 남아, PDF 를 열고 닫을수록 메인 프로세스가 커졌다(같은 쪽을 다시 열 때마다 또). */
export function closePage(page) {
  try { page.module._FPDF_ClosePage(page.pageIdx); } catch { /* 이미 닫힘 */ }
}
/** 쪽 n 을 열어 fn(page) 를 하고 닫는다(fn 이 약속을 돌려주면 끝난 뒤에) */
export function withPage(doc, n, fn) {
  const page = doc.getPage(n);
  let r;
  try { r = fn(page); } catch (e) { closePage(page); throw e; }
  if (r && typeof r.then === "function") return r.finally(() => closePage(page));
  closePage(page);
  return r;
}

export async function extractGlyphs(bytes, opts = {}) {
  const lib = await getLibrary();
  const doc = await lib.loadDocument(bytes);
  const pages = [];
  try {
    let pageNo = 0;
    const total = doc.getPageCount();
    for (const page of doc.pages()) try {
      opts.onPage?.(pageNo, total);                                  // 진행 표시(읽은 쪽 수)
      if (opts.yieldEvery && ++pageNo % opts.yieldEvery === 0) await new Promise((r) => setImmediate(r));
      // 이미지·선 개체의 위치(그림 파일은 문서화·끌어놓기에서 요청할 때 session.js 가 꺼낸다)
      const { images, paths, textSeq } = readPageObjects(page);
      const p = readPage(page, textSeq);
      // 보이지 않는 글자·선은 없는 것으로 본다(문서화·표 찾기·글자 층 모두):
      //  - 쪽 밖(재단선 밖·펼침 표지의 뒤표지 쪽)에 있는 글자
      //  - 쪽의 40% 이상을 덮는 불투명한 그림보다 먼저 그려져 그 밑에 가려진 글자·선(표지 그림 밑에 깔린 글 등)
      //    작은 그림은 보지 않는다: PDFium 이 불투명하다고 알려 줘도 실제로는 투명한 곳이 있어 밑의 글자가 보이는
      //    아이콘이 있다(괄호 글자 위에 얹힌 16pt 아이콘 — 80168_regulatory_analysis 예제).
      const area = (b) => Math.max(0, Math.min(p.width, b[2]) - Math.max(0, b[0])) * Math.max(0, Math.min(p.height, b[3]) - Math.max(0, b[1]));
      const covers = images.filter((im) => !im.hasAlpha && area(im.bbox) >= p.width * p.height * 0.4).map((im) => ({ b: im.bbox, seq: im.seq }));
      const hidden = (x, y, seq) => seq >= 0 && covers.some((c) => c.seq > seq && x > c.b[0] && x < c.b[2] && y > c.b[1] && y < c.b[3]);
      p.glyphs = p.glyphs.filter((g) => {
        const x = (g.x0 + g.x1) / 2, y = (g.y0 + g.y1) / 2;
        return x >= 0 && x <= p.width && y >= 0 && y <= p.height && !hidden(x, y, g.seq);
      });
      // 글 줄에 끼워 넣은 글자 크기의 작은 그림(기울임꼴 따옴표를 그림으로 넣은 PDF)을 문장 부호 글자로 되살린다
      const marks = punctuationImages(doc, page, p, images);
      p.images = images.filter((im) => !marks.has(im)).map(({ _obj, _m, ...img }) => img);
      p.paths = paths.filter((pa) => {
        const x = (pa.bbox[0] + pa.bbox[2]) / 2, y = (pa.bbox[1] + pa.bbox[3]) / 2;
        return x >= 0 && x <= p.width && y >= 0 && y <= p.height && !hidden(x, y, pa.seq);
      });
      pages.push(p);
    } finally { closePage(page); }
  } finally {
    doc.destroy();
  }
  return { pages };
}

/** 글 줄에 끼워 넣은 작은 그림 가운데 문장 부호 모양인 것을 글자로 바꿔 p.glyphs 에 넣는다. 바꾼 그림들의 집합을 돌려준다.
 *  어떤 PDF 는 기울임꼴 따옴표 같은 글자를 글자가 아니라 줄 높이만 한 작은 그림(폭 4pt × 높이 10pt)으로 넣는다. PDFium 은 그것을
 *  글자로 내주지 않아 따옴표가 통째로 빠졌고, 그림으로 남은 것은 너무 작아 문서에도 들어가지 않았다.
 *  모양만 보고 정한다: 잉크가 줄의 위쪽에만 있으면 따옴표(세로 획 하나 = ', 둘 = "), 아래쪽에만 있으면 마침표·쉼표.
 *  줄 높이 전체에 걸친 잉크(글자·아이콘)는 무엇인지 알 수 없으므로 그림 그대로 둔다. */
function punctuationImages(doc, page, p, images) {
  const done = new Set();
  const ink = p.glyphs.filter((g) => g.c.trim() && !g.invisible);
  if (!ink.length) return done;
  for (const im of images) {
    const [x0, y0, x1, y1] = im.bbox, w = x1 - x0, h = y1 - y0;
    if (!(h >= 4 && h <= 48 && w >= 0.8 && w <= h * 0.9) || im.tilted) continue;
    // 같은 줄의 글자: 세로로 그림과 절반 이상 겹치고 크기가 비슷하며(그림 높이의 0.6~1.5배) 가로로 가까운 것
    const row = ink.filter((g) => Math.min(g.y1, y1) - Math.max(g.y0, y0) >= Math.min(g.y1 - g.y0, h) * 0.5 && g.size >= h * 0.6 && g.size <= h * 1.5);
    const dist = (g) => Math.max(0, g.x0 - x1, x0 - g.x1);
    const near = row.filter((g) => dist(g) <= g.size * 1.2).sort((a, b) => dist(a) - dist(b))[0];
    if (!near) continue;
    // 따옴표 그림은 글자보다 좁다(폭이 글자 크기의 60% 이하). 글자만 한 그림(낫표 ｢ 옆에 겹쳐 놓인 장식 등)은 아니다.
    if (w > near.size * 0.6 || h > near.size * 1.6) continue;
    // 그림 개체만 따로 그린다(쪽을 그리면 그림 상자에 걸친 옆 글자의 잉크가 섞여 모양을 잘못 본다)
    const bm = imageInk(doc, page, im);
    if (!bm) continue;
    const W = bm.w, H = bm.h, S = H / h;
    const dark = (x, y) => bm.ink[y * W + x] === 1;
    let top = H, bottom = -1, n = 0;
    const cols = new Array(W).fill(0);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (dark(x, y)) { n++; cols[x]++; if (y < top) top = y; if (y > bottom) bottom = y; }
    if (n < W * H * 0.02 || bottom < 0) continue;                       // 잉크가 거의 없다
    // 세로 획 수: 잉크가 있는 세로줄이 이어진 덩어리(1px 틈은 같은 덩어리)
    let strokes = 0, run = 0, gap = 9, widest = 0;
    for (let x = 0; x < W; x++) { if (cols[x] > 0) { if (!run && gap > 1) strokes++; run++; gap = 0; if (run > widest) widest = run; } else { run = 0; gap++; } }
    // 줄 안에서의 세로 위치: 옆 글자의 상자를 줄로 삼는다(그림 상자는 줄보다 클 수 있다)
    const lineTop = near.y0, lineH = Math.max(1, near.y1 - near.y0);
    const inkTop = (y0 + top / S - lineTop) / lineH, inkBottom = (y0 + (bottom + 1) / S - lineTop) / lineH;
    let c = null;
    // 따옴표만 되살린다: 줄 위쪽에 있고(위 끝이 줄의 35% 안, 아래 끝이 62% 안), 획의 키가 줄 높이의 12~50%이며,
    // 획 하나하나가 가로보다 세로로 길다. 가로로 긴 잉크(그림으로 넣은 윗줄·밑줄 조각)와 줄 아래쪽의 점(밑줄 조각이 마침표로
    // 잘못 읽혔다)은 문장 부호로 보지 않는다 — 공개 예제의 시험지·법령 문서에서 밑줄 조각 수십 개가 ' 와 . 이 됐었다.
    const inkH = (bottom - top + 1) / S, strokeW = widest / S;
    if (inkTop <= 0.35 && inkBottom <= 0.62 && strokes <= 2 && inkH >= lineH * 0.12 && inkH <= lineH * 0.5 && strokeW <= inkH * 1.1) c = strokes === 2 ? '"' : "'";
    if (!c) continue;
    p.glyphs.push({ ...near, c, x0, y0: near.y0, x1, y1: near.y1, ox: x0, oy: near.oy, rawBox: null, hscale: 1, generated: false, hyphen: false,
      unicodeError: false, unreadable: false, invisible: false, seq: im.seq, ci: -1, fromImage: true });
    done.add(im);
  }
  return done;
}

// 장식 기호 글꼴(Wingdings·Webdings·ZapfDingbats·…Ornaments 등)은 알파벳 자리에 그림 기호가 들어 있다. 글자 코드대로 읽으면
// 글머리표가 "G 1단계"처럼 엉뚱한 알파벳이 된다(테스트2 Cristoforo-Ornaments). 대응표가 알려진 글꼴은 그 기호로,
// 모르는 장식 글꼴은 장식 기호(❧)로, 그 밖의 기호 글꼴은 글머리 점(•)으로 바꾼다. 이미 기호로 읽힌 글자(유니코드 기호)는 그대로.
const SYMBOL_FONT = /ornament|dingbat|wingding|webding|zapf|fleuron|bullets?\b/i;
const WINGDINGS = { '"': "✂", "#": "✁", "(": "☎", ")": "✆", "*": "✉", ",": "📪", "-": "📫", l: "●", n: "■", o: "□", q: "❑", u: "◆", v: "❖", w: "⬥", "§": "▪", "Ø": "➢", "ü": "✓", "û": "✗", "ý": "☒", "þ": "☑", "¨": "◻", J: "☺", L: "☹", F: "☞", "à": "➔", "è": "➡" };
const ZAPF = { l: "●", n: "■", o: "❏", q: "❑", u: "◆", H: "★", I: "✩", s: "▲", t: "▼", "3": "✓", "4": "✔", "7": "✗", "8": "✘", "+": "☛" };
function symbolFontChar(font, c) {
  if (!SYMBOL_FONT.test(font) || !c || /\s/.test(c)) return c;
  let code = c.codePointAt(0);
  if (code >= 0xf020 && code <= 0xf0ff) code -= 0xf000;       // 기호 글꼴의 사용자 영역(U+F0xx)으로 읽힌 경우
  if (code < 0x21 || code > 0xff) return c;                    // 이미 유니코드 기호(■, ❧ 등)
  const ch = String.fromCharCode(code);
  if (/wingding/i.test(font) && WINGDINGS[ch]) return WINGDINGS[ch];
  if (/zapf|dingbat/i.test(font) && ZAPF[ch]) return ZAPF[ch];
  return /ornament|fleuron/i.test(font) ? "❧" : "•";
}

function readPage(page, textSeq = new Map()) {
  const M = page.module;            // emscripten 모듈 (래퍼가 타입만 숨겨 둔 것)
  const fontUse = new Map();        // 글꼴 이름 → { obj: 그 글꼴의 글자 개체, chars: 이 쪽에 나온 소문자 }
  const h = page.pageIdx;           // FPDF_PAGE 핸들
  const W = M._FPDF_GetPageWidth(h);
  const H = M._FPDF_GetPageHeight(h);
  // 글자 좌표도 보이는 영역(CropBox) 기준으로(extract-objects.js pageOrigin 참고)
  const { x: OX, top: OT } = pageOrigin(page);
  const tp = M._FPDFText_LoadPage(h);
  if (!tp) throw new Error("text page load failed");

  const malloc = (n) => M.wasmExports.malloc(n);
  const free = (p) => M.wasmExports.free(p);
  const buf = malloc(64);           // double 2개 / float 4개 / 기타 임시 공간
  const fontBufLen = 256;
  const fontBuf = malloc(fontBufLen);
  const glyphs = [];

  try {
    const n = M._FPDFText_CountChars(tp);
    for (let i = 0; i < n; i++) {
      const code = M._FPDFText_GetUnicode(tp, i);
      const generated = M._FPDFText_IsGenerated(tp, i) === 1;
      // 글자 코드가 없는 글자(ToUnicode 누락 글꼴 등)도 버리지 않는다.
      // 무엇인지 모르므로 U+FFFD(�)로 자리를 표시하고 unreadable 로 남긴다.
      const unreadable = code === 0 && !generated;
      if (code === 0 && generated) continue;
      let c = unreadable ? "\ufffd" : String.fromCodePoint(code);

      // PDFium이 만들어 넣은 줄바꿈 문자는 버린다(줄은 우리가 직접 판정).
      if (c === "\r" || c === "\n") continue;

      // loose char box: FS_RECTF {left, top, right, bottom} float32
      let x0, y0, x1, y1;
      if (M._FPDFText_GetLooseCharBox(tp, i, buf)) {
        const f = M.HEAPF32, k = buf >> 2;
        const L = f[k], T = f[k + 1], R = f[k + 2], B = f[k + 3];
        x0 = L - OX; x1 = R - OX; y0 = OT - T; y1 = OT - B;
      } else {
        continue;
      }

      // origin (baseline)
      let ox = x0, oy = y1;
      if (M._FPDFText_GetCharOrigin(tp, i, buf, buf + 8)) {
        const d = M.HEAPF64, k = buf >> 3;
        ox = d[k] - OX; oy = OT - d[k + 1];
      }

      // 글꼴 크기 × 글자 행렬의 확대 비율 = 실제로 보이는 크기.
      // InDesign 등은 "1pt 글꼴을 10배 확대"처럼 기록하므로 GetFontSize만 쓰면 1이 나온다.
      let size = M._FPDFText_GetFontSize(tp, i);
      // 글자 행렬로 "회전"과 "기울임(가상 이탤릭)"을 구별한다.
      //   회전: b 가 0이 아님 → rot = atan2(b, a)
      //   기울임: b ≈ 0 이고 c 가 0이 아님 → skew = c / d (한글 글꼴의 이탤릭은 대부분 이 방식)
      // PDFium의 GetCharAngle 은 둘을 구별하지 않아서, 기울인 글자를 회전된 글자로 착각하게 된다.
      let rot = 0, skew = 0, hscale = 1;
      if (M._FPDFText_GetMatrix(tp, i, buf)) {
        const f = M.HEAPF32, k = buf >> 2;              // FS_MATRIX {a,b,c,d,e,f} float32
        const ma = f[k], mb = f[k + 1], mc = f[k + 2], md = f[k + 3];
        // 크기는 세로 배율로(장평이 있으면 가로 배율이 달라지므로), 회전된 글자는 전체 배율로
        const upright = Math.abs(mb) < Math.abs(ma) * 0.02 && Math.abs(md) > 0;
        const scale = upright ? Math.abs(md) : Math.sqrt(Math.abs(ma * md - mb * mc));
        if (scale > 0 && Math.abs(scale - 1) > 1e-3) size *= scale;
        if (upright) hscale = Math.round((Math.abs(ma) / Math.abs(md)) * 100) / 100;   // 장평(가로 비율)
        rot = Math.atan2(mb, ma);
        if (Math.abs(mb) < Math.abs(ma) * 0.02 && md !== 0) skew = mc / md;
      } else {
        rot = M._FPDFText_GetCharAngle(tp, i);
      }
      // 그래도 글자 상자 높이와 크게 어긋나면 상자 높이로 대신한다(상자 높이 ≈ 글자 크기의 1~1.3배)
      const boxH = y1 - y0;
      // (회전된 글자는 상자 높이가 글자 폭이 되므로 이 보정을 하지 않는다. 공백은 상자가 납작하므로 제외)
      if (boxH > 0 && Math.abs(Math.sin(rot)) < 0.3 && !/\s/.test(c) && (size < boxH * 0.25 || size > boxH * 4)) size = boxH / 1.15;   // 확실히 망가진 값만(글꼴마다 상자 높이가 크게 다르다)
      let font = "";
      const len = M._FPDFText_GetFontInfo(tp, i, fontBuf, fontBufLen, buf + 32);
      if (len > 1) {
        const u8 = M.HEAPU8.subarray(fontBuf, fontBuf + Math.min(len, fontBufLen) - 1);
        font = new TextDecoder().decode(u8);
      }
      if (!font) {                   // 일부 PDF는 FontInfo가 비어 있어 텍스트 객체의 글꼴에서 다시 시도
        const obj = M._FPDFText_GetTextObject(tp, i);
        const f = obj ? M._FPDFTextObj_GetFont(obj) : 0;
        const n2 = f ? M._FPDFFont_GetBaseFontName(f, fontBuf, fontBufLen) : 0;
        if (n2 > 1) font = new TextDecoder().decode(M.HEAPU8.subarray(fontBuf, fontBuf + n2 - 1));
      }
      font = font.replace(/^[A-Z]{6}\+/, "");   // 서브셋 접두어(ABCDEF+) 제거
      c = symbolFontChar(font, c);               // 장식 기호 글꼴의 알파벳 자리 글자 → 기호
      // 보이지 않게 그려지는 글자(그리기 방식 3·7): 스캔본·이미지 위에 깔린 검색용 글자 층 → 이미지의 일부로 본다
      const tobj = M._FPDFText_GetTextObject(tp, i);
      const rmode = tobj ? M._FPDFTextObj_GetTextRenderMode(tobj) : 0;
      const invisible = rmode === 3 || rmode === 7;
      // 채우기 + 테두리(그리기 방식 2·6)로 그린 글자는 가짜 굵게(한글 워드프로세서가 굵은 글꼴 없이 굵게 할 때)
      const weight = rmode === 2 || rmode === 6 ? Math.max(700, M._FPDFText_GetFontWeight(tp, i)) : M._FPDFText_GetFontWeight(tp, i);
      let color = null;
      if (M._FPDFText_GetFillColor(tp, i, buf, buf + 4, buf + 8, buf + 12)) {
        const u = M.HEAPU32, k = buf >> 2;
        color = [u[k], u[k + 1], u[k + 2], u[k + 3]];
      }
      const angle = rot;                                 // 기울임은 빼고 진짜 회전만
      // 기울인 글자의 상자는 위쪽이 오른쪽으로(음수면 왼쪽으로) 밀려 넓어져 있다 → 기울기만큼 되돌린다
      const italic = Math.abs(skew) > 0.03;
      const rawBox = italic ? [x0, x1] : null;
      if (italic) {
        const ascent = Math.max(0, oy - y0), descent = Math.max(0, y1 - oy);
        if (skew > 0) { x0 += descent * skew; x1 -= ascent * skew; }
        else { x0 -= ascent * skew; x1 += descent * skew; }       // skew<0: 위쪽이 왼쪽으로
        if (x1 < x0) { const m = (x0 + x1) / 2; x0 = m; x1 = m; }
      }
      const hyphen = M._FPDFText_IsHyphen(tp, i) === 1;
      const unicodeError = M._FPDFText_HasUnicodeMapError(tp, i) === 1;

      const seq = tobj && textSeq.has(tobj) ? textSeq.get(tobj) : -1;   // 그려지는 순서(모르면 -1: 가려짐 판단 안 함)
      if (tobj && /[a-z]/.test(c)) {        // 글꼴별로 이 쪽에 나온 소문자(대문자형 글꼴 찾기용)
        let e = fontUse.get(font); if (!e) fontUse.set(font, (e = { obj: tobj, chars: new Set() }));
        e.chars.add(c);
      }
      glyphs.push({ c, x0, y0, x1, y1, ox, oy, size, font, weight, angle, italic, skew, rawBox, color, hscale, invisible, ci: i, seq,
                    generated, hyphen, unicodeError: unicodeError || unreadable, unreadable });
    }
    // 대문자형 글꼴의 소문자는 대문자로(글꼴 개체가 살아 있는 동안 윤곽선을 읽는다)
    const caps = fontUse.size ? capsFontsOf(M, fontUse, buf) : null;
    if (caps?.size) for (const g of glyphs) if (caps.has(g.font) && /[a-z]/.test(g.c)) { g.c = g.c.toUpperCase(); g.capsFont = true; }
  } finally {
    free(buf); free(fontBuf);
    M._FPDFText_ClosePage(tp);
  }
  return { index: page.number, width: W, height: H, glyphs };
}
