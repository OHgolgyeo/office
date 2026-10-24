// 스캔 OCR 글줄의 띄어쓰기 다시 보기 — 글자 PDF 의 줄 이음(reconstruct.js refineWithSpacer)과 같은 근거를 쓴다:
// ① 문서 안에 같은 말이 붙어서/띄어서 나온 적이 있는가 ② Kiwi(형태소 분석) ③ 문장부호 규칙. 애매한 자리만 본다.
// 입력 글줄: { text, info } — info[k] 는 공백 뺀 k 번째 글자 뒤의 자리 { p: 공백 확률, g: 흰 틈/글자 높이, src: "model"|"p"|"gap"|null }
// (paddle-native.js respace 가 남긴다). ask(pairs) → Promise<boundary 결과[]>: pairs = [[앞말, 뒷말], …] (kiwi-spacer.js boundary 와 같은 모양)
const HANGUL = /[가-힣]/;
const UNIT = /^(인|명|개|년|월|일|세|원|층|호|차|회|번|장|권|쪽|시|분|초|평|대|건|종|가지|퍼센트)(?![가-힣])|^(인|명|개|년|월|일|세|원|층|호|차|회|번|장|권|쪽|시|분|초|평|대|건|종)[이가은는을를의에과와도만]/;
const WORDISH = /[가-힣A-Za-z0-9]/;
const EDGE = /^[\s"'“”‘’()[\]{}<>«»「」『』·,.:;!?…~-]+|[\s"'“”‘’()[\]{}<>«»「」『』·,.:;!?…~-]+$/g;
const clean = (t) => String(t || "").replace(EDGE, "");
// 조사·어미 떼기(문서 안 같은 말 찾기용) — 자주 쓰는 것만
const PARTICLE = /(으로부터|에서부터|으로서|으로써|에게서|에서|에게|으로|부터|까지|마저|조차|처럼|보다|이나|이며|이고|에는|에도|와는|과는|은|는|이|가|을|를|의|에|와|과|도|로|만|나)$/;
const stripParticle = (t) => { const s = t.replace(PARTICLE, ""); return s.length >= 1 ? s : t; };

/** 문서 안 낱말 통계: 붙어 나온 말(tokens)·띄어 나온 두 말(pairs). texts: 문서의 글줄들 */
export function buildSpacingDict(texts) {
  const tokens = new Map(), pairs = new Map();
  const bump = (m, k) => { if (k) m.set(k, (m.get(k) || 0) + 1); };
  for (const t of texts) {
    const ws = String(t || "").split(/\s+/).map(clean).filter(Boolean);
    ws.forEach((w, i) => { bump(tokens, w); bump(tokens, stripParticle(w)); if (i) bump(pairs, ws[i - 1] + " " + w); });
  }
  return { tokens, pairs };
}

/** 글줄 → 공백 뺀 글자와 각 자리의 띄움 여부 */
function split(text) {
  const chars = [], sp = [];
  for (const c of String(text)) { if (/\s/.test(c)) { if (chars.length) sp[chars.length - 1] = true; } else { chars.push(c); sp.push(false); } }
  sp[chars.length - 1] = false;
  return { chars, sp };
}
const join = (chars, sp) => chars.map((c, k) => c + (sp[k] && k < chars.length - 1 ? " " : "")).join("");
/** k 자리 왼쪽 어절(앞 공백부터 k까지)·오른쪽 어절 */
function around(chars, sp, k) {
  let a = k; while (a > 0 && !sp[a - 1]) a--;
  let b = k + 1; while (b < chars.length - 1 && !sp[b]) b++;
  return { A: chars.slice(a, k + 1).join(""), B: chars.slice(k + 1, b + 1).join(""), a, b };
}
/** 앞쪽 두 어절·뒤쪽 두 어절(Kiwi 문맥) */
function context(chars, sp, k) {
  const left = join(chars.slice(0, k + 1), sp.slice(0, k + 1)).split(" ").slice(-2).join(" ");
  const rightChars = chars.slice(k + 1), rightSp = sp.slice(k + 1);
  const right = join(rightChars, rightSp).split(" ").slice(0, 2).join(" ");
  return [left, right];
}

/** 애매한 자리인가: 모델이 확신 없이 붙였거나, 다시 보기(respace)가 띄웠거나 */
const uncertain = (inf, spaced) => inf && (spaced ? inf.src === "p" || inf.src === "gap" : (inf.p >= 0.02 || inf.g >= 0.25));

const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const quantile = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
/** 이 문서의 간격 잣대(글자 높이 대비 흰 틈): word = 모델이 공백 글자를 낸 자리의 중앙값(원작자가 공백을 친 폭),
 *  syl = 모델이 확신해서 붙인 자리(공백 확률 < 0.01)의 상위 10% 값(음절 사이 폭). 표본이 15개 안 되면 공개 샘플에서 본 보통 값. */
export function spacingScale(lines) {
  const word = [], syl = [];
  for (const l of lines) for (const inf of l.info || []) { if (inf.src === "model") word.push(inf.g); else if (!inf.src && inf.p < 0.01) syl.push(inf.g); }
  return { word: word.length >= 15 ? median(word) : 0.5, syl: syl.length >= 15 ? quantile(syl, 0.9) : 0.33 };
}

/**
 * 글줄들의 띄어쓰기를 고친다(그 자리에서 text 를 바꾼다). dict: buildSpacingDict 결과, ask: Kiwi 묻기(없으면 문서 증거·부호 규칙만),
 * scale: spacingScale(없으면 이 글줄들로 잰다)
 * 원칙: 원문에 친 대로. 그림의 흰 틈이 이 문서의 띄어쓰기 폭(scale.word) 이상이면 원작자가 공백을 친 것 → 띄운 채로 두고
 * 문서 증거·Kiwi 로 바꾸지 않는다(그것들은 "보통 어떻게 쓰나"일 뿐 그 자리에 공백을 쳤는지는 모른다).
 * 한 글자씩 벌린 줄("분 장 사 무")은 틈이 띄어쓰기 폭보다 좁으면 자간을 벌린 것 → 붙이고, 넓으면("부 서 명") 친 공백 → 띄운다.
 * @returns 바꾼 자리 수
 */
export async function refineOcrSpacing(lines, { dict, ask = null, scale = null } = {}) {
  const S = scale || spacingScale(lines);
  const work = [];
  for (const line of lines) {
    if (!line.info || !HANGUL.test(line.text)) continue;
    const { chars, sp } = split(line.text);
    if (chars.length !== line.info.length + 1) continue;          // 글자 수가 어긋난 줄(다른 처리가 바꾼 줄)은 그대로
    const locked = new Set();
    // 한 글자씩 벌린 줄: 세 조각 이상이 모두 한 글자이고 모든 자리가 띄워져 있으면 틈의 크기로 자간/공백을 가른다
    const pieces = join(chars, sp).split(" ");
    if (pieces.length >= 3 && pieces.every((p) => [...p].length === 1) && pieces.filter((p) => HANGUL.test(p)).length >= 3) {
      const typed = median(line.info.map((i) => i.g)) >= S.word;
      for (let k = 0; k < sp.length - 1; k++) { sp[k] = typed; locked.add(k); }
    }
    const cands = [];
    for (let k = 0; k < chars.length - 1; k++) {
      if (locked.has(k)) continue;
      // 친 공백: 그대로. 한글끼리만 — 숫자·영문·부호는 글자가 좁아 글자 가운데 사이의 흰 틈이 공백 없이도 넓게 잡힌다("(1인")
      if (line.info[k].g >= S.word && sp[k] && HANGUL.test(chars[k]) && HANGUL.test(chars[k + 1])) continue;
      if (!WORDISH.test(chars[k]) && !WORDISH.test(chars[k + 1]) && !/[.,:)]/.test(chars[k])) continue;
      if (uncertain(line.info[k], sp[k]) || punctuationRule(chars, k) !== null) cands.push(k);
    }
    work.push({ line, chars, sp, cands, before: split(line.text).sp });
  }
  // Kiwi 에 물을 것을 모아 한 번에
  const asks = [], askAt = [];
  for (const w of work) for (const k of w.cands) {
    if (decideByDict(w, k, dict) !== null || punctuationRule(w.chars, k) !== null) continue;
    if (HANGUL.test(w.chars[k]) || HANGUL.test(w.chars[k + 1])) { askAt.push([w, k]); asks.push(context(w.chars, w.sp, k)); }
  }
  let answers = [];
  if (ask && asks.length) { try { answers = await ask(asks); } catch { answers = []; } }
  const kiwiOf = new Map(); askAt.forEach(([w, k], i) => { if (answers[i]) kiwiOf.set(w.line, (kiwiOf.get(w.line) || new Map()).set(k, answers[i])); });

  let changed = 0;
  for (const w of work) {
    const { line, chars, sp, before } = w;
    for (const k of w.cands) {
      const d = punctuationRule(chars, k) ?? decideByDict(w, k, dict) ?? decideByKiwi(kiwiOf.get(line)?.get(k), chars, k);
      if (d !== null) sp[k] = d;
    }
    let here = 0;
    for (let k = 0; k < sp.length; k++) if (sp[k] !== before[k]) here++;
    if (here) { line.text = join(chars, sp); changed += here; }
  }
  return changed;
}

/** 문서 안 증거: "AB" 로 붙어 나온 적만 있으면 붙이고, "A B" 로 띄어 나온 적만 있으면 띄운다 */
function decideByDict(w, k, dict) {
  if (!dict) return null;
  const { A, B } = around(w.chars, w.sp, k);
  const a = clean(A), b = clean(B);
  if (a.length < 1 || b.length < 1 || !HANGUL.test(a + b)) return null;
  const joined = a + b;
  const nJ = (dict.tokens.get(joined) || 0) + (dict.tokens.get(stripParticle(joined)) || 0);
  const nS = (dict.pairs.get(a + " " + b) || 0) + (w.sp[k] ? -1 : 0);   // 지금 이 줄이 띄어 쓴 한 번은 뺀다
  const nJself = w.sp[k] ? 0 : 1;                                     // 지금 이 줄이 붙여 쓴 한 번도 뺀다
  const J = nJ - nJself, S = Math.max(0, nS);
  if (J > 0 && S === 0) return false;
  if (S > 0 && J <= 0) return true;
  return null;
}
/** Kiwi: 형태소 안쪽에서 끊김·뒤가 조사/어미 → 붙임, 앞이 조사/어미로 끝나고 뒤가 새 말 → 띄움, 숫자 + 단위 명사 → 붙임 */
function decideByKiwi(info, chars, k) {
  if (!info) return null;
  const functional = /^(J|E)/.test(info.insideTag || "");
  if (info.inside && info.diff >= (functional ? 8 : 2)) return false;
  if (!info.inside && /^(J|E|XS|VCP)/.test(info.rightTag || "")) return false;
  if (!info.inside && /^SN/.test(info.leftTag || "") && /^NNB/.test(info.rightTag || "")) return false;
  if (!info.inside && /^(J|E)/.test(info.leftTag || "") && /^(NN|NP|NR|VV|VA|MM|MA|IC|XR|SL|SH|SN|XP)/.test(info.rightTag || "")) return true;
  return null;
}
/** 부호 규칙: 줄 앞 번호 "2." 뒤, 문장 끝(한글 뒤 . ! ?) 뒤, 쉼표 뒤 한글은 띄운다 — 문장 끝 뒤의 "이는" 을 Kiwi 가 조사로 보고 붙였다 */
function punctuationRule(chars, k) {
  const next = chars[k + 1] || "";
  if (/[.!?]/.test(chars[k]) && HANGUL.test(chars[k - 1] || "") && HANGUL.test(next)) return true;
  if (chars[k] === "." && /^[0-9]$/.test(chars[k - 1] || "") && (k === 1 || !/[0-9.]/.test(chars[k - 2] || "")) && HANGUL.test(next)) return true;
  if (chars[k] === "," && HANGUL.test(next)) return true;
  // 숫자 + 단위("1인", "2025년", "3개"): 붙인다
  if (/[0-9]/.test(chars[k]) && UNIT.test(chars.slice(k + 1, k + 3).join(""))) return false;
  return null;
}

// ── 스캔 OCR 줄 흐름: 문단 나눔·빈 줄·줄 잇기(글자 PDF 의 reconstruct.js 와 같은 일을 OCR 줄 좌표로) ──
const SENTENCE_END = /[.!?。…"'”’)\]」』>]$/;
const LIST_START = /^(\d{1,3}[.)](?=\s|[가-힣])|\(\d{1,3}\)|\([가-하]\)|[가-하][.)]\s|[①-⑳❶-❿]|[○●◦•·□■◇◆▶▷※*ㅇ-]\s?)/;
/**
 * lines: 한 영역의 OCR 줄(읽는 순서) [{ text, x0, x1, y0, y1, par }] (같은 단위의 좌표, 예: 잘라 낸 그림 픽셀).
 * → 줄마다(두 번째 줄부터) { newPara, blank, join: "space"|"none" } — 앞 줄과의 관계.
 * 문단: 앞 줄이 단 오른쪽 끝보다 글자 1.5개 넘게 짧고 문장 끝으로 끝나거나, 단 폭의 60% 도 안 되거나, 다음 줄이 들여 쓰였거나,
 * 줄 사이가 보통 줄 간격보다 0.75줄 넘게 벌어졌으면 새 문단(빈 줄은 그만큼, 최대 3 — 글자 PDF 의 blankLinesBetween 과 같은 잣대).
 * 같은 문단의 줄 잇기: 문장부호 뒤는 띄움, 한글끼리는 문서 증거 → Kiwi(형태소 안쪽·뒤가 조사/어미 → 붙임, 앞이 조사/어미로 끝나고
 * 뒤가 새 말 → 띄움, 그 밖에는 Kiwi 가 붙인 쪽을 더 자연스럽게 보면 붙임), 그 밖은 띄움.
 */
/** 한 영역의 OCR 줄을 단으로 나눠 읽는 순서로: 단을 가로지르는 줄(제목 등) 가운데 단보다 위인 것 → 단마다(왼쪽부터) 위→아래 →
 *  나머지 가로지르는 줄. 단 사이는 어떤 줄(가로지르는 줄 빼고)도 지나지 않는 세로 빈 띠(글자 폭 1.5배 이상)로 찾는다.
 *  → { order: 줄 번호 배열, col: 순서대로 단 번호(가로지르는 줄은 -1, -2 …) }. 예전에는 위→아래로만 정렬해 두 단의 줄이 번갈아 섞였다. */
export function columnOrder(lines, { minGutter = null } = {}) {
  const len = (l) => [...String(l.text || "").replace(/\s/g, "")].length || 1;
  const idx = lines.map((_, i) => i);
  if (lines.length < 4) return { order: idx, col: idx.map(() => 0) };
  const charW = median(lines.map((l) => (l.x1 - l.x0) / len(l)).filter(Number.isFinite)) || 10;
  const L = Math.min(...lines.map((l) => l.x0)), width = Math.max(...lines.map((l) => l.x1)) - L;
  const narrow = lines.filter((l) => l.x1 - l.x0 < width * 0.62);
  const cover = new Int32Array(Math.max(1, Math.ceil(width)) + 1);
  for (const l of narrow) for (let x = Math.max(0, Math.floor(l.x0 - L)); x <= Math.min(cover.length - 1, Math.ceil(l.x1 - L)); x++) cover[x]++;
  // 단 위 머리글·짧은 제목 몇 개가 단 사이를 지나가도 빈 띠로 본다(그 줄들은 아래에서 "가로지르는 줄"이 된다)
  const allowed = Math.max(1, Math.round(narrow.length * 0.08));
  const gutters = [];
  for (let x = 0, run = -1; x <= cover.length; x++) {
    const empty = x < cover.length && cover[x] < allowed;
    if (empty && run < 0) run = x;
    if (!empty && run >= 0) { if (run > 0 && x < cover.length && x - run >= (minGutter ?? 1.5 * charW) && narrow.length >= (minGutter ? 2 : 4)) gutters.push([L + run, L + x]); run = -1; }
  }
  const colIdx = lines.map((l) => {
    if (gutters.some(([g0, g1]) => l.x0 < g0 && l.x1 > g1)) return null;      // 단을 가로지름
    const c = (l.x0 + l.x1) / 2; return gutters.filter(([g0]) => c > g0).length;
  });
  const inCols = idx.filter((i) => colIdx[i] !== null), spans = idx.filter((i) => colIdx[i] === null).sort((a, b) => lines[a].y0 - lines[b].y0);
  const top = inCols.length ? Math.min(...inCols.map((i) => lines[i].y0)) : Infinity;
  const order = [...spans.filter((i) => lines[i].y1 <= top + 1),
    ...inCols.sort((a, b) => colIdx[a] - colIdx[b] || lines[a].y1 - lines[b].y1 || lines[a].x0 - lines[b].x0),
    ...spans.filter((i) => lines[i].y1 > top + 1)];
  let sp = 0;
  return { order, col: order.map((i) => (colIdx[i] === null ? -1 - sp++ : colIdx[i])) };
}

export async function lineFlow(lines, { dict = null, ask = null, rules = null } = {}) {
  const out = lines.map(() => ({ newPara: false, blank: 0, join: "space" }));
  if (lines.length < 2) return out;
  const len = (l) => [...String(l.text || "").replace(/\s/g, "")].length || 1;
  // 단마다 잣대(글자 폭·왼쪽/오른쪽 끝·줄 높이·줄 간격)
  const stats = new Map();
  for (const c of new Set(lines.map((l) => l.col ?? 0))) {
    const ls = lines.filter((l) => (l.col ?? 0) === c), long = ls.filter((l) => len(l) >= 6);
    const lh = median(ls.map((l) => l.y1 - l.y0)) || 10;
    const pitches = []; for (let i = 1; i < ls.length; i++) { const p = ls[i].y1 - ls[i - 1].y1; if (p > 0 && p < lh * 3) pitches.push(p); }
    stats.set(c, { lh, pitch: Math.max(median(pitches) || lh * 1.5, lh * 1.05),
      charW: median(ls.map((l) => (l.x1 - l.x0) / len(l)).filter(Number.isFinite)) || 10,
      colL: long.length ? quantile(long.map((l) => l.x0), 0.1) : Math.min(...ls.map((l) => l.x0)),
      colR: long.length ? quantile(long.map((l) => l.x1), 0.9) : Math.max(...ls.map((l) => l.x1)) });
  }
  const asks = [], askAt = [];
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1], b = lines[i], o = out[i];
    if ((a.col ?? 0) !== (b.col ?? 0)) { o.newPara = true; o.why = "다른단"; continue; }
    const { charW, lh, pitch } = stats.get(b.col ?? 0);
    // 왼쪽 끝·오른쪽 끝·폭은 이 두 줄과 왼쪽 끝을 같이 쓰는 줄들(글자 2개 안)끼리 잰다: 한 영역에 칸 위 소제목(넓음)과
    // 사진 옆 칸 속 글(좁음)이 함께 있으면 영역 전체 폭에 견줘 칸 속 모든 줄이 "짧은 줄" 로 끊겼다(사용자 화면: 인물 소개 칸)
    const kin = lines.filter((l) => (l.col ?? 0) === (b.col ?? 0) && len(l) >= 6 && (Math.abs(l.x0 - a.x0) <= 2 * charW || Math.abs(l.x0 - b.x0) <= 2 * charW));
    const base = stats.get(b.col ?? 0);
    const colL = kin.length >= 2 ? quantile(kin.map((l) => l.x0), 0.1) : base.colL;
    const colR = kin.length >= 2 ? Math.max(quantile(kin.map((l) => l.x1), 0.9), a.x1, b.x1) : base.colR;
    o.pitch = pitch; if (i === 1) out[0].pitch = pitch;
    // 줄 간격 잣대: 단의 보통 줄 간격, 다만 큰 글자 줄(제목)은 그 글자 높이만큼 — 글자 PDF 의 blankLinesBetween(크기 × 1.2)과 같은 뜻
    const extra = (b.y1 - a.y1) / Math.max(pitch, Math.max(a.y1 - a.y0, b.y1 - b.y0) * 1.25) - 1;
    o.extra = +extra.toFixed(2);
    const sideBySide = b.x0 > a.x1 || b.y1 - a.y1 < lh * 0.5;            // 같은 줄에 나란한 조각(표 칸 등)
    if (Number.isFinite(extra) && extra >= 0.75 && !sideBySide) { o.newPara = true; o.blank = Math.min(3, Math.round(extra)); o.why = "간격"; }
    const short = a.x1 < colR - 1.5 * charW;
    if (!sideBySide && short && SENTENCE_END.test(a.text.trim())) { o.newPara = true; o.why ||= "짧은끝"; }
    // 단 끝보다 글자 4개 넘게 짧게 끝난 줄은 폭에 밀려 꺾인 줄이 아니다(목록·소제목 — 부호 없이 끝나도): "■ 우리들의 세계와는 …"
    if (!sideBySide && a.x1 < colR - 4 * charW) { o.newPara = true; o.why ||= "많이짧음"; }
    // 글자 크기가 크게 바뀌면(소제목 → 본문) 새 문단: "…움직이는 세계" + "이계란 …" 이 "세계이계란" 으로 붙었다
    const ha = a.y1 - a.y0, hb = b.y1 - b.y0;
    if (!sideBySide && Math.max(ha, hb) >= Math.min(ha, hb) * 1.25) { o.newPara = true; o.why ||= "크기"; }
    if (!sideBySide && a.x1 - a.x0 < (colR - colL) * 0.6) { o.newPara = true; o.why ||= "짧은줄"; }
    if (!sideBySide && b.x0 > colL + 0.8 * charW && b.x0 - a.x0 > 0.8 * charW) { o.newPara = true; o.why ||= "들여씀"; }
    // 다음 줄이 목록 표시로 시작하면 새 항목("11. 민원실…", "① …", "- …", "○ …") — 앞 줄이 부호 없이 끝나도
    if (!sideBySide && LIST_START.test(b.text.trim())) { o.newPara = true; o.why ||= "목록"; }
    // 줄 왼쪽에 글자로 읽히지 않은 목록 기호가 있으면(session.js leftMark) 새 항목
    if (!sideBySide && b.mark) { o.newPara = true; o.why ||= "기호"; }
    // 두 줄 사이에 두 줄 폭 절반 넘게 걸친 가로 구분선(rules, ocr.js findHRules)이 있으면 새 문단, 그 자리에 빈 줄 하나:
    // 가운데 맞춘 상자 글은 줄 폭이 모두 같아 위 잣대로는 부제 밑줄 아래 본문이 부제에 붙었다
    if (!sideBySide && rules && rules.some(([y, x0, x1]) => y > (a.y0 + a.y1) / 2 && y < (b.y0 + b.y1) / 2 && y >= a.y1 - 2 && y <= b.y0 + 2
      && Math.min(x1, a.x1, b.x1) - Math.max(x0, a.x0, b.x0) > 0.5 * Math.min(a.x1 - a.x0, b.x1 - b.x0))) { o.newPara = true; o.blank = Math.max(o.blank, 1); o.why ||= "선"; }
    if (o.newPara) continue;
    const last = a.text.trim().slice(-1), first = b.text.trim().slice(0, 1);
    if (/[.,!?;:)\]」』"'”’·]/.test(last) || /[(["'“‘「『]/.test(first) || !HANGUL.test(last) || !HANGUL.test(first)) { o.join = "space"; continue; }
    // 문서 증거: 앞 줄 끝 어절 + 다음 줄 첫 어절
    const A = clean(a.text.trim().split(/\s+/).at(-1)), B = clean(b.text.trim().split(/\s+/)[0]);
    if (dict && A && B) {
      const J = (dict.tokens.get(A + B) || 0) + (dict.tokens.get(stripParticle(A + B)) || 0), S = dict.pairs.get(A + " " + B) || 0;
      if (J > 0 && S === 0) { o.join = "none"; continue; }
      if (S > 0 && J === 0) { o.join = "space"; continue; }
    }
    o.pending = true;
    askAt.push(i); asks.push([a.text.trim().split(/\s+/).slice(-2).join(" "), b.text.trim().split(/\s+/).slice(0, 2).join(" ")]);
  }
  let answers = [];
  if (ask && asks.length) { try { answers = await ask(asks); } catch { answers = []; } }
  askAt.forEach((i, k) => {
    const info = answers[k], o = out[i]; delete o.pending;
    if (!info) return;                                                   // Kiwi 없음: 띄움(그대로)
    const functional = /^(J|E)/.test(info.insideTag || "");
    if (info.inside && info.diff >= (functional ? 8 : 2)) o.join = "none";
    else if (!info.inside && /^(J|E|XS|VCP)/.test(info.rightTag || "")) o.join = "none";
    else if (!info.inside && /^SN/.test(info.leftTag || "") && /^NNB/.test(info.rightTag || "")) o.join = "none";
    else if (!info.inside && /^(J|E)/.test(info.leftTag || "") && /^(NN|NP|NR|VV|VA|MM|MA|IC|XR|SL|SH|SN|XP)/.test(info.rightTag || "")) o.join = "space";
    else if (info.inside) o.join = "none";
    else o.join = "space";
  });
  // 줄마다 문장이 끝나고 마지막 줄까지 다른 줄만큼 긴 묶음은 폭에 밀려 꺾인 문단이 아니라 한 줄씩 쓴 글(가운데 맞춘 상자 속 글귀 등)이다:
  // 양쪽 맞춘 문단의 마지막 줄은 보통 짧다. 예전에는 문장 두 줄이 한 줄로 이어졌다
  const lineEnd = /[.!?。…][)\]"'”’」』]*$/;
  for (let i = 0; i < lines.length;) {
    let j = i; while (j + 1 < lines.length && !out[j + 1].newPara) j++;
    const run = lines.slice(i, j + 1), widest = Math.max(...run.map((l) => l.x1 - l.x0));
    if (j > i && run.every((l) => lineEnd.test(String(l.text || "").trim())) && lines[j].x1 - lines[j].x0 >= widest * 0.9)
      for (let k = i + 1; k <= j; k++) Object.assign(out[k], { newPara: true, join: "space", why: "줄마다문장" });
    i = j + 1;
  }
  return out;
}
