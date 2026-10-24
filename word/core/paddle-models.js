// PaddleOCR 고급 스캔 OCR 모델 관리자.
// 공식 PaddleOCR ONNX tar만 고정 목록으로 받아 사용자 자료 폴더에 둔다. 문서 이미지는 전송하지 않는다.
import fs from "fs";
import path from "path";

const BASE = "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0";
const model = (name, kind = "rec") => ({ name, kind, url: `${BASE}/${name}_onnx_infer.tar` });

export const PADDLE_MODELS = Object.freeze({
  "PP-OCRv6_medium_det": model("PP-OCRv6_medium_det", "det"),
  "PP-OCRv6_small_det": model("PP-OCRv6_small_det", "det"),
  "PP-OCRv5_mobile_det": model("PP-OCRv5_mobile_det", "det"),
  "PP-OCRv5_mobile_rec": model("PP-OCRv5_mobile_rec"),
  "korean_PP-OCRv5_mobile_rec": model("korean_PP-OCRv5_mobile_rec"),
  "latin_PP-OCRv5_mobile_rec": model("latin_PP-OCRv5_mobile_rec"),
  "en_PP-OCRv5_mobile_rec": model("en_PP-OCRv5_mobile_rec"),
  "eslav_PP-OCRv5_mobile_rec": model("eslav_PP-OCRv5_mobile_rec"),
  "cyrillic_PP-OCRv5_mobile_rec": model("cyrillic_PP-OCRv5_mobile_rec"),
  "arabic_PP-OCRv5_mobile_rec": model("arabic_PP-OCRv5_mobile_rec"),
  "devanagari_PP-OCRv5_mobile_rec": model("devanagari_PP-OCRv5_mobile_rec"),
  "th_PP-OCRv5_mobile_rec": model("th_PP-OCRv5_mobile_rec"),
  "el_PP-OCRv5_mobile_rec": model("el_PP-OCRv5_mobile_rec"),
  "ta_PP-OCRv5_mobile_rec": model("ta_PP-OCRv5_mobile_rec"),
  "te_PP-OCRv5_mobile_rec": model("te_PP-OCRv5_mobile_rec"),
});

export const PADDLE_PACKS = Object.freeze({
  korean: { name: "한국어·영어", model: "korean_PP-OCRv5_mobile_rec" },
  cjk: { name: "중국어·일본어·영어", model: "PP-OCRv5_mobile_rec" },
  latin: { name: "라틴 문자 언어", model: "latin_PP-OCRv5_mobile_rec" },
  english: { name: "영어", model: "en_PP-OCRv5_mobile_rec" },
  cyrillic: { name: "키릴 문자 언어", model: "cyrillic_PP-OCRv5_mobile_rec" },
  eastSlavic: { name: "러시아어·우크라이나어", model: "eslav_PP-OCRv5_mobile_rec" },
  arabic: { name: "아랍 문자 언어", model: "arabic_PP-OCRv5_mobile_rec" },
  devanagari: { name: "데바나가리 문자 언어", model: "devanagari_PP-OCRv5_mobile_rec" },
  thai: { name: "태국어", model: "th_PP-OCRv5_mobile_rec" },
  greek: { name: "그리스어", model: "el_PP-OCRv5_mobile_rec" },
  tamil: { name: "타밀어", model: "ta_PP-OCRv5_mobile_rec" },
  telugu: { name: "텔루구어", model: "te_PP-OCRv5_mobile_rec" },
});

const GROUPS = {
  korean: new Set(["kor"]),
  cjk: new Set(["jpn", "chi_sim", "chi_tra"]),
  latin: new Set(["afr", "aze", "bos", "cat", "ces", "cym", "dan", "deu", "spa", "est", "eus", "fin", "fra", "gle", "glg", "hrv", "hun", "ind", "isl", "ita", "kur", "lat", "ltz", "lit", "lav", "mri", "msa", "mlt", "nld", "nor", "oci", "pol", "por", "que", "roh", "ron", "srp_latn", "slk", "slv", "sqi", "swe", "swa", "tgl", "tur", "uzb", "vie"]),
  cyrillic: new Set(["bel", "bul", "mon", "kaz", "kir", "tgk", "mkd", "tat", "chv", "bak", "udm", "kom", "oss", "bua", "kal", "tuv", "sah", "kaa", "srp"]),
  eastSlavic: new Set(["rus", "ukr"]),
  arabic: new Set(["ara", "fas", "urd", "uig", "pus", "snd"]),
  devanagari: new Set(["hin", "mar", "nep", "san", "bih"]),
  thai: new Set(["tha"]),
  greek: new Set(["ell", "grc"]),
  tamil: new Set(["tam"]),
  telugu: new Set(["tel"]),
};

/** Tesseract 호환 언어 코드 목록을 PaddleOCR 언어군으로 바꾼다. 모르는 언어는 Tesseract가 맡는다. */
export function paddlePacksForLanguages(languages) {
  const selected = new Set((languages || []).map(String));
  const packs = [];
  for (const [pack, codes] of Object.entries(GROUPS)) if ([...selected].some((c) => codes.has(c))) packs.push(pack);
  // 모든 다국어 팩이 기본 라틴 문자도 읽으므로, 다른 팩이 하나라도 있으면 영어 전용 모델을 중복 실행하지 않는다.
  if (selected.has("eng") && !packs.length) packs.push("english");
  return packs;
}

export function modelNamesForPacks(packs) {
  const rec = [...new Set((packs || []).map((p) => PADDLE_PACKS[p]?.model).filter(Boolean))];
  return rec.length ? ["PP-OCRv6_medium_det", ...rec] : [];
}

export const paddleModelPath = (dir, name) => path.join(dir, `${name}.tar`);

function tarEntries(bytes) {
  const entries = new Map();
  for (let at = 0; at + 512 <= bytes.length;) {
    const head = bytes.subarray(at, at + 512);
    if (head.every((b) => b === 0)) break;
    const z = (start, len) => Buffer.from(head.subarray(start, start + len)).toString("utf8").replace(/\0.*$/s, "").trim();
    const name = z(0, 100), prefix = z(345, 155), full = prefix ? `${prefix}/${name}` : name;
    const size = parseInt(z(124, 12).replace(/\0/g, "").trim() || "0", 8);
    if (!full || !Number.isFinite(size) || size < 0 || at + 512 + size > bytes.length) throw new Error("PaddleOCR 모델 압축 파일이 올바르지 않습니다.");
    entries.set(path.posix.basename(full), bytes.subarray(at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

export function validatePaddleModel(bytes, expectedName) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.length < 512 * 1024 || bytes.length > 140 * 1024 * 1024) throw new Error(`${expectedName} 모델 크기가 올바르지 않습니다.`);
  const entries = tarEntries(bytes), onnx = entries.get("inference.onnx"), config = entries.get("inference.yml");
  if (!onnx?.length || !config?.length) throw new Error(`${expectedName} 모델에 inference.onnx 또는 inference.yml이 없습니다.`);
  const yaml = Buffer.from(config).toString("utf8");
  const found = yaml.match(/(?:^|\n)\s*model_name\s*:\s*["']?([^\s"']+)/)?.[1];
  if (found !== expectedName) throw new Error(`PaddleOCR 모델 이름이 다릅니다. (${found || "없음"})`);
  return true;
}

export function installedPaddleModels(dir) {
  const out = [];
  for (const name of Object.keys(PADDLE_MODELS)) {
    try { if (fs.statSync(paddleModelPath(dir, name)).size > 512 * 1024) out.push(name); } catch { /* 없음 */ }
  }
  return out;
}

async function downloadModel(dir, name, onProgress) {
  const info = PADDLE_MODELS[name];
  if (!info) throw new Error("지원하지 않는 PaddleOCR 모델입니다.");
  const target = paddleModelPath(dir, name), temp = `${target}.${process.pid}.tmp`;
  try {
    const r = await fetch(info.url, { redirect: "follow" });
    if (!r.ok || !r.body) throw new Error(`${name} 모델을 내려받지 못했습니다. (HTTP ${r.status})`);
    const declared = Number(r.headers.get("content-length") || 0);
    if (declared > 140 * 1024 * 1024) throw new Error(`${name} 모델이 허용 크기를 넘습니다.`);
    const chunks = []; let size = 0;
    for await (const chunk of r.body) {
      size += chunk.length;
      if (size > 140 * 1024 * 1024) throw new Error(`${name} 모델이 허용 크기를 넘습니다.`);
      chunks.push(chunk); onProgress?.(chunk.length, declared);
    }
    const bytes = Buffer.concat(chunks); validatePaddleModel(bytes, name);
    fs.writeFileSync(temp, bytes); fs.renameSync(temp, target);
  } catch (e) { try { fs.unlinkSync(temp); } catch { /* 없음 */ } throw e; }
}

/** 필요한 모델만 설치한다. 반환값은 이번에 새로 받은 모델 이름들이다. */
export async function installPaddlePacks(dir, packs, onProgress = () => {}) {
  fs.mkdirSync(dir, { recursive: true });
  const installed = new Set(installedPaddleModels(dir)), needed = modelNamesForPacks(packs), downloaded = [];
  let done = 0;
  for (const name of needed) {
    if (installed.has(name)) continue;
    await downloadModel(dir, name, (delta, total) => { done += delta; onProgress({ name, done, total }); });
    downloaded.push(name);
  }
  return downloaded;
}

export function paddlePackState(dir, languages) {
  const packs = paddlePacksForLanguages(languages), installed = new Set(installedPaddleModels(dir));
  const rec = [...new Set(packs.map((p) => PADDLE_PACKS[p]?.model).filter(Boolean))];
  // 새 정확도형 검출기를 우선하되, 이전 버전에서 모바일 검출기만 받은 사용자는
  // 언어 설정을 다시 누르기 전에도 OCR을 계속 쓸 수 있게 한다.
  const detector = installed.has("PP-OCRv6_medium_det") ? "PP-OCRv6_medium_det"
    : installed.has("PP-OCRv6_small_det") ? "PP-OCRv6_small_det"
      : installed.has("PP-OCRv5_mobile_det") ? "PP-OCRv5_mobile_det" : null;
  return {
    packs,
    models: detector ? [detector, ...rec] : modelNamesForPacks(packs),
    installedModels: [...installed],
    detector,
    accurate: detector === "PP-OCRv6_medium_det",
    upgradeAvailable: !!detector && detector !== "PP-OCRv6_medium_det",
    ready: !!detector && rec.every((n) => installed.has(n)),
  };
}
