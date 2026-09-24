// 쪽 안의 글자 외 개체(이미지, 선·도형)를 읽는다. PDFium 전용.
// 좌표는 extract-pdfium.js 와 같다: 왼쪽 위 (0,0), 단위 pt, y는 아래로 증가.
//
// 이미지 내보내기 원칙
//  - JPEG(RGB/회색)는 다시 압축하지 않고 원본 바이트를 그대로 저장 → 화질 손실 없음
//  - 그 밖의 형식이나 투명도가 있는 이미지는 원래 해상도로 렌더링해서 PNG(투명도 포함)로 저장
import { PNG } from "pngjs";
import jpeg from "jpeg-js";

const OBJ = { TEXT: 1, PATH: 2, IMAGE: 3, SHADING: 4, FORM: 5 };

function readMatrix(M, obj, buf) {
  if (!M._FPDFPageObj_GetMatrix(obj, buf)) return [1, 0, 0, 1, 0, 0];
  const f = M.HEAPF32, k = buf >> 2;
  return [f[k], f[k + 1], f[k + 2], f[k + 3], f[k + 4], f[k + 5]];
}
// PDF 행렬 곱: 먼저 m1, 그다음 m2 를 적용
const mul = (m1, m2) => [
  m1[0] * m2[0] + m1[1] * m2[2], m1[0] * m2[1] + m1[1] * m2[3],
  m1[2] * m2[0] + m1[3] * m2[2], m1[2] * m2[1] + m1[3] * m2[3],
  m1[4] * m2[0] + m1[5] * m2[2] + m2[4], m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function readString(M, fn, obj, idx) {
  const len = fn(obj, idx, 0, 0);
  if (len <= 1) return "";
  const p = M.wasmExports.malloc(len);
  try { fn(obj, idx, p, len); return new TextDecoder().decode(M.HEAPU8.subarray(p, p + len - 1)); }
  finally { M.wasmExports.free(p); }
}

/**
 * 쪽의 이미지·선 개체 목록.
 * @returns {{ images: Img[], paths: PathObj[] }}
 * Img = { id, bbox:[x0,y0,x1,y1], px:[w,h], filters:string[], bpp, colorspace, hasAlpha, background, _obj, _parents }
 */
export function readPageObjects(page) {
  const M = page.module, h = page.pageIdx;
  const W = M._FPDF_GetPageWidth(h), H = M._FPDF_GetPageHeight(h);
  const buf = M.wasmExports.malloc(64);
  const images = [], paths = [];
  let seq = 0;                                     // PDF에 그려지는 순서(겹침 순서 재현용)
  const walk = (count, get, parentM, depth) => {
    for (let i = 0; i < count; i++) {
      const obj = get(i);
      const type = M._FPDFPageObj_GetType(obj);
      if (type === OBJ.FORM) {
        const fm = mul(readMatrix(M, obj, buf), parentM);
        walk(M._FPDFFormObj_CountObjects(obj), (k) => M._FPDFFormObj_GetObject(obj, k), fm, depth + 1);
        continue;
      }
      if (type !== OBJ.IMAGE && type !== OBJ.PATH) continue;
      let bbox;
      if (type === OBJ.IMAGE) {
        // 이미지 행렬은 단위 정사각형을 쪽 공간으로 옮긴다
        const m = mul(readMatrix(M, obj, buf), parentM);
        const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => apply(m, x, y));
        bbox = bboxOf(pts, H);
        if (!M._FPDFImageObj_GetImagePixelSize(obj, buf, buf + 4)) continue;
        const pw = M.HEAPU32[buf >> 2], ph = M.HEAPU32[(buf >> 2) + 1];
        const nf = M._FPDFImageObj_GetImageFilterCount(obj);
        const filters = [];
        for (let k = 0; k < nf; k++) filters.push(readString(M, M._FPDFImageObj_GetImageFilter, obj, k));
        // FPDF_IMAGEOBJ_METADATA { uint width, height; float hdpi, vdpi; uint bpp; int colorspace; int marked_content_id }
        let bpp = 0, colorspace = 0;
        if (M._FPDFImageObj_GetImageMetadata(obj, h, buf)) { bpp = M.HEAPU32[(buf >> 2) + 4]; colorspace = M.HEAP32[(buf >> 2) + 5]; }
        const area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
        images.push({
          id: `p${page.number}-img${images.length}`, bbox, px: [pw, ph], filters, bpp, colorspace,
          hasAlpha: M._FPDFPageObj_HasTransparency(obj) === 1,
          background: area > W * H * 0.5,       // 쪽 대부분을 덮는 배경 질감
          inForm: depth > 0, _obj: obj, _m: m, seq: seq++,
        });
      } else {
        if (!M._FPDFPageObj_GetBounds(obj, buf, buf + 4, buf + 8, buf + 12)) continue;
        const f = M.HEAPF32, k = buf >> 2;
        const pts = [[f[k], f[k + 1]], [f[k + 2], f[k + 3]]].map(([x, y]) => apply(parentM, x, y));
        // 채움/선 여부와 색(지면 그대로 재현용)
        let fill = null, stroke = null, strokeWidth = 0;
        const dm = M._FPDFPath_GetDrawMode(obj, buf + 16, buf + 20);
        const fillMode = dm ? M.HEAP32[(buf + 16) >> 2] : 0, doStroke = dm ? M.HEAP32[(buf + 20) >> 2] : 0;
        const col = (fn) => fn(obj, buf + 24, buf + 28, buf + 32, buf + 36) ? [M.HEAPU32[(buf + 24) >> 2], M.HEAPU32[(buf + 28) >> 2], M.HEAPU32[(buf + 32) >> 2], M.HEAPU32[(buf + 36) >> 2]] : null;
        if (fillMode) fill = col(M._FPDFPageObj_GetFillColor);
        if (doStroke) { stroke = col(M._FPDFPageObj_GetStrokeColor); if (M._FPDFPageObj_GetStrokeWidth(obj, buf + 40)) strokeWidth = M.HEAPF32[(buf + 40) >> 2]; }
        // 실제 모양: 경로 조각을 쪽 좌표(왼쪽 위 원점)로 옮겨 SVG 경로로
        const pm = mul(readMatrix(M, obj, buf), parentM);
        const nseg = M._FPDFPath_CountSegments(obj);
        let d = "", pend = [];
        const P = (x, y) => { const [X, Y] = apply(pm, x, y); return `${X.toFixed(2)} ${(H - Y).toFixed(2)}`; };
        for (let k = 0; k < nseg && k < 20000; k++) {
          const sg = M._FPDFPath_GetPathSegment(obj, k);
          M._FPDFPathSegment_GetPoint(sg, buf + 44, buf + 48);
          const x = M.HEAPF32[(buf + 44) >> 2], y = M.HEAPF32[(buf + 48) >> 2];
          const t = M._FPDFPathSegment_GetType(sg);
          if (t === 2) d += `M${P(x, y)}`;
          else if (t === 0) d += `L${P(x, y)}`;
          else if (t === 1) { pend.push(P(x, y)); if (pend.length === 3) { d += `C${pend.join(" ")}`; pend = []; } }
          if (M._FPDFPathSegment_GetClose(sg)) d += "Z";
        }
        const scale = Math.sqrt(Math.abs(pm[0] * pm[3] - pm[1] * pm[2])) || 1;
        paths.push({ bbox: bboxOf(pts, H), segments: nseg, fill, stroke, strokeWidth: strokeWidth * scale,
          d, fillRule: fillMode === 1 ? "evenodd" : "nonzero", seq: seq++ });
      }
    }
  };
  try {
    walk(M._FPDFPage_CountObjects(h), (i) => M._FPDFPage_GetObject(h, i), [1, 0, 0, 1, 0, 0], 0);
  } finally { M.wasmExports.free(buf); }
  return { images, paths };
}

function bboxOf(pts, H) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => H - p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * 이미지 하나를 파일 데이터로 꺼낸다.
 * @returns {{ ext: "jpg"|"png", data: Uint8Array, how: string } | null}
 */
export function exportImage(doc, page, img) {
  const M = page.module, obj = img._obj;
  // 1) 먼저 원래 해상도로 렌더링해 본다(투명도 마스크까지 반영).
  //    PDFium의 "투명도 있음" 표시는 별도 마스크(SMask)를 놓치는 경우가 있어서 실제 픽셀로 확인한다.
  const rendered = renderImage(doc, page, img);
  const isJpeg = img.filters.length === 1 && img.filters[0] === "DCTDecode";
  // 2) 완전히 불투명한 RGB/회색 JPEG 이면 원본 바이트를 그대로(다시 압축하지 않음, CMYK=32bpp 제외)
  if (isJpeg && rendered && rendered.opaque && (img.bpp === 24 || img.bpp === 8)) {
    const len = M._FPDFImageObj_GetImageDataRaw(obj, 0, 0);
    if (len > 0) {
      const p = M.wasmExports.malloc(len);
      try { M._FPDFImageObj_GetImageDataRaw(obj, p, len); return { ext: "jpg", data: M.HEAPU8.slice(p, p + len), how: "원본 JPEG 그대로" }; }
      finally { M.wasmExports.free(p); }
    }
  }
  if (!rendered) return null;
  return { ext: "png", data: PNG.sync.write(rendered.png), how: rendered.opaque ? "원래 해상도로 렌더링" : "투명도(마스크) 포함 렌더링" };
}

// 이미지 하나를 원래 픽셀 크기로 렌더링. GetRenderedBitmap 은 쪽 크기(1pt=1px)로 그리므로
// 잠시 이미지 행렬을 원래 픽셀 크기로 키웠다가 되돌린다.
function renderImage(doc, page, img) {
  const M = page.module, obj = img._obj;
  const buf = M.wasmExports.malloc(32);
  let bmp = 0;
  try {
    const [a, b, c, d, e, f] = readMatrix(M, obj, buf);
    const cur = Math.hypot(a, b) || 1, curH = Math.hypot(c, d) || 1;
    // 원래 픽셀 크기로(단, 긴 변 최대 maxSide 픽셀 — 쪽 배경 질감처럼 거대한 이미지가 파일을 부풀리지 않게)
    const lim = Math.min(1, (img.maxSide || 2400) / Math.max(img.px[0], img.px[1]));
    const sx = Math.min((img.px[0] * lim) / cur, 8), sy = Math.min((img.px[1] * lim) / curH, 8);
    M._FPDFImageObj_SetMatrix(obj, a * sx, b * sx, c * sy, d * sy, e, f);
    try { bmp = M._FPDFImageObj_GetRenderedBitmap(doc.documentIdx, page.pageIdx, obj); }
    finally { M._FPDFImageObj_SetMatrix(obj, a, b, c, d, e, f); }
    if (!bmp) return null;
    const w = M._FPDFBitmap_GetWidth(bmp), hgt = M._FPDFBitmap_GetHeight(bmp), stride = M._FPDFBitmap_GetStride(bmp);
    const fmt = M._FPDFBitmap_GetFormat(bmp);            // 1 회색, 2 BGR, 3 BGRx, 4 BGRA
    const base = M._FPDFBitmap_GetBuffer(bmp);
    const src = M.HEAPU8.subarray(base, base + stride * hgt);
    const png = new PNG({ width: w, height: hgt });
    const bppx = fmt === 1 ? 1 : fmt === 2 ? 3 : 4;
    let opaque = true;
    for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
      const s = y * stride + x * bppx, t = (y * w + x) * 4;
      if (bppx === 1) { png.data[t] = png.data[t + 1] = png.data[t + 2] = src[s]; png.data[t + 3] = 255; }
      else {
        png.data[t] = src[s + 2]; png.data[t + 1] = src[s + 1]; png.data[t + 2] = src[s];
        const al = fmt === 4 ? src[s + 3] : 255;
        png.data[t + 3] = al;
        if (al < 250) opaque = false;
      }
    }
    return { png, opaque };
  } finally {
    if (bmp) M._FPDFBitmap_Destroy(bmp);
    M.wasmExports.free(buf);
  }
}


/** 쪽 전체를 PNG로 렌더링(비교용 원본 이미지). scale: pt 당 픽셀 수 */
export function renderPagePNG(page, scale = 1.5) {
  const M = page.module, h = page.pageIdx;
  const W = Math.round(M._FPDF_GetPageWidth(h) * scale), H = Math.round(M._FPDF_GetPageHeight(h) * scale);
  const bmp = M._FPDFBitmap_Create(W, H, 1);
  try {
    M._FPDFBitmap_FillRect(bmp, 0, 0, W, H, 0xffffffff);
    M._FPDF_RenderPageBitmap(bmp, h, 0, 0, W, H, 0, 0x01);   // 주석 포함(0x10 은 바이트 순서를 뒤집으므로 쓰지 않음)
    const stride = M._FPDFBitmap_GetStride(bmp), base = M._FPDFBitmap_GetBuffer(bmp);
    const src = M.HEAPU8.subarray(base, base + stride * H);
    const png = new PNG({ width: W, height: H });
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const s2 = y * stride + x * 4, t = (y * W + x) * 4;
      png.data[t] = src[s2 + 2]; png.data[t + 1] = src[s2 + 1]; png.data[t + 2] = src[s2]; png.data[t + 3] = 255;
    }
    return PNG.sync.write(png);
  } finally { M._FPDFBitmap_Destroy(bmp); }
}

/** 쪽 하나를 바로 JPEG 로(보기 화면용, PNG 를 거치지 않아 빠르다) */
export function renderPageJpeg(page, scale = 1.25, quality = 82, hideChars = null) {
  const M = page.module, h = page.pageIdx;
  // hideChars: 지울 글자 번호들 → 그 글자가 속한 글자 객체를 잠시 "보이지 않게 그리기"로 바꿨다가 되돌린다
  const restore = [];
  if (hideChars && hideChars.length) {
    const tp = M._FPDFText_LoadPage(h);
    const objs = new Set();
    for (const ci of hideChars) { const o = M._FPDFText_GetTextObject(tp, ci); if (o) objs.add(o); }
    for (const o of objs) { restore.push([o, M._FPDFTextObj_GetTextRenderMode(o)]); M._FPDFTextObj_SetTextRenderMode(o, 3); }
    M._FPDFText_ClosePage(tp);
  }
  try { return renderJpegInner(M, h, scale, quality); }
  finally { for (const [o, mode] of restore) M._FPDFTextObj_SetTextRenderMode(o, mode); }
}
function renderJpegInner(M, h, scale, quality) {
  const W = Math.round(M._FPDF_GetPageWidth(h) * scale), H = Math.round(M._FPDF_GetPageHeight(h) * scale);
  const bmp = M._FPDFBitmap_Create(W, H, 1);
  try {
    M._FPDFBitmap_FillRect(bmp, 0, 0, W, H, 0xffffffff);
    M._FPDF_RenderPageBitmap(bmp, h, 0, 0, W, H, 0, 0x01);
    const stride = M._FPDFBitmap_GetStride(bmp), base = M._FPDFBitmap_GetBuffer(bmp);
    const src = M.HEAPU8.subarray(base, base + stride * H);
    const rgba = Buffer.alloc(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const s = y * stride + x * 4, t = (y * W + x) * 4;
      rgba[t] = src[s + 2]; rgba[t + 1] = src[s + 1]; rgba[t + 2] = src[s]; rgba[t + 3] = 255;
    }
    return jpeg.encode({ data: rgba, width: W, height: H }, quality).data;
  } finally { M._FPDFBitmap_Destroy(bmp); }
}
