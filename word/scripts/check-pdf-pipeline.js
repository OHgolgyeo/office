import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function samplePdf() {
  const stream = "BT /F1 18 Tf 72 720 Td (Hello PDF) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let body = "%PDF-1.4\n", offset = Buffer.byteLength(body);
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(offset);
    const chunk = `${index + 1} 0 obj\n${object}\nendobj\n`;
    body += chunk; offset += Buffer.byteLength(chunk);
  });
  const xref = offset;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((value) => `${String(value).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogolgye-pdf-check-"));
process.env.OGOLGYE_SETTINGS = path.join(tempDir, "settings.json");
const { startServer } = await import("../server.js");
const { server, port } = await startServer(0);
const base = `http://127.0.0.1:${port}`;
try {
  const opened = await fetch(`${base}/api/pdf?name=check.pdf`, { method: "POST", body: samplePdf() });
  assert.equal(opened.status, 200);
  const info = await opened.json();
  assert.equal(info.pages, 1);

  const [view, page] = await Promise.all([
    fetch(`${base}/pdf/${info.id}/view`),
    fetch(`${base}/pdf/${info.id}/page/0.jpg`),
  ]);
  assert.equal(view.status, 200);
  assert.match(await view.text(), /문서화/);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("content-type"), "image/jpeg");
  assert.ok((await page.arrayBuffer()).byteLength > 1000);

  let state;
  for (let i = 0; i < 100; i++) {
    state = await (await fetch(`${base}/pdf/${info.id}/status`)).json();
    if (state.ready || state.error) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(state?.error, null);
  assert.equal(state?.ready, true);

  const textLayer = await fetch(`${base}/pdf/${info.id}/text/0`);
  assert.equal(textLayer.status, 200);
  assert.match(await textLayer.text(), /Hello PDF/);

  const content = await fetch(`${base}/pdf/${info.id}/content?pages=0&images=0`);
  assert.equal(content.status, 200);
  const converted = await content.json();
  assert.match(converted.text, /Hello PDF/);
  assert.deepEqual(converted.pages, [1]);

  const saved = await fetch(`${base}/pdf/${info.id}/annotations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version: 1, highlights: [], bookmarks: [{ id: "check", page: 0, label: "첫 쪽" }], notes: [] }),
  });
  assert.equal(saved.status, 200);
  const annotations = await (await fetch(`${base}/pdf/${info.id}/annotations`, { cache: "no-store" })).json();
  assert.equal(annotations.bookmarks[0]?.label, "첫 쪽");
  console.log("PDF 열기·보기·글자층·문서화·주석 저장 검사 통과");
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tempDir, { recursive: true, force: true });
}
// PDFium/Kiwi가 유지하는 작업 자원이 검사 프로세스의 자연 종료를 늦출 수 있다.
process.exit(0);
