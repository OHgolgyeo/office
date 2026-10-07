import assert from "node:assert/strict";
import zlib from "node:zlib";
import { htmlArchive, pdfPrintHtml } from "../core/export-files.js";

function readZipEntries(zip) {
  const entries = new Map();
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const method = zip.readUInt16LE(offset + 8);
    const packedLength = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = zip.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const packed = zip.subarray(dataStart, dataStart + packedLength);
    entries.set(name, method === 8 ? zlib.inflateRawSync(packed) : packed);
    offset = dataStart + packedLength;
  }
  return entries;
}

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const zip = htmlArchive(`<h1>시험 문서</h1><img alt="표지" src="data:image/png;base64,${png.toString("base64")}">`);
assert.equal(zip.subarray(0, 4).toString("hex"), "504b0304");
const entries = readZipEntries(zip);
assert.deepEqual([...entries.keys()], ["index.html", "assets/image-001.png"]);
assert.match(entries.get("index.html").toString("utf8"), /src="assets\/image-001\.png"/);
assert.deepEqual(entries.get("assets/image-001.png"), png);

const pdfHtml = pdfPrintHtml([
  '<svg viewBox="0 0 612 792"><text>첫 쪽</text></svg>',
  '<svg width="595" height="842"><text>둘째 쪽</text></svg>',
]);
// 쪽 크기는 SVG 사용자 단위 = CSS px(엔진은 96dpi px). 크기가 같은 쪽은 쪽 설정 하나를 같이 쓴다
assert.match(pdfHtml, /@page p0\{size:612px 792px/);
assert.match(pdfHtml, /@page p1\{size:595px 842px/);
assert.doesNotMatch(pdfHtml, /overflow:hidden/);   // 두면 Chromium 인쇄가 쪽마다 빈 쪽을 하나씩 더 만든다
assert.equal((pdfHtml.match(/<section class="page/g) || []).length, 2);
console.log("HTML ZIP 및 PDF 인쇄 문서 검사 통과");
