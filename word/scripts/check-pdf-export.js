import assert from "node:assert/strict";
import { app, BrowserWindow } from "electron";
import { PDFiumLibrary } from "@hyzyla/pdfium";
import { pdfPrintHtml } from "../core/export-files.js";

await app.whenReady();
console.log("Electron 준비 완료");
const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
try {
  const html = pdfPrintHtml([
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 612 792"><rect width="612" height="792" fill="white"/><text x="40" y="80" font-size="24">PDF export test</text></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 612 792"><rect width="612" height="792" fill="white"/><text x="40" y="80" font-size="24">Second page</text></svg>',
  ]);
  console.log("인쇄용 HTML 생성 완료");
  await window.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  console.log("숨김 창 로드 완료");
  const pdf = await window.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { marginType: "none" } });
  console.log("PDF 바이트 생성 완료");
  assert.equal(pdf.subarray(0, 4).toString("ascii"), "%PDF");
  assert.ok(pdf.length > 1000);
  const library = await PDFiumLibrary.init();
  console.log("PDFium 준비 완료");
  const document = await library.loadDocument(pdf);
  assert.equal(document.getPageCount(), 2);
  document.destroy();
  console.log(`실제 2쪽 PDF 생성 검사 통과 (${pdf.length} bytes)`);
} finally {
  window.destroy();
  app.quit();
}
