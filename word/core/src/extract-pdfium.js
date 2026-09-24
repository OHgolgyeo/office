// PDFium(MIT 래퍼 @hyzyla/pdfium, PDFium 자체는 BSD) 로 글자 단위 정보를 뽑는 어댑터.
// 결과 좌표계: 페이지 왼쪽 위가 (0,0), 단위 pt. y는 아래로 증가.
//
// 이 파일만 PDF 엔진에 의존한다. reconstruct.js 는 여기서 나온 glyph 배열만 본다.

import { PDFiumLibrary } from "@hyzyla/pdfium";
import { readPageObjects, exportImage, renderPagePNG } from "./extract-objects.js";
import { collectFontGlyphs, buildFonts } from "./extract-fonts.js";

let libPromise = null;
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
export async function extractGlyphs(bytes, opts = {}) {
  const lib = await getLibrary();
  const doc = await lib.loadDocument(bytes);
  const pages = [];
  const fontAcc = opts.fonts ? new Map() : null;
  let fonts = null;
  try {
    for (const page of doc.pages()) {
      const p = readPage(page);
      if (fontAcc) collectFontGlyphs(page, fontAcc);
      // 이미지·선 개체(위치는 항상, 이미지 파일 데이터는 opts.images 일 때만)
      const { images, paths } = readPageObjects(page);
      p.images = images.map((img) => {
        const out = { ...img };
        if (opts.maxImageSide) img.maxSide = opts.maxImageSide;
        if ((opts.images && !img.background) || (opts.backgrounds && img.background)) out.file = exportImage(doc, page, img);
        delete out._obj; delete out._m;
        return out;
      });
      p.paths = paths;
      if (opts.pageImages) p.render = renderPagePNG(page, opts.pageImageScale || 1.5);
      pages.push(p);
    }
    if (fontAcc) {
      // 글꼴마다 쓰인 장평 값들 → 장평별 변형 글꼴
      const variants = new Map();
      for (const p of pages) for (const g of p.glyphs) {
        const n = (g.font || "").replace(/^[A-Z]{6}\+/, "");
        if (!variants.has(n)) variants.set(n, new Set());
        variants.get(n).add(g.hscale || 1);
      }
      fonts = buildFonts(fontAcc, variants);
    }
  } finally {
    doc.destroy();
  }
  return { pages, fonts };
}

function readPage(page) {
  const M = page.module;            // emscripten 모듈 (래퍼가 타입만 숨겨 둔 것)
  const h = page.pageIdx;           // FPDF_PAGE 핸들
  const W = M._FPDF_GetPageWidth(h);
  const H = M._FPDF_GetPageHeight(h);
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
      const c = unreadable ? "\ufffd" : String.fromCodePoint(code);

      // PDFium이 만들어 넣은 줄바꿈 문자는 버린다(줄은 우리가 직접 판정).
      if (c === "\r" || c === "\n") continue;

      // loose char box: FS_RECTF {left, top, right, bottom} float32
      let x0, y0, x1, y1;
      if (M._FPDFText_GetLooseCharBox(tp, i, buf)) {
        const f = M.HEAPF32, k = buf >> 2;
        const L = f[k], T = f[k + 1], R = f[k + 2], B = f[k + 3];
        x0 = L; x1 = R; y0 = H - T; y1 = H - B;
      } else {
        continue;
      }

      // origin (baseline)
      let ox = x0, oy = y1;
      if (M._FPDFText_GetCharOrigin(tp, i, buf, buf + 8)) {
        const d = M.HEAPF64, k = buf >> 3;
        ox = d[k]; oy = H - d[k + 1];
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
      // 보이지 않게 그려지는 글자(그리기 방식 3·7): 스캔본·이미지 위에 깔린 검색용 글자 층 → 이미지의 일부로 본다
      const tobj = M._FPDFText_GetTextObject(tp, i);
      const rmode = tobj ? M._FPDFTextObj_GetTextRenderMode(tobj) : 0;
      const invisible = rmode === 3 || rmode === 7;
      const weight = M._FPDFText_GetFontWeight(tp, i);
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

      glyphs.push({ c, x0, y0, x1, y1, ox, oy, size, font, weight, angle, italic, skew, rawBox, color, hscale, invisible, ci: i,
                    generated, hyphen, unicodeError: unicodeError || unreadable, unreadable });
    }
  } finally {
    free(buf); free(fontBuf);
    M._FPDFText_ClosePage(tp);
  }
  return { index: page.number, width: W, height: H, glyphs };
}
