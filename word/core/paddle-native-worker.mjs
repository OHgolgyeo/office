// 네이티브 PaddleOCR(paddle-native.js)을 따로 도는 작업 스레드. 모델 계산(onnxruntime run)은 부른 스레드를 붙잡으므로
// PDF 세션 작업 스레드에서 바로 하면 그동안 글자 층·문서화 요청이 기다린다. 쉬면 세션 쪽이 이 작업 스레드를 끝내 메모리를 돌려받는다.
// 받는 것: { id, rgba, width, height, packs, detector } / 보내는 것: { id, result } 또는 { id, error }
import { parentPort, workerData } from "node:worker_threads";
import path from "node:path";
import { createPaddleNative } from "./paddle-native.js";

const engine = createPaddleNative({ modelPath: (name) => path.join(workerData.dir, `${name}.tar`), threads: workerData.threads });
const queue = [];
let busy = false;
parentPort.on("message", (m) => { queue.push(m); pump(); });
async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const m = queue.shift();
    try { parentPort.postMessage({ id: m.id, result: await engine.recognize(m) }); }
    catch (e) { parentPort.postMessage({ id: m.id, error: String(e?.message || e) }); }
  }
  busy = false;
}
