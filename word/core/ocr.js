// 그림 속 글자 읽기(로컬 OCR). 스캔은 PaddleOCR PP-OCRv5를 우선하고 Tesseract.js가 대체 경로를 맡는다.
// 언어 모델 설치 뒤의 인식은 인터넷 없이 이 컴퓨터 안에서만 돈다.
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

/**
 * Tesseract가 다단 지면의 같은 높이 글을 한 가로줄로 돌려준 경우, 여러 줄에서 반복되는
 * 큰 낱말 간격을 단 사이 여백으로 찾아 줄을 좌우 조각으로 나눈다. 한 줄에만 있는 큰
 * 띄어쓰기(이름-값, 짧은 제목)는 경계로 쓰지 않는다.
 */
export function splitOcrColumns(lines, debug = null) {
  const src = (lines || []).filter((l) => Array.isArray(l.words) && l.words.length).map((l, li) => ({
    line: l, li, words: [...l.words].sort((a, b) => a.bbox.x0 - b.bbox.x0),
  }));
  if (src.length < 3) { if (debug) Object.assign(debug, { inputLines: src.length, cuts: [], outputLines: src.length }); return lines || []; }
  const heights = src.flatMap(({ words }) => words.map((w) => Math.max(1, w.bbox.y1 - w.bbox.y0))).sort((a, b) => a - b);
  const bodyH = heights[heights.length >> 1] || 10;
  const candidates = [];
  for (const { li, words } of src) for (let i = 1; i < words.length; i++) {
    const gap = words[i].bbox.x0 - words[i - 1].bbox.x1;
    if (gap >= Math.max(8, bodyH * 0.75)) candidates.push({ x: (words[i - 1].bbox.x1 + words[i].bbox.x0) / 2, li });
  }
  candidates.sort((a, b) => a.x - b.x);
  const clusters = [];
  for (const c of candidates) {
    const last = clusters.at(-1);
    if (last && c.x - last.mean <= bodyH * 0.8) { last.items.push(c); last.mean = last.items.reduce((n, q) => n + q.x, 0) / last.items.length; }
    else clusters.push({ mean: c.x, items: [c] });
  }
  const cuts = clusters.filter((c) => new Set(c.items.map((q) => q.li)).size >= 3).map((c) => c.mean).sort((a, b) => a - b);
  if (!cuts.length) { if (debug) Object.assign(debug, { inputLines: src.length, bodyHeight: +bodyH.toFixed(2), candidates: candidates.length, cuts: [], outputLines: src.length }); return lines || []; }
  const out = [];
  for (const { line, words } of src) {
    const groups = new Map();
    for (const w of words) {
      const cx = (w.bbox.x0 + w.bbox.x1) / 2, col = cuts.filter((x) => cx >= x).length;
      if (!groups.has(col)) groups.set(col, []);
      groups.get(col).push(w);
    }
    for (const [col, ws] of groups) out.push({ ...line, text: ws.map((w) => w.text).join(" "), par: `${line.par ?? line._par ?? line.li ?? 0}:c${col}`, _par: `${line._par ?? line.par ?? line.li ?? 0}:c${col}`, words: ws });
  }
  // 읽기 순서도 가로 행 순서가 아니라 왼쪽 단 위→아래, 다음 단 위→아래로 바꾼다.
  const sorted = out.sort((a, b) => {
    const ax = Math.min(...a.words.map((w) => w.bbox.x0)), bx = Math.min(...b.words.map((w) => w.bbox.x0));
    const ay = Math.min(...a.words.map((w) => w.bbox.y0)), by = Math.min(...b.words.map((w) => w.bbox.y0));
    const ac = cuts.filter((x) => ax >= x).length, bc = cuts.filter((x) => bx >= x).length;
    return ac - bc || ay - by || ax - bx;
  });
  if (debug) Object.assign(debug, { inputLines: src.length, bodyHeight: +bodyH.toFixed(2), candidates: candidates.length, cuts: cuts.map((x) => +x.toFixed(2)), outputLines: sorted.length });
  return sorted;
}

const median = (values) => {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

/**
 * OCR 낱말과 뒤 공백을 돌려준다. Tesseract가 한국어 한 어절을 음절마다 별도 낱말로
 * 내보내면서 사이마다 공백을 넣는 경우에는 원문 문자열 대신 실제 글자 상자 간격으로
 * 어절 경계를 복구한다. 정상적인 여러 글자 낱말이 많은 줄은 Tesseract의 공백을 보존한다.
 */
export function spaceOcrWords(line, opts = {}) {
  const words = [...(line?.words || [])].sort((a, b) => a.bbox.x0 - b.bbox.x0);
  if (!words.length) return [];
  const chars = words.map((w) => [...String(w.text || "")].filter((c) => !/\s/u.test(c)).length || 1);
  const korean = words.map((w) => String(w.text || "")).filter((t) => /[가-힣ㄱ-ㅎㅏ-ㅣ]/u.test(t)).length;
  const fragments = words.filter((w, i) => chars[i] <= 2 && /^[가-힣ㄱ-ㅎㅏ-ㅣ.,!?…“”‘’"']{1,2}$/u.test(String(w.text || ""))).length;
  const fragmentedKorean = words.length >= 4 && korean >= words.length * 0.55 && fragments >= words.length * 0.6;
  // PSM 3 자동 문서 배치를 쓴 스캔은 줄 문자열의 공백이 낱말 상자보다 정확하다.
  // (`바`,`로`,`결`,`에` 상자여도 line.text는 `바로 결에`). 이때는 기하 추정을 하지 않는다.
  if (opts.trustText || !fragmentedKorean) {
    let pos = 0;
    return words.map((w, i) => {
      const at = String(line.text || "").indexOf(w.text, pos);
      if (at >= 0) pos = at + w.text.length;
      return { w, sp: i < words.length - 1 && (at < 0 || /^\s/u.test(String(line.text || "").slice(pos))) };
    });
  }
  const charW = median(words.map((w, i) => (w.bbox.x1 - w.bbox.x0) / Math.max(1, chars[i]))) || 10;
  const gaps = words.slice(1).map((w, i) => Math.max(0, w.bbox.x0 - words[i].bbox.x1));
  // 한글 자간은 보통 글자 폭의 0~20%, 띄어쓰기는 약 35~60%다. 스캔 해상도와
  // 글꼴 차이를 감안해 32%를 경계로 쓰되, 실제 작은 자간의 2.2배보다 작아지지 않게 한다.
  const small = gaps.filter((g) => g <= charW * 0.3);
  // 책 본문은 자간이 글자 폭의 30~45%까지 벌어지기도 한다. 48%보다 작은 간격은
  // `이 계 심도`, `현 실 세계` 같은 음절 분할로 보고 붙인다.
  const threshold = Math.max(charW * 0.48, (median(small) || 0) * 2.5);
  return words.map((w, i) => ({ w, sp: i < words.length - 1 && gaps[i] >= threshold }));
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

/** 스캔 책의 옅은 뒷면 잔상·종이 얼룩을 지우고 진한 인쇄 잉크만 남긴다. 원본 RGBA를 제자리에서 바꾼다. */
export function cleanScanImage(rgba) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < rgba.length; i += 4) hist[Math.max(0, Math.min(255, Math.round(rgba[i] * .299 + rgba[i + 1] * .587 + rgba[i + 2] * .114)))]++;
  const total = rgba.length / 4;
  let sum = 0;for(let i=0;i<256;i++)sum+=i*hist[i];
  let bg=0,w0=0,sum0=0,best=-1,otsu=170;
  for(let t=0;t<256;t++){
    w0+=hist[t];if(!w0)continue;const w1=total-w0;if(!w1)break;
    sum0+=t*hist[t];const m0=sum0/w0,m1=(sum-sum0)/w1,between=w0*w1*(m0-m1)*(m0-m1);
    if(between>best){best=between;otsu=t;}
  }
  // 너무 높은 임계값은 옅은 뒷면 글씨까지 살리고, 너무 낮으면 실제 글자의 가는 획을 지운다.
  const threshold=Math.max(115,Math.min(195,otsu));
  for(let i=0;i<rgba.length;i+=4){const y=rgba[i]*.299+rgba[i+1]*.587+rgba[i+2]*.114,v=y<threshold?0:255;rgba[i]=rgba[i+1]=rgba[i+2]=v;rgba[i+3]=255;}
  return threshold;
}

/**
 * 흰 종이 안의 검은 제목 카드처럼 극성이 뒤집힌 큰 영역만 찾아 제자리에서 반전한다.
 * 페이지 전체를 원본/반전으로 두 번 OCR하지 않아도 검은 바탕의 흰 글자를 일반 본문과
 * 같은 한 번의 검출에서 읽을 수 있다. 책등의 가느다란 검은 띠와 테두리는 제외한다.
 */
export function normalizeDarkTextAreas(rgba, width, height) {
  if (!rgba?.length || width < 32 || height < 32) return [];
  const cell = Math.max(16, Math.min(36, Math.round(Math.min(width, height) / 36)));
  const cols = Math.ceil(width / cell), rows = Math.ceil(height / cell), dark = new Uint8Array(cols * rows);
  for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
    const x0 = gx * cell, y0 = gy * cell, x1 = Math.min(width, x0 + cell), y1 = Math.min(height, y0 + cell);
    let sum = 0, deep = 0, count = 0;
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
      const at = (y * width + x) * 4, lum = rgba[at] * .299 + rgba[at + 1] * .587 + rgba[at + 2] * .114;
      sum += lum; deep += lum < 92 ? 1 : 0; count++;
    }
    if (count && sum / count < 118 && deep / count >= .48) dark[gy * cols + gx] = 1;
  }
  const seen = new Uint8Array(dark.length), regions = [];
  for (let start = 0; start < dark.length; start++) {
    if (!dark[start] || seen[start]) continue;
    const queue = [start]; seen[start] = 1;
    let q = 0, minX = cols, minY = rows, maxX = 0, maxY = 0, cells = 0;
    while (q < queue.length) {
      const at = queue[q++], x = at % cols, y = Math.floor(at / cols); cells++;
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      for (const next of [at - 1, at + 1, at - cols, at + cols]) {
        if (next < 0 || next >= dark.length || seen[next] || !dark[next]) continue;
        const nx = next % cols, ny = Math.floor(next / cols);
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
        seen[next] = 1; queue.push(next);
      }
    }
    const x0 = minX * cell, y0 = minY * cell, x1 = Math.min(width, (maxX + 1) * cell), y1 = Math.min(height, (maxY + 1) * cell);
    const w = x1 - x0, h = y1 - y0, area = w * h, ratio = w / Math.max(1, h);
    const edgeStrip = (x0 === 0 || x1 === width) && (ratio < .22 || (h > height * .45 && w < width * .12));
    const rule = (ratio > 14 && h < cell * 3) || (ratio < .08 && w < cell * 3);
    if (cells < 2 || area < width * height * .001 || area > width * height * .45 || edgeStrip || rule) continue;
    // 흰 여백까지 반전하면 카드 둘레에 새 검은 띠가 생겨 잡티로 검출된다. 실제로 어둡다고
    // 판정된 타일의 경계까지만 뒤집는다.
    const bx0 = x0, by0 = y0, bx1 = x1, by1 = y1;
    for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) {
      const at = (y * width + x) * 4;
      rgba[at] = 255 - rgba[at]; rgba[at + 1] = 255 - rgba[at + 1]; rgba[at + 2] = 255 - rgba[at + 2];
    }
    regions.push([bx0, by0, bx1, by1]);
  }
  return regions;
}

/** 스캔 테두리·점선처럼 넓게 흩어진 작은 조각을 글줄로 오인한 결과를 거른다. */
export function goodScanLine(l) {
  if(!goodLine(l)||l.confidence<70)return false;
  const ws=(l.words||[]).filter(w=>String(w.text||'').trim()&&w.confidence>=50&&w.bbox);
  if(!ws.length)return false;
  const meaningful=[...String(l.text||'')].filter(c=>/[\p{L}\p{N}]/u.test(c)).length;
  const x0=Math.min(...ws.map(w=>w.bbox.x0)),x1=Math.max(...ws.map(w=>w.bbox.x1));
  const ys=ws.flatMap(w=>[w.bbox.y0,w.bbox.y1]).filter(Number.isFinite),h=ys.length?Math.max(1,Math.max(...ys)-Math.min(...ys)):0;
  const ink=ws.reduce((n,w)=>n+Math.max(0,w.bbox.x1-w.bbox.x0),0),occupancy=ink/Math.max(1,x1-x0);
  const compact=String(l.text||'').replace(/[^\p{L}\p{N}]/gu,''),unique=new Set([...compact.toLowerCase()]);
  // 스캔 테두리·눈금이 IIIIII, 11111처럼 한 문자 반복으로 판정되는 흔한 잡티를 제거한다.
  if(compact.length>=4&&unique.size===1)return false;
  // 세로 테두리·스캔 얼룩을 II, 11 같은 짧은 글자로 오인한 가느다란 상자는 버린다.
  // 두세 글자짜리 실제 제목은 보통 가로 폭이 글자 높이와 비슷하거나 더 넓다.
  if(h&&meaningful<=4&&(x1-x0)/h<.45)return false;
  // 실제 짧은 제목은 글자들이 서로 붙어 있어 점유율이 높다. 가짜 선/잔상은 작은 상자들이 넓게 흩어진다.
  return occupancy>=(meaningful<=4?.34:.22);
}

/** PaddleOCR의 줄 다각형을 기존 OCR 줄 형식으로 바꾼다. 문단 번호는 같은 세로 흐름의 가까운 줄끼리 묶는다. */
export function paddleItemsToLines(items) {
  const rows = (items || []).map((item) => {
    const pts = (item.poly || []).map((p) => Array.isArray(p) ? p : [p?.x, p?.y]).filter((p) => Number.isFinite(+p[0]) && Number.isFinite(+p[1]));
    if (!pts.length || !String(item.text || "").trim()) return null;
    const bbox = { x0: Math.min(...pts.map((p) => +p[0])), y0: Math.min(...pts.map((p) => +p[1])), x1: Math.max(...pts.map((p) => +p[0])), y1: Math.max(...pts.map((p) => +p[1])) };
    // 줄 앞뒤의 막대(목록 상자 "▌·" 의 막대를 OCR 이 "|" 로 읽음)는 뗀다: 그대로 두면 아래 잡티 필터(goodLine)가 "|" 든 줄을
    // 통째로 버려 목록 항목이 사라졌다(사용자 화면: 셋 중 막대가 읽힌 둘이 빠짐). 앞에서 뗐으면 목록 기호가 있던 줄(lead).
    // 띄어쓰기 자리 정보(info: 공백 뺀 글자 사이마다)도 뗀 글자 수만큼 맞춘다.
    let text = String(item.text).trim(), info = item.info, lead = item.lead;
    const BAR = "|│┃▌▐¦";
    const count = (m) => [...m[0].replace(/\s/g, "")].length;
    const head = text.match(new RegExp(`^[${BAR}]+\\s*`));
    if (head && head[0].length < text.length) { text = text.slice(head[0].length); if (info) info = info.slice(count(head)); lead = Math.max(lead ?? 0, 2); }
    const tail = text.match(new RegExp(`\\s*[${BAR}]+$`));
    if (tail && tail[0].length < text.length) { text = text.slice(0, text.length - tail[0].length); if (info) info = info.slice(0, Math.max(0, info.length - count(tail))); }
    if (!text.trim()) return null;
    return { text: text.trim(), confidence: Math.max(0, Math.min(100, Number(item.score || 0) * 100)), bbox, info, lead };
  }).filter(Boolean).sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  let par = -1, prev = null;
  return rows.map((row) => {
    const h = Math.max(1, row.bbox.y1 - row.bbox.y0), ph = prev ? Math.max(1, prev.bbox.y1 - prev.bbox.y0) : h;
    const overlapX = prev ? Math.max(0, Math.min(row.bbox.x1, prev.bbox.x1) - Math.max(row.bbox.x0, prev.bbox.x0)) : 0;
    const narrower = prev ? Math.max(1, Math.min(row.bbox.x1 - row.bbox.x0, prev.bbox.x1 - prev.bbox.x0)) : 1;
    const gap = prev ? row.bbox.y0 - prev.bbox.y1 : Infinity;
    if (!prev || gap > Math.max(h, ph) * 1.25 || overlapX / narrower < .35 || Math.abs(row.bbox.x0 - prev.bbox.x0) > Math.max(h, ph) * 2.5) par++;
    prev = row;
    return { text: row.text, confidence: row.confidence, _par: par, par, ...(row.info ? { info: row.info } : {}), ...(row.lead !== undefined ? { lead: row.lead } : {}), words: [{ text: row.text, confidence: row.confidence, bbox: row.bbox }] };
  });
}

const paddleBox = (item) => {
  const pts = (item?.poly || []).map((p) => Array.isArray(p) ? p : [p?.x, p?.y])
    .filter((p) => Number.isFinite(+p[0]) && Number.isFinite(+p[1]));
  return pts.length ? [Math.min(...pts.map((p) => +p[0])), Math.min(...pts.map((p) => +p[1])),
    Math.max(...pts.map((p) => +p[0])), Math.max(...pts.map((p) => +p[1]))] : null;
};
const paddleArea = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const paddleOverlap = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]))
  * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
/** 원본·반전 OCR에서 같은 글줄이 두 번 나온 경우 신뢰도가 높은 결과만 남긴다. */
export function mergePaddleItems(groups) {
  const chosen = [];
  for (const item of (groups || []).flat().filter(Boolean).sort((a, b) => Number(b.score || 0) - Number(a.score || 0))) {
    const box = paddleBox(item); if (!box || !String(item.text || "").trim()) continue;
    if (chosen.some((old) => paddleOverlap(old.box, box) >= Math.min(paddleArea(old.box), paddleArea(box)) * .62)) continue;
    chosen.push({ item, box });
  }
  return chosen.map((x) => x.item);
}

/** 잘라 낸 그림에서 얇은 가로 구분선을 찾는다 → [[y, x0, x1]](픽셀). 어두운 화소(밝기 < 128)가 영역 폭의 15%·60px 넘게
 *  (2px 틈까지) 이어지고 두께가 10px 이하인 곳. 글자 획은 그만큼 길게 이어지지 않는다. 스캔 OCR 줄 흐름이 줄 사이의
 *  선을 문단 경계로 쓴다(ocr-spacing.js lineFlow) — 가운데 맞춘 상자 글은 줄 폭이 모두 같아 선 말고는 나눌 단서가 없다. */
export function findHRules(rgba, width, height) {
  const minRun = Math.max(60, width * 0.15), rows = [];
  for (let y = 0; y < height; y++) {
    let best = null, start = -1, end = -1;
    for (let x = 0; x <= width; x++) {
      const i = (y * width + x) * 4, dark = x < width && rgba[i] * 0.3 + rgba[i + 1] * 0.59 + rgba[i + 2] * 0.11 < 128;
      if (dark) { if (start < 0) start = x; end = x + 1; continue; }
      if (start >= 0 && x < width && x - end < 2) continue;
      if (start >= 0 && end - start >= minRun && (!best || end - start > best[1] - best[0])) best = [start, end];
      start = -1;
    }
    rows.push(best);
  }
  const out = [];
  for (let y = 0; y < height; y++) {
    if (!rows[y]) continue;
    let y1 = y; while (y1 + 1 < height && rows[y1 + 1]) y1++;
    if (y1 - y + 1 <= 10) out.push([(y + y1) / 2, Math.min(...rows.slice(y, y1 + 1).map((r) => r[0])), Math.max(...rows.slice(y, y1 + 1).map((r) => r[1]))]);
    y = y1;
  }
  return out;
}

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
  // 일반 본문과 검은 카드의 흰 글자를 한 번에 읽는다. 페이지 전체를 두 번 돌리는 것보다
  // 훨씬 가볍고, 반전한 카드 밖의 본문·사진에는 영향을 주지 않는다.
  if (opts.normalizeDarkText) normalizeDarkTextAreas(rgba, cw, ch);
  // opts.autoInvert: 어두운 바탕(검은 머리 칸의 흰 글자 등)이면 색을 뒤집어 읽는다.
  // PaddleOCR와 Tesseract가 같은 입력을 보도록 고급 OCR보다 먼저 적용한다.
  if (opts.autoInvert && !opts.dualPolarity) {
    let sum = 0;
    for (let i = 0; i < rgba.length; i += 4) sum += rgba[i] * 0.3 + rgba[i + 1] * 0.59 + rgba[i + 2] * 0.11;
    if (opts.forceInvert || sum / (rgba.length / 4) < 110) for (let i = 0; i < rgba.length; i += 4) { rgba[i] = 255 - rgba[i]; rgba[i + 1] = 255 - rgba[i + 1]; rgba[i + 2] = 255 - rgba[i + 2]; }
  }
  const rules = opts.findRules ? findHRules(rgba, cw, ch) : undefined;   // 반전까지 마친 그림에서(검은 상자 속 흰 선도 잡히게)
  // 복잡한 스캔은 PaddleOCR의 글줄 검출+언어별 인식을 우선한다. 실행기나 모델에 문제가 생기면
  // 문서를 못 읽게 하지 않고 아래 Tesseract 경로로 자동 복귀한다.
  if (opts.paddleOcr && opts.paddlePacks?.length) {
    try {
      const variants = [rgba];
      if (opts.dualPolarity) {
        const inverted = Buffer.from(rgba);
        for (let i = 0; i < inverted.length; i += 4) { inverted[i] = 255 - inverted[i]; inverted[i + 1] = 255 - inverted[i + 1]; inverted[i + 2] = 255 - inverted[i + 2]; }
        variants.push(inverted);
      }
      const groups = [];
      for (const pixels of variants) {
        // 화소 그대로 넘긴다: 네이티브 PaddleOCR(paddle-native.js)은 PNG 가 필요 없고, 숨은 창으로 보낼 때만 PNG 로 만든다(session-service.js)
        const result = await enqueue(() => opts.paddleOcr({ rgba: pixels, width: cw, height: ch, packs: opts.paddlePacks, detector: opts.paddleDetector }));
        groups.push(result?.items || []);
      }
      // Paddle 결과도 Tesseract와 같은 스캔 잡티 필터를 거친다. 예전에는 신뢰도 45만
      // 넘으면 점·테두리 조각도 투명 글자층에 들어가 본문 드래그에 함께 선택됐다.
      const lines = paddleItemsToLines(mergePaddleItems(groups)).filter(opts.loose ? (l) => l.confidence >= 35
        : opts.cleanScan ? goodScanLine : (l) => l.confidence >= 45);
      if (lines.length) return { deg: 0, S, crop: { x0, y0, w: cw, h: ch }, lines, rules };
    } catch (e) { console.warn("[PaddleOCR] 인식하지 못해 Tesseract로 다시 읽습니다:", String(e?.message || e).split("\n")[0]); }
  }
  if (opts.cleanScan) cleanScanImage(rgba);
  // opts.loose: 표 칸처럼 짧은 글을 읽을 때는 잡음 거르기(기호가 든 줄 버리기 등)를 느슨하게 — "이름 | PC①" 같은 칸 글이 버려졌다
  const keepLine = opts.loose ? (l) => l.confidence >= 45 && /[\p{L}\p{N}]/u.test(l.text) : opts.cleanScan ? goodScanLine : goodLine;

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
        return { deg: 0, S, crop: { x0, y0, w: cw, h: ch }, rules,
          lines: zero.lines.map((l) => ({ text: l.text.trim(), conf: l.confidence, par: l._par,
            words: (l.words || []).filter((wd) => wd.text.trim() && wd.confidence >= (opts.cleanScan ? 55 : 40)).map((wd) => ({ text: wd.text.trim(), bbox: wd.bbox })) })) };
      }
    }
    for (const d of opts.angles || [0, -4, 4]) if (!tried.has(d)) tried.set(d, await tryAngle(d));
    let best = [...tried.values()].sort((a, b) => b.score - a.score)[0];
    if (!opts.angles) for (const d of [best.deg - 2, best.deg + 2]) if (!tried.has(d)) tried.set(d, await tryAngle(d));
    best = [...tried.values()].sort((a, b) => b.score - a.score)[0];
    return {
      deg: best.deg, S, crop: { x0, y0, w: cw, h: ch }, rules: best.deg ? undefined : rules,   // 돌려 읽은 낱말 좌표와는 맞지 않는다
      lines: best.lines.map((l) => ({ text: l.text.trim(), conf: l.confidence, par: l._par,
        words: (l.words || []).filter((wd) => wd.text.trim() && wd.confidence >= (opts.cleanScan ? 55 : 40)).map((wd) => ({ text: wd.text.trim(), bbox: wd.bbox })) })),
    };
  });
}
