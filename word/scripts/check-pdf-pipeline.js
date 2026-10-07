import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 선으로 그은 3열 2행 표(윗줄 오른쪽 두 칸은 세로선이 없어 한 칸으로 합쳐져 있다)
const TABLE_STREAM = [
  "0.5 w",
  "72 600 m 72 660 l S 172 600 m 172 660 l S 272 600 m 272 630 l S 372 600 m 372 660 l S",
  "72 660 m 372 660 l S 72 630 m 372 630 l S 72 600 m 372 600 l S",
  ...[["A1", 80, 640], ["B1", 180, 640], ["A2", 80, 610], ["B2", 180, 610], ["C2", 280, 610]].map(([t, x, y]) => `BT /F1 10 Tf ${x} ${y} Td (${t}) Tj ET`),
].join("\n");

// 위아래로 이어진 서로 다른 두 표. 표 모양을 끄고 글로 풀 때 두 표 사이에는 빈 문단 하나가 필요하다.
const TWO_TABLE_STREAM = [
  "0.5 w",
  "72 600 m 72 660 l S 162 600 m 162 660 l S 252 600 m 252 660 l S 72 660 m 252 660 l S 72 630 m 252 630 l S 72 600 m 252 600 l S",
  "72 480 m 72 540 l S 162 480 m 162 540 l S 252 480 m 252 540 l S 72 540 m 252 540 l S 72 510 m 252 510 l S 72 480 m 252 480 l S",
  "BT /F1 10 Tf 82 641 Td (First A) Tj ET BT /F1 10 Tf 172 641 Td (First B) Tj ET BT /F1 10 Tf 82 611 Td (First C) Tj ET BT /F1 10 Tf 172 611 Td (First D) Tj ET",
  "BT /F1 10 Tf 82 521 Td (Second A) Tj ET BT /F1 10 Tf 172 521 Td (Second B) Tj ET BT /F1 10 Tf 82 491 Td (Second C) Tj ET BT /F1 10 Tf 172 491 Td (Second D) Tj ET",
].join("\n");

// 3단 본문(단 사이 14pt, 단마다 기준선이 어긋남). 1단 끝 문단 B는 2단 맨 위로 이어지고,
// 단 아래에는 1~2단 폭의 "Key:" 설명과 3단 쪽의 예시 글이 나란히 있다.
function threeColumnStream() {
  const cols = [40, 222, 404], shift = [0, 5, -3], size = 9, lead = 12;
  const w = ["alpha", "beta", "gamma", "delta", "omega", "sigma", "theta", "kappa"];
  const AFM = { " ": 278, ".": 278, ":": 278, i: 222, l: 222, f: 278, t: 278, r: 333, m: 833, w: 722, c: 500, k: 500, s: 500 };
  const width = (t) => [...t].reduce((a, ch) => a + (AFM[ch] ?? (/[A-Z]/.test(ch) ? 667 : 556)), 0) * size / 1000;
  const words = (tag, n, seed) => tag + " " + Array.from({ length: n }, (_, i) => w[(seed * 5 + i * 3) % 8]).join(" ");
  const ops = [];
  // 한 줄: 문단 끝 줄이 아니면 낱말 간격(Tw)으로 단 폭 155pt를 채운다(양쪽 정렬)
  const put = (x, y, t, fill) => {
    const tw = fill ? Math.max(0, (fill - width(t)) / (t.match(/ /g) || []).length) : 0;
    ops.push(`BT /F1 ${size} Tf ${tw.toFixed(2)} Tw ${x} ${y} Td (${t}) Tj ET`);
    return t;
  };
  // 문단: 첫 줄 들여쓰기 12pt(cont: 앞 단에서 이어지는 부분이면 없음), 마지막 줄은 2낱말 + 마침표(open 이면 다음 단으로 이어져 마침표 없이 꽉 채움)
  const para = (c, y0, tags, seed, open = false, cont = false) => tags.map((tag, i) => {
    const last = i === tags.length - 1 && !open, indent = i || cont ? 0 : 12;
    return put(cols[c] + indent, y0 - i * lead + shift[c], words(tag, last ? 2 : 5, seed + i) + (last ? "." : ""), last ? 0 : 155 - indent);
  });
  const A = para(0, 700, ["A1", "A2", "A3"], 1);
  const B = [...para(0, 652, ["B1", "B2", "B3", "B4"], 4, true), ...para(1, 700, ["B5", "B6"], 8, false, true)];
  const C = para(1, 664, ["C1", "C2", "C3"], 10);
  const D = para(2, 700, ["D1", "D2", "D3", "D4", "D5"], 13);
  const K = ["Key:", "Roll on the Surname column of your choice or roll", "once on each and create a hyphenated name."];
  K.forEach((t, i) => put(40, 560 - i * lead, t, 0));
  const E = ["Example: a roll of 1 on column A and 5", "results in the name von Meyernick."];
  E.forEach((t, i) => put(404, 548 - i * lead, t, 0));
  return { stream: ops.join("\n"), expected: [A.join(" "), B.join(" "), C.join(" "), D.join(" "), "Key:", K.slice(1).join(" "), E.join(" ")] };
}

// 가운데 제목 3단: 3단 위 가운데 큰 제목(짧아서 2단 폭 안에 들어간다), 3단(문단 A·B·C), 가운데 소제목, 다시 3단(D·E·F).
// 제목이 2단 첫 줄로 읽히면 안 된다.
function centeredTitleStream() {
  const cols = [40, 222, 404], size = 9, lead = 12;
  const w = ["alpha", "beta", "gamma", "delta", "omega", "sigma", "theta", "kappa"];
  const AFM = { " ": 278, ".": 278, i: 222, l: 222, f: 278, t: 278, r: 333, m: 833, w: 722, c: 500, k: 500, s: 500, y: 500,
    A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, M: 833, T: 611, S: 667, P: 667 };
  const width = (t, sz = size) => [...t].reduce((a, ch) => a + (AFM[ch] ?? 556), 0) * sz / 1000;
  const words = (tag, n, seed) => tag + " " + Array.from({ length: n }, (_, i) => w[(seed * 5 + i * 3) % 8]).join(" ");
  const ops = [], expected = [];
  const put = (x, y, t, fill, sz = size) => {
    const tw = fill ? Math.max(0, (fill - width(t)) / (t.match(/ /g) || []).length) : 0;
    ops.push(`BT /F1 ${sz} Tf ${tw.toFixed(2)} Tw ${x.toFixed(1)} ${y} Td (${t}) Tj ET`);
    return t;
  };
  const center = (t, y, sz) => put(306 - width(t, sz) / 2, y, t, 0, sz);
  const para = (c, y0, tag, seed) => [1, 2, 3, 4].map((k, i) => {
    const last = i === 3, indent = i ? 0 : 12;
    return put(cols[c] + indent, y0 - i * lead, words(tag + k, last ? 2 : i ? 5 : 4, seed + i) + (last ? "." : ""), last ? 0 : 155 - indent);
  }).join(" ");
  expected.push(center("Main Title", 680, 16));
  ["A", "B", "C"].forEach((tag, c) => expected.push(para(c, 650, tag, 8 + c * 7)));
  expected.push(center("Second Part", 580, 9));
  ["D", "E", "F"].forEach((tag, c) => expected.push(para(c, 556, tag, 30 + c * 7)));
  return { stream: ops.join("\n"), expected };
}

function samplePdf(extra = "") {
  const stream = "BT /F1 18 Tf 72 720 Td (Hello PDF) Tj ET" + (extra ? "\n" + extra : "");
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

  // 문서화 규칙: 표 모양 유지(tables=1)면 HTML 표(합친 칸 포함), 끄면 칸 글을 문단으로
  const tableInfo = await (await fetch(`${base}/api/pdf?name=table.pdf`, { method: "POST", body: samplePdf(TABLE_STREAM) })).json();
  for (let i = 0; i < 100; i++) {
    const st = await (await fetch(`${base}/pdf/${tableInfo.id}/status`)).json();
    if (st.ready || st.error) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const kept = await (await fetch(`${base}/pdf/${tableInfo.id}/content?pages=0&images=1&tables=1`)).json();
  assert.match(kept.html, /<table/);
  assert.match(kept.html, /<td colspan="2"[^>]*><p style="text-align:left">B1<\/p><\/td>/);
  for (const cell of ["A1", "A2", "B2", "C2"]) assert.match(kept.html, new RegExp(`<p style="text-align:left">${cell}</p>`));   // 칸 글은 원본처럼 왼쪽 정렬
  const plain = await (await fetch(`${base}/pdf/${tableInfo.id}/content?pages=0&images=0&tables=0`)).json();
  assert.doesNotMatch(plain.html, /<table/);
  assert.match(plain.text, /B1/);

  const twoTableInfo = await (await fetch(`${base}/api/pdf?name=two-tables.pdf`, { method: "POST", body: samplePdf(TWO_TABLE_STREAM) })).json();
  for (let i = 0; i < 100; i++) {
    const st = await (await fetch(`${base}/pdf/${twoTableInfo.id}/status`)).json();
    if (st.ready || st.error) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const twoTablesPlain = await (await fetch(`${base}/pdf/${twoTableInfo.id}/content?pages=0&images=0&tables=0&blanks=1`)).json();
  assert.doesNotMatch(twoTablesPlain.html, /<table/);
  assert.match(twoTablesPlain.html, /Hello PDF<\/p>(?:<p><br><\/p>)+<p[^>]*>First A/); // 글로 풀어도 앞 문단과 표 사이 빈 줄 보존
  assert.match(twoTablesPlain.html, /First D<\/p><p><br><\/p><p[^>]*>Second A/);
  const twoTablesKept = await (await fetch(`${base}/pdf/${twoTableInfo.id}/content?pages=0&images=0&tables=1&blanks=1`)).json();
  assert.match(twoTablesKept.html, /Hello PDF<\/p>(?:<p><br><\/p>)+<table/);  // 글 다음 표 앞의 원본 빈 줄도 보존

  // 이름-값 표: 선 없이 검은 이름 칸(흰 글자) 2행 × 2열 + 오른쪽 값 → 표(이름 칸 검은 바탕, 값 칸 왼쪽 정렬)
  const LABEL_STREAM = [
    "0 0 0 rg 90 600 70 24 re f 290 600 70 24 re f 90 576 70 24 re f 290 576 70 24 re f",
    ...[["Type", 100, 608], ["People", 300, 608], ["Genre", 100, 584], ["Time", 300, 584]].map(([t, x, y]) => `1 1 1 rg BT /F1 10 Tf ${x} ${y} Td (${t}) Tj ET`),
    ...[["Special", 175, 608], ["Three players", 375, 608], ["Comedy", 175, 584], ["Two hours", 375, 584]].map(([t, x, y]) => `0 0 0 rg BT /F1 10 Tf ${x} ${y} Td (${t}) Tj ET`),
  ].join("\n");
  const labelInfo = await (await fetch(`${base}/api/pdf?name=label.pdf`, { method: "POST", body: samplePdf(LABEL_STREAM) })).json();
  for (let i = 0; i < 100; i++) {
    const st = await (await fetch(`${base}/pdf/${labelInfo.id}/status`)).json();
    if (st.ready || st.error) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const labeled = await (await fetch(`${base}/pdf/${labelInfo.id}/content?pages=0&images=0&tables=1`)).json();
  assert.match(labeled.html, /<table/);
  assert.match(labeled.html, /background-color:#000000[^>]*><p style="text-align:center"><span style="color:#ffffff;">Type<\/span><\/p><\/td><td[^>]*><p style="text-align:left">Special<\/p>/);
  assert.match(labeled.html, /Time<\/span><\/p><\/td><td[^>]*><p style="text-align:left">Two hours<\/p>/);

  // 문단 사이 빈 줄 살리기(blanks=1): 한 줄이 비어 있던 곳에 빈 문단, 끄면 붙인다
  const BLANK_STREAM = [["First paragraph line one.", 690], ["Second line of the first one.", 676], ["Third line ends here.", 662],
    ["Next paragraph after one empty line.", 634], ["It goes on.", 620]].map(([t, y]) => `BT /F1 12 Tf 72 ${y} Td (${t}) Tj ET`).join("\n");
  const blankInfo = await (await fetch(`${base}/api/pdf?name=blank.pdf`, { method: "POST", body: samplePdf(BLANK_STREAM) })).json();
  for (let i = 0; i < 100; i++) {
    const st = await (await fetch(`${base}/pdf/${blankInfo.id}/status`)).json();
    if (st.ready || st.error) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const withBlank = await (await fetch(`${base}/pdf/${blankInfo.id}/content?pages=0&blanks=1`)).json();
  assert.match(withBlank.html, /Third line ends here\.<\/p><p><br><\/p><p[^>]*>Next paragraph/);
  const noBlank = await (await fetch(`${base}/pdf/${blankInfo.id}/content?pages=0&blanks=0`)).json();
  assert.match(noBlank.html, /Third line ends here\.<\/p><p[^>]*>Next paragraph/);

  // 3단 읽기 순서: 단마다 위→아래, 단을 넘어 이어지는 문단은 하나로, 단 아래의 나란한 글은 모든 단 뒤에
  const three = threeColumnStream();
  const threeInfo = await (await fetch(`${base}/api/pdf?name=three.pdf`, { method: "POST", body: samplePdf(three.stream) })).json();
  for (let i = 0; i < 100; i++) {
    const st = await (await fetch(`${base}/pdf/${threeInfo.id}/status`)).json();
    if (st.ready || st.error) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const threeOut = await (await fetch(`${base}/pdf/${threeInfo.id}/content?pages=0&images=0&blanks=1`)).json();
  const paras = threeOut.html.split("</p>").map((p) => p.replace(/<[^>]*>/g, "")).filter((t) => t && t !== "Hello PDF");
  assert.deepEqual(paras, three.expected);

  // 가운데 제목 3단: 제목·소제목은 단을 가로지르는 줄(2단 첫 줄이 아님), 구역마다 1→2→3단
  const titled = centeredTitleStream();
  const titledInfo = await (await fetch(`${base}/api/pdf?name=titled.pdf`, { method: "POST", body: samplePdf(titled.stream) })).json();
  for (let i = 0; i < 100; i++) {
    const st = await (await fetch(`${base}/pdf/${titledInfo.id}/status`)).json();
    if (st.ready || st.error) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const titledOut = await (await fetch(`${base}/pdf/${titledInfo.id}/content?pages=0&images=0&blanks=0`)).json();
  assert.deepEqual(titledOut.html.split("</p>").map((p) => p.replace(/<[^>]*>/g, "")).filter((t) => t && t !== "Hello PDF"), titled.expected);

  // 규칙은 설정 파일에 저장된다
  const rules = await (await fetch(`${base}/api/settings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pdfRules: { objectImages: false, tables: true, junk: 1 } }) })).json();
  assert.deepEqual(rules.pdfRules, { objectImages: false, tables: true, blankLines: true, scanTables: false });

  // 서브뷰 메뉴에서 Google Drive 파일을 고르면 대상 선택을 다시 거치지 않고 서브뷰로 연다.
  // 메뉴와 연결 중 한쪽만 남는 회귀를 정적 검사로 함께 막는다.
  const appSource = fs.readFileSync(path.join(process.cwd(), "renderer", "app.js"), "utf8");
  const bridgeSource = fs.readFileSync(path.join(process.cwd(), "renderer", "studio-bridge.js"), "utf8");
  const googleSource = fs.readFileSync(path.join(process.cwd(), "core", "google-docs.js"), "utf8");
  const mainSource = fs.readFileSync(path.join(process.cwd(), "main.js"), "utf8");
  assert.match(bridgeSource, /data-ogolgye="computer"[^>]*>[\s\S]*?내 컴퓨터에서 열기/);
  assert.match(bridgeSource, /data-ogolgye="drive"[^>]*>[\s\S]*?Google 드라이브에서 열기/);
  assert.match(appSource, /action === "computer"[\s\S]*?pickFile\(SUBVIEW_FILTERS\)[\s\S]*?openSubAny\(f\)/);
  // 서브뷰는 모든 문서를 연다: PDF·한글은 그대로, 그 밖은 한글 문서로 바꿔서(renderer/doc-import.js)
  assert.match(appSource, /async function openSubAny\(file\)[\s\S]*?openSubPdf\(file\)[\s\S]*?openSubDoc\(kind\.file\)/);
  const importSource = fs.readFileSync(path.join(process.cwd(), "renderer", "doc-import.js"), "utf8");
  for (const ext of ["pdf", "hwp", "hwpx", "docx", "odt", "rtf", "txt", "md", "html", "epub", "csv", "xlsx", "pptx"]) assert.match(importSource, new RegExp(`SUBVIEW_EXTENSIONS = \\[[^\\]]*"${ext}"`));
  // 드라이브 속도: 고르는 순간 미리 받기, 한 번 본 폴더 목록 캐시, 연결 토큰 미리 받기(겹친 갱신은 한 번)
  assert.match(appSource, /drivePrefetch\(drive\.selected\)/);
  assert.match(appSource, /drive\.cache\.get\(key\)/);
  assert.match(mainSource, /googleDocs\(\)\.warm\(\)/);
  assert.match(googleSource, /if \(this\.refreshing\) return this\.refreshing/);
  assert.match(googleSource, /return "gexport"[\s\S]*?OTHER_DOC\.test\(name\)/);   // 시트·슬라이드(PDF로), 그 밖의 문서도 목록에
  // 서브뷰 닫기: 서브 편집기의 '문서 복구' 창이 탭 줄(×, ✕)을 덮지 않게 — 서브에서는 '나중에'로 넘기고, 탭 줄은 그 창보다 위
  assert.match(bridgeSource, /if \(!OG_IS_MAIN\)[\s\S]*?\.recovery-dialog-body[\s\S]*?"나중에"/);
  assert.match(appSource, /#sub-tabs-shell\{[^}]*z-index:20000/);
  // 스크롤: 떠 있는 창(대화상자·그림 목록·주석 목록) 위의 휠은 뒤 PDF 로 넘기지 않고, 넘친 탭 줄은 세로 휠로 가로 이동
  const viewerShellSource = fs.readFileSync(path.join(process.cwd(), "core", "viewer-shell.js"), "utf8");
  assert.match(viewerShellSource, /document\.querySelectorAll\('\.ogdlg,\.ann-panel'\)\.forEach\(trapWheel\)/);
  assert.match(appSource, /subTabsElement\.addEventListener\("wheel"[\s\S]*?subTabsElement\.scrollLeft \+=/);
  // 서브뷰 탭 닫기: 탭 줄을 먼저 꺼내고(iframe 과 함께 이벤트가 떨어지지 않게), PDF 는 주석을 보낸 뒤 서버 세션을 내려놓고,
  // 문서 편집기는 몇 개 숨겨 두었다가 다시 쓴다(지운 편집기가 메모리에 남는 크로미움 문제)
  assert.match(appSource, /async function closeSub[\s\S]*?ogFlushAnnotations[\s\S]*?\/close`, \{ method: "POST" \}[\s\S]*?parkSubTabs\(\);[\s\S]*?spareSubEditors\.push/);
  assert.match(appSource, /async function openSubDoc[\s\S]*?spareSubEditors\.pop\(\)[\s\S]*?skipUnsavedGuard: true/);
  assert.match(viewerShellSource, /window\.ogFlushAnnotations=/);
  const serverSourceForClose = fs.readFileSync(path.join(process.cwd(), "server.js"), "utf8");
  assert.match(serverSourceForClose, /what === "close" && req\.method === "POST"\) \{ s\.close\(\); sessions\.delete\(s\.id\)/);
  // PDF 쪽은 쓰고 나면 닫는다(래퍼의 getPage 는 열기만 해서 pdfium 메모리가 쌓였다)
  const extractSource = fs.readFileSync(path.join(process.cwd(), "core", "src", "extract-pdfium.js"), "utf8");
  assert.match(extractSource, /export function closePage\(page\)[\s\S]*?_FPDF_ClosePage/);
  assert.match(extractSource, /for \(const page of doc\.pages\(\)\) try \{[\s\S]*?\} finally \{ closePage\(page\); \}/);
  // 글이 든 카드는 한 장짜리든 여러 조각(두루마리 막대 등)이든 똑같이 글상자(표)로, 바탕이 어두우면 글이 놓인 안쪽 색(그래도 어두우면 흰색)
  const reconstructSourceForCards = fs.readFileSync(path.join(process.cwd(), "core", "src", "reconstruct.js"), "utf8");
  assert.match(reconstructSourceForCards, /\} else if \(!single && linesBoxedBy\(page, b\)\) \{[\s\S]*?kind = "panel"; render = false;/);
  // 나란히 맞닿은 카드 둘(둘 다 글이 얹힘)은 묶지 않고, 글이 성긴 카드도 따로 흐름(위끝 6pt 안이면 같은 줄, 왼쪽부터),
  // 기준선이 조금 뜬 줄임표는 이웃 글자가 있는 줄로
  assert.match(reconstructSourceForCards, /const twoCards = \(stackedV \|\| stackedH\) && glyphsOver\(page, a\)\.length >= 3 && glyphsOver\(page, c\)\.length >= 3;/);
  assert.match(reconstructSourceForCards, /carded = inside >= 20 && straddle <= inside \* 0\.05;/);
  assert.match(reconstructSourceForCards, /Math\.abs\(panels\[a\]\.bbox\[1\] - panels\[b\]\.bbox\[1\]\) > 6/);
  assert.ok(reconstructSourceForCards.includes("const FLOAT = /^[…"));
  // 카드 크기 글상자 안의 줄은 머리글로 빼지 않는다(쪽마다 같은 자리의 "HandOut"), 상자 안 빈 줄은 한 줄까지
  assert.match(reconstructSourceForCards, /function isFurniture[\s\S]*?r\.bbox\[3\] - r\.bbox\[1\] >= l\.size \* 6[\s\S]*?\) return false;/);
  assert.match(fs.readFileSync(path.join(process.cwd(), "core", "session.js"), "utf8"), /"<p><\/p>"\.repeat\(Math\.min\(1, this\.blankLinesBetween\(boxParts\[k - 1\], p\)\)\)/);
  // 칸 바탕은 글이 놓인 자리에서 가장 많이 보이는 색(같은 틀의 카드는 같은 색), 어둡거나 거의 흰색이면 흰색
  assert.match(fs.readFileSync(path.join(process.cwd(), "core", "session.js"), "utf8"), /panelHtml\(panel[\s\S]*?regionBackgroundColor\(page, textBox\)[\s\S]*?return dark\(bg\) \|\| nearWhite \? "#ffffff" : bg;/);
  // 표 테두리 굵기가 변마다 달라 보이던 문제: 엔진은 가로·세로 가는 선을 픽셀에 맞추고(패치), 편집 화면은 쪽 그림을
  // 정수 픽셀 자리에 놓고(build-studio 패치), 서브뷰 폭도 정수 픽셀
  assert.match(fs.readFileSync(path.join(process.cwd(), "engine", "patches", "rhwp-0.8.6-ogolgye.patch"), "utf8"), /fn snap_axis_line\(ctx: &CanvasRenderingContext2d/);
  const buildStudioSource = fs.readFileSync(path.join(process.cwd(), "scripts", "build-studio.js"), "utf8");
  assert.match(buildStudioSource, /Math\.round\(this\.virtualScroll\.getPageLeftResolved\(pageIdx, this\.scrollContent\.clientWidth\)\)/);
  assert.match(buildStudioSource, /Math\.round\(this\.virtualScroll\.getTotalWidth\(\)\)/);
  // 빌드된 편집 화면의 엔진(wasm)에 그 수정이 실제로 들어 있는지(선 맞춤이 읽는 "getTransform" 글자)
  assert.ok(fs.readdirSync(path.join(process.cwd(), "vendor", "rhwp-studio", "assets")).some((f) => /^rhwp_bg-.*\.wasm$/.test(f) && fs.readFileSync(path.join(process.cwd(), "vendor", "rhwp-studio", "assets", f)).includes("getTransform")));
  assert.match(fs.readFileSync(path.join(process.cwd(), "renderer", "style.css"), "utf8"), /#sub-pane\{flex:0 0 round\(45%,1px\)\}/);
  // 페이지 없음 보기의 쪽 이어 붙이기: 줄 사이에 표가 끼어 커진 줄 간격은 쓰지 않는다(쪽이 바뀌는 자리에 표 하나만큼 빈 곳)
  assert.match(bridgeSource, /const pitch = r\.pitch && r\.pitch <= lineH \* 3 \? r\.pitch : lineH \* 1\.6;/);
  // 1열 표(제목 칸 + 가로줄로 나뉜 행들): 행 3개 이상이거나 첫 행이 제목처럼 낮을 때, 옆에 다른 글이 없을 때만 표
  assert.match(reconstructSourceForCards, /const titled = fullRows\.length >= 3 && size > 0 && fullRows\[1\] - fullRows\[0\] <= size \* 3;[\s\S]*?if \(beside > inside\.length \* 0\.2\) continue;/);
  // 페이지 없음 보기의 쪽 경계 캐시: 일괄 붙여넣기 뒤에는 전부 다시 재고, 화면에 보이는 쪽은 문서가 바뀐 뒤 반드시 다시 잰다
  assert.match(bridgeSource, /ogInvalidatePageEdges\(true\); ogRelayout\(\);\n  return \{ batch: true, placed, error \};/);
  assert.match(bridgeSource, /function ogCheckVisibleEdges\(\)[\s\S]*?ogEdges\.seen\.get\(k\) !== ogEdges\.rev/);
  assert.match(bridgeSource, /ogClipQueued = false; ogClipPages\(\); ogCheckVisibleEdges\(\);/);
  // 뒤에서 도는 쪽 나눔이 끝났을 때(document-mutated)도 다시 재고, 마지막으로 보이는 쪽은 엔진 값과 직접 맞춰 본다(스스로 바로잡기)
  assert.match(bridgeSource, /og\.eventBus\?\.on\("document-mutated", \(\) => \{ ogEdges\.rev\+\+; ogQueueClip\(\); \}\);/);
  assert.match(bridgeSource, /function ogVerifyVisibleEdges\(\)[\s\S]*?fresh = ogPageContentEdge\(i, t, b\)[\s\S]*?if \(changed\) ogRelayout\(\);/);
  // 옆 상자 때문에 좁아진 단의 한 줄 대사를 가운데 정렬로 보지 않는다(위아래 줄과 왼쪽 끝이 나란하면 왼쪽 정렬)
  assert.match(reconstructSourceForCards, /const leftAligned = \(i\) =>[\s\S]*?center: \(centered\(l\) && \(l\.spanTitle \|\| !leftAligned\(i\)\)\) \|\| undefined/);
  // 붙여 넣은 표의 자리 문단은 바탕글 문단 모양(엔진 패치) — 1번 "본문"(왼쪽 여백 15pt)을 쓰면 표가 안쪽에서 시작한다
  assert.match(fs.readFileSync(path.join(process.cwd(), "engine", "patches", "rhwp-0.8.6-ogolgye.patch"), "utf8"), /\.map\(\|s\| s\.para_shape_id\)/);
  // PDF 보기: 글자를 드래그하는 동안에는 그림 잡기 영역이 반응하지 않는다
  const viewerSourceForGrab = fs.readFileSync(path.join(process.cwd(), "core", "viewer-shell.js"), "utf8");
  assert.ok(viewerSourceForGrab.includes("body.selecting .figgrab{pointer-events:none}"));
  assert.ok(viewerSourceForGrab.includes("document.body.classList.add('selecting')"));
  // 그림이 든 쪽의 받침 층(흰 종이 판 + 그림 층)에도 쪽 그림과 같은 자르기를 건다 — 안 자르면 다음 쪽 첫 줄·그림 위를 덮는다
  assert.ok(bridgeSource.includes('document.querySelectorAll("#scroll-content [data-rhwp-overlay-page], #scroll-content [data-rhwp-grid-page], #scroll-content [data-rhwp-hf-edit-page]")'));
  // 쪽 그림이 치워지고 층만 남아도 그 쪽의 경계로 자른다(쪽 그림이 없다고 자르기를 풀면 쪽 전체 크기의 흰 판이 드러난다)
  assert.match(bridgeSource, /band = on \? vs\.__ogBands\[idx\] : null;\s*if \(!band\) \{ if \(el\.style\.clipPath\) el\.style\.clipPath = ""; return; \}/);
  // 확대·축소 직후(옛 크기를 scale 로 늘려 보여 주는 동안)에는 자르기 좌표를 그려진 배율로 되돌린다
  assert.ok(bridgeSource.includes("const rz = Number(c.dataset.rhwpRenderedZoom), k = Number.isFinite(rz) && rz > 0 ? rz / zoom : 1;"));
  assert.ok(bridgeSource.includes("const clip = ogPageClip(band, parseFloat(el.style.width) || 0, drawn.get(idx) ?? 1);"));
  // 층이 새로 놓이면 그려지기 전에 바로 자른다(한 프레임 깜빡임 방지)
  assert.ok(bridgeSource.includes("if (ogPageless() && records.some((r) => r.addedNodes.length)) ogClipPages();"));
  // 쪽의 마지막 줄이 글자처럼 놓인 그림이면(줄 높이 = 그림 높이) 줄 높이에 비례한 간격을 주지 않는다(그림 사이가 벌어짐)
  assert.ok(bridgeSource.includes("end = lineH > 40 ? r.bottom + 8 : Math.max(r.bottom, r.lineTop + pitch);"));
  // 화면 진단(Ctrl+Alt+Shift+D)은 원인을 찾은 뒤 뺐다
  assert.ok(!bridgeSource.includes("ogDiagnose") && !fs.readFileSync(path.join(process.cwd(), "server.js"), "utf8").includes("/api/diagnose"));
  // Kiwi(약 900MB): 켤 때 미리 불러오지 않고, PDF 준비(또는 파일을 고르기 시작할 때) 불러오며, 한동안 안 쓰면 작업 스레드째 내려놓는다
  assert.match(serverSourceForClose, /export const warmUp = \(\) => \{ prepareWorker\(\); \};/);
  assert.match(serverSourceForClose, /function schedulePrepRelease\(\)[\s\S]*?w\.terminate\(\)/);
  assert.match(serverSourceForClose, /if \(!prepJobs\.size\) schedulePrepRelease\(\); \}/);
  assert.match(appSource, /if \(action === "computer"\) \{\s*warmPdfPrepare\(\);/);
  const sessionSourceForPages =fs.readFileSync(path.join(process.cwd(), "core", "session.js"), "utf8");
  assert.deepEqual(sessionSourceForPages.match(/this\.doc\.getPage\(/g), ["this.doc.getPage("]);   // 하나(그림 꺼내기)만 직접, 그것도 finally 에서 닫음
  assert.match(sessionSourceForPages, /const page = this\.doc\.getPage\(pageIndex\);\n      try \{[\s\S]*?\} finally \{ closePage\(page\); \}/);
  // 큰 PDF 속도: 무거운 계산은 작업 스레드에서(서버가 멈추지 않게), 보기 화면 OCR 은 한 번에 하나씩(쪽 그림 요청이 줄 서지 않게)
  const serverSource = fs.readFileSync(path.join(process.cwd(), "server.js"), "utf8");
  const ppSource = fs.readFileSync(path.join(process.cwd(), "core", "ppstructure.js"), "utf8");
  const shellSource = fs.readFileSync(path.join(process.cwd(), "core", "viewer-shell.js"), "utf8");
  assert.match(ppSource, /fork\(fileURLToPath\(new URL\("\.\/ort-process\.mjs"/);       // 레이아웃·표 모델(따로 도는 프로세스 — 끌 때 바로 끝냄)
  assert.match(serverSource, /export async function shutdown\(\)[\s\S]*?shutdownModels\(\)[\s\S]*?shutdownOcr\(\)/);
  assert.match(fs.readFileSync(path.join(process.cwd(), "main.js"), "utf8"), /app\.on\("before-quit"[\s\S]*?shutdown\(\)/);
  assert.match(serverSource, /new Worker\(new URL\("\.\/core\/prepare-worker\.mjs"/);   // 글자 추출·문단 복원·Kiwi
  assert.match(serverSource, /prepareConversion\(spacer, prepareInWorker\)/);
  assert.match(shellSource, /function pumpOcr\(\)\{\s*if\(ocrBusy\)return;/);
  assert.match(appSource, /const subTabs = \[\]/);
  assert.match(appSource, /function makeSub\([\s\S]*?subTabs\.push\(tab\)[\s\S]*?activateSub\(tab\)/);
  assert.match(appSource, /async function openSubPdf\(file\) \{\s*const tab = makeSub/);
  assert.match(appSource, /async function openSubDoc\(file\) \{[\s\S]*?const tab = makeSub\("doc"/);   // 숨겨 둔 편집기가 있으면 먼저 불러온 뒤 탭을 만든다
  assert.match(appSource, /sub-tab-x[\s\S]*?closeSub\(tab\)/);
  assert.match(appSource, /tab\?\.kind === "doc" \? doc\?\.getElementById\("menu-bar"\) : doc\?\.querySelector\("\.menu"\)/);
  assert.match(appSource, /doc\.body\.prepend\(subTabsShell\)/);          // 편집기/PDF 화면의 맨 위에 탭을 둔다
  assert.match(appSource, /\.menu\{top:32px!important\}/);                // PDF 도구 메뉴는 최상단 탭 아래에 고정한다
  assert.match(appSource, /action === "drive"\) await openDriveDialog\("sub"\)/);
  assert.match(bridgeSource, /parent\.postMessage\(\{ type: "ogolgye:drive-open" \}, location\.origin\)/); // 기본 편집 화면의 파일 메뉴
  assert.match(appSource, /e\.data\.type === "ogolgye:drive-open"\) openDriveDialog\(\)/);                 // 기본 편집 화면으로 열기
  assert.match(appSource, /drive\.forcedTarget \|\| el\.querySelector\("\.dv-target"\)\.value/);
  assert.match(appSource, /el\.hidden = false;[\s\S]*?native\.google\.status\(\)/);                       // 상태 확인 전에 창부터 표시
  assert.match(appSource, /Google 드라이브 목록을 불러오지 못했습니다/);                                      // IPC·네트워크 오류도 창 안에 표시
  assert.match(googleSource, /m === MIME\.gdoc\) return "gdoc"/);       // Google 문서가 Drive 목록에서 빠지지 않음
  assert.match(googleSource, /kind === "gdoc"\)[\s\S]*?docsToModel/);  // Docs API로 탭·본문·서식을 읽음
  assert.match(mainSource, /f\.kind === "model"[\s\S]*?hwpxFromModel/); // HWPX로 바꿔 화면에 전달
  assert.match(appSource, /target === "sub"\) await openSubDoc\(file\)/); // Google 문서도 서브뷰에서 열림
  assert.match(appSource, /native\.google\.fetch\(\{ id: f\.id, name: f\.name, mimeType: f\.mimeType, kind: f\.kind \}\)/); // 목록 메타데이터 재사용
  assert.match(mainSource, /fetchFile\(selected\?\.id \|\| id, selected\)/); // 메타데이터 재조회 없이 가져오기
  assert.match(googleSource, /const imageCache = new Map\(\)[\s\S]*?activeImages >= 6/); // 중복 제거 + 제한 병렬 그림 다운로드
  console.log("PDF 열기·보기·글자층·문서화(규칙: 표 모양·이름-값 표·빈 줄, 3단·가운데 제목 3단 읽기 순서)·주석 저장·서브뷰 Google Drive 열기 검사 통과");
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tempDir, { recursive: true, force: true });
}
// PDFium/Kiwi가 유지하는 작업 자원이 검사 프로세스의 자연 종료를 늦출 수 있다.
process.exit(0);
