// 그림 속 글자 읽기(로컬 OCR, Tesseract — Apache-2.0). 인터넷 없이 이 컴퓨터 안에서만 돈다.
// 그림 영역을 쪽 그림에서 잘라 여러 각도로 돌려 읽고, 가장 잘 읽힌 결과를 쓴다(기울어진 그림 대응).
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { PNG } from "pngjs";

let workerP = null;
let workerKey = "";
let workerIdleTimer = null;
const queue = [];
let busy = false;
const workerPath = fileURLToPath(new URL("./tesseract-worker.cjs", import.meta.url));

export function ocrAvailable(langDir, languages = ["kor", "eng"]) {
  return languages.length > 0 && languages.every((code) => fs.existsSync(path.join(langDir, `${code}.traineddata`)));
}

async function worker(langDir, languages) {
  clearTimeout(workerIdleTimer); workerIdleTimer = null;
  const langs = [...new Set(languages || ["kor", "eng"])];
  const key = `${path.resolve(langDir)}\0${langs.join("+")}`;
  if (workerP && workerKey !== key) {
    try { (await workerP).terminate(); } catch { /* 이전 작업자가 이미 닫힘 */ }
    workerP = null;
  }
  if (!workerP) {
    workerKey = key;
    workerP = (async () => {
    const { createWorker, PSM } = await import("tesseract.js");
    // errorHandler: 주지 않으면 작업자 쪽 오류를 tesseract.js 가 메시지 처리기 안에서 던져, 잡을 수 없는 예외가 되어 앱에
    // "A JavaScript error occurred in the main process" 창이 뜬다(1.0.2 배포본에서 OCR 코어 파일이 빠졌을 때 그랬다).
    // 처리기를 주면 요청한 쪽의 약속만 실패하고, 그 오류는 아래에서 평소대로 다뤄진다.
    const w = await createWorker(langs, 1, { langPath: langDir, gzip: false, cachePath: path.join(os.tmpdir(), "ogolgye-ocr"), workerPath, logger: () => {},
      errorHandler: (e) => console.warn("[OCR] 작업자 오류:", String(e?.message || e).split("\n")[0]) });
    await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });   // 흩어진 글자(간판·지도·표지)에 맞는 방식
    return w;
    })().catch((e) => { workerP = null; workerKey = ""; throw e; });
  }
  return workerP;
}

/** 앱을 끌 때: OCR 작업자를 끝낸다(읽는 중이어도 기다리지 않는다) */
export function shutdownOcr() {
  clearTimeout(workerIdleTimer); workerIdleTimer = null;
  const p = workerP; workerP = null; workerKey = "";
  queue.length = 0;
  if (p) p.then((w) => w.terminate()).catch(() => {});
}

function releaseWorkerSoon() {
  clearTimeout(workerIdleTimer);
  workerIdleTimer = setTimeout(() => {
    if (busy || queue.length || !workerP) return;
    const p = workerP; workerP = null; workerKey = "";
    p.then((w) => w.terminate()).catch(() => {});
  }, 10 * 1000);
  workerIdleTimer.unref?.();
}

// 한 번에 하나씩(Tesseract 작업자 하나를 돌려 쓴다)
function enqueue(fn) {
  return new Promise((ok, fail) => { queue.push({ fn, ok, fail }); pump(); });
}
async function pump() {
  if (busy || !queue.length) return;
  busy = true;
  const { fn, ok, fail } = queue.shift();
  try { ok(await fn()); } catch (e) { fail(e); } finally { busy = false; if (queue.length) pump(); else releaseWorkerSoon(); }
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

const goodLine = (l) => l.confidence >= 60 && /(?:\p{L}.*){2}|(?:\p{N}.*){2}/u.test(l.text) && !/[{}|<>\\]/.test(l.text);

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
  // opts.autoInvert: 어두운 바탕(검은 머리 칸의 흰 글자 등)이면 색을 뒤집어 읽는다 — OCR 은 밝은 바탕의 어두운 글자를 잘 읽는다
  if (opts.autoInvert) {
    let sum = 0;
    for (let i = 0; i < rgba.length; i += 4) sum += rgba[i] * 0.3 + rgba[i + 1] * 0.59 + rgba[i + 2] * 0.11;
    if (sum / (rgba.length / 4) < 110) for (let i = 0; i < rgba.length; i += 4) { rgba[i] = 255 - rgba[i]; rgba[i + 1] = 255 - rgba[i + 1]; rgba[i + 2] = 255 - rgba[i + 2]; }
  }
  // opts.loose: 표 칸처럼 짧은 글을 읽을 때는 잡음 거르기(기호가 든 줄 버리기 등)를 느슨하게 — "이름 | PC①" 같은 칸 글이 버려졌다
  const keepLine = opts.loose ? (l) => l.confidence >= 45 && /[\p{L}\p{N}]/u.test(l.text) : goodLine;

  const tryAngle = async (deg) => {
    const w = await worker(langDir, opts.languages);
    // 무손실 PNG로 넘겨 JPEG 끝 마커 경고를 피하고, 실제 렌더 배율에 맞는 DPI를 알려
    // Tesseract가 매번 해상도를 추정하며 진단 메시지를 내지 않게 한다.
    const img = PNG.sync.write({ data: rotateRGBA(rgba, cw, ch, deg), width: cw, height: ch });
    // opts.psm: 읽는 방식을 잠시 바꾼다(표 칸 = "6" 한 덩어리 글 — 흩어진 글자 방식은 칸의 한 글자 숫자를 놓친다)
    if (opts.psm) await w.setParameters({ tessedit_pageseg_mode: opts.psm });
    let data;
    try { ({ data } = await w.recognize(img, { user_defined_dpi: String(Math.round(72 * S)) }, { blocks: true })); }
    finally { if (opts.psm) await w.setParameters({ tessedit_pageseg_mode: "11" }); }   // 기본(흩어진 글자)으로 되돌린다
    // 문단 번호를 줄에 붙여 둔다(여러 줄 문단은 복사할 때 이어 붙인다)
    let pi = 0;
    const lines = (data.blocks || []).flatMap((b) => b.paragraphs.flatMap((p) => { const k = pi++; return p.lines.map((l) => Object.assign(l, { _par: k })); })).filter(keepLine);
    const score = lines.reduce((n, l) => n + l.confidence * l.text.replace(/\s/g, "").length, 0);
    return { deg, score, lines };
  };
  return enqueue(async () => {
    // 거칠게(-4, 0, 4) 본 뒤 가장 좋은 각도 양옆(±2)을 더 본다(opts.angles 가 있으면 그 각도만).
    // 반듯한 스캔은 0°에서 이미 잘 읽힌다: 0°에서 읽은 글자의 평균 신뢰도가 85 이상이면 다른 각도는 보지 않는다(쪽당 수십 초 → 수 초).
    const tried = new Map();
    if (!opts.angles) {
      const zero = await tryAngle(0), chars = zero.lines.reduce((n, l) => n + l.text.replace(/\s/g, "").length, 0);
      tried.set(0, zero);
      if (chars >= 10 && zero.score / chars >= 85) {
        return { deg: 0, S, crop: { x0, y0, w: cw, h: ch },
          lines: zero.lines.map((l) => ({ text: l.text.trim(), conf: l.confidence, par: l._par,
            words: (l.words || []).filter((wd) => wd.text.trim() && wd.confidence >= 40).map((wd) => ({ text: wd.text.trim(), bbox: wd.bbox })) })) };
      }
    }
    for (const d of opts.angles || [0, -4, 4]) if (!tried.has(d)) tried.set(d, await tryAngle(d));
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
