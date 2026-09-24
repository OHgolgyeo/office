// Kiwi(한국어 형태소 분석기, Apache-2.0)로 줄바꿈 이음새의 형태소 경계를 알려 주는 어댑터.
// 텍스트를 고치는 데는 쓰지 않는다. "이 자리에서 끊긴 것이 형태소 안쪽인가, 경계라면 양쪽 품사는 무엇인가"만 묻는다.
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { KiwiBuilder } from "kiwi-nlp";

const require = createRequire(import.meta.url);

export const DEFAULT_MODEL_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "models", "kiwi");

export function findModelDir(dir = DEFAULT_MODEL_DIR) {
  if (!fs.existsSync(dir)) return null;
  // 압축을 풀면 models/cong/base 같은 하위 폴더가 생긴다 → cong.mdl 이 있는 폴더를 찾는다
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    const names = fs.readdirSync(d);
    if (names.some((n) => n.endsWith(".mdl")) && names.includes("default.dict")) return d;
    for (const n of names) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) stack.push(p); }
  }
  return null;
}

/** @returns {Promise<Spacer|null>} 모델이 없으면 null */
export async function createKiwiSpacer(modelDir) {
  const dir = findModelDir(modelDir);
  if (!dir) return null;
  const files = {};
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isFile()) files[f] = new Uint8Array(fs.readFileSync(p));
  }
  const wasm = path.join(path.dirname(require.resolve("kiwi-nlp")), "kiwi-wasm.wasm");
  // 모델을 불러올 때 Kiwi 가 내는 "Quantization is not supported…" 안내(오류 아님)는 숨긴다
  const quiet = (fn) => (...a) => { if (!/Quantization is not supported/.test(String(a[0]))) fn(...a); };
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = quiet(saved.log); console.warn = quiet(saved.warn); console.error = quiet(saved.error);
  let builder, kiwi;
  try {
    builder = await KiwiBuilder.create(wasm);
    kiwi = await builder.build({ modelFiles: files });
  } finally { Object.assign(console, saved); }
  kiwi.setGlobalConfig({ spaceTolerance: 0 });

  return {
    name: `Kiwi ${builder.version()}`,
    /**
     * left + right 를 붙여 분석해서 이어 붙인 자리(cut)의 사정을 알려 준다.
     * @returns {{inside:boolean, insideForm?:string, leftTag?:string, rightTag?:string, leftForm?:string, rightForm?:string, diff:number}}
     */
    boundary(left, right) {
      const joined = left + right, spaced = left + " " + right, cut = left.length;
      const r = kiwi.analyze(joined);
      const diff = r.score - kiwi.analyze(spaced).score;   // +면 붙인 쪽이 더 자연스러움
      const toks = r.tokens;
      const inside = toks.find((t) => t.position < cut && t.position + t.length > cut);
      if (inside) {
        // 모르는 고유명사를 만나면 Kiwi가 조사까지 삼켜 한 단어로 추측하는 일이 있다
        // ("러브크래프트와크툴루"). 앞말만 따로 분석해서 조사·어미로 끝나면 그 추측을 믿지 않는다.
        const leftAlone = kiwi.analyze(left).tokens;
        const lastL = leftAlone.at(-1), firstR = kiwi.analyze(right).tokens[0];
        if (inside.length >= 5 && lastL && /^(J|E)/.test(lastL.tag) && firstR && /^(NN|NP|NR|SL|SH)/.test(firstR.tag))
          return { inside: false, oovAbsorbed: inside.str, leftTag: lastL.tag, leftForm: lastL.str, rightTag: firstR.tag, rightForm: firstR.str, diff };
        return { inside: true, insideForm: inside.str, insideTag: inside.tag, diff };
      }
      const L = toks.filter((t) => t.position + t.length <= cut).at(-1);
      const R = toks.find((t) => t.position >= cut);
      return { inside: false, leftTag: L?.tag, leftForm: L?.str, rightTag: R?.tag, rightForm: R?.str, diff };
    },
    /** Kiwi가 문맥만 보고 고른 답(약한 근거로만 쓴다) */
    glue(left, right) { return kiwi.glue([left, right]).spaceInsertions[0]; },
  };
}
