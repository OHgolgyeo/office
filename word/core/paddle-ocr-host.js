// 숨은 Electron 화면에서만 실행한다. 공식 PaddleOCR.js는 브라우저용이라 이 화면이
// OpenCV.js와 ONNX Runtime Web을 맡고, 메인 프로세스에는 작은 결과만 돌려준다.
import { PaddleOCR } from "@paddleocr/paddleocr-js";

const PACK_MODEL = Object.freeze({
  korean: "korean_PP-OCRv5_mobile_rec",
  cjk: "PP-OCRv5_mobile_rec",
  latin: "latin_PP-OCRv5_mobile_rec",
  english: "en_PP-OCRv5_mobile_rec",
  eastSlavic: "eslav_PP-OCRv5_mobile_rec",
  cyrillic: "cyrillic_PP-OCRv5_mobile_rec",
  arabic: "arabic_PP-OCRv5_mobile_rec",
  devanagari: "devanagari_PP-OCRv5_mobile_rec",
  thai: "th_PP-OCRv5_mobile_rec",
  greek: "el_PP-OCRv5_mobile_rec",
  tamil: "ta_PP-OCRv5_mobile_rec",
  telugu: "te_PP-OCRv5_mobile_rec",
});

const engines = new Map();
// Electron 데스크톱에서는 WebGPU를 먼저 쓰고, 지원하지 않는 PC만 WASM으로 돌아간다.
// WASM은 격리된 숨은 창에서 논리 코어 절반(최대 4개)을 사용한다.
const desktopThreads = globalThis.crossOriginIsolated
  ? Math.max(1, Math.min(4, Math.ceil((navigator.hardwareConcurrency || 2) / 2))) : 1;
async function engine(pack, detector = "PP-OCRv5_mobile_det") {
  const key = `${detector}:${pack}`;
  if (!engines.has(key)) engines.set(key, PaddleOCR.create({
    textDetectionModelName: detector,
    textDetectionModelAsset: { url: `/api/paddle-model/${detector}.tar` },
    textRecognitionModelName: PACK_MODEL[pack],
    textRecognitionModelAsset: { url: `/api/paddle-model/${PACK_MODEL[pack]}.tar` },
    textRecognitionBatchSize: 8,
    ortOptions: { backend: "auto", wasmPaths: "/paddle-ort/", numThreads: desktopThreads, simd: true },
  }).catch((e) => { engines.delete(key); throw e; }));
  return engines.get(key);
}

const bbox = (poly) => {
  const pts = (poly || []).map((p) => Array.isArray(p) ? p : [p?.x, p?.y]).filter((p) => Number.isFinite(+p[0]) && Number.isFinite(+p[1]));
  return pts.length ? [Math.min(...pts.map((p) => +p[0])), Math.min(...pts.map((p) => +p[1])), Math.max(...pts.map((p) => +p[0])), Math.max(...pts.map((p) => +p[1]))] : null;
};
const area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const overlap = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
const scriptRatio = (text, pack) => {
  const chars = [...String(text || "")].filter((c) => /[\p{L}\p{N}]/u.test(c));
  if (!chars.length) return .5;
  const patterns = {
    korean: /[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9]/u,
    cjk: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z0-9]/u,
    latin: /[\p{Script=Latin}0-9]/u, english: /[A-Za-z0-9]/u,
    eastSlavic: /[\p{Script=Cyrillic}A-Za-z0-9]/u, cyrillic: /[\p{Script=Cyrillic}A-Za-z0-9]/u,
    arabic: /[\p{Script=Arabic}A-Za-z0-9]/u, devanagari: /[\p{Script=Devanagari}A-Za-z0-9]/u,
    thai: /[\p{Script=Thai}A-Za-z0-9]/u, greek: /[\p{Script=Greek}A-Za-z0-9]/u,
    tamil: /[\p{Script=Tamil}A-Za-z0-9]/u, telugu: /[\p{Script=Telugu}A-Za-z0-9]/u,
  };
  const re = patterns[pack] || /[\p{L}\p{N}]/u;
  return chars.filter((c) => re.test(c)).length / chars.length;
};

function mergeResults(results) {
  const chosen = [];
  for (const { pack, result } of results) for (const item of result?.items || []) {
    const b = bbox(item.poly); if (!b || !String(item.text || "").trim()) continue;
    const candidate = { poly: item.poly, text: String(item.text).trim(), score: Number(item.score || 0), pack, b };
    candidate.rank = candidate.score * (.55 + .45 * scriptRatio(candidate.text, pack));
    const old = chosen.findIndex((x) => overlap(x.b, b) >= .55 * Math.min(area(x.b), area(b)));
    if (old < 0) chosen.push(candidate); else if (candidate.rank > chosen[old].rank) chosen[old] = candidate;
  }
  return chosen.sort((a, b) => a.b[1] - b.b[1] || a.b[0] - b.b[0]).map(({ poly, text, score, pack }) => ({ poly, text, score, pack }));
}

async function recognize(bytes, packs, mime = "image/png", detector = "PP-OCRv5_mobile_det") {
  const blob = new Blob([new Uint8Array(bytes)], { type: mime }), results = [];
  for (const pack of [...new Set(packs || [])].filter((p) => PACK_MODEL[p])) {
    let ocr;
    try { ocr = await engine(pack, detector); } catch (e) { throw new Error(`${pack} 모델 초기화: ${String(e?.message || e)}`, { cause: e }); }
    let result;
    try { [result] = await ocr.predict(blob, { textRecScoreThresh: .35 }); }
    catch (e) { throw new Error(`${pack} 그림 인식: ${String(e?.message || e)}`, { cause: e }); }
    results.push({ pack, result });
  }
  return mergeResults(results);
}
const errorText = (e) => {
  const parts = [e?.name, e?.message, e?.stack, e?.cause && String(e.cause)].filter(Boolean);
  try { const extra = JSON.stringify(e, Object.getOwnPropertyNames(e || {})); if (extra && extra !== "{}") parts.push(extra); } catch { /* 순환 오류 */ }
  return [...new Set(parts)].join("\n");
};

if (window.paddleHost) {
  window.paddleHost.onRequest(async ({ id, bytes, packs, mime = "image/png", detector }) => {
    try { window.paddleHost.result({ id, ok: true, items: await recognize(bytes, packs, mime, detector) }); }
    catch (e) { window.paddleHost.result({ id, ok: false, error: errorText(e) }); }
  });
  window.paddleHost.ready();
}

