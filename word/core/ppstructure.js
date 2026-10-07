// 스캔본 표 인식: PaddleOCR PP-Structure 의 두 모델을 ONNX 로 돌린다(파이썬·PaddlePaddle 없이, onnxruntime-node).
//  ① 레이아웃 인식 PP-DocLayoutV3 — 쪽 그림에서 표 영역을 찾는다
//  ② 표 구조 인식 SLANet_plus — 표 그림에서 행·열·합친 칸(HTML 표 토큰)과 칸 상자를 얻는다
// 칸 안 글자는 쪽 OCR(core/ocr.js, session.js ocrPage)이 이미 읽어 둔 낱말을 칸마다 나눠 담는다.
// 모델(Apache-2.0, 약 131MB)은 설치 파일에 넣지 않고 처음 켤 때 사용자 자료 폴더로 한 번 내려받는다.
// 모델 출처: PaddlePaddle PaddleOCR(Apache-2.0)의 ONNX 판 — huggingface.co/snowfluke/ppu-paddle-ocr-models (Apache-2.0)
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { renderRegionRGB } from "./src/extract-objects.js";

const BASE = "https://huggingface.co/snowfluke/ppu-paddle-ocr-models/resolve/main";
export const PP_MODELS = [
  { file: "PP-DocLayoutV3.onnx", url: `${BASE}/layout/PP-DocLayoutV3.onnx`, sha256: "dc5670ebbb42e2ba4e41395fc55e8217b007134e8b9e35023d592a8fe040a288", size: 129920689 },
  { file: "SLANet_plus.onnx", url: `${BASE}/table/SLANet_plus.onnx`, sha256: "d57a942af6a2f57d6a4a0372573c696a2379bf5857c45e2ac69993f3b334514b", size: 7758305 },
];
// PP-DocLayoutV3 분류(PP-DocLayoutV3_labels.txt 순서)
const LAYOUT_LABELS = ["abstract", "algorithm", "aside_text", "chart", "content", "display_formula", "doc_title", "figure_title", "footer",
  "footer_image", "footnote", "formula_number", "header", "header_image", "image", "inline_formula", "number", "paragraph_title",
  "reference", "reference_content", "seal", "table", "text", "vertical_text", "vision_footnote"];
// SLANet 표 구조 토큰: PaddleOCR table_structure_dict_ch.txt 에서 "<td>"를 빼고 "<td></td>"를 더한 뒤 앞뒤에 시작·끝(merge_no_span_structure)
const SPANS = (k) => Array.from({ length: 19 }, (_, i) => ` ${k}="${i + 2}"`);
const TABLE_TOKENS = ["sos", "<thead>", "</thead>", "<tbody>", "</tbody>", "<tr>", "</tr>", "<td", ">", "</td>",
  ...SPANS("colspan"), ...SPANS("rowspan"), "<td></td>", "eos"];
const TD_TOKENS = new Set(["<td>", "<td", "<td></td>"]);

export const ppModelsInstalled = (dir) => PP_MODELS.every((m) => fileOk(dir, m));

/** 모델을 내려받는다(이미 있으면 건너뜀). onProgress(받은 바이트, 전체 바이트) */
export async function installPpModels(dir, onProgress = () => {}) {
  fs.mkdirSync(dir, { recursive: true });
  const total = PP_MODELS.reduce((s, m) => s + m.size, 0);
  let done = PP_MODELS.filter((m) => fileOk(dir, m)).reduce((s, m) => s + m.size, 0);
  for (const m of PP_MODELS) {
    if (fileOk(dir, m)) continue;
    const target = path.join(dir, m.file), temp = `${target}.${process.pid}.tmp`;
    const r = await fetch(m.url);
    if (!r.ok || !r.body) throw new Error(`표 인식 모델을 내려받지 못했습니다. (${m.file}, HTTP ${r.status})`);
    const hash = crypto.createHash("sha256"), out = fs.createWriteStream(temp);
    try {
      for await (const chunk of r.body) { hash.update(chunk); if (!out.write(chunk)) await new Promise((ok) => out.once("drain", ok)); done += chunk.length; onProgress(done, total); }
      await new Promise((ok, fail) => out.end((e) => (e ? fail(e) : ok())));
      if (hash.digest("hex") !== m.sha256) throw new Error(`내려받은 표 인식 모델이 올바르지 않습니다. (${m.file})`);
      fs.renameSync(temp, target);
    } catch (e) { out.destroy(); try { fs.unlinkSync(temp); } catch { /* 없음 */ } throw e; }
  }
  try { sessions?.child?.kill(); } catch { /* 이미 끝남 */ }
  sessions = null;
}
function fileOk(dir, m) { try { return fs.statSync(path.join(dir, m.file)).size === m.size; } catch { return false; } }

let sessions = null, ortPromise = null, loading = null;
// 모델은 따로 도는 프로세스(ort-process.mjs)에서 돌린다: run() 이 부른 스레드를 계산 내내 붙잡아, 서버에서 바로 돌리면
// 큰 PDF 의 레이아웃 분석 동안(쪽마다 1.5~4초) 쪽 그림·글자층 요청이 모두 멈췄다. 작업 스레드로 옮기면 앱을 끌 때
// 계산 중인 쪽이 끝나기를 기다려 종료가 늦었다 — 프로세스는 바로 끝낼 수 있다. 못 띄우면 예전처럼 여기서.
class TensorLike { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } }
async function processModels(dir) {
  const { fork } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const files = { layout: path.join(dir, PP_MODELS[0].file), table: path.join(dir, PP_MODELS[1].file) };
  const child = fork(fileURLToPath(new URL("./ort-process.mjs", import.meta.url)), [JSON.stringify(files)],
    { serialization: "advanced", stdio: ["ignore", "ignore", "inherit", "ipc"], execArgv: [] });
  const pending = new Map();
  let seq = 0;
  const names = await new Promise((resolve, reject) => {
    const first = (m) => { if (m?.ready === undefined) return; child.off("message", first); m.ready ? resolve(m.names) : reject(new Error(m.error)); };
    child.on("message", first);
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`모델 프로세스가 시작하자마자 끝났습니다(${code}).`)));
  });
  child.on("message", (m) => {
    if (m?.id == null) return;
    const p = pending.get(m.id); if (!p) return;
    pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error)); else p.resolve(m.out);
  });
  const fail = (e) => { for (const p of pending.values()) p.reject(e instanceof Error ? e : new Error(String(e))); pending.clear(); if (sessions?.child === child) sessions = null; };
  child.on("error", fail);
  child.on("exit", (code) => fail(new Error(`표·레이아웃 모델 프로세스가 끝났습니다(${code}).`)));
  child.unref(); child.channel?.unref?.();                       // 서버(앱)가 끝날 때 이 프로세스를 기다리지 않는다
  const mk = (model) => ({
    ...names[model],
    run: (feeds) => new Promise((resolve, reject) => {
      const id = ++seq, plain = {};
      for (const [k, v] of Object.entries(feeds)) plain[k] = { type: v.type, data: v.data, dims: v.dims };
      pending.set(id, { resolve, reject });
      child.channel?.ref?.();                                      // 계산 중에는 연결을 붙잡고, 다 끝나면 놓는다
      child.send({ id, model, feeds: plain }, (err) => { if (err) { pending.delete(id); reject(err); } });
    }).finally(() => { if (!pending.size) child.channel?.unref?.(); }),
  });
  return { dir, ort: { Tensor: TensorLike }, layout: mk("layout"), table: mk("table"), child };
}
/** 앱을 끌 때: 모델 프로세스를 바로 끝낸다(계산 중이어도 기다리지 않는다) */
export function shutdownModels() {
  try { sessions?.child?.kill(); } catch { /* 이미 끝남 */ }
  sessions = null;
}
async function models(dir) {
  if (sessions?.dir === dir) return sessions;
  if (loading?.dir === dir) return loading.promise;
  const promise = (async () => {
    try { sessions = await processModels(dir); return sessions; }
    catch (e) { console.warn("[레이아웃 분석] 모델 프로세스를 쓰지 못해 서버에서 직접 돌립니다:", e?.message || e); }
    return inProcessModels(dir);
  })().finally(() => { loading = null; });
  loading = { dir, promise };
  return promise;
}
async function inProcessModels(dir) {
  ortPromise ||= import("onnxruntime-node");
  const ort = await ortPromise;
  // 모델 출력 모양 경고("Expected shape … does not match")는 결과에 영향이 없는데 터미널을 가득 채운다 → 오류만 남긴다
  try { ort.env.logLevel = "error"; } catch { /* 설정 못 함 */ }
  const opts = { graphOptimizationLevel: "all", logSeverityLevel: 3 };
  const [layout, table] = await Promise.all(PP_MODELS.map((m) => ort.InferenceSession.create(path.join(dir, m.file), opts)));
  sessions = { dir, ort, layout, table };
  return sessions;
}

// RGB 그림 → 정규화한 CHW Float32 (mean/std 는 채널별, 값은 0~1 로 나눈 뒤 적용). bgr 이면 채널 순서를 B,G,R 로
function toCHW({ data, w, h }, W, H, mean, std, bgr = false) {
  const out = new Float32Array(3 * W * H);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y * w + x) * 3;
    for (let c = 0; c < 3; c++) {
      const v = data[s + (bgr ? 2 - c : c)] / 255;
      out[c * W * H + y * W + x] = (v - mean[c]) / std[c];
    }
  }
  return out;
}

/** ① 쪽(pt 영역)에서 표 영역 찾기 → [{ bbox:[x0,y0,x1,y1](pt), score }] */
export async function detectTables(dir, page, region, minScore = 0.5) {
  return tablesOf(await detectLayout(dir, page, region), minScore);
}

/** 레이아웃 결과에서 표만: 같은 표를 겹쳐 찾은 상자(카드 하나 / 카드 두 개 묶음 등)는 신뢰도 높은 것만 남긴다
 *  (작은 쪽 넓이의 50% 이상 겹치면 같은 표) */
export function tablesOf(boxes, minScore = 0.5) {
  const found = boxes.filter((b) => b.label === "table" && b.score >= minScore).map(({ bbox, score }) => ({ bbox, score }));
  const area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const inter = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const kept = [];
  for (const f of found.sort((a, b) => b.score - a.score)) {
    if (!kept.some((k) => inter(k.bbox, f.bbox) >= 0.5 * Math.min(area(k.bbox), area(f.bbox)))) kept.push(f);
  }
  return kept.sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
}

// 머리말·꼬리말(쪽마다 되풀이되는 장 제목·쪽 번호·장식 띠)
export const FURNITURE_LABELS = new Set(["header", "header_image", "footer", "footer_image", "number"]);

/** 쪽(pt 영역)의 레이아웃 전체 → [{ label, bbox:[x0,y0,x1,y1](pt), score }] (신뢰도 0.3 이상) */
export async function detectLayout(dir, page, region) {
  const { ort, layout } = await models(dir);
  const S = 800, w = region[2] - region[0], h = region[3] - region[1];
  const img = renderRegionRGB(page, region, S, S);                 // 모델 입력 크기로 바로 그린다(비율 유지 안 함, RT-DETR 전처리와 같음)
  const feeds = {
    image: new ort.Tensor("float32", toCHW(img, S, S, [0, 0, 0], [1, 1, 1]), [1, 3, S, S]),
    im_shape: new ort.Tensor("float32", Float32Array.from([S, S]), [1, 2]),
    scale_factor: new ort.Tensor("float32", Float32Array.from([S / h, S / w]), [1, 2]),
  };
  const out = await layout.run(feeds);
  const boxes = out[layout.outputNames[0]], n = out[layout.outputNames[1]]?.data?.[0] ?? boxes.dims[0];
  const cols = boxes.dims[1], d = boxes.data, found = [];
  for (let i = 0; i < n; i++) {
    const cls = Math.round(d[i * cols]), score = d[i * cols + 1];
    if (score < 0.3 || !LAYOUT_LABELS[cls]) continue;
    const [x0, y0, x1, y1] = [2, 3, 4, 5].map((k) => d[i * cols + k]);
    found.push({ label: LAYOUT_LABELS[cls], bbox: [region[0] + Math.max(0, x0), region[1] + Math.max(0, y0), region[0] + Math.min(w, x1), region[1] + Math.min(h, y1)], score });
  }
  return found;
}

/** ② 표 영역(pt)의 구조 → { tokens:[...], cells:[[x0,y0,x1,y1] (pt)] } (cells 는 td 토큰 순서) */
export async function recognizeTableStructure(dir, page, bbox) {
  const { ort, table } = await models(dir);
  const L = 488, w = bbox[2] - bbox[0], h = bbox[3] - bbox[1];
  const ratio = L / Math.max(w, h);                                // 긴 변을 488 로(비율 유지) → 488×488 로 채움
  const rw = Math.max(1, Math.round(w * ratio)), rh = Math.max(1, Math.round(h * ratio));
  const img = renderRegionRGB(page, bbox, rw, rh);
  const x = toCHW(img, L, L, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225], true);   // PaddleOCR 은 BGR 로 읽는다. 오른쪽·아래 여백은 0
  const out = await table.run({ [table.inputNames[0]]: new ort.Tensor("float32", x, [1, 3, L, L]) });
  const loc = out[table.outputNames[0]], prob = out[table.outputNames[1]];
  const steps = prob.dims[1], V = prob.dims[2], tokens = [], cells = [];
  for (let t = 0; t < steps; t++) {
    let best = 0, bv = -Infinity;
    for (let v = 0; v < V; v++) { const p = prob.data[t * V + v]; if (p > bv) { bv = p; best = v; } }
    const tok = TABLE_TOKENS[best];
    if (tok === "eos" && t > 0) break;
    if (tok === "sos" || tok === "eos") continue;
    tokens.push(tok);
    if (TD_TOKENS.has(tok)) {
      const b = Array.from(loc.data.slice(t * 8, t * 8 + 8));      // 4점(x,y)×4, 0~1 → 488 칸 → ÷ratio → pt
      const xs = [b[0], b[2], b[4], b[6]].map((v) => (v * L) / ratio), ys = [b[1], b[3], b[5], b[7]].map((v) => (v * L) / ratio);
      cells.push([bbox[0] + Math.min(...xs), bbox[1] + Math.min(...ys), bbox[0] + Math.max(...xs), bbox[1] + Math.max(...ys)]);
    }
  }
  return { tokens, cells };
}

/** 표 토큰에서 칸마다 격자 자리(행, 열, colspan, rowspan)를 구한다. 위 행에서 내려온 rowspan 칸은 건너뛴다. 칸 순서 = td 토큰 순서 */
function tableGrid(tokens) {
  const out = [], taken = new Set();
  let row = -1, col = 0, cur = null;
  const place = (cs, rs) => {
    while (taken.has(`${row}:${col}`)) col++;
    const g = { row, col, cs, rs };
    for (let r = row; r < row + rs; r++) for (let c = col; c < col + cs; c++) taken.add(`${r}:${c}`);
    col += cs;
    out.push(g);
    return g;
  };
  for (const tok of tokens) {
    if (tok === "<tr>") { row++; col = 0; continue; }
    if (tok === "<td></td>") { place(1, 1); continue; }
    if (tok === "<td") { cur = { cs: 1, rs: 1 }; continue; }
    const m = /^ (colspan|rowspan)="(\d+)"$/.exec(tok);
    if (m && cur) { cur[m[1] === "colspan" ? "cs" : "rs"] = +m[2]; continue; }
    if (tok === ">" && cur) { place(cur.cs, cur.rs); cur = null; }
  }
  return out;
}

/** 스캔 쪽의 표를 HTML 표로: 구조(②) + 칸 글자. words 는 쪽 OCR 이 읽어 둔 낱말
 *  [{ text, sp(뒤 띄어쓰기), line, x0,y0,x1,y1 (pt) }]. readCell(칸 pt 상자) → 글: 쪽 OCR 에서 빈 칸만 따로 읽는다
 *  (검은 머리 칸의 흰 글자처럼 쪽 OCR 이 놓친 칸). 반환 { html, text, bbox } */
export async function scanTableHtml(dir, page, bbox, { words, esc, readCell = null, cellColor = null, fit = false }) {
  const { tokens, cells } = await recognizeTableStructure(dir, page, bbox);
  if (!cells.length) return null;
  return fillTableHtml(tokens, cells, bbox, { words, esc, readCell, cellColor, fit });
}

/** 글자 정보가 있는 PDF 쪽의 표(선 없는 표 등)를 HTML 표로: 구조는 모델(②), 칸 글자는 PDF 글자 그대로(OCR 없음).
 *  glyphs: 쪽의 글자 [{ c, x0,y0,x1,y1 (pt), line, sp(이 글자 뒤 띄어쓰기) }] — 읽는 순서대로. 반환 { html, text, bbox } */
export async function pdfTableHtml(dir, page, bbox, { glyphs, esc, cellColor = null, fit = false }) {
  const { tokens, cells } = await recognizeTableStructure(dir, page, bbox);
  if (!cells.length) return null;
  // 글자를 낱말로 묶는다(같은 줄의 이어진 글자, 공백 글자에서 끊고 뒤 띄어쓰기 표시)
  const words = [];
  let cur = null;
  for (const g of glyphs) {
    if (/\s/.test(g.c)) { if (cur) { cur.sp = true; cur = null; } continue; }
    // 공백 글자 없이 간격으로만 띄어 쓴 PDF 도 있다: 글자 상자 높이의 15%(글자 크기의 약 0.18배) 이상 벌어지면 낱말을 끊고 띄운다
    if (cur && cur.line === g.line && g.x0 - cur.x1 < Math.max(1, (g.y1 - g.y0) * 0.15)) {
      cur.text += g.c; cur.x1 = Math.max(cur.x1, g.x1); cur.y0 = Math.min(cur.y0, g.y0); cur.y1 = Math.max(cur.y1, g.y1);
    } else {
      if (cur) cur.sp = true;                                        // 간격으로 끊겼거나 줄이 바뀜 → 띄어 쓴다
      cur = { text: g.c, sp: false, line: g.line, size: g.size, x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1 };
      words.push(cur);
    }
    if (g.sp) { cur.sp = true; cur = null; }                        // 줄 글에서 이 글자 뒤를 띄어 썼다
  }
  return fillTableHtml(tokens, cells, bbox, { words, esc, cellColor, fit });
}

async function fillTableHtml(tokens, cells, bbox, { words, esc, readCell = null, cellColor = null, fit = false }) {
  // 표 영역 안의 낱말을 칸에 나눠 담는다(낱말 가운데가 든 칸, 없으면 가장 가까운 칸). 띄어쓰기는 OCR 이 알려 준 자리만,
  // 줄이 바뀌면 띄운다(한국어는 음절마다 낱말로 알려 주는 일이 많아 낱말마다 띄우면 "당 신 은"이 된다)
  const parts = cells.map(() => []);
  // 쪽 OCR 의 읽기 영역이 겹치면 같은 낱말을 두 번 읽는다("Anita Anita"): 같은 글자가 절반 넘게 겹치면 하나만
  const overlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const size = (a) => Math.max(1e-3, (a.x1 - a.x0) * (a.y1 - a.y0));
  const unique = [];
  for (const wd of words) if (!unique.some((u) => u.text === wd.text && overlap(u, wd) > 0.5 * Math.min(size(u), size(wd)))) unique.push(wd);
  for (const wd of unique) {
    const cx = (wd.x0 + wd.x1) / 2, cy = (wd.y0 + wd.y1) / 2;
    if (cx < bbox[0] || cx > bbox[2] || cy < bbox[1] || cy > bbox[3]) continue;
    let k = cells.findIndex((c) => cx >= c[0] && cx <= c[2] && cy >= c[1] && cy <= c[3]);
    if (k < 0) k = cells.reduce((bi, c, i) => { const d = Math.hypot(cx - (c[0] + c[2]) / 2, cy - (c[1] + c[3]) / 2); return d < bi.d ? { i, d } : bi; }, { i: -1, d: Infinity }).i;
    if (k >= 0) parts[k].push(wd);
  }
  const texts = parts.map((ws) => [ws.map((w, i) => w.text + (i < ws.length - 1 && (w.sp || ws[i + 1].line !== w.line) ? " " : "")).join("")]);
  // 칸 글자 크기: 원본 글자 크기 그대로(PDF 글자 = size, OCR 낱말 = 상자 높이로 어림). 편집기 기본 크기(10pt)로 넣으면
  // 작은 글자의 표가 칸에 안 들어가 줄이 꺾였다. 표 전체에서 한 크기(가운데값)를 쓴다.
  const sizes = parts.flat().map((w) => w.size || (w.y1 - w.y0) * 0.8).filter((v) => v > 3).sort((a, b) => a - b);
  const fontPt = sizes.length ? Math.round(Math.min(14, Math.max(6, sizes[sizes.length >> 1])) * 2) / 2 : null;
  if (readCell) for (let k = 0; k < cells.length; k++) {
    if (texts[k][0]) continue;
    const c = cells[k];
    if (c[2] - c[0] < 8 || c[3] - c[1] < 6) continue;             // 틈 칸처럼 아주 좁은 칸은 읽지 않는다
    texts[k] = [(await readCell(c).catch(() => "")) || ""];
  }
  // 칸 바탕: 칸의 평균 색(cellColor, #rrggbb). 흰색에 가까우면 두지 않고, 어두우면 글자를 흰색으로
  const colors = cells.map((c) => { try { return cellColor ? cellColor(c) : null; } catch { return null; } });
  const lum = (hex) => { const v = parseInt(hex.slice(1), 16); return ((v >> 16) & 255) * 0.3 + ((v >> 8) & 255) * 0.59 + (v & 255) * 0.11; };
  // 열 폭 맞추기: 모델의 칸 상자 폭은 행마다 조금씩 달라서 그대로 쓰면 같은 열의 칸 폭이 제각각이 되고
  // (표가 찌그러지고 한 칸이 좁아져 글자가 한 자씩 꺾였다), 열마다 한 칸짜리 칸들의 폭 가운데값을 쓴다.
  // 모델의 칸 상자는 칸 전체가 아니라 글자가 있는 부분이라 그 폭을 쓰면 열이 좁아진다("F e m a l e" 처럼 꺾였다).
  // 열마다 한 칸짜리 칸들의 가운데 x 의 가운데값을 열 위치로 삼고, 이웃 열 위치의 중간점을 열 경계로(양 끝은 표 영역 끝) 나눈다.
  const grid = tableGrid(tokens);
  const nCols = Math.max(1, ...grid.map((g) => g.col + g.cs));
  const mid = (arr) => { const s = arr.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };
  let centers = Array.from({ length: nCols }, (_, c) => mid(grid.map((g, k) => (g.col === c && g.cs === 1 ? (cells[k][0] + cells[k][2]) / 2 : NaN))));
  // 위치를 모르는 열은 표 폭을 고르게 나눈 자리로
  centers = centers.map((v, c) => v ?? bbox[0] + ((c + 0.5) * (bbox[2] - bbox[0])) / nCols);
  const edges = [bbox[0], ...centers.slice(1).map((v, c) => (centers[c] + v) / 2), bbox[2]];
  const colW = edges.slice(1).map((e, c) => Math.max(8, e - edges[c]));
  const widthOf = (k) => { const g = grid[k]; let w = 0; for (let c = g.col; c < g.col + g.cs; c++) w += colW[c]; return w; };
  // 행 높이도 알려 준다(칸 높이는 "최소 높이"로 쓰이고 글이 넘치면 늘어난다). 알려 주지 않으면 편집기가 표 전체 높이를
  // 행마다 1000(약 13px)으로 잡아, 두 줄 칸이 하나 있을 때 다른 행을 글자보다 낮게 눌러 그 높이에 맞췄다.
  const nRows = Math.max(1, ...grid.map((g) => g.row + g.rs));
  const rowH = Array.from({ length: nRows }, (_, r) => {
    const hs = grid.map((g, k) => (g.row === r && g.rs === 1 ? cells[k][3] - cells[k][1] : null)).filter((v) => v > 0).sort((a, b) => a - b);
    return Math.max(14, hs.length ? hs[hs.length >> 1] : 14);
  });
  const heightOf = (k) => { const g = grid[k]; let h = 0; for (let r = g.row; r < g.row + g.rs; r++) h += rowH[r]; return h; };
  // 같은 행에서 서로 비슷한 칸 색(글자 잉크·질감 때문에 조금씩 다름)은 그 행의 가운데 색 하나로 맞춘다
  const rgb = (hex) => { const v = parseInt(hex.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
  for (let r = 0; r < nRows; r++) {
    const ks = grid.map((g, k) => (g.row === r && colors[k] ? k : -1)).filter((k) => k >= 0);
    if (ks.length < 2) continue;
    const sorted = [...ks].sort((a, b) => lum(colors[a]) - lum(colors[b]));
    const med = colors[sorted[sorted.length >> 1]], mc = rgb(med);
    for (const k of ks) if (rgb(colors[k]).every((v, i) => Math.abs(v - mc[i]) <= 12)) colors[k] = med;
  }
  const cellStyle = (k) => {
    const bg = colors[k] && lum(colors[k]) < 235 ? colors[k] : null;
    return `style="width:${Math.max(8, widthOf(k)).toFixed(1)}pt;height:${heightOf(k).toFixed(1)}pt;border:0.5pt solid #000000;${bg ? `background-color:${bg};` : ""}padding:1.4pt 2.8pt;vertical-align:middle"`;
  };
  // 칸 문단은 왼쪽 정렬(양쪽 정렬이면 칸에서 꺾인 짧은 줄이 "v o n" 처럼 벌어진다)
  const body = (k) => {
    const t = esc(texts[k].join(" "));
    const css = (fontPt ? `font-size:${fontPt}pt;` : "") + (colors[k] && lum(colors[k]) < 110 && t ? "color:#ffffff;" : "");
    return `<p style="text-align:left">${css && t ? `<span style="${css}">${t}</span>` : t}</p>`;
  };
  let html = `<table${fit ? ' data-og-fit="1"' : ""} style="border-collapse:collapse">`, k = -1, open = false;
  for (const tok of tokens) {
    if (tok === "<thead>" || tok === "</thead>" || tok === "<tbody>" || tok === "</tbody>") continue;
    if (tok === "<td></td>") { k++; html += `<td ${cellStyle(k)}>${body(k)}</td>`; continue; }
    if (tok === "<td") { k++; html += "<td"; open = true; continue; }
    if (tok === ">" && open) { html += ` ${cellStyle(k)}>${body(k)}`; open = false; continue; }
    html += tok;
  }
  html += "</table>";
  return { html, text: texts.map((t) => t.join(" ")).filter(Boolean).join("\t"), bbox };
}
