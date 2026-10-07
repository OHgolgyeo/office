import assert from "node:assert/strict";
import { app, BrowserWindow } from "electron";
import { PDFiumLibrary } from "@hyzyla/pdfium";
import { pdfPrintParts } from "../core/export-files.js";

// 앱의 PDF 내보내기(main.js pdfFromSvgs)와 같은 방식: 작은 틀을 열고 쪽 조각(SVG)을 붙인 뒤 printToPDF.
// 쪽 SVG 는 엔진처럼 96dpi px 크기(A4 = 793.7×1122.48)로 만든다. 쪽 수가 SVG 수와 같아야 하고(빈 쪽이 끼면 안 됨),
// 쪽 크기는 A4(595.3×841.9pt)여야 한다. 큰 그림이 든 쪽(수 MB)도 열려야 한다.
// (최상위 await app.whenReady() 는 Electron ESM 에서 멈춰서 then 으로 기다린다)
const W = 793.7066666666667, H = 1122.48;
const page = (label, extra = "") => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>\n<text x="60" y="100" font-size="24">${label}</text>${extra}\n</svg>\n`;
const bigImage = `<image x="60" y="200" width="400" height="300" href="data:image/png;base64,${"A".repeat(4_000_000)}"/>`;

app.whenReady().then(async () => {
  console.log("Electron 준비 완료");
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  let code = 0;
  try {
    const svgs = [page("PDF export test"), page("Second page", bigImage), page("Third page")];
    const { shell, pages } = pdfPrintParts(svgs);
    await window.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(shell));
    for (const p of pages) await window.webContents.executeJavaScript(`document.body.insertAdjacentHTML("beforeend", ${JSON.stringify(p)}); 0`, true);
    const pdf = await window.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { marginType: "none" } });
    assert.equal(pdf.subarray(0, 4).toString("ascii"), "%PDF");
    const library = await PDFiumLibrary.init();
    const document = await library.loadDocument(pdf);
    const count = document.getPageCount();
    const { originalWidth: fw, originalHeight: fh } = document.getPage(0).getOriginalSize(), first = { width: fw, height: fh };
    document.destroy();
    assert.equal(count, 3, `쪽 수 ${count} (빈 쪽이 끼었는지 확인)`);
    assert.ok(Math.abs(first.width - 595.3) < 2 && Math.abs(first.height - 841.9) < 2, `쪽 크기 ${first.width}×${first.height}pt (A4 아님)`);
    console.log(`실제 3쪽 A4 PDF 생성 검사 통과 (큰 그림 쪽 포함, ${pdf.length} bytes)`);
  } catch (e) {
    console.error(e); code = 1;
  } finally {
    window.destroy();
    app.exit(code);
  }
});
