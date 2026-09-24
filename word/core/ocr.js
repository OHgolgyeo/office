// 그림 속 글자 읽기(로컬 OCR, Tesseract — Apache-2.0). 인터넷 없이 이 컴퓨터 안에서만 돈다.
// 그림 영역을 쪽 그림에서 잘라 여러 각도로 돌려 읽고, 가장 잘 읽힌 결과를 쓴다(기울어진 그림 대응).
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { PNG } from "pngjs";

let workerP = null;
const queue = [];
let busy = false;
const workerPath = fileURLToPath(new URL("./tesseract-worker.cjs", import.meta.url));

export function ocrAvailable(langDir) {
  return fs.existsSync(path.join(langDir, "kor.traineddata"));
}

async function worker(langDir) {
  if (!workerP) workerP = (async () => {
    const { createWorker, PSM } = await import("tesseract.js");
    const w = await createWorker(["kor", "eng"], 1, { langPath: langDir, gzip: false, cachePath: path.join(os.tmpdir(), "ogolgye-ocr"), workerPath, logger: () => {} });
    await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });   // 흩어진 글자(간판·지도·표지)에 맞는 방식
    return w;
  })();
  return workerP;
}

// 한 번에 하나씩(Tesseract 작업자 하나를 돌려 쓴다)
function enqueue(fn) {
  return new Promise((ok, fail) => { queue.push({ fn, ok, fail }); pump(); });
}
async function pump() {
  if (busy || !queue.length) return;
  busy = true;
  const { fn, ok, fail } = queue.shift();
  try { ok(await fn()); } catch (e) { fail(e); } finally { busy = false; pump(); }
}

function rotateRGBA(src, w, h, deg) {
  if (!deg) return src;
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), out = Buffer.alloc(w * h * 4, 255), cx = w / 2, cy = h / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x - cx, dy = y - cy, sx = Math.round(c * dx + s * dy + cx), sy = Math.round(-s * dx + c * dy + cy);
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
    const si = (sy * w + sx) * 4, di = (y * w + x) * 4;
    out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2];
  }
  return out;
}

const goodLine = (l) => l.confidence >= 60 && /[가-힣]{2}|[0-9]{2}|[A-Za-z]{3}/.test(l.text) && !/[{}|<>\\]/.test(l.text);

/**
 * 쪽 안의 한 영역(pt)을 읽는다.
 * @returns {{ deg, S, crop:{x0,y0,w,h}, lines:[{text, conf, words:[{text, bbox:{x0,y0,x1,y1}}]}] }}
 *   bbox 는 "deg 만큼 돌린 잘라 낸 그림"의 픽셀 좌표
 */
export async function ocrRegion(page, bbox, langDir, S = 3, opts = {}) {
  const M = page.module, h = page.pageIdx;
  const W = Math.round(M._FPDF_GetPageWidth(h) * S), H = Math.round(M._FPDF_GetPageHeight(h) * S);
  const x0 = Math.max(0, Math.floor(bbox[0] * S)), y0 = Math.max(0, Math.floor(bbox[1] * S));
  const x1 = Math.min(W, Math.ceil(bbox[2] * S)), y1 = Math.min(H, Math.ceil(bbox[3] * S));
  const cw = x1 - x0, ch = y1 - y0;
  if (cw < 30 || ch < 30) return null;
  // 그 영역만 그린다. opts.hide: 숨길 글자 번호(변환한 본문 글자 — 남는 것은 그림 속 글자뿐)
  const restore = [];
  if (opts.hide && opts.hide.length) {
    const tp = M._FPDFText_LoadPage(h);
    const objs = new Set();
    for (const ci of opts.hide) { const o = M._FPDFText_GetTextObject(tp, ci); if (o) objs.add(o); }
    for (const o of objs) { restore.push([o, M._FPDFTextObj_GetTextRenderMode(o)]); M._FPDFTextObj_SetTextRenderMode(o, 3); }
    M._FPDFText_ClosePage(tp);
  }
  const bmp = M._FPDFBitmap_Create(cw, ch, 1);
  const rgba = Buffer.alloc(cw * ch * 4);
  try {
    M._FPDFBitmap_FillRect(bmp, 0, 0, cw, ch, 0xffffffff);
    M._FPDF_RenderPageBitmap(bmp, h, -x0, -y0, W, H, 0, 0x01);
    const st = M._FPDFBitmap_GetStride(bmp), base = M._FPDFBitmap_GetBuffer(bmp);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const s = base + y * st + x * 4, t = (y * cw + x) * 4;
      rgba[t] = M.HEAPU8[s + 2]; rgba[t + 1] = M.HEAPU8[s + 1]; rgba[t + 2] = M.HEAPU8[s]; rgba[t + 3] = 255;
    }
  } finally { M._FPDFBitmap_Destroy(bmp); for (const [o, m] of restore) M._FPDFTextObj_SetTextRenderMode(o, m); }

  const w = await worker(langDir);
  const tryAngle = async (deg) => {
    // 무손실 PNG로 넘겨 JPEG 끝 마커 경고를 피하고, 실제 렌더 배율에 맞는 DPI를 알려
    // Tesseract가 매번 해상도를 추정하며 진단 메시지를 내지 않게 한다.
    const img = PNG.sync.write({ data: rotateRGBA(rgba, cw, ch, deg), width: cw, height: ch });
    const { data } = await w.recognize(img, { user_defined_dpi: String(Math.round(72 * S)) }, { blocks: true });
    // 문단 번호를 줄에 붙여 둔다(여러 줄 문단은 복사할 때 이어 붙인다)
    let pi = 0;
    const lines = (data.blocks || []).flatMap((b) => b.paragraphs.flatMap((p) => { const k = pi++; return p.lines.map((l) => Object.assign(l, { _par: k })); })).filter(goodLine);
    const score = lines.reduce((n, l) => n + l.confidence * l.text.replace(/\s/g, "").length, 0);
    return { deg, score, lines };
  };
  return enqueue(async () => {
    // 거칠게(-4, 0, 4) 본 뒤 가장 좋은 각도 양옆(±2)을 더 본다(opts.angles 가 있으면 그 각도만)
    const tried = new Map();
    for (const d of opts.angles || [0, -4, 4]) tried.set(d, await tryAngle(d));
    let best = [...tried.values()].sort((a, b) => b.score - a.score)[0];
    if (!opts.angles) for (const d of [best.deg - 2, best.deg + 2]) if (!tried.has(d)) tried.set(d, await tryAngle(d));
    best = [...tried.values()].sort((a, b) => b.score - a.score)[0];
    return {
      deg: best.deg, S, crop: { x0, y0, w: cw, h: ch },
      lines: best.lines.map((l) => ({ text: l.text.trim(), conf: l.confidence, par: l._par,
        words: (l.words || []).filter((wd) => wd.text.trim() && wd.confidence >= 40).map((wd) => ({ text: wd.text.trim(), bbox: wd.bbox })) })),
    };
  });
}
