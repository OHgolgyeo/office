import assert from "node:assert/strict";
import { docsToModel } from "../core/gdoc-tabs.js";

// Google 문서의 그림들이 순서대로 기다리지 않고 병렬로 변환되는지 확인한다.
const inlineObjects = {};
const elements = [];
for (let i = 0; i < 4; i++) {
  const id = `image-${i}`;
  inlineObjects[id] = { inlineObjectProperties: { embeddedObject: { imageProperties: { contentUri: `https://example.invalid/${i}` } } } };
  elements.push({ inlineObjectElement: { inlineObjectId: id } });
}
let active = 0, peak = 0;
const started = performance.now();
const model = await docsToModel({ title: "속도 검사", body: { content: [{ paragraph: { elements } }] }, inlineObjects }, async (uri) => {
  active++; peak = Math.max(peak, active);
  await new Promise((resolve) => setTimeout(resolve, 60));
  active--;
  return { mime: "image/png", b64: uri.at(-1) };
});
const elapsed = performance.now() - started;
assert.ok(peak >= 4, `그림 다운로드가 병렬로 시작되지 않았습니다(최대 ${peak}개).`);
assert.ok(elapsed < 180, `그림 4개 변환이 순차 처리된 것처럼 느립니다(${Math.round(elapsed)}ms).`);
assert.deepEqual(model.tabs[0].blocks[0].runs.map((run) => run.img.b64), ["0", "1", "2", "3"]);
console.log(`Google 문서 그림 병렬 가져오기 검사 통과 (${Math.round(elapsed)}ms, 동시 ${peak}개)`);
