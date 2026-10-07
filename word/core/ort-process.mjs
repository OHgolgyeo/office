// 레이아웃 분석·표 구조 모델(onnxruntime-node)을 따로 도는 프로세스.
// onnxruntime-node 의 run() 은 부른 스레드를 계산 내내 붙잡는다. 서버 스레드에서 돌리면 큰 PDF 에서 쪽마다 1.5~4초씩
// 서버가 멈췄고, 작업 스레드(worker_threads)로 옮기면 서버는 살지만 앱을 끌 때 계산 중인 쪽이 끝날 때까지(최대 몇 초)
// 종료가 늦었다(계산 도중의 작업 스레드는 끊을 수 없다). 프로세스는 끌 때 바로 끝낼 수 있다.
// 주고받는 것(IPC, 형식 있는 배열 그대로): { id, model: "layout"|"table", feeds: { 이름: { type, data, dims } } } → { id, out } / { id, error }
// 그래픽카드(DirectML)는 쓰지 않는다: onnxruntime-node 에 들어 있고 쪽당 0.9초(CPU 1.5초)로 빠르지만, PP-DocLayoutV3 에서
// 상자를 거의 못 찾는 틀린 결과가 나왔다(Iris Xe, 최적화 수준을 바꿔도 같음, 2026-10-06). CPU 스레드 수를 바꾸는 것도 기본보다 느렸다.
const models = JSON.parse(process.argv[2] || "{}");
process.on("disconnect", () => process.exit(0));                 // 앱(부모)이 끝나면 같이 끝난다

const ort = await import("onnxruntime-node");
try { ort.env.logLevel = "error"; } catch { /* 설정 못 함 */ }
const opts = { graphOptimizationLevel: "all", logSeverityLevel: 3 };
const sessions = {};
try {
  for (const [name, file] of Object.entries(models)) sessions[name] = await ort.InferenceSession.create(file, opts);
  process.send({ ready: true, names: Object.fromEntries(Object.entries(sessions).map(([k, s]) => [k, { inputNames: s.inputNames, outputNames: s.outputNames }])) });
} catch (e) {
  process.send({ ready: false, error: String(e?.message || e) });
}

process.on("message", async ({ id, model, feeds }) => {
  try {
    const input = {};
    for (const [k, v] of Object.entries(feeds)) input[k] = new ort.Tensor(v.type, v.data, v.dims);
    const out = await sessions[model].run(input);
    const res = {};
    for (const [k, t] of Object.entries(out)) res[k] = { type: t.type, data: t.data.slice(), dims: t.dims };   // 엔진 메모리를 가리킬 수 있어 복사
    process.send({ id, out: res });
  } catch (e) {
    process.send({ id, error: String(e?.message || e) });
  }
});
