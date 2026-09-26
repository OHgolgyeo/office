// 열어 둔 PDF 하나. 무거운 일은 필요할 때 조금씩 한다.
//  1) 여는 즉시: 글자·이미지 위치만 추출(빠름) → 원본 보기(쪽 그림은 화면에 보이는 쪽만 그때그때)
//  2) 뒤에서: 줄바꿈·문단 복원(Kiwi) → 투명 글자 층(복사·형광펜)과 문서화 준비 완료
//  3) 그림 파일은 문서화·끌어놓기에서 요청한 쪽만 꺼낸다
//  4) 사진·스캔처럼 글자 데이터가 없는 곳은 화면에 보이는 쪽부터 로컬 OCR 로 읽어 투명 글자 층을 덧붙인다
import { extractGlyphs, getLibrary } from "./src/extract-pdfium.js";
import { renderPageJpeg, readPageObjects, exportImage } from "./src/extract-objects.js";
import { reconstruct, TOC_LINE } from "./src/reconstruct.js";
import { renderTextLayers, renderGraphicText } from "./src/render-layout.js";
import { ocrRegion, ocrAvailable } from "./ocr.js";

const ROT_SIGN = -1;   // 읽을 때 돌린 각도를 되돌리는 방향

// PDF에는 제목이라는 표식이 없으므로, 본문 대표 크기와 문단의 크기·굵기·정렬을 함께 본다.
// 길고 문장부호로 끝나는 일반 문장이나 여러 줄 본문은 크기가 조금 다르다는 이유만으로 제목이 되지 않게 한다.
export function boldFontName(name) {
  const n = String(name || "").replace(/^[A-Z]{6}\+/, "");
  return /bold|black|heavy|semibold|extrabold|굵/i.test(n) || /[a-z](?:B|EB|XB|SB|Bd|Bk)$/.test(n) || /[-_ ](?:B|EB|XB|SB)$/i.test(n);
}

export function pdfHeadingLevel(para, bodySize, style = {}) {
  const text = String(para?.text || "").trim();
  const lay = para?.layout || {};
  const size = Number(lay.fontSize) || bodySize || 10;
  const base = Math.max(1, Number(bodySize) || size || 10);
  const ratio = size / base;
  const lineCount = Array.isArray(para?.lines) ? para.lines.length : 1;
  const chars = [...text.replace(/\s/g, "")].length;
  if (!text || chars > 120 || lineCount > 3 || para?.cell) return 0;
  const sentenceLike = chars > 55 && /[.!?。！？]$/.test(text);
  if (sentenceLike && ratio < 1.4) return 0;
  // 굵기: 글꼴이 알려 주는 굵기, 또는 글꼴 이름(굵기를 적어 두지 않은 PDF 가 많다)
  const bold = (Number(lay.weight) || 400) >= 600 || boldFontName(lay.font);
  const centered = lay.align === "center";
  const latin = text.replace(/[^A-Za-z]/g, "");
  const allCaps = latin.length >= 4 && latin === latin.toUpperCase();
  if (ratio >= 1.65) return 1;
  if (ratio >= 1.38) return 2;
  if (ratio >= 1.17) return 3;
  if (ratio >= 1.06 && (bold || centered || allCaps)) return 3;
  if (lineCount === 1 && chars <= 55 && bold && ratio >= 0.96) return 3;
  // 본문과 크기는 같지만 굵기·색·기울임을 달리한 짧은 줄(인물 소개·소제목 등). 줄 일부만 달라도(굵은 이름 + 색 있는 설명) 된다.
  // 문장처럼 끝나거나 목차 항목이면 제목으로 보지 않는다.
  if (style.styled && lineCount <= 2 && chars <= 60 && ratio >= 0.9 && !/[.!?。！？,，]$/.test(text) && !TOC_LINE.test(text)) return 3;
  return 0;
}

export class PdfSession {
  constructor(bytes, name) {
    this.bytes = bytes; this.name = name;
    this.state = { text: false, ready: false, error: null, t0: Date.now() };
    this.pageJpeg = new Map();   // 쪽 번호 → JPEG
    this.ocrHtml = new Map();    // 쪽 번호 → 그림 속 글자(OCR) 층(Promise)
    this.ocrParas = new Map();   // 쪽 번호 → OCR 로 읽은 문단 [{ text, page, y(pt) }] (문서화용)
    this.ocrSeq = 0;
    this.ocrGeneration = 0;      // 언어 변경 전에 시작한 인식 결과가 뒤늦게 섞이지 않게 구분
    this.ocrLangDir = null;      // 서버가 정해 준다(models/ocr)
    this.ocrLanguages = ["kor", "eng"];
  }

  /** 여는 즉시 할 일: 글자와 이미지 위치(실제 그림 데이터는 문서화에서 요청할 때만) */
  async open() {
    const lib = await getLibrary();
    this.doc = await lib.loadDocument(new Uint8Array(this.bytes));      // 쪽 그림·이미지·글꼴용으로 열어 둔다
    // 창을 바로 띄울 수 있게 쪽 크기만 먼저 알아 둔다(글자 추출은 prepareConversion 에서 뒤에서)
    this.pageSizes = [];
    for (let i = 0; i < this.doc.getPageCount(); i++) {
      const pg = this.doc.getPage(i), M = pg.module;
      this.pageSizes.push({ w: M._FPDF_GetPageWidth(pg.pageIdx), h: M._FPDF_GetPageHeight(pg.pageIdx) });
    }
    return this;
  }

  meta() {
    return { name: this.name, pages: this.pageSizes, ...this.state };
  }

  /** 선택한 PDF 쪽의 본문을 문서용 일반 텍스트로 만든다.
   *  원문 글자는 고치지 않고, 복원 단계에서 판정한 줄 이음과 문단 경계만 적용한다. */
  contentParts(pageIndexes) {
    if (!this.state.ready || !this.res) return null;
    const selected = new Set(pageIndexes);
    const pieces = [];
    const joinText = (text, lineIndex) => {
      const kind = this.res.joins[lineIndex]?.kind;
      if (kind === "hyphen-drop") return text.replace(/[-\u2010]$/, "");
      return text + (kind === "space" ? " " : "");
    };
    this.res.paragraphs.forEach((para, paragraphIndex) => {
      let part = "", previousLine = null, first = null;
      const flush = () => { if (part) pieces.push({ text: part, paragraphIndex, page: first.page, y: first.oy, toc: TOC_LINE.test(part) }); part = ""; previousLine = null; first = null; };
      for (const lineIndex of para.lines) {
        const line = this.res.lines[lineIndex];
        if (!selected.has(line.page)) { flush(); continue; }
        first ||= line;
        if (previousLine !== null) part = joinText(part, previousLine);
        part += line.text;
        previousLine = lineIndex;
      }
      flush();
    });
    return pieces;
  }

  /** 사진·스캔 쪽인가: PDF 글자 데이터가 하나도 없고 글자를 담을 만한 그림이 있는 쪽 */
  isScanPage(n) {
    return !this.res.lines.some((l) => l.page === n) && !this.res.furniture.some((l) => l.page === n) && this.ocrAreas(n).length > 0;
  }

  /** 스캔 쪽 자체인 그림(쪽 대부분을 덮는 그림) — 그 글은 OCR 로 옮기므로 그림으로는 다시 넣지 않는다 */
  isScanImage(f) {
    const page = this.input.pages[f.page], area = (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]);
    return !!page && area > page.width * page.height * 0.5 && this.isScanPage(f.page);
  }

  /** 글자 조각 사이에 OCR 로 읽은 문단을 쪽별 위에서 아래 순서로 끼워 넣는다.
   *  문서화에는 사진·스캔 쪽(글자 데이터가 없는 쪽)의 OCR 글자만 넣는다. 글자가 있는 쪽의 사진 속 글자는
   *  문서에 옮기지 않는다(화면에서 드래그·복사만). 아직 읽지 않은 쪽은 여기서 읽는다. */
  async contentPartsWithOcr(pageIndexes) {
    const parts = this.contentParts(pageIndexes);
    if (!parts || !this.ocrReady()) return parts;
    const pages = [...new Set(pageIndexes)].sort((a, b) => a - b);
    const queue = new Map();                                   // 쪽 → 아직 넣지 않은 OCR 문단(위에서 아래)
    for (const n of pages) {
      if (!this.isScanPage(n)) { queue.set(n, []); continue; }
      await this.ocrPage(n);
      queue.set(n, [...(this.ocrParas.get(n) || [])].sort((a, b) => a.y - b.y));
    }
    const out = [];
    let lastIndex = -1;                                       // 그림 자리(beforeParagraph)는 앞선 글 문단 번호를 따른다
    const put = (p) => out.push({ text: p.text, paragraphIndex: lastIndex, page: p.page, y: p.y, ocr: true });
    for (const part of parts) {
      for (const n of pages) {
        const q = queue.get(n);
        while (q.length && (n < part.page || (n === part.page && q[0].y < part.y))) put(q.shift());
        if (n >= part.page) break;
      }
      out.push(part); lastIndex = part.paragraphIndex;
    }
    for (const n of pages) for (const p of queue.get(n)) put(p);
    return out;
  }

  /** 문서화 내용: 일반 텍스트와 HTML. 복원 전이면 null */
  async content(pageIndexes, { includeImages = false } = {}) {
    const parts = await this.contentPartsWithOcr(pageIndexes);
    if (!parts) return null;
    for (const p of parts) p.heading = this.partIsHeading(p);
    const text = parts.map((p, i) => (i > 0 && p.heading && !parts[i - 1].heading ? "\n" : "") + p.text).join("\n");
    return { text, html: this.contentHtml(parts, pageIndexes, { includeImages }) };
  }

  /** 문단 글자 가운데 본문과 모양이 다른 글자(본문과 다른 색·굵게·기울임)가 30% 이상인가 */
  paraStyled(para) {
    this.paraColored(para);                                   // 본문 색 준비
    let all = 0, odd = 0;
    for (const li of para.lines) for (const g of this.res.lines[li].glyphs) {
      if (/\s/.test(g.c)) continue;
      all++;
      const c = g.color ? [g.color[0], g.color[1], g.color[2]] : [0, 0, 0];
      const colored = c.reduce((d, v, i) => d + Math.abs(v - this._bodyColor[i]), 0) > 90;
      if (colored || (g.weight || 400) >= 600 || boldFontName(g.font) || g.italic) odd++;
    }
    return all > 0 && odd / all >= 0.3;
  }

  /** 본문 글자색(가장 많이 쓰인 색)과 비교해 문단 색이 다른가. 색 차이가 작으면(검정 계열끼리) 같은 색으로 본다. */
  paraColored(para) {
    const key = (c) => c ? [c[0], c[1], c[2]] : [0, 0, 0];
    if (!this._bodyColor) {
      const count = new Map();
      for (const l of this.res.lines) for (const g of l.glyphs) { const k = key(g.color).join(); count.set(k, (count.get(k) || 0) + 1); }
      this._bodyColor = ([...count].sort((a, b) => b[1] - a[1])[0]?.[0] || "0,0,0").split(",").map(Number);
    }
    const count = new Map();
    for (const li of para.lines) for (const g of this.res.lines[li].glyphs) { if (/\s/.test(g.c)) continue; const k = key(g.color).join(); count.set(k, (count.get(k) || 0) + 1); }
    const main = ([...count].sort((a, b) => b[1] - a[1])[0]?.[0] || "0,0,0").split(",").map(Number);
    return main.reduce((d, v, i) => d + Math.abs(v - this._bodyColor[i]), 0) > 90;
  }

  /** 문서화 조각이 제목인가 */
  partIsHeading(part) {
    if (part.ocr) return false;
    const para = this.res.paragraphs[part.paragraphIndex];
    return !part.toc && pdfHeadingLevel(para, this.res.stats?.bodySize, { styled: this.paraStyled(para) }) > 0;
  }

  /** 이미지 포함 문서화를 선택한 쪽만 실제 그림을 꺼낸다. */
  ensureFigureFiles(pageIndexes) {
    const selected = new Set(pageIndexes);
    for (const pageIndex of selected) {
      const targets = (this.res.figures || []).filter((f) => f.page === pageIndex && f.kind === "figure" && !f.file);
      if (!targets.length) continue;
      const targetById = new Map(targets.map((f) => [f.id, f]));
      const inputById = new Map((this.input.pages[pageIndex]?.images || []).map((im) => [im.id, im]));
      const page = this.doc.getPage(pageIndex);
      for (const image of readPageObjects(page).images) {
        const target = targetById.get(image.id);
        if (!target) continue;                               // 목록에 든 그림만(배경이라도 내용 그림이면 목록에 있다)
        image.maxSide = 1600;
        try {
          const file = exportImage(this.doc, page, image);
          if (file) { target.file = file; const input = inputById.get(image.id); if (input) input.file = file; }
        } catch { /* 손상되었거나 PDFium이 꺼내지 못하는 그림 하나는 건너뛴다. */ }
      }
    }
  }

  /** 내용만 문서화용 HTML. 제목 묶음과 본문 사이에는 빈 문단 하나만 두고, 그림은 읽기 순서에 넣는다. */
  contentHtml(parts, pageIndexes, { includeImages = false } = {}) {
    if (includeImages) this.ensureFigureFiles(pageIndexes);
    const selected = new Set(pageIndexes);
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const figures = includeImages
      ? (this.res.figures || []).filter((f) => selected.has(f.page) && f.kind === "figure" && f.file?.data && !this.isScanImage(f))
        .sort((a, b) => a.beforeParagraph - b.beforeParagraph || a.page - b.page || a.bbox[1] - b.bbox[1])
      : [];
    const imageHtml = (f) => {
      const ext = String(f.file.ext || "png").toLowerCase().replace("jpg", "jpeg");
      const mime = `image/${ext}`;
      const src = `data:${mime};base64,${Buffer.from(f.file.data).toString("base64")}`;
      const w = Math.max(1, f.bbox[2] - f.bbox[0]);
      const h = Math.max(1, f.bbox[3] - f.bbox[1]);
      return `<p><img src="${src}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" alt=""></p>`;
    };
    let html = "", fi = 0, previousHeading = null;
    for (const part of parts) {
      while (fi < figures.length && figures[fi].beforeParagraph <= part.paragraphIndex) html += imageHtml(figures[fi++]);
      const heading = part.heading ?? this.partIsHeading(part);
      // 빈 줄은 본문이 끝나고 제목이 시작하는 곳에만 하나 둔다(제목 바로 뒤 본문은 붙이고, 이어지는 제목은 한 묶음).
      if (previousHeading === false && heading) html += "<p><br></p>";
      html += `<p style="white-space:pre-wrap${part.toc ? ";text-align:left" : ""}">${esc(part.text)}</p>`;
      previousHeading = heading;
    }
    while (fi < figures.length) html += imageHtml(figures[fi++]);
    return `<div>${html}</div>`;
  }

  /** 뒤에서: 글자 추출 → 줄바꿈·문단 복원 → 투명 글자 층 */
  async prepareConversion(spacerPromise) {
    try {
      // 글자 추출(몇 쪽마다 양보해서 그동안 쪽 그림 요청을 처리한다)
      this.input = await extractGlyphs(new Uint8Array(this.bytes), { yieldEvery: 3 });
      this.state.text = true;
      const spacer = await spacerPromise;
      await new Promise((r) => setImmediate(r));
      this.res = reconstruct(this.input, { spacer });
      // 원본 보기의 투명 글자 층(복사용)은 복원 결과의 줄 정보를 쓴다
      this.textLayers = renderTextLayers(this.input, this.res);
      this.state.ocrPages = this.input.pages.map((p) => p.index).filter((n) => this.ocrAreas(n).length);
      this.state.ready = true;
    } catch (e) {
      this.state.error = String(e && e.message || e);
    }
  }

  /** 원본 쪽 그림(JPEG), 한 번 만든 것은 기억 */
  pageImage(n, scale = 1.5) {
    if (!this.pageJpeg.has(n)) {
      this.pageJpeg.set(n, renderPageJpeg(this.doc.getPage(n), scale));
      if (this.pageJpeg.size > 60) this.pageJpeg.delete(this.pageJpeg.keys().next().value);
    }
    return this.pageJpeg.get(n);
  }

  /** 쪽 목록의 작은 미리보기 그림(JPEG) */
  pageThumb(n) {
    this.pageThumbs ||= new Map();
    if (!this.pageThumbs.has(n)) {
      const size = this.pageSizes[n] || { w: 595, h: 842 };
      this.pageThumbs.set(n, renderPageJpeg(this.doc.getPage(n), Math.min(0.5, 240 / Math.max(size.w, 1)), 75));   // 폭 약 240px
      if (this.pageThumbs.size > 400) this.pageThumbs.delete(this.pageThumbs.keys().next().value);
    }
    return this.pageThumbs.get(n);
  }

  /** 원본 보기의 투명 글자 층(복원 전에는 빈 문자열) */
  textLayer(n) { return this.textLayers ? this.textLayers[n].textLayer + renderGraphicText(this.res, n) : ""; }

  /** 끌어다 놓을 수 있는 그림 목록(쪽별, pt) */
  figureList() {
    if (!this.state.ready) return null;
    return (this.res.figures || []).filter((f) => f.kind === "figure").map((f) => ({ page: f.page, id: f.id, bbox: f.bbox }));
  }

  /** 그림 원본 파일(PDF 에서 꺼낸 그대로) */
  figureFile(page, id) {
    if (!this.state.ready) return null;
    this.ensureFigureFiles([page]);
    const f = (this.res.figures || []).find((x) => x.page === page && x.id === id);
    return f && f.file && f.file.data ? f.file : null;
  }

  /** OCR 을 쓸 수 있는가(언어 자료가 설치되어 있는가) */
  ocrReady() { return !!this.ocrLangDir && ocrAvailable(this.ocrLangDir, this.ocrLanguages); }

  /** 환경 설정에서 언어를 바꾸면 열어 둔 PDF도 새 언어로 다시 읽는다. */
  setOcrLanguages(languages) {
    this.ocrLanguages = [...languages];
    this.ocrGeneration++;
    this.ocrHtml.clear();
    this.ocrParas.clear();
    this.ocrSeq = 0;
  }

  /** OCR 에서 숨길 글자 = 이미 글자 데이터가 있는 본문·머리글·그림 속 글자(따로 투명 층이 있으므로) */
  hiddenChars(n) {
    const page = this.input.pages[n];
    const text = [...this.res.lines, ...this.res.furniture].filter((l) => l.page === n).flatMap((l) => l.glyphs.map((g) => g.ci));
    const graphic = (page.imageText || []).map((g) => g.ci);
    return [...text, ...graphic].filter((v) => v !== undefined);
  }

  /** OCR 할 곳 = 쪽에 들어 있는 그림(이미지) 영역(pt). 글자로 된 쪽이나 작은 아이콘·로고만 있는 쪽은 비어 있다.
   *  사진·스캔 PDF 는 쪽 전체가 그림 하나이므로 쪽 전체가 된다. 겹치는 그림은 하나로 합친다. */
  ocrAreas(n) {
    const page = this.input?.pages[n];
    if (!page) return [];
    const W = page.width, H = page.height;
    let areas = (page.images || []).map((im) => [Math.max(0, im.bbox[0]), Math.max(0, im.bbox[1]), Math.min(W, im.bbox[2]), Math.min(H, im.bbox[3])])
      .filter((b, i) => {
        const w = b[2] - b[0], h = b[3] - b[1], px = page.images[i].px || [0, 0];
        return w >= 40 && h >= 20 && w * h >= W * H * 0.01 && px[0] >= 80 && px[1] >= 30;   // 글자를 담을 만한 크기
      });
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < areas.length && !merged; i++) for (let j = i + 1; j < areas.length && !merged; j++) {
        const a = areas[i], b = areas[j];
        if (a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]) {
          areas[i] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
          areas.splice(j, 1); merged = true;
        }
      }
    }
    return areas;
  }

  /** 1단계: 그림 영역을 한 번씩 훑어 글자가 있는 곳들(pt)을 찾는다 */
  async ocrRegions(n) {
    const page = this.input.pages[n], W = page.width, H = page.height;
    let boxes = [];
    for (const area of this.ocrAreas(n)) {
      const r = await ocrRegion(this.doc.getPage(n), area, this.ocrLangDir, 2.5, { hide: this.hiddenChars(n), angles: [0], languages: this.ocrLanguages });
      if (!r) continue;
      const S = r.S, ox = r.crop.x0 / S, oy = r.crop.y0 / S;                    // 잘라 낸 곳 기준 → 쪽 좌표
      for (const l of r.lines.filter((l) => l.words.length)) {
        const ws = l.words, hh = Math.max(...ws.map((w) => w.bbox.y1 - w.bbox.y0)) / S;
        // 같은 칸의 위아래 줄은 묶되, 바로 옆 광고 칸까지 가로로 합쳐지지 않게 여백을 비대칭으로 둔다(그림 밖으로는 넘지 않게).
        const px = hh * 0.3, py = hh * 0.9;
        boxes.push([Math.max(area[0], ox + Math.min(...ws.map((w) => w.bbox.x0)) / S - px), Math.max(area[1], oy + Math.min(...ws.map((w) => w.bbox.y0)) / S - py),
          Math.min(area[2], ox + Math.max(...ws.map((w) => w.bbox.x1)) / S + px), Math.min(area[3], oy + Math.max(...ws.map((w) => w.bbox.y1)) / S + py)]);
      }
    }
    // 같은 글묶음의 위아래 줄만 한 영역으로 합친다.
    // 단순히 조금이라도 닿는다는 이유로 합치면 기울어진 광고·카드의 옆 칸까지 하나가 되어,
    // 한 칸의 글자를 드래그해도 주변 글자가 전부 선택된다.
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < boxes.length && !merged; i++) for (let j = i + 1; j < boxes.length && !merged; j++) {
        const a = boxes[i], b = boxes[j];
        const overlapX = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
        const narrower = Math.max(1, Math.min(a[2] - a[0], b[2] - b[0]));
        const gapY = Math.max(0, Math.max(a[1], b[1]) - Math.min(a[3], b[3]));
        const lineHeight = Math.max(1, Math.min(a[3] - a[1], b[3] - b[1]));
        const sameColumn = overlapX / narrower >= 0.55;
        const verticallyClose = gapY <= lineHeight * 0.45;
        if (sameColumn && verticallyClose) {
          boxes[i] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
          boxes.splice(j, 1); merged = true;
        }
      }
    }
    return boxes.map((b) => [Math.max(0, b[0]), Math.max(0, b[1]), Math.min(W, b[2]), Math.min(H, b[3])]).filter((b) => b[2] - b[0] > 20 && b[3] - b[1] > 8);
  }

  /** 2단계: 영역마다 기울기까지 맞춰 읽고, 원본 보기의 투명 글자 층과 같은 모양(줄마다 .tl)으로 만든다.
   *  같은 문단의 줄은 같은 data-pid 로 묶어 복사할 때 띄어쓰기로 잇는다. 한 번 읽은 쪽은 기억한다.
   *  반환: 투명 글자 층 HTML(""), 언어 자료가 없으면 null */
  ocrPage(n) {
    if (!this.state.ready) return Promise.resolve("");
    if (!this.ocrReady()) return Promise.resolve(null);
    if (!this.ocrAreas(n).length) { this.ocrParas.set(n, []); return Promise.resolve(""); }   // 그림이 없는 쪽: OCR 하지 않는다
    if (!this.ocrHtml.has(n)) this.ocrHtml.set(n, (async () => {
      const generation = this.ocrGeneration;
      let html = "";
      const paras = [];
      for (const b of await this.ocrRegions(n)) {
        const gid = 1000 + this.ocrSeq++;
        let r = null;
        try { r = await ocrRegion(this.doc.getPage(n), b, this.ocrLangDir, 3, { hide: this.hiddenChars(n), languages: this.ocrLanguages }); } catch { r = null; }
        const lines = r ? r.lines.filter((l) => l.words.length) : [];
        if (!lines.length) continue;
        const S = r.S, pt = (v) => (v / S).toFixed(2);
        const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
        // 낱말 사이 띄어쓰기: OCR 이 알려 준 줄 전체 글자에서 실제로 띄어 쓴 자리만(한국어는 음절 단위로 쪼개 알려 주는 일이 많다)
        const lineText = (l) => {
          let pos = 0;
          return l.words.map((w, i) => {
            const at = l.text.indexOf(w.text, pos);
            if (at >= 0) pos = at + w.text.length;
            return w.text + (i < l.words.length - 1 && (at < 0 || /^\s/.test(l.text.slice(pos))) ? " " : "");
          }).join("");
        };
        // 문서화용 문단: 같은 문단 번호의 줄을 띄어쓰기로 잇는다(위치는 잘라 낸 곳 기준 pt)
        for (const l of lines) {
          const y = (r.crop.y0 + Math.min(...l.words.map((w) => w.bbox.y0))) / S;
          const last = paras.at(-1);
          if (last && last.region === gid && last.par === l.par) last.text += " " + lineText(l);
          else paras.push({ text: lineText(l), page: n, y, region: gid, par: l.par, deg: r.deg });
        }
        let layer = "", open = null;
        lines.forEach((l, li) => {
          const pid = `o${gid}-p${l.par ?? li}`;
          if (pid !== open) { if (open) layer += "</div>"; layer += `<div class="opara" data-pid="${pid}">`; open = pid; }
          const ws = l.words, sameParNext = li < lines.length - 1 && lines[li + 1].par === l.par;
          const x0 = Math.min(...ws.map((w) => w.bbox.x0)), x1 = Math.max(...ws.map((w) => w.bbox.x1));
          const y0 = Math.min(...ws.map((w) => w.bbox.y0)), y1 = Math.max(...ws.map((w) => w.bbox.y1));
          layer += `<div class="tl" data-pid="${pid}" data-join="${sameParNext ? "space" : ""}" data-w="${pt(x1 - x0)}" style="left:${pt(x0)}pt;top:${pt(y0)}pt;font-size:${pt((y1 - y0) * 0.9)}pt;line-height:${pt(y1 - y0)}pt">${esc(lineText(l))}</div>`;
        });
        if (open) layer += "</div>";
        // 화면 좌표 = 잘라 낸 곳 + 가운데 + 읽을 때 돌린 각도를 되돌림
        const cx = r.crop.w / 2, cy = r.crop.h / 2;
        const css = `translate(${pt(r.crop.x0 + cx)}pt,${pt(r.crop.y0 + cy)}pt) rotate(${ROT_SIGN * r.deg}deg) translate(${pt(-cx)}pt,${pt(-cy)}pt)`;
        html += `<div class="gtext ocr" data-g="${gid}" style="transform:${css}">${layer}</div>`;
      }
      if (generation !== this.ocrGeneration) return "";
      // 문서화에는 기울어진 글자를 넣지 않는다(PDF 글자와 같은 규칙: 기울어진 글자는 그림 속 글자로 본다).
      // 스캔은 쪽 전체가 조금 기울어 있을 수 있으므로, 그 쪽에서 가장 많은 글자가 읽힌 각도를 "바로 선 각도"로 삼고
      // 그 각도와 다른 영역(기울어진 광고·카드 등)만 뺀다. 화면의 투명 글자(드래그·복사)는 모두 둔다.
      const weight = new Map();
      for (const p of paras) weight.set(p.deg, (weight.get(p.deg) || 0) + p.text.length);
      const upright = [...weight].sort((a, b) => b[1] - a[1] || Math.abs(a[0]) - Math.abs(b[0]))[0]?.[0] ?? 0;
      this.ocrParas.set(n, paras.filter((p) => p.deg === upright).map(({ text, page, y }) => ({ text: text.trim(), page, y })).filter((p) => p.text));
      return html;
    })());
    return this.ocrHtml.get(n);
  }

  close() { try { this.doc?.destroy(); } catch { /* 이미 닫힘 */ } }
}
