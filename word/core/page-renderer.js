// 쪽 그림 작업 스레드(render-worker.mjs)를 서버 쪽에서 부리는 곳. 열린 PDF 마다 작업 스레드에도 문서를 한 부 열어 두고,
// 쪽 그림을 거기서 그린다. 열린 PDF 가 하나도 없으면 작업 스레드를 끝내 메모리를 돌려받는다.
// 작업 스레드를 못 쓰면(띄우지 못함·도중에 죽음) 호출한 쪽(session.pageImage)이 예전처럼 직접 그린다.
import { Worker } from "node:worker_threads";
import { encodeBgraJpeg, hasNativeJpeg } from "./src/extract-objects.js";

let worker = null, seq = 0, broken = false;
const jobs = new Map();   // id → { resolve, reject }
const open = new Set();   // 작업 스레드에 열어 둔 sid

function getWorker() {
  if (worker || broken) return worker;
  try {
    const w = new Worker(new URL("./render-worker.mjs", import.meta.url));
    w.on("message", (m) => {
      const job = jobs.get(m.id); if (!job) return;
      jobs.delete(m.id);
      if (!jobs.size) w.unref();
      if (m.error) job.reject(new Error(m.error));
      else job.resolve(m.jpeg || encodeBgraJpeg({ data: Buffer.from(m.bgra.buffer, m.bgra.byteOffset, m.bgra.byteLength), width: m.width, height: m.height }, job.quality));
    });
    const fail = (e) => {
      for (const j of jobs.values()) j.reject(e instanceof Error ? e : new Error(String(e)));
      jobs.clear(); open.clear();
      if (worker === w) worker = null;
    };
    w.on("error", (e) => { broken = true; fail(e); });
    w.on("exit", (code) => fail(new Error(`쪽 그림 작업 스레드가 끝났습니다(${code}).`)));
    w.unref();
    worker = w;
  } catch (e) { console.warn("[쪽 그림] 작업 스레드를 띄우지 못해 메인에서 그립니다:", e?.message || e); broken = true; }
  return worker;
}

/** PDF 한 부를 작업 스레드에 연다. 돌려준 객체로 그리고 닫는다. 작업 스레드를 못 쓰면 null. */
export function openPageRenderer(bytes) {
  const w = getWorker();
  if (!w) return null;
  const sid = ++seq;
  const copy = new Uint8Array(bytes);                 // 원본은 세션이 계속 쓴다
  w.postMessage({ op: "open", sid, bytes: copy }, [copy.buffer]);
  open.add(sid);
  const encode = !hasNativeJpeg();
  return {
    /** 쪽 n 의 JPEG(Uint8Array/Buffer). 작업 스레드가 죽었으면 거부된다. */
    render(n, scale, quality = 82) {
      if (!worker || !open.has(sid)) return Promise.reject(new Error("쪽 그림 작업 스레드 없음"));
      return new Promise((resolve, reject) => {
        const id = ++seq;
        jobs.set(id, { resolve, reject, quality });
        worker.ref();                                   // 그리는 동안에는 프로세스가 기다린다(쉬는 동안은 unref)
        worker.postMessage({ op: "render", id, sid, n, scale, quality, encode });
      });
    },
    close() {
      if (!open.delete(sid)) return;
      worker?.postMessage({ op: "close", sid });
      if (!open.size && !jobs.size && worker) { const w = worker; worker = null; w.terminate().catch(() => {}); }
    },
  };
}
