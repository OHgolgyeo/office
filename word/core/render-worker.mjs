// 원본 보기의 쪽 그림을 그리는 작업 스레드. PDFium 그리기는 쪽당 수십~수백 ms 동기 계산이라, 메인 프로세스(앱 본체·서버)에서
// 하면 그동안 앱 전체가 멈췄다(램 8GB PC 에서 스크롤할 때 끊김). 여기서는 BGRA 비트맵까지만 그리고, JPEG 은 메인이 내장
// 변환(nativeImage, 수 ms)으로 만든다. 메인에 내장 변환이 없으면(브라우저 시험 모드) 여기서 JPEG 까지 만든다.
// 받는 것: { op: "open", sid, bytes } / { op: "render", id, sid, n, scale, quality, encode } / { op: "close", sid }
// 보내는 것: { id, width, height, bgra } 또는 { id, jpeg } / { id, error }
import { parentPort } from "node:worker_threads";
import { getLibrary, withPage } from "./src/extract-pdfium.js";
import { renderPageBgra, encodeBgraJpeg } from "./src/extract-objects.js";

const docs = new Map();   // sid → Promise<PDFium 문서>
parentPort.on("message", async (m) => {
  if (m.op === "open") { docs.set(m.sid, getLibrary().then((lib) => lib.loadDocument(m.bytes))); docs.get(m.sid).catch(() => {}); return; }
  if (m.op === "close") {
    const d = docs.get(m.sid); docs.delete(m.sid);
    d?.then((doc) => { try { doc.destroy(); } catch { /* 이미 닫힘 */ } }).catch(() => {});
    return;
  }
  if (m.op !== "render") return;
  try {
    const doc = await docs.get(m.sid);
    if (!doc) throw new Error("열지 않은 문서");
    const bmp = withPage(doc, m.n, (page) => renderPageBgra(page, m.scale));
    if (m.encode) {
      const jpeg = encodeBgraJpeg(bmp, m.quality);
      const out = new Uint8Array(jpeg);
      parentPort.postMessage({ id: m.id, jpeg: out }, [out.buffer]);
    } else {
      // Buffer.alloc 은 공용 풀에서 잘라 줄 수 있어 통째로 넘기려면 따로 떼어 낸다
      const own = bmp.data.byteOffset === 0 && bmp.data.byteLength === bmp.data.buffer.byteLength ? bmp.data : new Uint8Array(bmp.data);
      parentPort.postMessage({ id: m.id, width: bmp.width, height: bmp.height, bgra: own }, [own.buffer]);
    }
  } catch (e) {
    parentPort.postMessage({ id: m.id, error: String(e?.message || e) });
  }
});
