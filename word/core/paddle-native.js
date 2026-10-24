// PaddleOCR(글줄 검출 DB + 글자 인식 CTC)을 onnxruntime-node 로 직접 돌린다. 예전에는 공식 PaddleOCR.js(브라우저용)를
// 숨은 Electron 창에서 OpenCV.js·ONNX Runtime Web(WebAssembly)으로 돌려, 램 8GB PC 에서 스캔 쪽 하나에 몇 분씩 걸리고
// 창 하나가 수백 MB 를 차지했다. 여기서는 같은 모델·같은 설정·같은 전처리/후처리를 OpenCV 없이 옮겼다.
// 옮긴 곳: @paddleocr/paddleocr-js 0.4.2 (Apache-2.0, Copyright (c) 2026 PaddlePaddle Authors) 의
//   models/det.ts·rec.ts·common.ts, pipelines/ocr/crop.ts·core.ts, resources/tar.ts, 그리고 core/paddle-ocr-host.js 의 결과 합치기.
// OpenCV 가 하던 일(크기 조절·윤곽·최소 회전 사각형·다각형 채우기·원근 펴기)은 같은 뜻으로 다시 짰다 — 화소 단위 반올림은
// 조금 다를 수 있다.
import fs from "node:fs";
import ClipperLib from "clipper-lib";
import yaml from "js-yaml";

// ── 모델 묶음(.tar) ── resources/tar.ts
const tarString = (b, s, n) => { let o = ""; for (let i = s; i < s + n && b[i]; i++) o += String.fromCharCode(b[i]); return o.trim(); };
export function readTar(bytes) {
  const out = new Map();
  for (let off = 0; off + 512 <= bytes.length;) {
    let empty = true; for (let i = off; i < off + 512; i++) if (bytes[i]) { empty = false; break; }
    if (empty) break;
    const name = tarString(bytes, off, 100).replace(/^\.?\//, ""), size = parseInt(tarString(bytes, off + 124, 12) || "0", 8) || 0, type = bytes[off + 156];
    const base = name.split("/").at(-1) || "";
    if (type !== 53 && type !== 120 && name && !base.startsWith("._") && !name.includes("PaxHeader") && !name.includes("__MACOSX")) out.set(name, bytes.subarray(off + 512, off + 512 + size));
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}
const pick = (entries, file) => { for (const [n, v] of entries) if (n === file || n.endsWith("/" + file)) return v; throw new Error(`모델 묶음에 ${file} 이 없습니다.`); };
/** PaddleOCR 공식 ONNX 묶음(.tar) → { onnx, config } */
export function loadModelTar(file) {
  const entries = readTar(new Uint8Array(fs.readFileSync(file)));
  const cfg = yaml.load(Buffer.from(pick(entries, "inference.yml")).toString("utf8"));
  return { onnx: pick(entries, "inference.onnx"), config: cfg && typeof cfg === "object" ? cfg : {} };
}
const transformOp = (cfg, name) => (cfg?.PreProcess?.transform_ops || []).find((op) => op && Object.hasOwn(op, name))?.[name] || null;
const scaleValue = (v, d) => {
  if (typeof v === "number") return v;
  const s = String(v ?? "").replace(/\s/g, ""), n = Number(s); if (!Number.isNaN(n) && s) return n;
  const [a, b] = s.split("/").map((x) => Number(x.replace(/\.+$/, ""))); return b ? a / b : d;
};

// ── 설정 ── PaddleOCR.js 의 기본 OCR 파이프라인(default-config.ts)이 모델 설정보다 앞선다:
// 글줄 검출은 짧은 변 64 이상이면 줄이지 않고(limit_type min), 긴 변 4000 까지, thresh 0.3·box_thresh 0.6·unclip 1.5.
const PIPELINE_DET = { limitSideLen: 64, limitType: "min", maxSideLimit: 4000, thresh: 0.3, boxThresh: 0.6, unclipRatio: 1.5 };
export function detConfig(cfg) {
  const norm = transformOp(cfg, "NormalizeImage");
  return { ...PIPELINE_DET, maxCandidates: Number(cfg?.PostProcess?.max_candidates ?? 1000),
    mean: norm?.mean ?? [0.485, 0.456, 0.406], std: norm?.std ?? [0.229, 0.224, 0.225], scale: scaleValue(norm?.scale, 1 / 255) };
}
export function recConfig(cfg) {
  const shape = transformOp(cfg, "RecResizeImg")?.image_shape;
  if (!Array.isArray(shape) || shape.length < 3) throw new Error("글자 인식 모델 설정에 RecResizeImg.image_shape 가 없습니다.");
  const dict = cfg?.PostProcess?.character_dict;
  return { imageShape: shape, charDict: [...(Array.isArray(dict) && dict.length ? dict.map(String) : "0123456789abcdefghijklmnopqrstuvwxyz".split("")), " "] };
}

// ── 그림(BGR, 한 화소 3바이트) ──
/** RGBA → BGR */
export function rgbaToBgr(rgba, w, h) {
  const out = new Uint8Array(w * h * 3);
  for (let i = 0, j = 0; i < w * h * 4; i += 4, j += 3) { out[j] = rgba[i + 2]; out[j + 1] = rgba[i + 1]; out[j + 2] = rgba[i]; }
  return out;
}
/** 쌍선형 크기 조절(OpenCV INTER_LINEAR 와 같은 화소 중심 맞춤) */
export function resizeBgr(src, sw, sh, dw, dh) {
  const out = new Uint8Array(dw * dh * 3), fx = sw / dw, fy = sh / dh;
  const xs = new Int32Array(dw * 2), xw = new Float32Array(dw);
  for (let x = 0; x < dw; x++) {
    let sx = (x + 0.5) * fx - 0.5, x0 = Math.floor(sx), a = sx - x0;
    if (x0 < 0) { x0 = 0; a = 0; } if (x0 >= sw - 1) { x0 = sw - 1; a = 0; }
    xs[x * 2] = x0 * 3; xs[x * 2 + 1] = Math.min(sw - 1, x0 + 1) * 3; xw[x] = a;
  }
  for (let y = 0; y < dh; y++) {
    let sy = (y + 0.5) * fy - 0.5, y0 = Math.floor(sy), b = sy - y0;
    if (y0 < 0) { y0 = 0; b = 0; } if (y0 >= sh - 1) { y0 = sh - 1; b = 0; }
    const r0 = y0 * sw * 3, r1 = Math.min(sh - 1, y0 + 1) * sw * 3, o = y * dw * 3;
    for (let x = 0; x < dw; x++) {
      const p0 = xs[x * 2], p1 = xs[x * 2 + 1], a = xw[x];
      for (let c = 0; c < 3; c++) {
        const top = src[r0 + p0 + c] * (1 - a) + src[r0 + p1 + c] * a, bot = src[r1 + p0 + c] * (1 - a) + src[r1 + p1 + c] * a;
        out[o + x * 3 + c] = Math.round(top * (1 - b) + bot * b);
      }
    }
  }
  return out;
}
/** BGR → 정규화한 CHW(float) — models/common.ts toBgrFloatCHWFromBgr */
function bgrToChw(bgr, w, h, mean, std, scale, out = new Float32Array(3 * w * h), outW = w) {
  const plane = h * outW;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = (y * w + x) * 3, i = y * outW + x;
    out[i] = (bgr[p] * scale - mean[0]) / std[0];
    out[i + plane] = (bgr[p + 1] * scale - mean[1]) / std[1];
    out[i + 2 * plane] = (bgr[p + 2] * scale - mean[2]) / std[2];
  }
  return out;
}

// ── 기하 ──
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up.at(-2), up.at(-1), q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
/** 점들을 감싸는 가장 작은 회전 사각형의 네 꼭짓점(OpenCV minAreaRect + RotatedRect.points) */
function minAreaRect(points) {
  const hull = convexHull(points);
  if (hull.length === 1) return [hull[0], hull[0], hull[0], hull[0]];
  if (hull.length === 2) return [hull[0], hull[1], hull[1], hull[0]];
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length], len = dist(a, b); if (!len) continue;
    const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const q of hull) { const u = q[0] * ux + q[1] * uy, v = -q[0] * uy + q[1] * ux; minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v); }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) best = { area, ux, uy, minU, maxU, minV, maxV };
  }
  const { ux, uy, minU, maxU, minV, maxV } = best;
  const at = (u, v) => [u * ux - v * uy, u * uy + v * ux];
  return [at(minU, minV), at(maxU, minV), at(maxU, maxV), at(minU, maxV)];
}
/** 왼쪽 위·오른쪽 위·오른쪽 아래·왼쪽 아래 순서 — models/common.ts orderQuad */
function orderQuad(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0]);
  const [A, D] = p[1][1] > p[0][1] ? [0, 1] : [1, 0], [B, C] = p[3][1] > p[2][1] ? [2, 3] : [3, 2];
  return [p[A], p[B], p[C], p[D]];
}
function miniBox(points) {
  const box = orderQuad(minAreaRect(points));
  return { box, side: Math.min(dist(box[0], box[1]), dist(box[1], box[2])) };
}
const polyArea = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const j = (i + 1) % p.length; s += p[i][0] * p[j][1] - p[j][0] * p[i][1]; } return Math.abs(s) / 2; };
const polyPerimeter = (p) => p.reduce((s, q, i) => s + dist(q, p[(i + 1) % p.length]), 0);
/** 상자 넓히기 — models/common.ts unclip(같은 clipper-lib) */
function unclip(poly, ratio) {
  const per = polyPerimeter(poly); if (per <= 0) return null;
  const off = new ClipperLib.ClipperOffset();
  off.AddPath(poly.map((p) => ({ X: Math.trunc(p[0]), Y: Math.trunc(p[1]) })), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const paths = new ClipperLib.Paths(); off.Execute(paths, (polyArea(poly) * ratio) / per);
  let best = null, bestA = 0;
  for (const path of paths) { if (path.length < 4) continue; const q = path.map((pt) => [pt.X, pt.Y]), a = polyArea(q); if (a > bestA) { bestA = a; best = q; } }
  return best;
}
/** 다각형 안 확률 평균 — models/common.ts boxScoreFast(cv.fillPoly + cv.mean) */
function boxScore(pred, w, h, box) {
  const xsB = box.map((p) => p[0]), ysB = box.map((p) => p[1]);
  const minX = Math.max(0, Math.min(w - 1, Math.floor(Math.min(...xsB)))), maxX = Math.max(0, Math.min(w - 1, Math.ceil(Math.max(...xsB))));
  const minY = Math.max(0, Math.min(h - 1, Math.floor(Math.min(...ysB)))), maxY = Math.max(0, Math.min(h - 1, Math.ceil(Math.max(...ysB))));
  const poly = box.map((p) => [Math.trunc(p[0] - minX), Math.trunc(p[1] - minY)]);
  let sum = 0, n = 0;
  for (let y = 0; y <= maxY - minY; y++) {
    // 이 줄과 다각형 변의 교점(꼭짓점 위도 포함)
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if ((y < Math.min(a[1], b[1])) || (y > Math.max(a[1], b[1]))) continue;
      if (a[1] === b[1]) { lo = Math.min(lo, a[0], b[0]); hi = Math.max(hi, a[0], b[0]); continue; }
      const x = a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]); lo = Math.min(lo, x); hi = Math.max(hi, x);
    }
    if (lo > hi) continue;
    const x0 = Math.max(0, Math.round(lo)), x1 = Math.min(maxX - minX, Math.round(hi));
    for (let x = x0; x <= x1; x++) { sum += pred[(y + minY) * w + x + minX]; n++; }
  }
  return n ? sum / n : 0;
}

// ── 글줄 검출 ── models/det.ts
function detPreprocess(bgr, srcW, srcH, cfg) {
  const limit = Math.max(32, cfg.limitSideLen), maxSide = Math.max(32, cfg.maxSideLimit);
  let scale = 1;
  if (cfg.limitType === "max") { if (Math.max(srcW, srcH) > limit) scale = limit / Math.max(srcW, srcH); }
  else if (Math.min(srcW, srcH) < limit) scale = limit / Math.max(1, Math.min(srcW, srcH));
  let dw = Math.max(32, Math.round((srcW * scale) / 32) * 32), dh = Math.max(32, Math.round((srcH * scale) / 32) * 32);
  if (Math.max(dw, dh) > maxSide) { const k = maxSide / Math.max(dw, dh); dw = Math.max(32, Math.floor(dw * k)); dh = Math.max(32, Math.floor(dh * k)); }
  dw = Math.max(32, Math.round(Math.min(maxSide, Math.max(32, dw)) / 32) * 32);
  dh = Math.max(32, Math.round(Math.min(maxSide, Math.max(32, dh)) / 32) * 32);
  const resized = resizeBgr(bgr, srcW, srcH, dw, dh);
  return { chw: bgrToChw(resized, dw, dh, cfg.mean, cfg.std, cfg.scale), dw, dh };
}
/** 확률 지도 → 글줄 상자(원래 그림 좌표). 윤곽(findContours RETR_LIST) 대신 8방향 연결 덩어리의 가장자리 화소를 쓴다 */
export function detPostprocess(pred, w, h, srcW, srcH, cfg) {
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = pred[i] > cfg.thresh ? 1 : 0;
  const label = new Int32Array(w * h), stack = new Int32Array(w * h);
  const boxes = [];
  let comps = 0;
  for (let start = 0; start < w * h && comps < cfg.maxCandidates; start++) {
    if (!mask[start] || label[start]) continue;
    comps++;
    let top = 0; stack[top++] = start; label[start] = comps;
    const edge = [];
    while (top) {
      const i = stack[--top], x = i % w, y = (i - x) / w;
      let border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!mask[j]) { if (!dx || !dy) border = true; continue; }
        if (!label[j]) { label[j] = comps; stack[top++] = j; }
      }
      if (border) edge.push([x, y]);
    }
    if (edge.length < 4) continue;
    const mini = miniBox(edge);
    if (mini.side < 3) continue;
    const score = boxScore(pred, w, h, mini.box);
    if (score < cfg.boxThresh) continue;
    const expanded = unclip(mini.box, cfg.unclipRatio);
    if (!expanded || expanded.length < 4) continue;
    const m2 = miniBox(expanded);
    if (m2.side < 5) continue;
    const clamp = (v, hi) => Math.max(0, Math.min(hi, v));
    boxes.push({ poly: m2.box.map((p) => [clamp(Math.round((p[0] * srcW) / Math.max(1, w)), srcW), clamp(Math.round((p[1] * srcH) / Math.max(1, h)), srcH)]), score });
  }
  // 위→아래, 같은 줄(10px 안)은 왼→오른
  boxes.sort((a, b) => a.poly[0][1] - b.poly[0][1] || a.poly[0][0] - b.poly[0][0]);
  for (let i = 0; i < boxes.length - 1; i++) for (let j = i; j >= 0; j--) {
    if (Math.abs(boxes[j + 1].poly[0][1] - boxes[j].poly[0][1]) < 10 && boxes[j + 1].poly[0][0] < boxes[j].poly[0][0]) [boxes[j], boxes[j + 1]] = [boxes[j + 1], boxes[j]];
    else break;
  }
  return boxes;
}

// ── 글줄 잘라 펴기 ── pipelines/ocr/crop.ts (getPerspectiveTransform + warpPerspective INTER_CUBIC, BORDER_REPLICATE)
function perspective(src, dst) {
  // dst = H·src 를 푸는 8x8 연립방정식
  const A = [], bv = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); bv.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]); bv.push(v);
  }
  for (let c = 0; c < 8; c++) {
    let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [bv[c], bv[p]] = [bv[p], bv[c]];
    const d = A[c][c] || 1e-12;
    for (let r = 0; r < 8; r++) { if (r === c) continue; const f = A[r][c] / d; if (!f) continue; for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; bv[r] -= f * bv[c]; }
  }
  const hm = bv.map((v, i) => v / (A[i][i] || 1e-12));
  return [hm[0], hm[1], hm[2], hm[3], hm[4], hm[5], hm[6], hm[7], 1];
}
function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C || 1e-12;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
const cubicW = (t) => { const A = -0.75, x = Math.abs(t); return x <= 1 ? ((A + 2) * x - (A + 3)) * x * x + 1 : x < 2 ? ((A * x - 5 * A) * x + 8 * A) * x - 4 * A : 0; };
export function cropByPoly(bgr, sw, sh, poly) {
  const o = miniBox(poly).box;
  const cw = Math.max(1, Math.floor(Math.max(dist(o[0], o[1]), dist(o[3], o[2])))), ch = Math.max(1, Math.floor(Math.max(dist(o[0], o[3]), dist(o[1], o[2]))));
  const inv = invert3(perspective(o, [[0, 0], [cw, 0], [cw, ch], [0, ch]]));
  let out = new Uint8Array(cw * ch * 3);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const W = inv[6] * x + inv[7] * y + inv[8], fx = (inv[0] * x + inv[1] * y + inv[2]) / W, fy = (inv[3] * x + inv[4] * y + inv[5]) / W;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
    const wx = [cubicW(1 + ax), cubicW(ax), cubicW(1 - ax), cubicW(2 - ax)], wy = [cubicW(1 + ay), cubicW(ay), cubicW(1 - ay), cubicW(2 - ay)];
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let j = 0; j < 4; j++) {
        const yy = Math.max(0, Math.min(sh - 1, y0 - 1 + j)) * sw;
        let r = 0; for (let i = 0; i < 4; i++) r += wx[i] * bgr[(yy + Math.max(0, Math.min(sw - 1, x0 - 1 + i))) * 3 + c];
        s += wy[j] * r;
      }
      out[(y * cw + x) * 3 + c] = Math.max(0, Math.min(255, Math.round(s)));
    }
  }
  if (ch / cw >= 1.5) {                                          // 세로로 긴 글줄: 반시계 90° 돌린다
    const rot = new Uint8Array(cw * ch * 3);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) for (let c = 0; c < 3; c++) rot[((cw - 1 - x) * ch + y) * 3 + c] = out[(y * cw + x) * 3 + c];
    return { data: rot, w: ch, h: cw };
  }
  return { data: out, w: cw, h: ch };
}

// ── 글자 인식 ── models/rec.ts
function recSample(crop, cfg) {
  const [, H, baseW] = cfg.imageShape;
  const ratio = crop.w / Math.max(1, crop.h);
  const recW = Math.max(1, Math.min(3200, Math.trunc(H * Math.max(baseW / Math.max(1, H), ratio))));
  const rw = Math.min(recW, Math.ceil(H * ratio));
  const resized = resizeBgr(crop.data, crop.w, crop.h, rw, H);
  return { width: recW, rw, resized };
}
/** CTC 탐욕 풀기. 글자마다 시간 칸(t0~t1)과, 글자 사이 칸들에서 공백일 확률의 최댓값(pSpace)도 남긴다(띄어쓰기 다시 보기용) */
function ctcDecode(data, off, T, C, dict) {
  let prev = -1, text = ""; const probs = [], chars = [];
  const spaceClass = dict.length;                                   // 사전 끝의 " " (0 은 빈칸)
  let pSpace = 0;
  for (let t = 0; t < T; t++) {
    let mi = 0, mv = -Infinity; const so = off + t * C;
    for (let c = 0; c < C; c++) if (data[so + c] > mv) { mv = data[so + c]; mi = c; }
    if (mi > 0 && mi !== prev && mi - 1 < dict.length) { text += dict[mi - 1]; probs.push(mv); chars.push({ c: dict[mi - 1], t0: t, t1: t, pSpaceBefore: pSpace }); pSpace = 0; }
    else if (mi > 0 && mi === prev && chars.length) chars.at(-1).t1 = t;
    if (mi !== prev || mi === 0) pSpace = Math.max(pSpace, spaceClass < C ? data[so + spaceClass] : 0);
    prev = mi;
  }
  return { text, chars, T, score: probs.length ? probs.reduce((a, b) => a + b, 0) / probs.length : 0 };
}
/** 글줄 그림의 세로줄마다 잉크가 있는가(어두운 화소) — 글자 사이 흰 틈 재기용. 글자 높이(잉크가 있는 가로줄 범위)도 */
export function inkColumns(crop) {
  const { data, w, h } = crop, gray = new Uint8Array(w * h);
  let lo = 255, hi = 0;
  for (let i = 0; i < w * h; i++) { const g = (data[i * 3] + data[i * 3 + 1] + data[i * 3 + 2]) / 3; gray[i] = g; if (g < lo) lo = g; if (g > hi) hi = g; }
  const cut = (lo + hi) / 2, cols = new Uint8Array(w);
  let top = h, bottom = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (gray[y * w + x] < cut && hi - lo > 40) { cols[x] = 1; if (y < top) top = y; if (y > bottom) bottom = y; }
  return { cols, textH: bottom >= top ? bottom - top + 1 : h };
}
// 띄어쓰기 다시 보기: 글자 인식 모델은 시간 칸마다 가장 높은 후보만 고르므로, 공백일 확률이 0.15~0.5 로 2등이면 공백이 빠졌다
// (공개 샘플 한국어 쪽에서 원문 공백 10개 중 약 1개). 모델이 붙인 두 글자 사이라도 ① 그 사이 칸들의 공백 확률이 0.1 이상이거나
// ② 그림의 흰 틈이 글자 높이의 0.45 이상이면 띄운다. 정하기용 12쪽 7,169곳: 틀림 225 → 8, 따로 둔 검증용 12쪽 10,110곳: 282 → 11
// (2026-10-24, 원문 = 같은 PDF 의 글자). 맞게 붙인 자리는 공백 확률이 거의 0, 흰 틈은 글자 높이의 0.25 이하였다.
const RESPACE_P = 0.1, RESPACE_GAP = 0.45;
/** → 띄어쓰기를 다시 본 글줄. info 에 공백 뺀 글자 사이마다 { p: 공백 확률, g: 흰 틈/글자 높이, src: 띄운 까닭 } 을 남긴다
 *  (session.js 가 문서 증거·Kiwi 로 한 번 더 볼 때 쓴다 — ocr-spacing.js) */
export function respace(r, crop, info = null) {
  const chars = (r.chars || []).filter((ch, k, a) => ch.c !== " " || (k && a[k - 1].c !== " "));
  if (chars.length < 2) return r.text;
  const ink = crop ? inkColumns(crop) : null;
  let out = "", prevReal = null, sawSpace = false;
  for (const ch of chars) {
    if (ch.c === " ") { sawSpace = true; continue; }
    if (prevReal) {
      const g = ink ? longestWhite(ink.cols, (prevReal.x0 + prevReal.x1) / 2, (ch.x0 + ch.x1) / 2) / Math.max(1, ink.textH) : 0;
      const src = sawSpace ? "model" : ch.pSpaceBefore >= RESPACE_P ? "p" : g >= RESPACE_GAP ? "gap" : null;
      info?.push({ p: +(sawSpace ? 1 : ch.pSpaceBefore).toFixed(4), g: +g.toFixed(4), src });
      if (src) out += " ";
    }
    out += ch.c; prevReal = ch; sawSpace = false;
  }
  return out;
}
/** 두 x(글줄 그림 좌표) 사이에서 가장 긴 흰 틈의 폭 */
export function longestWhite(cols, x0, x1) {
  let best = 0, run = 0;
  for (let x = Math.max(0, Math.ceil(x0)); x <= Math.min(cols.length - 1, Math.floor(x1)); x++) { if (cols[x]) run = 0; else best = Math.max(best, ++run); }
  return best;
}

// ── 엔진 ──
const PACK_MODEL = Object.freeze({
  korean: "korean_PP-OCRv5_mobile_rec", cjk: "PP-OCRv5_mobile_rec", latin: "latin_PP-OCRv5_mobile_rec", english: "en_PP-OCRv5_mobile_rec",
  eastSlavic: "eslav_PP-OCRv5_mobile_rec", cyrillic: "cyrillic_PP-OCRv5_mobile_rec", arabic: "arabic_PP-OCRv5_mobile_rec",
  devanagari: "devanagari_PP-OCRv5_mobile_rec", thai: "th_PP-OCRv5_mobile_rec", greek: "el_PP-OCRv5_mobile_rec",
  tamil: "ta_PP-OCRv5_mobile_rec", telugu: "te_PP-OCRv5_mobile_rec",
});
const REC_BATCH = 8, REC_SCORE = 0.35;

/** modelPath(이름) → .tar 경로. threads: 계산 스레드 수 */
export function createPaddleNative({ modelPath, threads = 2 }) {
  let ortP = null;
  const ort = () => (ortP ||= import("onnxruntime-node"));
  const models = new Map();
  // 메모리 풀은 끈다(레이아웃 모델과 같은 이유: 켜면 놓지 않고 쌓인다)
  const load = (name, kind) => {
    if (!models.has(name)) models.set(name, (async () => {
      const { InferenceSession } = await ort();
      const { onnx, config } = loadModelTar(modelPath(name));
      const session = await InferenceSession.create(onnx, { graphOptimizationLevel: "all", logSeverityLevel: 3,
        enableCpuMemArena: false, enableMemPattern: false, intraOpNumThreads: threads, executionProviders: ["cpu"] });
      return { session, cfg: kind === "det" ? detConfig(config) : recConfig(config) };
    })().catch((e) => { models.delete(name); throw e; }));
    return models.get(name);
  };
  const run = async (m, data, dims) => {
    const { Tensor } = await ort();
    const out = await m.session.run({ [m.session.inputNames[0]]: new Tensor("float32", data, dims) });
    return out[m.session.outputNames[0]];
  };

  async function detect(bgr, w, h, detector) {
    const det = await load(detector, "det");
    const { chw, dw, dh } = detPreprocess(bgr, w, h, det.cfg);
    const t = await run(det, chw, [1, 3, dh, dw]);
    const oh = t.dims.length === 4 ? t.dims[2] : t.dims[1], ow = t.dims.length === 4 ? t.dims[3] : t.dims[2];
    return detPostprocess(t.data, ow, oh, w, h, det.cfg);
  }
  async function recognizeCrops(crops, pack) {
    const rec = await load(PACK_MODEL[pack], "rec");
    const H = rec.cfg.imageShape[1];
    const samples = crops.map((c, i) => ({ i, ...recSample(c, rec.cfg) })).sort((a, b) => a.width - b.width);
    const out = new Array(crops.length);
    for (let k = 0; k < samples.length; k += REC_BATCH) {
      const batch = samples.slice(k, k + REC_BATCH), maxW = Math.max(1, ...batch.map((s) => s.width));
      const data = new Float32Array(batch.length * 3 * H * maxW);
      batch.forEach((s, b) => bgrToChw(s.resized, s.rw, H, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5], 1 / 255, data.subarray(b * 3 * H * maxW, (b + 1) * 3 * H * maxW), maxW));
      const t = await run(rec, data, [batch.length, 3, H, maxW]);
      const [N, T, C] = t.dims;
      for (let b = 0; b < N; b++) {
        const r = ctcDecode(t.data, b * T * C, T, C, rec.cfg.charDict), s = batch[b];
        // 시간 칸 → 글줄 그림 x: 칸 하나는 입력 폭 maxW/T, 입력의 글 부분(rw)이 원래 글줄 그림 폭에 대응
        const k = (maxW / T) * (crops[s.i].w / Math.max(1, s.rw));
        for (const ch of r.chars) { ch.x0 = ch.t0 * k; ch.x1 = (ch.t1 + 1) * k; }
        out[s.i] = r;
      }
    }
    return out;
  }
  return {
    /** RGBA 그림 하나를 고른 언어 묶음마다 읽어 합친다 — paddle-ocr-host.js recognize() 와 같은 결과 모양 */
    async recognize({ rgba, width, height, packs, detector = "PP-OCRv5_mobile_det", detail = false }) {
      const bgr = rgbaToBgr(rgba, width, height);
      const boxes = await detect(bgr, width, height, detector);
      const crops = boxes.map((b) => cropByPoly(bgr, width, height, b.poly));
      const results = [];
      for (const pack of [...new Set(packs || [])].filter((p) => PACK_MODEL[p])) {
        const recs = crops.length ? await recognizeCrops(crops, pack) : [];
        const items = [];
        recs.forEach((r, i) => {
          if (!r?.text || r.score < REC_SCORE) return;
          const info = [];
          const item = { poly: boxes[i].poly, text: respace(r, crops[i], info), score: r.score, info };
          // lead: 글줄 그림 왼쪽 끝에서 첫 글자까지(글자 높이 배수) — 크면 앞에 글자로 읽히지 않은 표시(목록 기호 "▌·")가 있다
          const firstCh = (r.chars || []).find((ch) => ch.c !== " ");
          if (firstCh) item.lead = +(firstCh.x0 / Math.max(1, inkColumns(crops[i]).textH)).toFixed(2);
          // detail: 글자마다 위치와, 앞 글자와의 흰 틈·공백 확률(띄어쓰기 평가용)
          if (detail) { const ink = inkColumns(crops[i]); item.detail = { textH: ink.textH, chars: r.chars.map((ch, k) => ({ c: ch.c, x0: ch.x0, x1: ch.x1, pSpace: ch.pSpaceBefore,
            gap: k ? longestWhite(ink.cols, (r.chars[k - 1].x0 + r.chars[k - 1].x1) / 2, (ch.x0 + ch.x1) / 2) : 0 })) }; }
          items.push(item);
        });
        results.push({ pack, result: { items } });
      }
      return { items: mergeResults(results) };
    },
    async dispose() { for (const p of models.values()) { try { await (await p).session.release?.(); } catch { /* 이미 닫힘 */ } } models.clear(); },
  };
}

// ── 언어 묶음 결과 합치기 ── core/paddle-ocr-host.js 와 같다
const bboxOf = (poly) => {
  const pts = (poly || []).filter((p) => Number.isFinite(+p[0]) && Number.isFinite(+p[1]));
  return pts.length ? [Math.min(...pts.map((p) => +p[0])), Math.min(...pts.map((p) => +p[1])), Math.max(...pts.map((p) => +p[0])), Math.max(...pts.map((p) => +p[1]))] : null;
};
const boxArea = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const overlap = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
const SCRIPT = {
  korean: /[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9]/u, cjk: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z0-9]/u,
  latin: /[\p{Script=Latin}0-9]/u, english: /[A-Za-z0-9]/u, eastSlavic: /[\p{Script=Cyrillic}A-Za-z0-9]/u, cyrillic: /[\p{Script=Cyrillic}A-Za-z0-9]/u,
  arabic: /[\p{Script=Arabic}A-Za-z0-9]/u, devanagari: /[\p{Script=Devanagari}A-Za-z0-9]/u, thai: /[\p{Script=Thai}A-Za-z0-9]/u,
  greek: /[\p{Script=Greek}A-Za-z0-9]/u, tamil: /[\p{Script=Tamil}A-Za-z0-9]/u, telugu: /[\p{Script=Telugu}A-Za-z0-9]/u,
};
const scriptRatio = (text, pack) => {
  const chars = [...String(text || "")].filter((c) => /[\p{L}\p{N}]/u.test(c));
  if (!chars.length) return 0.5;
  const re = SCRIPT[pack] || /[\p{L}\p{N}]/u;
  return chars.filter((c) => re.test(c)).length / chars.length;
};
export function mergeResults(results) {
  const chosen = [];
  for (const { pack, result } of results) for (const item of result?.items || []) {
    const b = bboxOf(item.poly); if (!b || !String(item.text || "").trim()) continue;
    const cand = { poly: item.poly, text: String(item.text).trim(), score: Number(item.score || 0), pack, b, detail: item.detail, info: item.info, lead: item.lead };
    cand.rank = cand.score * (0.55 + 0.45 * scriptRatio(cand.text, pack));
    const old = chosen.findIndex((x) => overlap(x.b, b) >= 0.55 * Math.min(boxArea(x.b), boxArea(b)));
    if (old < 0) chosen.push(cand); else if (cand.rank > chosen[old].rank) chosen[old] = cand;
  }
  return chosen.sort((a, b) => a.b[1] - b.b[1] || a.b[0] - b.b[0]).map(({ poly, text, score, pack, detail, info, lead }) => ({ poly, text, score, pack, ...(info ? { info } : {}), ...(lead !== undefined ? { lead } : {}), ...(detail ? { detail } : {}) }));
}
