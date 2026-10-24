// 서버(앱 본체) 쪽에서 PDF 세션 작업 스레드(session-host.mjs)에 일을 맡기는 곳. 요청 하나에 답 하나(Promise).
// 작업 스레드를 못 띄우면 같은 일(session-service.js)을 본체 안에서 그대로 한다(예전과 같다).
// 작업 스레드가 도중에 죽으면 기다리던 요청은 실패하고 onLost() 를 알린다 — 열려 있던 PDF 는 닫힌 것으로 보고, 다음 요청 때 새로 띄운다.
import { Worker } from "node:worker_threads";

export function createSessionClient({ kiwiDir, onMainCall, onLost = () => {} }) {
  let worker = null, local = null, noWorker = false, seq = 0;
  const jobs = new Map();
  const asLocal = async () => (local ||= (await import("./session-service.js")).createSessionService({ kiwiDir, callMain: onMainCall }));

  function start() {
    if (worker || noWorker) return worker;
    try {
      const w = new Worker(new URL("./session-host.mjs", import.meta.url), { workerData: { kiwiDir } });
      w.on("message", async (m) => {
        if (m.call) {                                            // 작업 스레드가 본체에 부탁(PaddleOCR)
          const t = Date.now();
          if (process.env.OG_TRACE) console.error(`[host→본체] ${m.op} 시작`);
          try { w.postMessage({ reply: m.call, result: await onMainCall(m.op, m.args) }); }
          catch (e) { w.postMessage({ reply: m.call, error: String(e?.message || e) }); }
          if (process.env.OG_TRACE) console.error(`[host→본체] ${m.op} ${Date.now() - t}ms`);
          return;
        }
        const job = jobs.get(m.id); if (!job) return;
        jobs.delete(m.id);
        if (!jobs.size) w.unref();
        if (m.error) job.reject(Object.assign(new Error(m.error), m.status ? { status: m.status } : {}));
        else job.resolve(m.result);
      });
      const lost = (e) => {
        if (worker !== w) return;
        worker = null;
        for (const j of jobs.values()) j.reject(e instanceof Error ? e : new Error(String(e)));
        jobs.clear();
        console.warn("[PDF 세션] 작업 스레드가 끝났습니다:", e?.message || e);
        onLost();
      };
      w.on("error", lost);
      w.on("exit", (code) => lost(new Error(`작업 스레드 종료(${code})`)));
      w.unref();
      worker = w;
    } catch (e) {
      console.warn("[PDF 세션] 작업 스레드를 띄우지 못해 본체에서 합니다:", e?.message || e);
      noWorker = true;                                           // 아래 call 이 asLocal() 로 한다
    }
    return worker;
  }

  return {
    /** op 를 맡기고 답을 받는다. transfer: 넘겨 버릴 ArrayBuffer 들(쪽 PDF 바이트 등) */
    async call(op, args = {}, transfer = []) {
      if (!start()) return (await asLocal()).handle(op, args);
      return new Promise((resolve, reject) => {
        const id = ++seq;
        jobs.set(id, { resolve, reject });
        worker.ref();                                            // 답을 기다리는 동안은 프로세스가 기다린다
        worker.postMessage({ id, op, args }, transfer);
      });
    },
    /** 앱을 끌 때 */
    async stop() {
      const w = worker; worker = null;
      if (w) { try { await w.terminate(); } catch { /* 이미 끝남 */ } }
    },
  };
}
