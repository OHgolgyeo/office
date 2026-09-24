// 열어 둔 PDF 하나. 무거운 일은 필요할 때 조금씩 한다.
//  1) 여는 즉시: 글자·이미지 위치만 추출(빠름) → 원본 보기(쪽 그림은 화면에 보이는 쪽만 그때그때)
//  2) 뒤에서: 줄바꿈·문단 복원(Kiwi) → 원본 글꼴 되살리기 → 변환 보기 준비 완료
//  3) 변환 보기: 보이는 쪽만 그때그때 그 쪽의 이미지를 꺼내 화면 조각을 만든다
import { extractGlyphs, getLibrary } from "./src/extract-pdfium.js";
import { renderPageJpeg, readPageObjects, exportImage } from "./src/extract-objects.js";
import { collectFontGlyphs, buildFonts } from "./src/extract-fonts.js";
import { reconstruct } from "./src/reconstruct.js";
import { renderLayout, renderGraphicText } from "./src/render-layout.js";
import { ocrRegion, ocrAvailable } from "./ocr.js";

const ROT_SIGN = -1;   // 읽을 때 돌린 각도를 되돌리는 방향

export class PdfSession {
  constructor(bytes, name) {
    this.bytes = bytes; this.name = name;
    this.state = { text: false, conv: false, fonts: false, error: null, t0: Date.now(), tText: 0, tConv: 0 };
    this.pageJpeg = new Map();   // 쪽 번호 → JPEG
    this.convHtml = new Map();   // 쪽 번호 → 변환 화면 조각
    this.ocrHtml = new Map();    // 쪽 번호 → 그림 속 글자(OCR) 층(Promise)
    this.ocrSeq = 0;
    this.ocrLangDir = null;      // 서버가 정해 준다(models/ocr)
  }

  /** 여는 즉시 할 일: 글자와 이미지 위치(실제 그림 데이터는 문서화에서 요청할 때만) */
  async open() {
    const lib = await getLibrary();
    this.doc = await lib.loadDocument(new Uint8Array(this.bytes));      // 쪽 그림·이미지·글꼴용으로 열어 둔다
    this.input = await extractGlyphs(new Uint8Array(this.bytes), {});
    this.state.text = true; this.state.tText = Date.now() - this.state.t0;
    return this;
  }

  meta() {
    return { name: this.name, pages: this.input.pages.map((p) => ({ w: p.width, h: p.height })), ...this.state };
  }

  /** 선택한 PDF 쪽의 본문을 문서용 일반 텍스트로 만든다.
   *  원문 글자는 고치지 않고, 복원 단계에서 판정한 줄 이음과 문단 경계만 적용한다. */
  contentParts(pageIndexes) {
    if (!this.state.conv || !this.res) return null;
    const selected = new Set(pageIndexes);
    const pieces = [];
    const joinText = (text, lineIndex) => {
      const kind = this.res.joins[lineIndex]?.kind;
      if (kind === "hyphen-drop") return text.replace(/[-\u2010]$/, "");
      return text + (kind === "space" ? " " : "");
    };
    this.res.paragraphs.forEach((para, paragraphIndex) => {
      let part = "", previousLine = null;
      const flush = () => { if (part) pieces.push({ text: part, paragraphIndex }); part = ""; previousLine = null; };
      for (const lineIndex of para.lines) {
        const line = this.res.lines[lineIndex];
        if (!selected.has(line.page)) { flush(); continue; }
        if (previousLine !== null) part = joinText(part, previousLine);
        part += line.text;
        previousLine = lineIndex;
      }
      flush();
    });
    return pieces;
  }

  contentText(pageIndexes) {
    const parts = this.contentParts(pageIndexes);
    return parts && parts.map((p) => p.text).join("\n");
  }

  /** 이미지 포함 문서화를 선택한 쪽만 실제 그림을 꺼낸다. */
  ensureFigureFiles(pageIndexes) {
    const selected = new Set(pageIndexes);
    for (const pageIndex of selected) {
      const targets = (this.res.figures || []).filter((f) => f.page === pageIndex && !f.file);
      if (!targets.length) continue;
      const targetById = new Map(targets.map((f) => [f.id, f]));
      const inputById = new Map((this.input.pages[pageIndex]?.images || []).map((im) => [im.id, im]));
      const page = this.doc.getPage(pageIndex);
      for (const image of readPageObjects(page).images) {
        const target = targetById.get(image.id);
        if (!target || image.background) continue;
        image.maxSide = 1600;
        try {
          const file = exportImage(this.doc, page, image);
          if (file) { target.file = file; const input = inputById.get(image.id); if (input) input.file = file; }
        } catch { /* 손상되었거나 PDFium이 꺼내지 못하는 그림 하나는 건너뛴다. */ }
      }
    }
  }

  /** 내용만 문서화용 HTML. 본문은 일반 문단으로, 배경이 아닌 그림은 읽기 순서에 넣는다. */
  contentHtml(pageIndexes, { includeImages = false } = {}) {
    const parts = this.contentParts(pageIndexes);
    if (!parts) return null;
    if (includeImages) this.ensureFigureFiles(pageIndexes);
    const selected = new Set(pageIndexes);
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const figures = includeImages
      ? (this.res.figures || []).filter((f) => selected.has(f.page) && f.file?.data)
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
    let html = "", fi = 0;
    for (const part of parts) {
      while (fi < figures.length && figures[fi].beforeParagraph <= part.paragraphIndex) html += imageHtml(figures[fi++]);
      html += `<p style="white-space:pre-wrap">${esc(part.text)}</p>`;
    }
    while (fi < figures.length) html += imageHtml(figures[fi++]);
    return `<div>${html}</div>`;
  }

  /** 뒤에서: 복원 → 글꼴 */
  async prepareConversion(spacerPromise) {
    try {
      const spacer = await spacerPromise;
      this.spacer = spacer;
      this.res = reconstruct(this.input, { spacer });
      // 원본 보기의 투명 글자 층(복사용)은 복원 결과의 줄 정보를 쓴다
      this.textLayers = renderLayout(this.input, this.res, { lockLines: true, textOnly: true }).pages;
      await new Promise((r) => setImmediate(r));
      const acc = new Map();
      for (let i = 0; i < this.input.pages.length; i++) {
        collectFontGlyphs(this.doc.getPage(i), acc);
        if (i % 10 === 9) await new Promise((r) => setImmediate(r));       // 다른 요청(쪽 그림)이 끼어들 수 있게
      }
      const variants = new Map();
      for (const p of this.input.pages) for (const g of p.glyphs) {
        const n = (g.font || "").replace(/^[A-Z]{6}\+/, "");
        if (!variants.has(n)) variants.set(n, new Set());
        variants.get(n).add(g.hscale || 1);
      }
      this.input.fonts = buildFonts(acc, variants);
      this.state.fonts = true;
      this.state.conv = true; this.state.tConv = Date.now() - this.state.t0;
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

  /** 원본 보기의 투명 글자 층(복원 전에는 빈 문자열) */
  textLayer(n) { return this.textLayers ? this.textLayers[n].textLayer + renderGraphicText(this.res, n, "orig") : ""; }

  /** 변환 보기 한 쪽: 바탕은 PDFium 이 그린 원본 쪽에서 "변환할 글자"만 지운 그림,
   *  그 위에 변환한 글자. 이미지·도형·기울어진 그래픽과 그 속 글자는 원본 그대로 남는다. */
  convPage(n) {
    if (!this.state.conv) return null;
    if (!this.convHtml.has(n)) {
      const { pages } = renderLayout(this.input, this.res, { lockLines: true, pages: [n], noGraphics: true });
      // 그림 자리(OCR 전): 오른쪽 클릭하면 "읽고 있습니다"가 나오도록 미리 깔아 둔다
      const pending = `<div class="garea pending" style="left:0;top:0;width:100%;height:100%"></div>`;
      this.convHtml.set(n, `<img class="bgconv" src="/pdf/${this.id}/convbg/${n}.jpg" alt="">` + (pages[0] ? pages[0].layer : "") + renderGraphicText(this.res, n, "conv") + pending);
      if (this.convHtml.size > 40) this.convHtml.delete(this.convHtml.keys().next().value);
    }
    return this.convHtml.get(n);
  }

  /** 변환 보기 바탕: 변환할 본문 글자(와 머리글·쪽 번호)만 지운 원본 쪽 그림 */
  convBackground(n, scale = 1.5) {
    if (!this.state.conv) return null;
    const key = "c" + n;
    if (!this.pageJpeg.has(key)) {
      const hide = [...this.res.lines, ...this.res.furniture].filter((l) => l.page === n).flatMap((l) => l.glyphs.map((g) => g.ci)).filter((v) => v !== undefined);
      this.pageJpeg.set(key, renderPageJpeg(this.doc.getPage(n), scale, 82, hide));
      if (this.pageJpeg.size > 60) this.pageJpeg.delete(this.pageJpeg.keys().next().value);
    }
    return this.pageJpeg.get(key);
  }

  /** OCR 을 쓸 수 있는가(언어 자료가 설치되어 있는가) */
  ocrReady() { return !!this.ocrLangDir && ocrAvailable(this.ocrLangDir); }

  /** 변환 보기 바탕에서 숨기는 글자 = 변환한 본문·머리글 + 글자 데이터가 있는 그림 속 글자(따로 투명 층이 있으므로) */
  hiddenChars(n) {
    const page = this.input.pages[n];
    const conv = [...this.res.lines, ...this.res.furniture].filter((l) => l.page === n).flatMap((l) => l.glyphs.map((g) => g.ci));
    const graphic = (page.imageText || []).map((g) => g.ci);
    return [...conv, ...graphic].filter((v) => v !== undefined);
  }

  /** 1단계: 쪽 전체를 한 번 읽어 그림 속 글자가 있는 영역들(pt)을 찾는다 */
  async ocrRegions(n) {
    const page = this.input.pages[n], W = page.width, H = page.height;
    const r = await ocrRegion(this.doc.getPage(n), [0, 0, W, H], this.ocrLangDir, 2.5, { hide: this.hiddenChars(n), angles: [0] });
    if (!r) return [];
    const S = r.S;
    let boxes = r.lines.filter((l) => l.words.length).map((l) => {
      const ws = l.words, hh = Math.max(...ws.map((w) => w.bbox.y1 - w.bbox.y0)) / S;
      // 같은 칸의 위아래 줄은 묶되, 바로 옆 광고 칸까지 가로로 합쳐지지 않게 여백을 비대칭으로 둔다.
      const px = hh * 0.3, py = hh * 0.9;
      return [Math.min(...ws.map((w) => w.bbox.x0)) / S - px, Math.min(...ws.map((w) => w.bbox.y0)) / S - py,
        Math.max(...ws.map((w) => w.bbox.x1)) / S + px, Math.max(...ws.map((w) => w.bbox.y1)) / S + py];
    });
    // 서로 닿는 상자끼리 합쳐 영역으로
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < boxes.length && !merged; i++) for (let j = i + 1; j < boxes.length && !merged; j++) {
        const a = boxes[i], b = boxes[j];
        if (a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]) {
          boxes[i] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
          boxes.splice(j, 1); merged = true;
        }
      }
    }
    return boxes.map((b) => [Math.max(0, b[0]), Math.max(0, b[1]), Math.min(W, b[2]), Math.min(H, b[3])]).filter((b) => b[2] - b[0] > 20 && b[3] - b[1] > 8);
  }

  /** 그림 속 글자 읽기(뒤에서, 한 번 읽은 쪽은 기억). 결과는 투명 글자 층 HTML */
  ocrPage(n) {
    if (!this.state.conv) return Promise.resolve(null);
    if (!this.ocrHtml.has(n)) this.ocrHtml.set(n, (async () => {
      let html = "";
      if (!this.ocrReady()) return `<div class="garea nodata" style="left:0;top:0;width:100%;height:100%"></div>`;
      for (const b of await this.ocrRegions(n)) {
        const gid = 1000 + this.ocrSeq++;
        const area = `left:${b[0]}pt;top:${b[1]}pt;width:${b[2] - b[0]}pt;height:${b[3] - b[1]}pt`;
        let r = null;
        try { r = await ocrRegion(this.doc.getPage(n), b, this.ocrLangDir, 3, { hide: this.hiddenChars(n) }); } catch { r = null; }
        const words = r ? r.lines.flatMap((l) => l.words) : [];
        if (!words.length) { html += `<div class="garea empty" data-g="${gid}" style="${area}"></div>`; continue; }
        // 낱말마다 그 자리에 투명 글자(OCR 이 알려 준 상자 그대로). 같은 문단 낱말끼리는 복사할 때 띄어쓰기로 잇는다
        const S = r.S, esc = (t) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
        const pt = (v) => (v / S).toFixed(2);
        let conv = "", orig = "";
        // 낱말 사이 띄어쓰기: OCR 이 알려 준 줄 전체 글자에서 실제로 띄어 쓴 자리만(한국어는 음절 단위로 쪼개 알려 주는 일이 많다)
        const spaceAfter = (l) => {
          const flags = []; let pos = 0; const t = l.text;
          l.words.forEach((w, i) => {
            const at = t.indexOf(w.text, pos);
            if (at < 0) { flags.push(true); return; }
            pos = at + w.text.length;
            flags.push(i < l.words.length - 1 && /^\s/.test(t.slice(pos)));
          });
          return flags;
        };
        const lines = r.lines.filter((l) => l.words.length);
        lines.forEach((l, li) => {
          const ws = l.words, sp = spaceAfter(l);
          const pid = `o${gid}-p${l.par ?? li}`;
          const lastOfPar = li === lines.length - 1 || lines[li + 1].par !== l.par;
          ws.forEach((wd, wi) => {
            const h = Math.max(1, wd.bbox.y1 - wd.bbox.y0);
            // 줄 안: 띄어 쓴 자리만 공백 / 줄 끝: 같은 문단이 이어지면 공백 / 문단 끝: 줄바꿈
            const join = wi < ws.length - 1 ? (sp[wi] ? "space" : "none") : (lastOfPar ? "" : "space");
            conv += `<span class="para tl ow" data-pid="${pid}" data-join="${join}" data-w="${pt(wd.bbox.x1 - wd.bbox.x0)}" style="left:${pt(wd.bbox.x0)}pt;top:${pt(wd.bbox.y0)}pt;font-size:${pt(h * 0.9)}pt;line-height:${pt(h)}pt">${esc(wd.text)}</span>`;
          });
          const x0 = Math.min(...ws.map((w) => w.bbox.x0)), x1 = Math.max(...ws.map((w) => w.bbox.x1));
          const y0 = Math.min(...ws.map((w) => w.bbox.y0)), y1 = Math.max(...ws.map((w) => w.bbox.y1));
          orig += `<div class="tl" data-w="${pt(x1 - x0)}" style="left:${pt(x0)}pt;top:${pt(y0)}pt;font-size:${pt((y1 - y0) * 0.9)}pt;line-height:${pt(y1 - y0)}pt">${esc(ws.map((w, i) => w.text + (i < ws.length - 1 && sp[i] ? " " : "")).join(""))}</div>`;
        });
        // 화면 좌표 = 잘라 낸 곳 + 가운데 + 읽을 때 돌린 각도를 되돌림
        const cx = r.crop.w / 2, cy = r.crop.h / 2;
        const css = `translate(${pt(r.crop.x0 + cx)}pt,${pt(r.crop.y0 + cy)}pt) rotate(${ROT_SIGN * r.deg}deg) translate(${pt(-cx)}pt,${pt(-cy)}pt)`;
        html += `<div class="garea" data-g="${gid}" style="${area}"></div><div class="gtext ocr" data-g="${gid}" style="transform:${css}"><div class="gconv">${conv}</div><div class="gorig">${orig}</div></div>`;
      }
      return html;
    })());
    return this.ocrHtml.get(n);
  }

  /** 되살린 글꼴 CSS */
  fontCss() {
    if (!this.state.fonts) return "";
    return renderLayout(this.input, this.res, { lockLines: true, pages: [] }).fontFaceCss;
  }

  get mode() { return this.res ? this.res.stats.wrapMode : "char"; }

  close() { try { this.doc?.destroy(); } catch { /* 이미 닫힘 */ } }
}
