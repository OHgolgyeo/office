// 쪽 안의 글자 외 개체(이미지, 선·도형)를 읽는다. PDFium 전용.
// 좌표는 extract-pdfium.js 와 같다: 왼쪽 위 (0,0), 단위 pt, y는 아래로 증가.
//
// 이미지 내보내기 원칙
//  - JPEG(RGB/회색)는 다시 압축하지 않고 원본 바이트를 그대로 저장 → 화질 손실 없음
//  - 그 밖의 형식이나 투명도가 있는 이미지는 원래 해상도로 렌더링해서 PNG(투명도 포함)로 저장
import { PNG } from "pngjs";
import jpeg from "jpeg-js";

// Electron 안(메인 프로세스)에서는 내장 이미지 변환(nativeImage)으로 JPEG 를 만든다(자바스크립트 변환보다 훨씬 빠르다)
let nativeImage = null;
if (process.versions && process.versions.electron) {
  try { ({ nativeImage } = await import("electron")); } catch { nativeImage = null; }
}

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
  const origin = pageOrigin(page);                 // 보이는 영역 기준 좌표로
  const buf = M.wasmExports.malloc(64);
  const images = [], paths = [];
  const textSeq = new Map();                       // 텍스트 개체 → 그려지는 순서(그림 밑에 가려진 글자 찾기용)
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
      if (type === OBJ.TEXT) { textSeq.set(obj, seq++); continue; }
      if (type !== OBJ.IMAGE && type !== OBJ.PATH) continue;
      let bbox;
      if (type === OBJ.IMAGE) {
        // 이미지 행렬은 단위 정사각형을 쪽 공간으로 옮긴다
        const m = mul(readMatrix(M, obj, buf), parentM);
        const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => apply(m, x, y));
        bbox = bboxOf(pts, origin);
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
          rawLen: M._FPDFImageObj_GetImageDataRaw(obj, 0, 0),   // 같은 그림(같은 데이터)이 여러 쪽에 쓰였는지 가리는 데 쓴다
          hasAlpha: M._FPDFPageObj_HasTransparency(obj) === 1,
          background: area > W * H * 0.5,       // 쪽 대부분을 덮는 배경 질감
          // 기울여 놓은 그림(90° 단위 회전이 아닌 회전·비틀림): 원본을 꺼내면 가장자리가 잘려 보이는 그대로 그린다(reconstruct.js)
          tilted: !((Math.abs(m[1]) < Math.abs(m[0]) * 0.01 && Math.abs(m[2]) < Math.abs(m[3]) * 0.01)
            || (Math.abs(m[0]) < Math.abs(m[1]) * 0.01 && Math.abs(m[3]) < Math.abs(m[2]) * 0.01)),
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
        const P = (x, y) => { const [X, Y] = apply(pm, x, y); return `${(X - origin.x).toFixed(2)} ${(origin.top - Y).toFixed(2)}`; };
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
        paths.push({ bbox: bboxOf(pts, origin), segments: nseg, fill, stroke, strokeWidth: strokeWidth * scale,
          d, fillRule: fillMode === 1 ? "evenodd" : "nonzero", seq: seq++ });
      }
    }
  };
  try {
    walk(M._FPDFPage_CountObjects(h), (i) => M._FPDFPage_GetObject(h, i), [1, 0, 0, 1, 0, 0], 0);
  } finally { M.wasmExports.free(buf); }
  return { images, paths, textSeq };
}

function bboxOf(pts, origin) {
  const xs = pts.map((p) => p[0] - origin.x), ys = pts.map((p) => origin.top - p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** 쪽에서 실제로 보이는 영역(CropBox)의 왼쪽·위 — PDFium 은 개체·글자 좌표를 용지(MediaBox) 기준으로 준다.
 *  펼침 표지처럼 용지는 넓고 보이는 곳은 일부인 쪽에서, 좌표를 보이는 영역 기준(왼쪽 위 0,0)으로 옮기는 데 쓴다. */
export function pageOrigin(page) {
  const M = page.module, h = page.pageIdx, buf = M.wasmExports.malloc(16);
  try {
    if (M._FPDFPage_GetCropBox(h, buf, buf + 4, buf + 8, buf + 12)) {
      const f = M.HEAPF32, k = buf >> 2;
      return { x: Math.min(f[k], f[k + 2]), top: Math.max(f[k + 1], f[k + 3]) };
    }
  } finally { M.wasmExports.free(buf); }
  return { x: 0, top: M._FPDF_GetPageHeight(h) };
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
    // 그림에 걸린 잘라내기 경로(clip)는 원본을 꺼낼 때 무시한다: 뒤 사진 틀에 맞춰 잘리게 놓은 그림(전단 등)도 원본 전체를,
    // 그리고 해상도를 올리려고 키운 그림이 원래 크기의 잘라내기 경로에 걸려 잘리지 않게. 그림 중심을 기준으로 아주 크게
    // 늘렸다가(사실상 없앰) 끝나면 정확히 되돌린다.
    const S = 1e4, cx = (a + c) / 2 + e, cy = (b + d) / 2 + f;
    const clipped = !!M._FPDFPageObj_GetClipPath(obj);
    M._FPDFImageObj_SetMatrix(obj, a * sx, b * sx, c * sy, d * sy, e, f);
    if (clipped) M._FPDFPageObj_TransformClipPath(obj, S, 0, 0, S, cx * (1 - S), cy * (1 - S));
    try { bmp = M._FPDFImageObj_GetRenderedBitmap(doc.documentIdx, page.pageIdx, obj); }
    finally {
      M._FPDFImageObj_SetMatrix(obj, a, b, c, d, e, f);
      if (clipped) M._FPDFPageObj_TransformClipPath(obj, 1 / S, 0, 0, 1 / S, cx * (1 - 1 / S), cy * (1 - 1 / S));
    }
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


/** 쪽의 한 부분(region, pt)을 가로 W × 세로 H 픽셀 그림으로 그린다(가로세로 배율이 달라도 된다).
 *  반환: { data: Uint8Array(RGB, 한 점에 3바이트), w, h } — 표 인식 모델(core/ppstructure.js) 입력용 */
export function renderRegionRGB(page, region, W, H) {
  const M = page.module, h = page.pageIdx;
  const PW = M._FPDF_GetPageWidth(h), PH = M._FPDF_GetPageHeight(h);
  const sx = W / Math.max(1e-3, region[2] - region[0]), sy = H / Math.max(1e-3, region[3] - region[1]);
  const bmp = M._FPDFBitmap_Create(W, H, 1);
  try {
    M._FPDFBitmap_FillRect(bmp, 0, 0, W, H, 0xffffffff);
    M._FPDF_RenderPageBitmap(bmp, h, -Math.round(region[0] * sx), -Math.round(region[1] * sy), Math.round(PW * sx), Math.round(PH * sy), 0, 0);
    const stride = M._FPDFBitmap_GetStride(bmp), base = M._FPDFBitmap_GetBuffer(bmp);
    const out = new Uint8Array(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const s = base + y * stride + x * 4, t = (y * W + x) * 3;
      out[t] = M.HEAPU8[s + 2]; out[t + 1] = M.HEAPU8[s + 1]; out[t + 2] = M.HEAPU8[s];   // BGRA → RGB
    }
    return { data: out, w: W, h: H };
  } finally { M._FPDFBitmap_Destroy(bmp); }
}

/** 쪽의 한 부분(pt)을 보이는 그대로 작게 그려 평균 색(#rrggbb)을 구한다. 글상자 바탕색에 쓴다.
 *  글자는 바탕보다 적으므로, 밝기가 중간값에서 크게 벗어난 점(글자·테두리)은 빼고 평균한다. */
export function regionAverageColor(page, region) {
  const M = page.module, h = page.pageIdx;
  const PW = M._FPDF_GetPageWidth(h), PH = M._FPDF_GetPageHeight(h);
  const scale = Math.min(1, 64 / Math.max(1, region[2] - region[0], region[3] - region[1]));
  const W = Math.max(1, Math.round((region[2] - region[0]) * scale)), H = Math.max(1, Math.round((region[3] - region[1]) * scale));
  const bmp = M._FPDFBitmap_Create(W, H, 1);
  try {
    M._FPDFBitmap_FillRect(bmp, 0, 0, W, H, 0xffffffff);
    M._FPDF_RenderPageBitmap(bmp, h, -Math.round(region[0] * scale), -Math.round(region[1] * scale), Math.round(PW * scale), Math.round(PH * scale), 0, 0);
    const stride = M._FPDFBitmap_GetStride(bmp), base = M._FPDFBitmap_GetBuffer(bmp), px = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = base + y * stride + x * 4; px.push([M.HEAPU8[s + 2], M.HEAPU8[s + 1], M.HEAPU8[s]]); }
    const lum = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
    const mid = px.map(lum).sort((a, b) => a - b)[px.length >> 1];
    const keep = px.filter((c) => Math.abs(lum(c) - mid) < 40);
    const avg = [0, 1, 2].map((k) => Math.round(keep.reduce((s, c) => s + c[k], 0) / Math.max(1, keep.length)));
    return "#" + avg.map((v) => v.toString(16).padStart(2, "0")).join("");
  } finally { M._FPDFBitmap_Destroy(bmp); }
}

/** 영역에서 가장 많이 보이는 색(글 밑에 깔린 종이 색). 글자 획은 적은 쪽이라 빠진다.
 *  가운데 밝기 색(regionAverageColor)은 장식 테두리·글 양에 따라 같은 모양의 카드도 회색·흰색으로 갈렸다. */
export function regionBackgroundColor(page, region) {
  const M = page.module, h = page.pageIdx;
  const PW = M._FPDF_GetPageWidth(h), PH = M._FPDF_GetPageHeight(h);
  const scale = Math.min(2, 160 / Math.max(1, region[2] - region[0], region[3] - region[1]));
  const W = Math.max(1, Math.round((region[2] - region[0]) * scale)), H = Math.max(1, Math.round((region[3] - region[1]) * scale));
  const bmp = M._FPDFBitmap_Create(W, H, 1);
  try {
    M._FPDFBitmap_FillRect(bmp, 0, 0, W, H, 0xffffffff);
    M._FPDF_RenderPageBitmap(bmp, h, -Math.round(region[0] * scale), -Math.round(region[1] * scale), Math.round(PW * scale), Math.round(PH * scale), 0, 0);
    const stride = M._FPDFBitmap_GetStride(bmp), base = M._FPDFBitmap_GetBuffer(bmp);
    const bins = new Map();                                   // 채널마다 16단계로 묶어 센다(종이 질감의 작은 얼룩은 한 칸에)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const s = base + y * stride + x * 4, r = M.HEAPU8[s + 2], g = M.HEAPU8[s + 1], b = M.HEAPU8[s];
      const k = (r >> 4) << 8 | (g >> 4) << 4 | (b >> 4);
      const e = bins.get(k) || bins.set(k, [0, 0, 0, 0]).get(k);
      e[0]++; e[1] += r; e[2] += g; e[3] += b;
    }
    let best = null;
    for (const e of bins.values()) if (!best || e[0] > best[0]) best = e;
    return "#" + [1, 2, 3].map((k) => Math.round(best[k] / best[0]).toString(16).padStart(2, "0")).join("");
  } finally { M._FPDFBitmap_Destroy(bmp); }
}

/** fn 을 부르는 동안 글자 번호(hide, 텍스트 쪽의 char index)가 든 텍스트 개체를 보이지 않게(그리기 방식 3) 해 둔다 */
export function withHiddenText(page, hide, fn) {
  if (!hide || !hide.length) return fn();
  const M = page.module, restore = [], tp = M._FPDFText_LoadPage(page.pageIdx), objs = new Set();
  try {
    for (const ci of hide) { const o = M._FPDFText_GetTextObject(tp, ci); if (o) objs.add(o); }
    for (const o of objs) { restore.push([o, M._FPDFTextObj_GetTextRenderMode(o)]); M._FPDFTextObj_SetTextRenderMode(o, 3); }
    return fn();
  } finally {
    for (const [o, m] of restore) M._FPDFTextObj_SetTextRenderMode(o, m);
    M._FPDFText_ClosePage(tp);
  }
}

/** fn 을 부르는 동안 keepIds(readPageObjects 의 그림 id) 그림만 남기고 쪽의 다른 개체(글자·선·다른 그림)를
 *  쪽 밖으로 잠시 옮겨 둔다. 겹쳐 저장된 한 장식(띠 + 촉수 그림)을 종이 배경·글자 없이 한 장으로 그릴 때 쓴다.
 *  keepText 면 글자·선은 그대로 두고 다른 그림만 옮긴다(손글씨 쪽지처럼 그림 위 글씨까지 그려야 할 때). */
export function withOnlyImages(page, keepIds, fn, { keepText = false } = {}) {
  const M = page.module, h = page.pageIdx, keep = new Set(keepIds);
  const D = 10 * Math.max(M._FPDF_GetPageWidth(h), M._FPDF_GetPageHeight(h));
  const moved = [];
  let imageNo = 0;
  const walk = (count, get) => {
    for (let i = 0; i < count; i++) {
      const obj = get(i), type = M._FPDFPageObj_GetType(obj);
      if (type === OBJ.FORM) { walk(M._FPDFFormObj_CountObjects(obj), (k) => M._FPDFFormObj_GetObject(obj, k)); continue; }
      // 그림 번호는 readPageObjects 와 같은 순서(그림 크기를 못 읽는 그림도 번호를 건너뛰지 않게 같은 조건으로)
      if (type === OBJ.IMAGE) {
        const buf = M.wasmExports.malloc(8);
        let counted = false;
        try { counted = !!M._FPDFImageObj_GetImagePixelSize(obj, buf, buf + 4); } finally { M.wasmExports.free(buf); }
        const id = counted ? `p${page.number}-img${imageNo++}` : null;
        if (id && keep.has(id)) continue;
      } else if (keepText || (type !== OBJ.TEXT && type !== OBJ.PATH)) continue;
      M._FPDFPageObj_Transform(obj, 1, 0, 0, 1, D, 0);
      moved.push(obj);
    }
  };
  try {
    walk(M._FPDFPage_CountObjects(h), (i) => M._FPDFPage_GetObject(h, i));
    return fn();
  } finally {
    for (const obj of moved) M._FPDFPageObj_Transform(obj, 1, 0, 0, 1, -D, 0);
  }
}

/** 쪽 하나를 바로 JPEG 로(보기 화면용, PNG 를 거치지 않아 빠르다).
 *  region([x0,y0,x1,y1] pt)을 주면 쪽에서 그 부분만 보이는 그대로(그림 위 글자·선 포함) 그린다. */
export function renderPageJpeg(page, scale = 1.25, quality = 82, region = null) {
  const M = page.module, h = page.pageIdx;
  const PW = M._FPDF_GetPageWidth(h), PH = M._FPDF_GetPageHeight(h);
  const [rx0, ry0, rx1, ry1] = region || [0, 0, PW, PH];
  const W = Math.max(1, Math.round((rx1 - rx0) * scale)), H = Math.max(1, Math.round((ry1 - ry0) * scale));
  const bmp = M._FPDFBitmap_Create(W, H, 1);
  try {
    M._FPDFBitmap_FillRect(bmp, 0, 0, W, H, 0xffffffff);
    // 쪽 전체를 scale 로 그리되 region 의 왼쪽 위가 비트맵 (0,0)에 오도록 옮긴다(비트맵 밖은 잘린다)
    M._FPDF_RenderPageBitmap(bmp, h, -Math.round(rx0 * scale), -Math.round(ry0 * scale), Math.round(PW * scale), Math.round(PH * scale), 0, 0x01);
    const stride = M._FPDFBitmap_GetStride(bmp), base = M._FPDFBitmap_GetBuffer(bmp);
    // PDFium 은 BGRA 로 그린다
    const bgra = Buffer.alloc(W * H * 4);
    for (let y = 0; y < H; y++) bgra.set(M.HEAPU8.subarray(base + y * stride, base + y * stride + W * 4), y * W * 4);
    if (nativeImage) {
      try { return nativeImage.createFromBitmap(bgra, { width: W, height: H }).toJPEG(quality); } catch { /* 아래 방식으로 */ }
    }
    // 4바이트씩 한 번에 B↔R 바꾸기(글자 단위 반복보다 빠르다)
    const a = new Uint32Array(bgra.buffer, bgra.byteOffset, W * H);
    for (let i = 0; i < a.length; i++) { const v = a[i]; a[i] = 0xff000000 | ((v & 0xff) << 16) | (v & 0xff00) | ((v >>> 16) & 0xff); }
    return jpeg.encode({ data: bgra, width: W, height: H }, quality).data;
  } finally { M._FPDFBitmap_Destroy(bmp); }
}
