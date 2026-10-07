// PDF 문서화 준비(글자 추출 → 줄바꿈·문단 복원(Kiwi 띄어쓰기 포함) → 투명 글자 층)를 따로 도는 작업 스레드.
// 서버에서 바로 하면 문단 복원 동안(771쪽 PDF 에서 약 6초) 서버가 멈춰 쪽 그림 요청이 기다렸고,
// Kiwi 사전을 불러오는 동안(약 3초)도 요청이 기다렸다. 여기서는 처음 준비할 때 불러 두고, 한동안 안 쓰면 서버가 이
// 작업 스레드를 끝내 메모리(약 900MB)를 돌려받는다(server.js schedulePrepRelease).
// 받는 것: { warm: true } (사전만 미리) / { id, bytes } (문서 하나)
// 보내는 것: { id, progress: [쪽, 전체] } / { id, phase } / { id, result: { input, res, textLayers } } / { id, error }
import { parentPort, workerData } from "node:worker_threads";

let spacerP = null;
const spacer = () => (spacerP ||= import("./src/kiwi-spacer.js").then((m) => m.createKiwiSpacer(workerData.kiwiDir)).catch(() => null));
const libs = () => Promise.all([import("./src/extract-pdfium.js"), import("./src/reconstruct.js"), import("./src/render-layout.js")]);

const queue = [];
let busy = false;
parentPort.on("message", (m) => {
  if (m.warm) { spacer(); return; }
  spacer();                                                        // 글자를 추출하는 동안 Kiwi 도 불러오기 시작
  queue.push(m);
  pump();
});
async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const job = queue.shift();
    try {
      const [{ extractGlyphs }, { reconstruct }, { renderTextLayers }] = await libs();
      let lastSent = 0;
      const input = await extractGlyphs(job.bytes, { onPage: (done, total) => {
        const now = Date.now();
        if (now - lastSent > 100 || done + 1 >= total) { lastSent = now; parentPort.postMessage({ id: job.id, progress: [done, total] }); }
      } });
      parentPort.postMessage({ id: job.id, phase: "문단 복원" });
      const res = reconstruct(input, { spacer: await spacer() });
      const textLayers = renderTextLayers(input, res);
      // input·res·textLayers 를 한 번에 보내야 서로 같은 글자 객체를 가리키는 관계가 그대로 남는다
      parentPort.postMessage({ id: job.id, result: { input, res, textLayers } });
    } catch (e) {
      parentPort.postMessage({ id: job.id, error: String(e?.message || e) });
    }
  }
  busy = false;
}
