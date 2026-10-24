// 열린 PDF 세션들(core/session.js)을 맡아 서버의 요청을 처리하는 곳. 보통은 작업 스레드(session-host.mjs) 안에서 돌아,
// 문단 복원 결과 받기(150쪽 약 31MB 를 푸는 데 0.5~1.6초)·글자 층·문서화 결과 만들기·OCR 정리 같은 계산이 앱 본체
// (Electron 메인 프로세스)를 막지 않는다. 작업 스레드를 못 쓰면 서버가 같은 코드를 본체 안에서 그대로 쓴다.
// 문단 복원(Kiwi 포함)은 여기서 다시 따로 도는 작업 스레드(prepare-worker.mjs)에서 한다.
// callMain(op, args): 본체에 부탁하기 — PaddleOCR 은 본체의 숨은 창에서 돈다.
import { Worker } from "node:worker_threads";
import os from "node:os";
import { PdfSession } from "./session.js";

export function createSessionService({ kiwiDir, callMain = null }) {
  const sessions = new Map();    // sid → PdfSession
  let paddleEnabled = false, paddleDir = null;
  // PaddleOCR: 네이티브(onnxruntime-node, paddle-native-worker.mjs)로 먼저 읽고, 못 쓰면 본체의 숨은 창(공식 PaddleOCR.js)에 맡긴다.
  // 숨은 창은 WebAssembly 라 램 8GB PC 에서 스캔 쪽 하나에 몇 분씩 걸렸다(네이티브는 같은 쪽 수십 초, 글자 결과는 사실상 같음).
  let nativeW = null, nativeBroken = false, nativeSeq = 0, nativeIdle = 0;
  const nativeJobs = new Map();
  const NATIVE_IDLE_MS = 15 * 1000;                                 // 숨은 창과 같다: 쉬면 모델(약 200MB)을 내려놓는다
  function nativeWorker() {
    if (nativeW || nativeBroken || !paddleDir) return nativeW;
    try {
      const threads = Math.max(1, Math.min(4, Math.ceil(os.cpus().length / 2)));
      const w = new Worker(new URL("./paddle-native-worker.mjs", import.meta.url), { workerData: { dir: paddleDir, threads } });
      w.on("message", (m) => {
        const job = nativeJobs.get(m.id); if (!job) return;
        nativeJobs.delete(m.id);
        if (m.error) job.reject(new Error(m.error)); else job.resolve(m.result);
        if (!nativeJobs.size) { w.unref(); clearTimeout(nativeIdle); nativeIdle = setTimeout(() => { if (!nativeJobs.size && nativeW === w) { nativeW = null; w.terminate().catch(() => {}); } }, NATIVE_IDLE_MS); nativeIdle.unref?.(); }
      });
      const fail = (e, broken) => {
        if (nativeW === w) nativeW = null;
        if (broken) nativeBroken = true;                              // 실행기 자체가 안 되는 컴퓨터: 다음부터 숨은 창으로
        for (const j of nativeJobs.values()) j.reject(e instanceof Error ? e : new Error(String(e)));
        nativeJobs.clear();
      };
      w.on("error", (e) => { console.warn("[PaddleOCR] 네이티브 실행기를 쓸 수 없어 숨은 창으로 읽습니다:", e?.message || e); fail(e, true); });
      w.on("exit", (code) => fail(new Error(`PaddleOCR 작업 스레드 종료(${code})`), false));
      w.unref();
      nativeW = w;
    } catch (e) { console.warn("[PaddleOCR] 네이티브 작업 스레드를 띄우지 못했습니다:", e?.message || e); nativeBroken = true; }
    return nativeW;
  }
  const native = (req) => new Promise((resolve, reject) => {
    const w = nativeWorker();
    if (!w) { reject(new Error("네이티브 PaddleOCR 없음")); return; }
    clearTimeout(nativeIdle);
    const id = ++nativeSeq;
    nativeJobs.set(id, { resolve, reject });
    w.ref();
    const rgba = new Uint8Array(req.rgba);                             // 한 부 떼어 넘긴다(부른 쪽은 Tesseract 로 다시 쓸 수 있다)
    w.postMessage({ id, rgba, width: req.width, height: req.height, packs: req.packs, detector: req.detector }, [rgba.buffer]);
  });
  async function paddleOcr(req) {
    if (!nativeBroken && paddleDir) {
      try { return await native(req); }
      catch (e) { if (!callMain) throw e; console.warn("[PaddleOCR] 네이티브로 읽지 못해 숨은 창으로 읽습니다:", String(e?.message || e).split("\n")[0]); }
    }
    const { PNG } = await import("pngjs");
    const png = PNG.sync.write({ data: Buffer.from(req.rgba.buffer, req.rgba.byteOffset, req.rgba.byteLength), width: req.width, height: req.height });
    return callMain("paddle", { png, packs: req.packs, detector: req.detector });
  }
  const paddleFor = () => (paddleEnabled && callMain ? paddleOcr : null);

  // ── 문단 복원 작업 스레드(Kiwi). 쉬면 끝내 메모리(약 900MB)를 돌려받는다 ──
  let spacerP = null;
  const spacer = () => (spacerP ||= import("./src/kiwi-spacer.js").then((m) => m.createKiwiSpacer(kiwiDir))
    .catch((e) => { console.warn("[Kiwi] 불러오지 못해 띄어쓰기 판단에 Kiwi 를 쓰지 않습니다:", e?.message || e); return null; }));
  let prepW = null, prepSeq = 0, prepIdleTimer = 0;
  const prepJobs = new Map();
  // Kiwi(문단 띄어쓰기 판단)는 작업 스레드 안에서 약 900MB 를 차지하고(WebAssembly 메모리라 한 번 늘면 줄지 않는다),
  // PDF 를 준비할 때(글자 추출 뒤 문단 복원)만 쓴다 → 준비가 끝나고 이만큼 아무 PDF 도 준비하지 않으면 작업 스레드를 끝내
  // 메모리를 돌려받는다. 다음 PDF 는 새 작업 스레드가 Kiwi 를 다시 불러온다(뒤에서 약 2~3초 더).
  const PREP_IDLE_MS = +process.env.OG_PREP_IDLE_MS || 5 * 1000;
  function schedulePrepRelease() {
    clearTimeout(prepIdleTimer);
    prepIdleTimer = setTimeout(() => {
      if (prepJobs.size || !prepW) return;
      const w = prepW; prepW = null;
      w.terminate().catch(() => {});
    }, PREP_IDLE_MS);
    prepIdleTimer.unref?.();
  }
  function prepareWorker() {
    if (prepW !== null) return prepW;
    try {
      const w = new Worker(new URL("./prepare-worker.mjs", import.meta.url), { workerData: { kiwiDir } });
      w.on("message", (m) => {
        const job = prepJobs.get(m.id); if (!job) return;
        if (m.progress) job.onProgress(m.progress[0], m.progress[1]);
        else if (m.phase) job.onPhase(m.phase);
        else { prepJobs.delete(m.id); if (m.error) job.reject(new Error(m.error)); else job.resolve(m.result); if (!prepJobs.size) schedulePrepRelease(); }
      });
      const fail = (e) => { for (const j of prepJobs.values()) j.reject(e instanceof Error ? e : new Error(String(e))); prepJobs.clear(); if (prepW === w) prepW = null; };
      w.on("error", fail);
      w.on("exit", (code) => fail(new Error(`PDF 준비 작업 스레드가 끝났습니다(${code}).`)));
      w.unref();
      prepW = w;
    } catch (e) { console.warn("[PDF 준비] 작업 스레드를 띄우지 못했습니다:", e?.message || e); prepW = false; }
    return prepW;
  }
  function prepareInWorker(bytes, onProgress, onPhase, { kiwiCache = null } = {}) {
    const w = prepareWorker();
    if (!w) return Promise.reject(new Error("작업 스레드 없음"));
    clearTimeout(prepIdleTimer);
    return new Promise((resolve, reject) => {
      const id = ++prepSeq;
      prepJobs.set(id, { resolve, reject, onProgress, onPhase });
      w.postMessage({ id, bytes, kiwiCache }, [bytes.buffer]);
    });
  }

  /** Kiwi 에 묻기(문단 복원 작업 스레드 — 쉬면 내려놓는다) */
  function kiwiAsk(pairs, kiwiCache) {
    const w = prepareWorker();
    if (!w) return Promise.resolve(pairs.map(() => null));
    clearTimeout(prepIdleTimer);
    return new Promise((resolve, reject) => {
      const id = ++prepSeq;
      prepJobs.set(id, { resolve, reject, onProgress() {}, onPhase() {} });
      w.postMessage({ id, ask: pairs, kiwiCache });
    });
  }
  const get = (sid) => {
    const s = sessions.get(sid);
    if (!s) throw Object.assign(new Error("닫힌 문서"), { status: 404 });
    return s;
  };
  const applyOcr = (s, cfg) => s.setOcrConfig({ languages: cfg.languages, paddleOcr: paddleFor(), paddlePacks: cfg.paddlePacks, paddleDetector: cfg.paddleDetector });

  const ops = {
    async open({ sid, bytes, name, cfg }) {
      const s = await new PdfSession(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), name).open();
      s.id = sid;
      Object.assign(s, { annotationKey: cfg.annotationKey, ocrLangDir: cfg.ocrLangDir, paddleOcr: paddleFor(), paddlePacks: cfg.paddlePacks,
        paddleDetector: cfg.paddleDetector, ppDir: cfg.ppDir, layoutStore: cfg.layoutStore, kiwiCache: cfg.kiwiCache,
        ocrLanguages: cfg.ocrLanguages, autoLayout: cfg.autoLayout });
      s.kiwiAsk = (pairs) => kiwiAsk(pairs, cfg.kiwiCache);          // 스캔 OCR 띄어쓰기 다시 보기용
      sessions.set(sid, s);
      // 글자층·줄바꿈 복원만 뒤에서 준비한다. 무거운 ONNX 레이아웃 분석은 PDF를 보는 것만으로 시작하지 않고,
      // 사용자가 문서화에서 "스캔 표 인식"을 실제로 선택했을 때 고른 페이지만 실행한다.
      s.prepareConversion(spacer, prepareInWorker);                  // spacer: 작업 스레드를 못 쓸 때만 여기서 불러온다
      return { pages: s.pageSizes, ms: Date.now() - s.state.t0 };
    },
    meta: ({ sid }) => get(sid).meta(),
    textLayer: ({ sid, n }) => get(sid).textLayer(n),
    pageImage: ({ sid, n, scale }) => get(sid).pageImage(n, scale),
    pageThumb: ({ sid, n }) => get(sid).pageThumb(n),
    ocrPage: ({ sid, n }) => get(sid).ocrPage(n),
    ocrReady: ({ sid }) => get(sid).ocrReady(),
    content: ({ sid, pages, opts }) => get(sid).content(pages, opts),
    figureList: ({ sid }) => get(sid).figureList(),
    async imagesZip({ sid, ids }) {
      const entries = get(sid).figureZipEntries(ids);
      if (!entries || !entries.length) return { count: entries ? 0 : null };
      const { zipBytes } = await import("./export-files.js");
      return { count: entries.length, zip: zipBytes(entries) };
    },
    figureFile: ({ sid, n, fid }) => get(sid).figureFile(n, fid),
    analyzePageImages: ({ sid, n }) => get(sid).analyzePageImages(n),
    layoutLog: ({ sid, n }) => get(sid).layoutLog(n),
    trimViewCaches: ({ sid }) => { sessions.get(sid)?.trimViewCaches?.(); return true; },
    close: ({ sid }) => { sessions.get(sid)?.close(); sessions.delete(sid); return true; },
    /** OCR 언어·PaddleOCR 설정을 열린 세션 모두에 */
    setOcrConfig: ({ cfg }) => { paddleEnabled = !!cfg.paddleEnabled; paddleDir = cfg.paddleDir || paddleDir; for (const s of sessions.values()) applyOcr(s, cfg); return true; },
    setPaddle: ({ enabled, dir }) => { paddleEnabled = !!enabled; paddleDir = dir || paddleDir; for (const s of sessions.values()) s.paddleOcr = paddleFor(); return true; },
    setAutoLayout: ({ value }) => { for (const s of sessions.values()) { s.autoLayout = !!value; s.cancelLayoutPrefetch(); } return true; },
    // 앱을 켤 때: 작업 스레드만 띄워 둔다. Kiwi 는 PDF 를 처음 준비할 때 불러온다 — 예전에는 켜자마자 불러
    // PDF 를 한 번도 열지 않아도 메인 프로세스가 약 1GB 였다.
    warmUp: () => { prepareWorker(); return true; },
    // 사용자가 파일을 고르기 시작하면(서브뷰 "내 컴퓨터에서 열기"·드라이브 창) 고르는 동안 Kiwi 를 미리 불러온다 — 쓰지 않으면 똑같이 내려놓는다
    warmKiwi: () => { const w = prepareWorker(); if (w) { w.postMessage({ warm: true }); if (!prepJobs.size) schedulePrepRelease(); } return true; },
    /** 앱을 끌 때: 뒤에서 도는 계산(모델 프로세스·문서화 준비 작업 스레드·OCR)을 기다리지 않고 바로 정리한다. */
    async shutdown() {
      clearTimeout(prepIdleTimer);
      for (const s of sessions.values()) s.close();
      sessions.clear();
      try { if (prepW) await prepW.terminate(); } catch { /* 이미 끝남 */ }
      prepW = null;
      clearTimeout(nativeIdle);
      try { if (nativeW) await nativeW.terminate(); } catch { /* 이미 끝남 */ }
      nativeW = null;
      try { (await import("./ppstructure.js")).shutdownModels(); } catch { /* 모델을 안 씀 */ }
      try { (await import("./ocr.js")).shutdownOcr(); } catch { /* OCR 을 안 씀 */ }
      return true;
    },
  };
  return {
    async handle(op, args = {}) {
      const fn = ops[op];
      if (!fn) throw new Error(`모르는 요청: ${op}`);
      return fn(args);
    },
  };
}
