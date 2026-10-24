// PDF 문서화 준비(글자 추출 → 줄바꿈·문단 복원(Kiwi 띄어쓰기 포함) → 투명 글자 층)를 따로 도는 작업 스레드.
// 서버에서 바로 하면 문단 복원 동안(771쪽 PDF 에서 약 6초) 서버가 멈춰 쪽 그림 요청이 기다렸고,
// Kiwi 사전을 불러오는 동안(약 3초)도 요청이 기다렸다. 여기서는 처음 준비할 때 불러 두고, 한동안 안 쓰면 서버가 이
// 작업 스레드를 끝내 메모리(약 900MB)를 돌려받는다(server.js schedulePrepRelease). 스캔 전용 PDF는 Kiwi를 불러오지 않는다.
// 받는 것: { warm: true } (사전만 미리) / { id, bytes } (문서 하나)
// 보내는 것: { id, progress: [쪽, 전체] } / { id, phase } / { id, result: { input, res } } / { id, error }
import { parentPort, workerData } from "node:worker_threads";

let spacerP = null;
const spacer = () => (spacerP ||= import("./src/kiwi-spacer.js").then((m) => m.createKiwiSpacer(workerData.kiwiDir))
  // Kiwi 를 못 불러오면 통계만으로 띄어쓰기를 정한다(품질이 떨어진다) — 조용히 넘어가지 않고 터미널에 남긴다
  .then((sp) => { if (!sp) console.warn("[Kiwi] 모델을 찾지 못해 띄어쓰기 판단에 Kiwi 를 쓰지 않습니다:", workerData.kiwiDir); return sp; })
  .catch((e) => { console.warn("[Kiwi] 불러오지 못해 띄어쓰기 판단에 Kiwi 를 쓰지 않습니다:", e?.message || e); return null; }));
const libs = () => Promise.all([import("./src/extract-pdfium.js"), import("./src/reconstruct.js")]);

// 같은 PDF 를 다시 열면 지난번 Kiwi 답(job.kiwiCache, 파일 해시별)으로 문단을 복원한다 — Kiwi 를 불러오지 않아 램이 약 1GB
// 덜 오르고 몇 초 빠르다(램 8GB PC 에서 연 직후 버벅임의 주원인이었다). 기억에 없는 물음이 하나라도 나오면(코드가 바뀐 뒤 등)
// 그 결과는 버리고, 글자를 다시 읽어(복원이 input 에 표시를 남기므로) Kiwi 로 처음부터 하고 답을 새로 적는다.
async function withKiwi(job, input, extractGlyphs, reconstruct) {
  const { memoOnlySpacer, recordingSpacer, KiwiMemoMiss } = await import("./src/kiwi-spacer.js");
  const fs = await import("node:fs"), path = await import("node:path");
  let memo = null;
  if (job.kiwiCache) { try { memo = JSON.parse(fs.readFileSync(job.kiwiCache, "utf8")); } catch { /* 처음 여는 PDF */ } }
  if (memo?.b && memo?.g) {
    try { return { res: reconstruct(input, { spacer: memoOnlySpacer(memo) }), input }; }
    catch (e) { if (!(e instanceof KiwiMemoMiss)) throw e; }
    input = await extractGlyphs(job.bytes);
  }
  const sp = await spacer();
  if (!sp) return { res: reconstruct(input, { spacer: null }), input };
  const fresh = { b: {}, g: {} };
  const res = reconstruct(input, { spacer: recordingSpacer(sp, fresh) });
  if (job.kiwiCache) {
    try {
      fs.mkdirSync(path.dirname(job.kiwiCache), { recursive: true });
      fs.writeFileSync(job.kiwiCache, JSON.stringify(fresh));
      // 오래된 기억은 지운다(최근 60개 파일만): 파일 하나는 150쪽 기준 수백 KB
      const dir = path.dirname(job.kiwiCache);
      const old = fs.readdirSync(dir).filter((n) => n.endsWith(".json")).map((n) => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs })).sort((a, b) => b.t - a.t).slice(60);
      for (const { n } of old) fs.unlinkSync(path.join(dir, n));
    } catch { /* 못 적어도 다음에 Kiwi 로 다시 한다 */ }
  }
  return { res, input };
}

// 스캔 OCR 띄어쓰기 다시 보기(ocr-spacing.js)의 Kiwi 물음: [[앞말, 뒷말], …] → boundary 결과들. 같은 PDF 의 Kiwi 답 기억(kiwiCache)을
// 먼저 보고, 없는 것만 Kiwi 를 불러와 묻고 기억에 더한다(문단 복원 답과 같은 파일·같은 모양).
async function askKiwi({ ask, kiwiCache }) {
  const fs = await import("node:fs"), path = await import("node:path");
  let memo = { b: {}, g: {} };
  if (kiwiCache) { try { const m = JSON.parse(fs.readFileSync(kiwiCache, "utf8")); if (m?.b && m?.g) memo = m; } catch { /* 처음 */ } }
  const key = (l, r) => l + "\u0000" + r;
  const missing = ask.filter(([l, r]) => !Object.hasOwn(memo.b, key(l, r)));
  if (missing.length) {
    const sp = await spacer();
    if (!sp) return ask.map(() => null);
    for (const [l, r] of missing) memo.b[key(l, r)] = sp.boundary(l, r);
    if (kiwiCache) { try { fs.mkdirSync(path.dirname(kiwiCache), { recursive: true }); fs.writeFileSync(kiwiCache, JSON.stringify(memo)); } catch { /* 못 적어도 다음에 다시 묻는다 */ } }
  }
  return ask.map(([l, r]) => memo.b[key(l, r)] ?? null);
}

const queue = [];
let busy = false;
parentPort.on("message", (m) => {
  if (m.warm) { spacer(); return; }
  if (m.ask) { askKiwi(m).then((result) => parentPort.postMessage({ id: m.id, result }), (e) => parentPort.postMessage({ id: m.id, error: String(e?.message || e) })); return; }
  queue.push(m);
  pump();
});
async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const job = queue.shift();
    try {
      const [{ extractGlyphs, isRasterOnlyDocument, needsKoreanSpacer }, { reconstruct }] = await libs();
      let lastSent = 0;
      const input = await extractGlyphs(job.bytes, { onPage: (done, total) => {
        const now = Date.now();
        if (now - lastSent > 100 || done + 1 >= total) { lastSent = now; parentPort.postMessage({ id: job.id, progress: [done, total] }); }
      } });
      const rasterOnly = isRasterOnlyDocument(input);
      parentPort.postMessage({ id: job.id, phase: rasterOnly ? "스캔 문서 정리" : "문단 복원" });
      // 스캔 전용 PDF와 한글이 없는 영문·일문·중문 PDF에는 Kiwi가 실제로 호출될 경계가 없다.
      // 이때 약 900MB의 한국어 모델을 올리지 않는다. 한글 텍스트 PDF의 복원 품질은 그대로 유지한다.
      const needKiwi = !rasterOnly && needsKoreanSpacer(input);
      const { res, input: usedInput } = needKiwi ? await withKiwi(job, input, extractGlyphs, reconstruct) : { res: reconstruct(input, { spacer: null }), input };
      // 투명 글자층 HTML은 사용자가 실제로 보는 쪽만 서버에서 만든다.
      parentPort.postMessage({ id: job.id, result: { input: usedInput, res } });
    } catch (e) {
      parentPort.postMessage({ id: job.id, error: String(e?.message || e) });
    }
  }
  busy = false;
}
