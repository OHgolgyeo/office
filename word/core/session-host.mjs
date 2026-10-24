// PDF 세션 작업 스레드: session-service.js 를 앱 본체 밖에서 돌린다(core/session-client.js 가 띄운다).
// 받는 것: { id, op, args } / { reply, result | error } (본체에 부탁한 일의 답)
// 보내는 것: { id, result | error, status } / { call, op, args } (본체에 부탁 — PaddleOCR)
import { parentPort, workerData } from "node:worker_threads";
import { createSessionService } from "./session-service.js";

const asked = new Map();
let askSeq = 0;
const callMain = (op, args) => new Promise((resolve, reject) => {
  const call = ++askSeq;
  asked.set(call, { resolve, reject });
  parentPort.postMessage({ call, op, args });
});
const service = createSessionService({ kiwiDir: workerData.kiwiDir, callMain });

parentPort.on("message", async (m) => {
  if (m.reply) {
    const a = asked.get(m.reply); asked.delete(m.reply);
    if (a) { if (m.error) a.reject(new Error(m.error)); else a.resolve(m.result); }
    return;
  }
  const t = Date.now();
  if (process.env.OG_TRACE) console.error(`[host] ${m.op} 시작`);
  try {
    parentPort.postMessage({ id: m.id, result: await service.handle(m.op, m.args) });
  } catch (e) {
    parentPort.postMessage({ id: m.id, error: String(e?.message || e), status: e?.status || 0 });
  }
  if (process.env.OG_TRACE) console.error(`[host] ${m.op} 끝 ${Date.now() - t}ms`);
});
