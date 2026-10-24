// 열어 둔 PDF 하나. 무거운 일은 필요할 때 조금씩 한다.
//  1) 여는 즉시: 글자·이미지 위치만 추출(빠름) → 원본 보기(쪽 그림은 화면에 보이는 쪽만 그때그때)
//  2) 뒤에서: 줄바꿈·문단 복원(Kiwi) → 투명 글자 층(복사·형광펜)과 문서화 준비 완료
//  3) 그림 파일은 문서화·끌어놓기에서 요청한 쪽만 꺼낸다
//  4) 사진·스캔처럼 글자 데이터가 없는 곳은 화면에 보이는 쪽부터 로컬 OCR 로 읽어 투명 글자 층을 덧붙인다
import fs from "node:fs";
import path from "node:path";
import { extractGlyphs, getLibrary, closePage, withPage, isRasterOnlyDocument, needsKoreanSpacer } from "./src/extract-pdfium.js";
import { renderPageJpeg, renderRegionRGB, readPageObjects, exportImage, regionAverageColor, regionBackgroundColor, withHiddenText, withOnlyImages } from "./src/extract-objects.js";
import { reconstruct, repairPunctuationText, TOC_LINE, findGutters } from "./src/reconstruct.js";
import { renderTextLayers, renderGraphicText } from "./src/render-layout.js";
import { ocrRegion, ocrAvailable, splitOcrColumns, spaceOcrWords } from "./ocr.js";
import { detectLayout, tablesOf, imagesOf, FURNITURE_LABELS, scanTableHtml, pdfTableHtml, ppModelsInstalled } from "./ppstructure.js";
import { associateJapaneseRuby, renderJapaneseRuby } from "./ruby.js";
import { findRasterImageRegions } from "./image-regions.js";

const ROT_SIGN = -1;   // 읽을 때 돌린 각도를 되돌리는 방향
const MB = 1024 * 1024;
const PAGE_JPEG_CACHE_BYTES = Math.max(12 * MB, Number(process.env.OG_PDF_PAGE_CACHE_MB || 48) * MB);
const PAGE_THUMB_CACHE_BYTES = Math.max(4 * MB, Number(process.env.OG_PDF_THUMB_CACHE_MB || 12) * MB);
const TEXT_LAYER_CACHE_BYTES = Math.max(4 * MB, Number(process.env.OG_PDF_TEXT_CACHE_MB || 16) * MB);
const OCR_CACHE_BYTES = Math.max(8 * MB, Number(process.env.OG_PDF_OCR_CACHE_MB || 24) * MB);
const OCR_CACHE_PAGES = Math.max(2, Number(process.env.OG_PDF_OCR_CACHE_PAGES || 8));
const OCR_GLOBAL_CACHE_BYTES = Math.max(OCR_CACHE_BYTES, Number(process.env.OG_PDF_OCR_GLOBAL_CACHE_MB || 64) * MB);
const OCR_GLOBAL_CACHE_PAGES = Math.max(OCR_CACHE_PAGES, Number(process.env.OG_PDF_OCR_GLOBAL_CACHE_PAGES || 24));
const LIVE_PDF_SESSIONS = new Set();

const valueBytes = (value) => typeof value === "string" ? Buffer.byteLength(value, "utf8") : Number(value?.byteLength ?? value?.length ?? 0);
function putByteLru(map, key, value, byteLimit, countLimit) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  let bytes = 0;
  for (const item of map.values()) bytes += valueBytes(item);
  while (map.size > 1 && (map.size > countLimit || bytes > byteLimit)) {
    const oldest = map.keys().next().value, removed = map.get(oldest);
    map.delete(oldest); bytes -= valueBytes(removed);
  }
  return value;
}

const boxArea = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const boxOverlap = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

/** 레이아웃 모델이 같은 본문을 title/text/content처럼 겹쳐 돌려주는 경우 한 번만 읽는다. */
export function uniqueOcrRegions(regions) {
  const chosen = [];
  // 포함 관계라면 작은 제목 상자보다 본문 전체 상자를 남겨 글이 통째로 빠지는 일을 막는다.
  for (const region of [...regions].sort((a, b) => boxArea(b.bbox) - boxArea(a.bbox) || b.score - a.score)) {
    const area = boxArea(region.bbox);
    // 검은 카드의 흰 글자는 이 영역만 색을 뒤집어야 읽힌다. 큰 content 상자가 카드를
    // 포함해도 image_text 후보를 중복으로 보아 버리지 않는다.
    const duplicate = chosen.some((old) => {
      if ((old.label === "image_text") !== (region.label === "image_text")) return false;
      return boxOverlap(old.bbox, region.bbox) >= Math.min(boxArea(old.bbox), area) * .82;
    });
    if (!area || duplicate) continue;
    chosen.push(region);
  }
  return chosen;
}

/** 다단 스캔은 위쪽 좌우를 번갈아 읽지 않고 왼쪽 단을 끝까지 읽은 뒤 오른쪽 단으로 간다.
 *  쪽 너비 대부분을 차지하는 제목·구분선은 단 사이의 세로 구간 경계로 취급한다. */
export function orderOcrRegions(boxes, pageWidth) {
  const sorted = [...boxes].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const wide = sorted.filter((b) => b[2] - b[0] >= pageWidth * .78);
  const narrow = sorted.filter((b) => !wide.includes(b));
  const bands = Array.from({ length: wide.length + 1 }, () => []);
  for (const b of narrow) {
    const cy = (b[1] + b[3]) / 2;
    let band = 0;
    while (band < wide.length && cy >= (wide[band][1] + wide[band][3]) / 2) band++;
    bands[band].push(b);
  }
  const orderBand = (items, bandIndex) => {
    const columns = [];
    for (const b of [...items].sort((a, c) => a[0] - c[0] || a[1] - c[1])) {
      let best = null, ratio = 0;
      for (const col of columns) {
        const overlap = Math.max(0, Math.min(col.x1, b[2]) - Math.max(col.x0, b[0]));
        const value = overlap / Math.max(1, Math.min(col.x1 - col.x0, b[2] - b[0]));
        if (value > ratio) { ratio = value; best = col; }
      }
      if (!best || ratio < .3) columns.push({ x0: b[0], x1: b[2], boxes: [b] });
      else { best.boxes.push(b); best.x0 = Math.min(best.x0, b[0]); best.x1 = Math.max(best.x1, b[2]); }
    }
    return columns.sort((a, b) => a.x0 - b.x0).flatMap((col, columnIndex) => col.boxes
      .sort((a, b) => a[1] - b[1] || a[0] - b[0]).map((box, rowIndex) => {
        // PP-Structure가 알려 준 측면/세로 글자는 본문과 별개로 선택한다. 본문도 단마다
        // 범위를 나눠 왼쪽 단을 드래그할 때 오른쪽 단이나 책등 글자가 끼지 않게 한다.
        const aside = box.ocrLabel === "aside_text" || box.ocrLabel === "vertical_text";
        const imageText = box.ocrLabel === "image_text";
        box.ocrScope = imageText ? `image-b${bandIndex}-c${columnIndex}-r${rowIndex}`
          : `${aside ? "aside" : "body"}-b${bandIndex}-c${columnIndex}`;
        return box;
      }));
  };
  const out = [];
  for (let i = 0; i < bands.length; i++) {
    out.push(...orderBand(bands[i], i));
    if (wide[i]) { wide[i].ocrScope = wide[i].ocrLabel === "image_text" ? `image-wide-${i}` : `wide-${i}`; out.push(wide[i]); }
  }
  return out;
}

/** 같은 본문 단에서 잘게 나뉜 OCR 상자를 한 열로 합친다.
 *  1차 검출 뒤 문단마다 모델을 다시 실행하던 비용을 단마다 한 번으로 줄인다.
 *  검은 카드·측면 글자는 본문과 섞이지 않도록 독립 영역으로 유지한다. */
export function compactOcrRegions(boxes, pageWidth) {
  const ordered = orderOcrRegions(boxes, pageWidth), byScope = new Map(), out = [];
  for (const box of ordered) {
    const separate = box.ocrLabel === "image_text" || box.ocrLabel === "aside_text" || box.ocrLabel === "vertical_text";
    const key = separate ? null : box.ocrScope;
    if (!key || !byScope.has(key)) {
      const copy = Object.assign([...box], { ocrLabel: box.ocrLabel, ocrScore: box.ocrScore, ocrScope: box.ocrScope });
      out.push(copy); if (key) byScope.set(key, copy);
      continue;
    }
    const old = byScope.get(key);
    old[0] = Math.min(old[0], box[0]); old[1] = Math.min(old[1], box[1]);
    old[2] = Math.max(old[2], box[2]); old[3] = Math.max(old[3], box[3]);
  }
  return out;
}

// PDF에는 제목이라는 표식이 없으므로, 본문 대표 크기와 문단의 크기·굵기·정렬을 함께 본다.
// 길고 문장부호로 끝나는 일반 문장이나 여러 줄 본문은 크기가 조금 다르다는 이유만으로 제목이 되지 않게 한다.
export function boldFontName(name) {
  const n = String(name || "").replace(/^[A-Z]{6}\+/, "");
  return /bold|black|heavy|semibold|extrabold|굵/i.test(n) || /[a-z](?:B|EB|XB|SB|Bd|Bk)$/.test(n) || /[-_ ](?:B|EB|XB|SB)$/i.test(n);
}

const LABEL_VALUE = /^[^\s:：.!?。][^:：.!?。]{0,18}\s*[:：]\s*\S/;
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
  // "이름표 : 값" 줄(전투 확률 : 없음)은 이름표가 굵어도 제목이 아니다 — 값이 한두 글자면 줄 대부분이 굵은 글자라
  // 제목으로 잡혀, 목록 한가운데 줄의 앞뒤에만 빈 줄이 들어갔다. 글자가 본문보다 뚜렷이 클 때만 제목으로 본다.
  if (LABEL_VALUE.test(text) && ratio < 1.17) return 0;
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

// 목록 항목: 문단 첫머리의 글머리 기호·번호. 문서화 HTML 에 표시(data-og-list)를 달고 기호 글자는 빼면,
// 앱이 편집기에 넣을 때 진짜 글머리표·문단 번호(문단 모양)로 바꾼다.
//  b: 글머리표(mark = 기호), n: 번호(fmt = 한글 번호 모양 "^1." 등, code = 문단 번호 종류 0 숫자·1 원문자·2 I·3 i·4 A·5 a·8 가나다·13 一二三 — 엔진 utils numbering_format_to_number_format 표)
const LIST_BULLET = /^([•●○◦▪■□◆◇▶▷►‣⁃∙❧❖➢✓✔★☆♢♦◈▣◾◽❑➔➡ㅇ\-–])[  ]+(?=\S)/u;
const HANGUL_NUM = "가나다라마바사아자차카타파하";
const HANGUL_JAMO = "ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ";
const HANJA_NUM = "一二三四五六七八九十";
const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii"];
// 엔진이 그릴 수 없는 번호 모양(ㄱ. ㉠ ㉮ ⓐ Ⓐ)은 같은 차례의 A, B, C 로 바꿔 넣는다(번호 뒤 구분 기호는 살리고, 없으면 ".")
const subst = (sep, value, len) => ({ type: "n", key: "nA" + sep, fmt: "^1" + sep, code: 4, value, len, substitute: true });
function listMark(text) {
  let m;
  // OCR 이 흔히 내는 가운뎃점류 기호는 뒤에 공백이 없어도 글머리표("·여기는 …")
  if ((m = text.match(/^([·ㆍ・•])[  ]*(?=[\p{L}\p{N}])/u))) return { type: "b", key: "b•", mark: "•", len: m[0].length };
  if ((m = text.match(LIST_BULLET))) return { type: "b", key: "b" + m[1], mark: m[1], len: m[0].length };
  if ((m = text.match(/^(\d{1,2})([.)])[  ]+(?=\S)/))) return { type: "n", key: "n0" + m[2], fmt: "^1" + m[2], code: 0, value: +m[1], len: m[0].length };
  if ((m = text.match(/^\((\d{1,2})\)[  ]*(?=\S)/))) return { type: "n", key: "n0()", fmt: "(^1)", code: 0, value: +m[1], len: m[0].length };
  if ((m = text.match(/^([⑴-⒇])[  ]*(?=\S)/))) return { type: "n", key: "n0()", fmt: "(^1)", code: 0, value: m[1].codePointAt(0) - 0x2474 + 1, len: m[0].length };   // ⑴ → (1)
  if ((m = text.match(/^([①-⑳])[  ]*(?=\S)/))) return { type: "n", key: "n1", fmt: "^1", code: 1, value: m[1].codePointAt(0) - 0x2460 + 1, len: m[0].length };
  if ((m = text.match(/^([가나다라마바사아자차카타파하])([.)])[  ]+(?=\S)/))) return { type: "n", key: "n8" + m[2], fmt: "^1" + m[2], code: 8, value: HANGUL_NUM.indexOf(m[1]) + 1, len: m[0].length };
  if ((m = text.match(/^([一二三四五六七八九十])([.)])[  ]*(?=\S)/))) return { type: "n", key: "n13" + m[2], fmt: "^1" + m[2], code: 13, value: HANJA_NUM.indexOf(m[1]) + 1, len: m[0].length };
  if ((m = text.match(/^(i{1,3}|iv|vi{0,3}|ix|xi{0,2})([.)])[  ]+(?=\S)/))) return { type: "n", key: "n3" + m[2], fmt: "^1" + m[2], code: 3, value: ROMAN.indexOf(m[1]) + 1, len: m[0].length };
  if ((m = text.match(/^(I{1,3}|IV|VI{0,3}|IX|XI{0,2})([.)])[  ]+(?=\S)/))) return { type: "n", key: "n2" + m[2], fmt: "^1" + m[2], code: 2, value: ROMAN.indexOf(m[1].toLowerCase()) + 1, len: m[0].length };
  if ((m = text.match(/^([a-h])([.)])[  ]+(?=\S)/))) return { type: "n", key: "n5" + m[2], fmt: "^1" + m[2], code: 5, value: m[1].charCodeAt(0) - 96, len: m[0].length };
  if ((m = text.match(/^([A-H])([.)])[  ]+(?=\S)/))) return { type: "n", key: "n4" + m[2], fmt: "^1" + m[2], code: 4, value: m[1].charCodeAt(0) - 64, len: m[0].length };
  // 대체 번호(A, B, C)
  if ((m = text.match(/^([ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ])([.)])[  ]+(?=\S)/))) return subst(m[2], HANGUL_JAMO.indexOf(m[1]) + 1, m[0].length);
  if ((m = text.match(/^([㉠-㉭])[  ]*(?=\S)/))) return subst(".", m[1].codePointAt(0) - 0x3260 + 1, m[0].length);   // ㉠ ㉡
  if ((m = text.match(/^([㉮-㉻])[  ]*(?=\S)/))) return subst(".", m[1].codePointAt(0) - 0x326e + 1, m[0].length);   // ㉮ ㉯
  if ((m = text.match(/^([ⓐ-ⓩ])[  ]*(?=\S)/))) return subst(".", m[1].codePointAt(0) - 0x24d0 + 1, m[0].length);   // ⓐ ⓑ
  if ((m = text.match(/^([Ⓐ-Ⓩ])[  ]*(?=\S)/))) return subst(".", m[1].codePointAt(0) - 0x24b6 + 1, m[0].length);   // Ⓐ Ⓑ
  return null;
}

export class PdfSession {
  constructor(bytes, name) {
    this.bytes = bytes; this.name = name;
    this.state = { text: false, ready: false, error: null, t0: Date.now() };
    this.pageJpeg = new Map();   // 쪽 번호 → JPEG
    this.textLayerCache = new Map(); // 실제로 본 쪽 번호 → 투명 글자층 HTML
    this.ocrHtml = new Map();    // 쪽 번호 → 그림 속 글자(OCR) 층(Promise)
    this.ocrParas = new Map();   // 쪽 번호 → OCR 로 읽은 문단 [{ text, page, y(pt) }] (문서화용)
    this.ocrDebug = new Map();   // 사용자가 요청할 때 복사하는 현재 쪽 OCR 단 판정 기록
    this.ocrCacheMeta = new Map(); // 쪽 번호 → {bytes,last}; OCR 관련 네 캐시를 함께 제한한다
    this.ocrSeq = 0;
    this.ocrGeneration = 0;      // 언어 변경 전에 시작한 인식 결과가 뒤늦게 섞이지 않게 구분
    this.ocrLangDir = null;      // 서버가 정해 준다(models/ocr)
    this.ocrLanguages = ["kor", "eng"];
    this._layoutPrefetchEpoch = 0;
    this._layoutPrefetchTimer = null;
    this._priorityLayout = 0;
  }

  /** 여는 즉시 할 일: 글자와 이미지 위치(실제 그림 데이터는 문서화에서 요청할 때만) */
  async open() {
    const lib = await getLibrary();
    this.doc = await lib.loadDocument(new Uint8Array(this.bytes));      // 쪽 그림·이미지·글꼴용으로 열어 둔다
    // 창을 바로 띄울 수 있게 쪽 크기만 먼저 알아 둔다(글자 추출은 prepareConversion 에서 뒤에서)
    this.pageSizes = [];
    for (let i = 0; i < this.doc.getPageCount(); i++) {
      this.pageSizes.push(withPage(this.doc, i, (pg) => ({ w: pg.module._FPDF_GetPageWidth(pg.pageIdx), h: pg.module._FPDF_GetPageHeight(pg.pageIdx) })));
    }
    return this;
  }

  meta() {
    return { name: this.name, pages: this.pageSizes, ...this.state };
  }

  /** 현재 쪽의 다단 판정 진단. 사용자가 명시적으로 복사할 때만 반환한다. */
  async layoutLog(n) {
    if (!this.state.ready || !Number.isInteger(n) || n < 0 || n >= this.pageSizes.length) return null;
    if (this.ocrAreas(n).length) {
      // 평소 OCR에서는 큰 상세 진단 배열을 만들지 않는다. 사용자가 벌레 로그를 요청한 현재 쪽만
      // 같은 OCR을 진단 모드로 다시 실행해 선택·단 판정 자료를 완전하게 만든다.
      if (!this.ocrDebug.has(n)) {
        if (this.ocrHtml.has(n)) await this.ocrHtml.get(n);         // 진행 중인 일반 OCR과 겹쳐 모델을 두 번 돌리지 않는다
        this.dropOcrCache(n);
      }
      await this.ocrPage(n, { diagnostic: true });
    }
    const pageLines = (this.res?.lines || []).map((l, i) => ({ l, i })).filter(({ l }) => l.page === n);
    const lineInfo = ({ l, i }) => {
      const gs = [...(l.glyphs || [])].sort((a, b) => a.x0 - b.x0);
      const gaps = gs.slice(1).map((g, k) => ({ x: +((gs[k].x1 + g.x0) / 2).toFixed(2), width: +(g.x0 - gs[k].x1).toFixed(2) })).filter((g) => g.width > l.size).sort((a, b) => b.width - a.width).slice(0, 4);
      return { i, text: String(l.text || "").slice(0, 100), x0: +l.x0.toFixed(2), x1: +l.x1.toFixed(2), y: +l.oy.toFixed(2), size: +l.size.toFixed(2), group: l.group, panel: l.panel, gaps };
    };
    const paragraphs = (this.res?.paragraphs || []).map((p, i) => ({ p, i })).filter(({ p }) => (p.lines || []).some((li) => this.res.lines[li]?.page === n)).map(({ p, i }) => ({
      i, text: String(p.text || "").slice(0, 160), lines: (p.lines || []).filter((li) => this.res.lines[li]?.page === n), columnBox: p.layout?.columnBox,
    }));
    return {
      kind: "ogolgye-pdf-layout-log", version: 1, createdAt: new Date().toISOString(), file: this.name, page: n + 1,
      pageSize: this.pageSizes[n], embeddedText: { lineCount: pageLines.length,
        inferredGutters: findGutters(pageLines.map(({ l }) => ({ oy: l.oy, size: l.size, gs: l.glyphs || [] })), this.pageSizes[n].w, this.pageSizes[n].h),
        lines: pageLines.map(lineInfo), paragraphs },
      ocr: { eligible: this.ocrAreas(n).length > 0, areas: this.ocrAreas(n), ...(this.ocrDebug.get(n) || {}), finalParagraphs: (this.ocrParas.get(n) || []).map((p) => ({ text: String(p.text || "").slice(0, 160), x: p.x, y: p.y })) },
    };
  }

  /** 같은 배열을 쪽별로 반복 검색하는 문서화 경로용 인덱스. 원본 배열을 바꾸지 않고 참조만 묶는다. */
  byPage(items) {
    if (!Array.isArray(items) || !items.length) return new Map();
    this._pageGroups ||= new WeakMap();
    let grouped = this._pageGroups.get(items);
    if (grouped) return grouped;
    grouped = new Map();
    for (const item of items) {
      const page = item?.page;
      if (!Number.isInteger(page)) continue;
      let list = grouped.get(page);
      if (!list) grouped.set(page, list = []);
      list.push(item);
    }
    this._pageGroups.set(items, grouped);
    return grouped;
  }

  /** 한 문단이 여러 쪽에 걸칠 수 있으므로 각 쪽에 실제 줄이 있는 문단만 한 번 계산한다. */
  paragraphsOnPage(page) {
    const source = this.res?.paragraphs;
    if (this._pageParagraphSource !== source) {
      const sets = new Map();
      const indexes = new WeakMap();
      for (let paragraphIndex = 0; paragraphIndex < (source || []).length; paragraphIndex++) {
        const para = source[paragraphIndex]; indexes.set(para, paragraphIndex);
        const pages = new Set((para.lines || []).map((i) => this.res.lines[i]?.page).filter(Number.isInteger));
        for (const n of pages) {
          let list = sets.get(n);
          if (!list) sets.set(n, list = []);
          list.push(para);
        }
      }
      this._pageParagraphSource = source;
      this._pageParagraphs = sets;
      this._paragraphIndexes = indexes;
    }
    return this._pageParagraphs?.get(page) || [];
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
    const indexes = new Set();
    for (const page of selected) for (const para of this.paragraphsOnPage(page)) {
      const paragraphIndex = this._paragraphIndexes?.get(para);
      if (paragraphIndex !== undefined) indexes.add(paragraphIndex);
    }
    for (const paragraphIndex of [...indexes].sort((a, b) => a - b)) {
      const para = this.res.paragraphs[paragraphIndex];
      let part = "", previousLine = null, first = null;
      const flush = () => { if (part) pieces.push({ text: part, paragraphIndex, page: first.page, y: first.oy, toc: TOC_LINE.test(part), center: !!para.center, lastLine: previousLine }); part = ""; previousLine = null; first = null; };
      for (const lineIndex of para.lines) {
        const line = this.res.lines[lineIndex];
        if (!selected.has(line.page)) { flush(); continue; }
        first ||= line;
        if (previousLine !== null) part = joinText(part, previousLine);
        part += line.text;
        previousLine = lineIndex;
      }
      flush();
    }
    return pieces;
  }

  /** 사진·스캔 쪽인가: PDF 글자 데이터가 하나도 없고 글자를 담을 만한 그림이 있는 쪽 */
  isScanPage(n) {
    const page = this.input?.pages[n];
    if (!page || !this.ocrAreas(n).length) return false;
    const nativeChars = [...(this.byPage(this.res.lines).get(n) || []), ...(this.byPage(this.res.furniture).get(n) || [])]
      .reduce((sum, line) => sum + (line.glyphs || []).filter((g) => !/\s/u.test(g.c || "")).length, 0);
    // 스캔 PDF에도 쪽 번호나 잘못 만들어진 짧은 검색 글자층이 들어 있을 수 있다.
    // 그림들이 함께 지면을 거의 다(90% 이상) 덮고 실제 PDF 글자가 조금뿐이면 스캔으로 읽는다(여러 조각으로 저장된 스캔 포함).
    // 배경 그림(여러 쪽에 되풀이되는 종이 질감·머리 띠)은 세지 않고, 겹친 곳은 한 번만 센다(4pt 격자로 잰다):
    // 예전에는 배경 질감과 삽화들의 넓이를 겹친 것까지 모두 더해, 쪽 번호만 있는 삽화 쪽(테스트1 7쪽: 질감 배경 + 삽화 3장,
    // 실제로 덮은 곳 79%)이 스캔 쪽이 되어 삽화가 문서에서 빠지고 그림 속 글자 OCR 결과가 대신 들어갔다.
    if (nativeChars === 0) return true;
    if (nativeChars > 48) return false;
    // 이 규칙은 스캔 PDF(대부분의 쪽이 지면을 덮는 그림 + 쪽 번호 정도의 글자)에서만 쓴다. 일반 문서의 전면 삽화 쪽
    // (그림이 지면을 덮고 설명 글이 조금 — 여름빛 클리셰 65쪽 등 150쪽 중 4쪽)까지 스캔 쪽으로 보아 삽화가 문서에서 빠졌다.
    if (!this.scanLikeDocument()) return false;
    return this.rasterCovers(n);
  }

  /** 쪽 n 을 배경이 아닌 그림들이 함께 90% 이상 덮는가 */
  rasterCovers(n) {
    const page = this.input?.pages[n]; if (!page) return false;
    const background = new Set((this.res.figures || []).filter((f) => f.page === n && f.kind === "background").map((f) => f.id));
    const boxes = (page.images || []).filter((im) => !background.has(im.id)).map((im) => im.bbox || [0, 0, 0, 0]);
    if (!boxes.length) return false;
    let hit = 0, total = 0;
    for (let y = 2; y < page.height; y += 4) for (let x = 2; x < page.width; x += 4) {
      total++;
      if (boxes.some((b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3])) hit++;
    }
    return hit >= total * .9;
  }

  /** 스캔 PDF 인가: 쪽의 절반 이상이 "PDF 글자가 쪽 번호 정도(48자 이하)뿐이고 그림이 지면을 덮는" 쪽 */
  scanLikeDocument() {
    if (this._scanLikeDoc !== undefined) return this._scanLikeDoc;
    const pages = this.input?.pages || [];
    let scans = 0;
    pages.forEach((page, n) => {
      const chars = [...(this.byPage(this.res.lines).get(n) || []), ...(this.byPage(this.res.furniture).get(n) || [])]
        .reduce((sum, line) => sum + (line.glyphs || []).filter((g) => !/\s/u.test(g.c || "")).length, 0);
      if (chars <= 48 && this.rasterCovers(n)) scans++;
    });
    this._scanLikeDoc = pages.length > 0 && scans >= pages.length * .5;
    return this._scanLikeDoc;
  }

  /** 스캔 쪽 자체인 그림(쪽 대부분을 덮는 그림) — 그 글은 OCR 로 옮기므로 그림으로는 다시 넣지 않는다 */
  isScanImage(f) {
    const page = this.input.pages[f.page], area = (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]);
    return !!page && area > page.width * page.height * 0.5 && this.isScanPage(f.page);
  }

  /** 글자 조각 사이에 OCR 로 읽은 문단을 쪽별 위에서 아래 순서로 끼워 넣는다.
   *  문서화에는 사진·스캔 쪽(글자 데이터가 없는 쪽)의 OCR 글자만 넣는다. 글자가 있는 쪽의 사진 속 글자는
   *  문서에 옮기지 않는다(화면에서 드래그·복사만). 아직 읽지 않은 쪽은 여기서 읽는다. */
  async contentPartsWithOcr(pageIndexes, { scanTables = false, rubyMode = "position" } = {}) {
    const parts = this.contentParts(pageIndexes);
    if (!parts || !this.ocrReady()) return parts;
    const pages = [...new Set(pageIndexes)].sort((a, b) => a - b);
    const queue = new Map();                                   // 쪽 → 아직 넣지 않은 OCR 문단(위에서 아래)
    const useTables = scanTables && this.ppDir && ppModelsInstalled(this.ppDir);
    const scanPages = pages.filter((n) => this.isScanPage(n));
    let scanDone = 0;
    if (scanPages.length) this.state.progress = { phase: "그림 글자 읽기", done: 0, total: scanPages.length };
    try {
      // 먼저 고른 스캔 쪽을 모두 읽는다 — 쪽마다 같은 자리에 되풀이되는 머리말·꼬리말을 가리려면 다른 쪽 결과가 있어야 한다
      for (const n of scanPages) {
        await this.ocrPage(n);
        scanDone++;
        this.state.progress = { phase: "그림 글자 읽기", done: scanDone, total: scanPages.length };
      }
      for (const n of pages) {
        if (!this.isScanPage(n)) { queue.set(n, []); continue; }
        await this.ocrPage(n);
        let q = this.dropRepeatedOcr(n, this.ocrParas.get(n) || []).map((p) => {
          if (!p.ruby?.length) return p;
          const rendered = renderJapaneseRuby(p.text, p.ruby, rubyMode);
          return { ...p, text: rendered.text, richHtml: rendered.html };
        });
        // 스캔본 표 인식(PP-Structure): 표 영역의 OCR 문단을 빼고 그 자리에 표를 넣는다
        if (useTables) {
          const tables = await this.scanTables(n).catch(() => []);
          const inside = (p, b) => p.x >= b[0] && p.x <= b[2] && p.y >= b[1] - 2 && p.y <= b[3];
          q = q.filter((p) => !tables.some((t) => inside(p, t.bbox)));
          for (const t of tables) q.push({ text: t.text, html: t.html, page: n, y: t.bbox[1], x0: t.bbox[0], x1: t.bbox[2], y1: t.bbox[3] });
        }
        queue.set(n, await this.orderOcrParas(q));
      }
    } finally {
      if (scanPages.length) this.state.progress = null;
    }
    const out = [];
    let lastIndex = -1;                                       // 그림 자리(beforeParagraph)는 앞선 글 문단 번호를 따른다
    const put = (p) => out.push({ text: p.text, html: p.html, richHtml: p.richHtml, paragraphIndex: lastIndex, page: p.page, y: p.y, ocr: true, blankBefore: p.blankBefore || 0, listItem: !!p.listItem });
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

  /** 문서화 내용: 일반 텍스트와 HTML. 복원 전이면 null
   *  includeImages: 오브젝트(내용) 그림을 넣는다. 문서 전체에 깔린 배경 그림은 넣지 않는다.
   *  keepTables: 선으로 그은 표를 표 모양(칸 너비·높이, 합친 칸) 그대로 넣는다. 끄면 칸 글을 문단으로 푼다.
   *  keepBlankLines: PDF 에서 문단 사이가 한 줄 이상 비어 있던 곳에 빈 문단을 넣는다. */
  async content(pageIndexes, { includeImages = false, keepTables = false, keepBlankLines = false, scanTables = false, rubyMode = "position" } = {}) {
    const pages = [...new Set(pageIndexes)].sort((a, b) => a - b);
    // 레이아웃 분석: 레이아웃 모델이 머리말·꼬리말(쪽 번호·장식 띠 포함)로 본 영역의 글과 그림은 옮기지 않는다
    const aiFurniture = [];
    if (scanTables && this.ppDir && ppModelsInstalled(this.ppDir)) {
      await this.layoutPages(pages);                               // 두 쪽씩 동시에, 진행 표시와 함께(이미 읽은 쪽은 건너뜀)
      for (const n of pages) aiFurniture.push(...await this.pageFurniture(n).catch(() => []));
    }
    // 단, 본문보다 큰 글자(1.15배 이상)는 머리말 영역에 들었어도 그대로 둔다: 레이아웃 모델은 쪽 맨 위의 장 제목("개요" 등)도
    // 머리말로 분류하곤 해서 제목이 통째로 사라졌다. 쪽마다 되풀이되는 머리말은 본문보다 작거나 같은 크기이고,
    // 큰 글자 머리말은 되풀이 검사(isFurniture)가 이미 걸러 낸다.
    const bodySize = this.res.stats?.bodySize || 10;
    const titleSized = (p) => !p.ocr && (Number(this.res.paragraphs[p.paragraphIndex]?.layout?.fontSize) || 0) >= bodySize * 1.15;
    const parts = (await this.contentPartsWithOcr(pageIndexes, { scanTables, rubyMode }))?.filter((p) => {
      const cut = aiFurniture.length && !titleSized(p) ? this.linesOutsideTables(p, [], aiFurniture) : null;
      if (cut) p.text = cut.text;
      return !cut || cut.text;
    });
    if (!parts) return null;
    for (const p of parts) p.heading = this.partIsHeading(p);
    const text = parts.map((p, i) => (i > 0 && p.heading && !parts[i - 1].heading ? "\n" : "") + p.text).join("\n");
    // AI 표 인식(선 없는 표 등, 글자 정보가 있는 쪽): "표 모양 살리기"와 "레이아웃 분석"이 모두 켜졌을 때
    const aiTables = [];
    if (keepTables) {
      // 이름-값 표(어두운 이름 칸 + 값, 규칙) — 레이아웃 분석이 같은 자리를 표로 찾았으면 이름-값 표를 쓴다
      const area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
      const inter = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
      for (const n of pages) {
        const labels = this.labelTables(n);
        const ai = scanTables ? await this.pdfTables(n).catch(() => []) : [];
        aiTables.push(...labels, ...ai.filter((t) => !labels.some((l) => inter(l.bbox, t.bbox) > 0.3 * Math.min(area(l.bbox), area(t.bbox)))));
      }
    }
    return { text, html: this.contentHtml(parts, pageIndexes, { includeImages, keepTables, keepBlankLines, aiTables, aiFurniture }) };
  }

  /** 쪽 n 의 이름-값 표: 같은 크기의 어두운 채운 상자(이름 칸, 흰 글자)가 행·열을 맞춰 2행 이상 붙어 있고,
   *  각 상자 오른쪽(다음 이름 칸까지)에 값 글이 있는 표(테스트4 "타입 | 특수형 · 인원, 리미트 | 3인 4사이클…").
   *  선이 없어 선 표 규칙에 안 잡히고 한 줄 글("타입 특수형 인원, 리미트 …")로 읽혔다. AI 없이 규칙으로 찾는다.
   *  반환 [{ html, text, bbox, page }] (AI 표와 같은 모양: 영역 안 줄은 빼고 표를 처음 걸친 자리에 넣는다) */
  labelTables(n) {
    const page = this.input.pages[n];
    if (!page) return [];
    const lum = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
    const hex = (c) => "#" + c.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const ink = page.glyphs.filter((g) => !/\s/.test(g.c));
    const inBox = (g, b) => { const x = (g.x0 + g.x1) / 2, y = (g.y0 + g.y1) / 2; return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]; };
    const ruled = (page._tables || []).map((t) => t.bbox).filter(Boolean);
    const boxes = (page.paths || []).filter((p) => p.fill && p.fill[3] > 0 && lum(p.fill) < 90).map((p) => ({ b: p.bbox, fill: p.fill }))
      .filter(({ b }) => b[2] - b[0] >= 20 && b[2] - b[0] <= 220 && b[3] - b[1] >= 8 && b[3] - b[1] <= 60)
      .filter(({ b }) => !ruled.some((r) => b[0] >= r[0] - 1 && b[2] <= r[2] + 1 && b[1] >= r[1] - 1 && b[3] <= r[3] + 1))
      .filter(({ b }) => ink.some((g) => inBox(g, b)));
    const near = (a, c) => Math.abs(a - c) <= 2;
    // 행: 위아래 끝이 같은 상자들
    const rows = [];
    for (const x of boxes.sort((a, c) => a.b[1] - c.b[1] || a.b[0] - c.b[0])) {
      const r = rows.find((q) => near(q.y0, x.b[1]) && near(q.y1, x.b[3]));
      if (r) r.cells.push(x); else rows.push({ y0: x.b[1], y1: x.b[3], cells: [x] });
    }
    for (const r of rows) r.cells.sort((a, c) => a.b[0] - c.b[0]);
    // 같은 열 배치(왼쪽 끝이 같음)로 위아래가 붙은(틈 6pt 이하) 행들을 한 표로
    const sameCols = (a, c) => a.cells.length === c.cells.length && a.cells.every((x, k) => near(x.b[0], c.cells[k].b[0]) && near(x.b[2], c.cells[k].b[2]));
    const groups = [];
    for (const r of rows) {
      const g = groups.at(-1);
      if (g && sameCols(g.at(-1), r) && r.y0 - g.at(-1).y1 <= 6) g.push(r); else groups.push([r]);
    }
    const out = [];
    for (const g of groups.filter((q) => q.length >= 2)) {
      const labels = g[0].cells.map((x) => x.b);
      const y0 = g[0].y0, y1 = g.at(-1).y1;
      // 값 칸: 이름 칸 오른쪽 끝 ~ 다음 이름 칸 왼쪽. 마지막 열은 그 행들 글자의 오른쪽 끝까지
      const tail = ink.filter((g2) => (g2.y0 + g2.y1) / 2 > y0 && (g2.y0 + g2.y1) / 2 < y1 && g2.x0 >= labels.at(-1)[2]);
      const lastRight = tail.length ? Math.max(...tail.map((q) => q.x1)) + 6 : labels.at(-1)[2] + 60;
      const valueX = labels.map((b, k) => [b[2], k + 1 < labels.length ? labels[k + 1][0] : lastRight]);
      const textIn = (x0, x1, ry0, ry1) => {
        const gs = ink.filter((q) => { const cx = (q.x0 + q.x1) / 2, cy = (q.y0 + q.y1) / 2; return cx >= x0 && cx <= x1 && cy >= ry0 && cy <= ry1; })
          .sort((a, c) => a.oy - c.oy || a.x0 - c.x0);
        let t = "", prev = null;
        for (const q of gs) {
          if (prev) { const sameLine = Math.abs(q.oy - prev.oy) < q.size * 0.5; if (!sameLine || q.x0 - prev.x1 > q.size * 0.2) t += " "; }
          t += q.c; prev = q;
        }
        return { t: t.trim(), color: gs.length ? hex(gs[0].color || [0, 0, 0]) : "#000000", bold: gs.filter((q) => (q.weight || 400) >= 600 || boldFontName(q.font)).length * 2 > gs.length };
      };
      let html = `<table${this.fitsColumn(n, [labels[0][0], y0, lastRight, y1]) ? ' data-og-fit="1"' : ""} style="border-collapse:collapse">`, text = [];
      for (const r of g) {
        html += "<tr>";
        r.cells.forEach((x, k) => {
          const lab = textIn(x.b[0], x.b[2], r.y0, r.y1), val = textIn(valueX[k][0], valueX[k][1], r.y0, r.y1);
          const h = (r.y1 - r.y0).toFixed(1);
          const labCss = `color:${lab.color};` + (lab.bold ? "font-weight:bold;" : "");
          html += `<td style="width:${(x.b[2] - x.b[0]).toFixed(1)}pt;height:${h}pt;border:none;background-color:${hex(x.fill)};padding:1.4pt 2.8pt;vertical-align:middle"><p style="text-align:center"><span style="${labCss}">${esc(lab.t)}</span></p></td>`;
          html += `<td style="width:${(valueX[k][1] - valueX[k][0]).toFixed(1)}pt;height:${h}pt;border:none;padding:1.4pt 8pt;vertical-align:middle"><p style="text-align:left">${esc(val.t)}</p></td>`;
          text.push(lab.t, val.t);
        });
        html += "</tr>";
      }
      html += "</table>";
      out.push({ html, text: text.filter(Boolean).join("\t"), bbox: [labels[0][0], y0, lastRight, y1], page: n });
    }
    return out;
  }

  /** 쪽 n 의 레이아웃(PP-DocLayoutV3) 전체. 한 번 읽은 쪽은 기억한다 */
  pageLayout(n) {
    this.layoutCache ||= new Map();
    if (!this.layoutCache.has(n)) {
      const disk = this.layoutDisk();
      if (disk?.[n]) this.layoutCache.set(n, Promise.resolve(disk[n]));
      else {
        const size = this.pageSizes[n];
        const p = withPage(this.doc, n, (page) => detectLayout(this.ppDir, page, [0, 0, size.w, size.h]));
        // 실패(모델 프로세스가 중간에 끝남 등)는 기억하지 않는다 — 다음에 다시 읽는다
        p.then((boxes) => this.saveLayout(n, boxes), () => { if (this.layoutCache.get(n) === p) this.layoutCache.delete(n); });
        this.layoutCache.set(n, p);
      }
    }
    return this.layoutCache.get(n);
  }

  /** AI 레이아웃 결과를 파일별로 디스크에 둔다(layoutStore: 서버가 정한 경로, 파일 해시·모델별).
   *  같은 PDF 를 다시 열면 모델을 다시 돌리지 않는다(96쪽 약 2분 → 바로). */
  layoutDisk() {
    if (this._layoutDisk !== undefined) return this._layoutDisk;
    this._layoutDisk = null;
    if (this.layoutStore) { try { this._layoutDisk = JSON.parse(fs.readFileSync(this.layoutStore, "utf8")); } catch { this._layoutDisk = {}; } }
    return this._layoutDisk;
  }
  saveLayout(n, boxes) {
    const disk = this.layoutDisk();
    if (!disk || !this.layoutStore) return;
    disk[n] = boxes;
    clearTimeout(this._layoutSaveTimer);
    this._layoutSaveTimer = setTimeout(() => {
      try { fs.mkdirSync(path.dirname(this.layoutStore), { recursive: true }); fs.writeFileSync(this.layoutStore, JSON.stringify(disk)); } catch { /* 저장 못 해도 다음에 다시 계산 */ }
    }, 1500);
  }

  /** 여러 쪽의 AI 레이아웃을 한꺼번에(동시에 concurrency 쪽씩). 문서화(앞)와 미리 읽기(뒤)가 같은 기억을 쓴다.
   *  front: 문서화 진행 표시(state.progress)를 갱신한다. 뒤에서 미리 읽을 때는 state.aiPrefetch 만. */
  async layoutPages(pages, { concurrency = 2, front = true, urgent = false, prefetchEpoch = null } = {}) {
    if (!this.ppDir || !ppModelsInstalled(this.ppDir)) return;
    this.layoutCache ||= new Map();
    const total = pages.length;
    const isDone = (n) => this.layoutCache.has(n) || this.layoutDisk()?.[n];
    let done = pages.filter(isDone).length, k = 0;
    const todo = pages.filter((n) => !isDone(n));
    const valid = () => !this.closed && (prefetchEpoch === null || prefetchEpoch === this._layoutPrefetchEpoch);
    const show = () => { if (front) this.state.progress = { phase: "레이아웃 분석", done, total }; else if (!urgent) this.state.aiPrefetch = { done, total }; };
    show();
    const priority = front || urgent;
    if (priority) this._priorityLayout++;                         // 보이는 쪽·문서화가 도는 동안 전체 미리 읽기는 비켜선다
    const worker = async () => {
      while (k < todo.length && valid() && (priority || !this._priorityLayout)) {
        const n = todo[k++];
        await this.pageLayout(n).catch(() => {});
        done++; show();
      }
    };
    try { await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, todo.length)) }, worker)); }
    finally { if (priority) this._priorityLayout--; }
    if (!priority && k < todo.length && valid()) {                 // 비켜섰던 미리 읽기: 앞 작업이 끝나면 남은 쪽을 이어서
      const wait = () => new Promise((r) => setTimeout(r, 1000));
      while (this._priorityLayout && valid()) await wait();
      if (valid()) return this.layoutPages(pages, { concurrency, front, urgent, prefetchEpoch });
    }
    // 앞에서 기다리는 동안 뒤에서 이미 돌던 쪽(같은 약속)도 끝까지 기다린다
    await Promise.all(pages.map((n) => this.layoutCache.get(n)).filter(Boolean)).catch(() => {});
    if (front) this.state.progress = null; else if (!urgent && valid()) this.state.aiPrefetch = { done: total, total };
  }

  /** 전체 쪽 분석은 화면이 뜬 뒤 유휴 시간에 시작한다. 새 예약·닫기는 이전 예약을 무효화한다. */
  scheduleLayoutPrefetch(delay = 1800) {
    this.cancelLayoutPrefetch();
    if (this.closed || !this.ppDir || !ppModelsInstalled(this.ppDir)) return;
    const epoch = this._layoutPrefetchEpoch;
    this._layoutPrefetchTimer = setTimeout(() => {
      this._layoutPrefetchTimer = null;
      const pages = this.pageSizes.map((_, i) => i);
      this.layoutPages(pages, { concurrency: 1, front: false, prefetchEpoch: epoch }).catch(() => {});
    }, Math.max(0, delay));
    this._layoutPrefetchTimer.unref?.();
  }

  cancelLayoutPrefetch() {
    this._layoutPrefetchEpoch++;
    clearTimeout(this._layoutPrefetchTimer);
    this._layoutPrefetchTimer = null;
    this.state.aiPrefetch = null;
  }

  /** 화면에 요청된 쪽과 이웃 쪽을 전체 미리 읽기보다 먼저 분석한다. */
  prioritizeLayoutPage(n) {
    if (!this.autoLayout || this.closed || !Number.isInteger(n)) return;
    const pages = [n, n - 1, n + 1].filter((p) => p >= 0 && p < this.pageSizes.length);
    this.layoutPages(pages, { concurrency: 1, front: false, urgent: true }).catch(() => {});
  }

  /** 쪽 n 의 머리말·꼬리말 영역 [{ bbox, page, label }]. 쪽 위·아래 가장자리(각 20%) 안에 든 상자만 믿는다
   *  (본문 가운데를 머리말로 잘못 본 상자 때문에 본문이 사라지지 않도록) */
  async pageFurniture(n) {
    const h = this.pageSizes[n].h;
    return (await this.pageLayout(n))
      .filter((b) => FURNITURE_LABELS.has(b.label) && b.score >= 0.45 && (b.bbox[3] <= h * 0.2 || b.bbox[1] >= h * 0.8))
      .map((b) => ({ bbox: b.bbox, page: n, label: b.label }));
  }

  /** 그림이 머리말·꼬리말 영역에 드는가(그림 넓이의 60% 이상이 영역 안) */
  inFurniture(f, boxes) {
    const area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
    const inter = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    return (this.byPage(boxes).get(f.page) || []).some((b) => inter(b.bbox, f.bbox) >= 0.6 * area(f.bbox));
  }

  /** 글자 정보가 있는 쪽 n 에서 선 없는 표 등(선으로 그은 표 말고)을 AI 모델로 찾아 HTML 표로. 칸 글자는 PDF 글자 그대로.
   *  넓은 칸 간격이 있는 줄이 3줄 이상인 쪽만 모델에 넣는다(모델은 쪽당 수백 ms~수 초). 한 번 읽은 쪽은 기억한다.
   *  반환 [{ html, text, bbox, page }] */
  pdfTables(n) {
    this.pdfTableCache ||= new Map();
    if (!this.pdfTableCache.has(n)) this.pdfTableCache.set(n, (async () => {
      if (!this.ppDir || !ppModelsInstalled(this.ppDir) || this.isScanPage(n)) return [];
      const lines = this.byPage(this.res.lines).get(n) || [];
      if (lines.filter((l) => (l.gaps || []).some((g) => g.gap > l.size * 1.5)).length < 3) return [];
      return withPage(this.doc, n, async (page) => {
        const size = this.pageSizes[n];
        const area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
        const inter = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
        const ruled = (this.input.pages[n]?._tables || []).map((t) => t.bbox);
        const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
        const out = [];
        for (const t of tablesOf(await this.pageLayout(n))) {
          if (ruled.some((b) => inter(b, t.bbox) > 0.5 * Math.min(area(b), area(t.bbox)))) continue;   // 선으로 그은 표는 규칙으로
          const inside = (g) => { const x = (g.x0 + g.x1) / 2, y = (g.y0 + g.y1) / 2; return x >= t.bbox[0] && x <= t.bbox[2] && y >= t.bbox[1] && y <= t.bbox[3]; };
          // 띄어쓰기: 문단 복원이 판정한 줄 글(l.text)에서 띄어 쓴 자리 바로 앞 글자에 sp 를 단다
          // (공백 글자 없이 간격으로만 띄운 PDF 는 글자 상자 사이가 거의 붙어 있어 간격만으로는 낱말을 가를 수 없다)
          const withSpaces = (l) => {
            const gs = l.glyphs, sp = new Set();
            let gi = 0;
            for (const ch of l.text) {
              if (/\s/.test(ch)) { if (gi > 0) sp.add(gi - 1); if (gs[gi] && /\s/.test(gs[gi].c)) gi++; }
              else { while (gs[gi] && /\s/.test(gs[gi].c)) gi++; gi++; }
            }
            return gs.map((g, i) => ({ g, sp: sp.has(i) }));
          };
          const glyphs = lines.flatMap((l, li) => withSpaces(l).filter(({ g }) => inside(g)).map(({ g, sp }) => ({ c: g.c, size: g.size, x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1, line: li, sp })));
          if (glyphs.filter((g) => !/\s/.test(g.c)).length < 6) continue;
          // 테두리 상자에 든 문장을 표로 오인한 것 거르기: 영역 안 줄 가운데 넓은 칸 간격이 있는 줄이 30% 미만이면 표가 아니다
          // (한두 줄 문장이 7칸으로 쪼개졌다 — synam-001 30쪽 동의 문구 상자)
          const regionLines = lines.filter((l) => { const gs = l.glyphs.filter((g) => !/\s/.test(g.c)); return gs.length && gs.filter(inside).length * 2 > gs.length; });
          const wideLines = regionLines.filter((l) => (l.gaps || []).some((g) => g.gap > l.size * 1.5)).length;
          if (!regionLines.length || wideLines < regionLines.length * 0.3) continue;
          // 칸 색은 쪽의 그림(종이 질감 등 배경)을 숨기고 잰다 — 그대로 재면 배경 질감 색이 모든 칸에 들어갔다
          const cellColor = (c) => withOnlyImages(page, [], () => regionAverageColor(page, [c[0] + 1, c[1] + 1, c[2] - 1, c[3] - 1]), { keepText: true });
          const table = await pdfTableHtml(this.ppDir, page, t.bbox, { glyphs, esc, cellColor, fit: this.fitsColumn(n, t.bbox) }).catch(() => null);
          if (!table) continue;
          // 2행 2열이 안 되는 것(글상자 한 칸 등)은 표로 넣지 않는다
          const rows = (table.html.match(/<tr>/g) || []).length, cols = Math.max(0, ...(table.html.match(/<tr>[\s\S]*?<\/tr>/g) || []).map((r) => (r.match(/<td/g) || []).length));
          if (rows < 2 || cols < 2) continue;
          out.push({ ...table, page: n });
        }
        return out;
      });
    })());
    return this.pdfTableCache.get(n);
  }

  /** 스캔 쪽 n 의 표들(PP-Structure 레이아웃 → 표 구조 → 칸 글자는 쪽 OCR 낱말을 나눠 담음). ocrPage(n) 뒤에 부른다.
   *  한 번 읽은 쪽은 기억한다.
   *  반환 [{ html, text, bbox }] */
  scanTables(n) {
    this.scanTableCache ||= new Map();
    if (!this.scanTableCache.has(n)) this.scanTableCache.set(n, withPage(this.doc, n, async (page) => {
      const size = this.pageSizes[n];
      const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
      const out = [];
      for (const t of tablesOf(await this.pageLayout(n))) {
        // 쪽 OCR 이 놓친 빈 칸만 따로 읽는다: 칸은 반듯하므로 0°로 한 번, 어두운 바탕이면 색을 뒤집어, 짧은 글도 버리지 않게
        const readCell = async (c) => {
          const r = await ocrRegion(page, [c[0] - 1, c[1] - 1, c[2] + 1, c[3] + 1], this.ocrLangDir, 3, { angles: [0], languages: this.ocrLanguages,
            paddleOcr: this.paddleOcr, paddlePacks: this.paddlePacks, paddleDetector: this.paddleDetector, autoInvert: true, loose: true, psm: "6" });
          return (r?.lines || []).map((l) => l.text).join(" ").trim();
        };
        const cellColor = (c) => regionAverageColor(page, [c[0] + 1, c[1] + 1, c[2] - 1, c[3] - 1]);   // 테두리 선은 빼고
        const table = await scanTableHtml(this.ppDir, page, t.bbox, { words: this.ocrWords?.get(n) || [], esc, readCell, cellColor, fit: this.fitsColumn(n, t.bbox) }).catch(() => null);
        if (table) out.push(table);
      }
      return out;
    }));
    return this.scanTableCache.get(n);
  }

  /** 쪽 n 의 영역 bbox 에 걸쳐 있지만 글로 옮기는 문단(글자 절반 이상이 bbox 밖 — partInside 와 같은 기준)의 글자 번호들 */
  keptTextCharsIn(n, bbox) {
    // 문단이 그림 안에 드는지는 글자 가운데로(partInside 와 같게), 숨길지는 글자 상자가 조금이라도 걸치는지로 본다
    // (가운데는 밖이지만 글자 아랫부분이 걸친 윗줄도 그림에 찍혔다)
    const center = (g) => { const x = (g.x0 + g.x1) / 2, y = (g.y0 + g.y1) / 2; return x >= bbox[0] && x <= bbox[2] && y >= bbox[1] && y <= bbox[3]; };
    const touches = (g) => g.x1 > bbox[0] && g.x0 < bbox[2] && g.y1 > bbox[1] && g.y0 < bbox[3];
    const out = [];
    for (const para of this.paragraphsOnPage(n)) {
      const glyphs = para.lines.map((li) => this.res.lines[li]).filter((l) => l.page === n).flatMap((l) => l.glyphs).filter((g) => !/\s/.test(g.c));
      if (!glyphs.length || !glyphs.some(touches)) continue;
      if (glyphs.filter(center).length * 2 <= glyphs.length) for (const g of glyphs) if (g.ci !== undefined) out.push(g.ci);
    }
    return out;
  }

  /** 문서화 조각의 글자가 대부분(절반 넘게) 들어 있는 그림(보이는 그대로 그린 그림·글상자 바탕). 없으면 null */
  partInside(part, figures) {
    const para = this.res.paragraphs[part.paragraphIndex];
    if (part.ocr || !para) return null;
    const count = new Map();
    let all = 0;
    const figuresByPage = this.byPage(figures);
    for (const li of para.lines) {
      const line = this.res.lines[li];
      if (line.page !== part.page) continue;
      const boxes = figuresByPage.get(line.page) || [];
      for (const g of line.glyphs) {
        if (/\s/.test(g.c)) continue;
        all++;
        const x = (g.x0 + g.x1) / 2, y = (g.y0 + g.y1) / 2;
        const f = boxes.find((b) => x >= b.bbox[0] && x <= b.bbox[2] && y >= b.bbox[1] && y <= b.bbox[3]);
        if (f) count.set(f, (count.get(f) || 0) + 1);
      }
    }
    for (const [f, n] of count) if (n * 2 > all) return f;
    return null;
  }

  /** 칸 글이 PDF 에서 칸의 위·가운데·아래 어디에 놓였는가(top / middle / bottom) */
  /** 칸 높이에서 글이 차지한 높이를 뺀 나머지(pt). 글이 없으면 0 */
  cellFreeHeight(parts, height) {
    let y0 = Infinity, y1 = -Infinity;
    for (const p of parts) for (const li of this.res.paragraphs[p.paragraphIndex]?.lines || []) {
      for (const g of this.res.lines[li].glyphs) { if (/\s/.test(g.c)) continue; y0 = Math.min(y0, g.y0); y1 = Math.max(y1, g.y1); }
    }
    return Number.isFinite(y0) ? Math.max(0, height - (y1 - y0)) : 0;
  }

  cellVerticalAlign(parts, top, bottom) {
    let y0 = Infinity, y1 = -Infinity;
    for (const p of parts) for (const li of this.res.paragraphs[p.paragraphIndex]?.lines || []) {
      for (const g of this.res.lines[li].glyphs) { if (/\s/.test(g.c)) continue; y0 = Math.min(y0, g.y0); y1 = Math.max(y1, g.y1); }
    }
    const free = (bottom - top) - (y1 - y0);
    if (!Number.isFinite(y0) || free < 4) return "middle";
    const r = (y0 - top) / free;
    return r < 0.3 ? "top" : r > 0.7 ? "bottom" : "middle";
  }

  /** 문서화 조각의 줄 가운데 표 영역(tables, 줄 글자 절반 넘게 든 곳)에 든 줄을 뺀다.
   *  걸친 표가 없으면 null, 있으면 { touched: 걸친 표들, text: 남은 줄의 글("" 이면 모두 표 안) } */
  linesOutsideTables(part, tables, drop = []) {
    const para = this.res.paragraphs[part.paragraphIndex];
    if (part.ocr || !para) return null;
    const boxes = this.byPage(tables).get(part.page) || [], dropBoxes = this.byPage(drop).get(part.page) || [];
    if (!boxes.length && !dropBoxes.length) return null;
    const touched = new Set(), keep = [];
    let dropped = false;
    const mostlyIn = (gs, t) => gs.filter((g) => { const x = (g.x0 + g.x1) / 2, y = (g.y0 + g.y1) / 2; return x >= t.bbox[0] && x <= t.bbox[2] && y >= t.bbox[1] && y <= t.bbox[3]; }).length * 2 > gs.length;
    for (const li of para.lines) {
      const line = this.res.lines[li];
      if (line.page !== part.page) continue;
      const gs = line.glyphs.filter((g) => !/\s/.test(g.c));
      if (dropBoxes.some((t) => mostlyIn(gs, t))) { dropped = true; continue; }   // 머리말·꼬리말(drop): 뺀다
      const hit = boxes.find((t) => mostlyIn(gs, t));
      if (hit) touched.add(hit); else keep.push(line.text);
    }
    if (!touched.size && !dropped) return null;
    return { touched: [...touched], text: keep.join(" ").trim() };
  }

  /** 표(글상자)가 원본에서 자기 단을 가득 채웠는가 — 그러면 편집 문서의 본문 폭에 맞춰 늘린다(data-og-fit, studio-bridge
   *  ogFitTablesHtml). 문장은 원본이 몇 단이든 본문 폭으로 흐르는데 표만 단 폭으로 남아 좁게 보였다.
   *  단 폭: 표와 같은 높이 근처(위아래 300pt)에서 표와 가로로 겹치는 표 밖 글 줄들의 단(L~R) 폭. 글 줄이 없으면 쪽 폭의 40%를 기준으로. */
  fitsColumn(pageIndex, bbox) {
    const w = bbox[2] - bbox[0];
    const inside = (l) => l.x0 >= bbox[0] - 2 && l.x1 <= bbox[2] + 2 && l.oy >= bbox[1] - 2 && l.oy <= bbox[3] + 2;
    const cols = (this.byPage(this.res.lines).get(pageIndex) || []).filter((l) => !l.cell && !inside(l) && Math.abs(l.oy - (bbox[1] + bbox[3]) / 2) < 300
      && l.x1 > bbox[0] && l.x0 < bbox[2] && Number.isFinite(l.L) && Number.isFinite(l.R)).map((l) => l.R - l.L).sort((a, b) => a - b);
    if (cols.length >= 3) return w >= cols[cols.length >> 1] * 0.8;
    return w >= (this.pageSizes[pageIndex]?.w || 595) * 0.4;
  }

  /** 글상자 바탕 그림 위의 글을 1칸 표로. 칸 폭은 그림 폭, 칸 바탕은 글 밑에 깔린 색 */
  panelHtml(panel, boxParts, esc, keepBlankLines = false) {
    let color = "#ffffff";
    // 칸 바탕: 글이 놓인 자리에서 가장 많이 보이는 색. 그림 전체의 가운데 밝기 색은 장식 테두리·글 양에 따라 같은 틀의 카드도
    // 회색·흰색으로 갈렸다. 글은 검정으로 넣으므로 그 색이 어두우면(어두운 바탕에 흰 글) 흰 바탕
    const dark = (c) => { const n = parseInt(c.slice(1), 16); return ((n >> 16) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11) < 128; };
    const lines = boxParts.flatMap((p) => this.res.paragraphs[p.paragraphIndex]?.lines || []).map((li) => this.res.lines[li])
      .filter((l) => l && l.page === panel.page);
    const textBox = lines.length ? [Math.min(...lines.map((l) => l.x0)), Math.min(...lines.map((l) => l.oy - l.size)),
      Math.max(...lines.map((l) => l.x1)), Math.max(...lines.map((l) => l.oy + l.size * 0.25))] : panel.bbox;
    try {
      color = withPage(this.doc, panel.page, (page) => {
        const bg = regionBackgroundColor(page, textBox);
        const n = parseInt(bg.slice(1), 16);
        const nearWhite = (n >> 16) >= 0xf8 && ((n >> 8) & 255) >= 0xf8 && (n & 255) >= 0xf8;   // #fefefe 같은 거의 흰색은 흰색으로(같은 틀이면 같은 색)
        return dark(bg) || nearWhite ? "#ffffff" : bg;
      });
    } catch { /* 흰 바탕 */ }
    const w = (panel.bbox[2] - panel.bbox[0]).toFixed(1);
    // 상자 안에서도 "빈 줄 살리기"면 원본에서 문단 사이가 한 줄 이상 비어 있던 곳(인물 소개 사이 등)에 빈 문단을 넣는다.
    // 상자 안에서는 한 줄까지만: 카드 아래쪽에 고정된 문구("이 비밀을 스스로 밝힐 수 없다") 앞의 빈 곳은 글 양에 따라 달라
    // 같은 틀의 카드가 빈 줄 0~3개로 제각각이었다
    const body = boxParts.map((p, k) => (keepBlankLines && k ? "<p></p>".repeat(Math.min(1, this.blankLinesBetween(boxParts[k - 1], p))) : "") + `<p>${esc(p.text)}</p>`).join("");
    return `<table${this.fitsColumn(panel.page, panel.bbox) ? ' data-og-fit="1"' : ""} style="border-collapse:collapse"><tr><td style="width:${w}pt;border:0.5pt solid #808080;background-color:${color};padding:5.7pt 5.7pt;vertical-align:top">${body}</td></tr></table><p></p>`;
  }

  /** 문서화 조각이 든 표 칸 { table: "p3-t0", row, col } (표 칸이 아니면 null) */
  partCell(part) {
    return part.ocr ? null : this.res.paragraphs[part.paragraphIndex]?.cell || null;
  }

  /** 선으로 그은 표 하나를 HTML 표로. 칸 너비·높이는 PDF 그대로(pt), 세로선이 없는 칸은 옆으로(colspan),
   *  가로선이 지나지 않는 행 경계는 위아래로(rowspan) 합친다. 칸 글은 칸마다 문단으로 넣는다. */
  tableHtml(tableKey, cellParts, esc) {
    const m = /^p(\d+)-t(\d+)$/.exec(tableKey);
    const table = m && (this.input.pages[+m[1]]?._tables || []).find((t) => t.id === +m[2]);
    if (!table?.rows?.length) return null;
    const near = (a, b) => Math.abs(a - b) <= 3;
    // 열 경계: 모든 칸의 왼쪽·오른쪽 끝을 모아 가까운 것은 하나로
    const xs = [];
    for (const row of table.rows) for (const c of row.cells) for (const x of [c.x0, c.x1]) if (!xs.some((v) => near(v, x))) xs.push(x);
    xs.sort((a, b) => a - b);
    const col = (x) => xs.findIndex((v) => near(v, x));
    // 행 경계 y 에서 x 자리를 가로선이 지나가는가
    const ruled = (y, x) => (table.hlines || []).some(([hy, hx0, hx1]) => Math.abs(hy - y) <= 2.5 && hx0 <= x + 1 && hx1 >= x - 1);
    const hex = (c) => "#" + c.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
    // 칸 글: 문단마다 원래 글자색·굵기(가장 많이 쓰인 것)를 살린다(검은 바탕 머리 칸의 흰 글자 등)
    // 칸 문단 정렬: 원본에서 글 줄들이 칸 가운데에 놓였으면 가운데, 아니면 왼쪽(양쪽 정렬이면 칸에서 꺾인 짧은 줄이
    // "장면에      등장한"처럼 벌어졌다)
    const paraHtml = (p, x0, x1) => {
      const para = this.res.paragraphs[p.paragraphIndex], count = new Map();
      let bold = 0, all = 0, centered = 0, lines = 0;
      const widths = [];
      for (const li of para?.lines || []) {
        const l = this.res.lines[li], gs = l.glyphs.filter((g) => !/\s/.test(g.c));
        if (!gs.length) continue;
        lines++;
        const lx0 = gs[0].x0, lx1 = gs[gs.length - 1].x1;
        if (Math.abs((lx0 + lx1) / 2 - (x0 + x1) / 2) <= 3 && lx0 - x0 > 4) centered++;
        widths.push([lx1 - lx0, l.size]);
        for (const g of gs) {
          all++; const k = hex(g.color || [0, 0, 0]); count.set(k, (count.get(k) || 0) + 1);
          if ((g.weight || 400) >= 600 || boldFontName(g.font)) bold++;
        }
      }
      const color = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] || "#000000";
      const css = (color !== "#000000" ? `color:${color};` : "") + (all && bold * 2 > all ? "font-weight:bold;" : "");
      // 여러 줄의 폭이 모두 같고(글자 하나 안쪽) 칸 폭의 80% 이상이면 칸 폭에 꽉 차서 꺾인 보통 문단이다 — 좌우 안쪽 여백이 같은 글상자에서는
      // 꽉 찬 줄이 모두 칸 한가운데에 놓여 가운데 정렬로 보였다. 가운데 정렬한 글은 줄마다 길이가 다르다.
      // (칸보다 훨씬 좁은 같은 폭의 줄들 — "기술 / 분류" 같은 두 줄 머리 칸 — 은 가운데 정렬 그대로)
      // 1칸 글상자(table.edge 가 있는 표)에서만 본다: 여러 칸 표의 좁은 머리 칸("일몰설정 / 예외기준")은 같은 폭 두 줄이 칸을 채워도 가운데 정렬이다.
      const full = table.edge && widths.length >= 2 && Math.max(...widths.map((w) => w[0])) - Math.min(...widths.map((w) => w[0])) < widths[0][1]
        && Math.min(...widths.map((w) => w[0])) >= (x1 - x0) * 0.8;
      const align = lines && centered === lines && !full ? "center" : "left";
      return css ? `<p style="text-align:${align}"><span style="${css}">${esc(p.text)}</span></p>` : `<p style="text-align:${align}">${esc(p.text)}</p>`;
    };
    // 칸 바탕: 칸 가운데를 덮는 채운 도형 가운데 가장 작은 것(칸 넓이의 절반 이상)의 색. 흰색이면 두지 않는다
    const fills = (this.input.pages[+m[1]]?.paths || []).filter((pa) => pa.fill && pa.fill[3] > 0);
    const cellFill = (x0, y0, x1, y1) => {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, area = (x1 - x0) * (y1 - y0);
      const hit = fills.filter((pa) => pa.bbox[0] <= cx && pa.bbox[2] >= cx && pa.bbox[1] <= cy && pa.bbox[3] >= cy &&
        Math.max(0, Math.min(x1, pa.bbox[2]) - Math.max(x0, pa.bbox[0])) * Math.max(0, Math.min(y1, pa.bbox[3]) - Math.max(y0, pa.bbox[1])) >= area * 0.5)
        .sort((a, b) => (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]) - (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1]))[0];
      const c = hit && hex(hit.fill);
      if (!c || c === "#ffffff") return null;
      // 도형의 테두리 상자만으로는 실제로 그 칸이 칠해졌는지 알 수 없다: 머리 행과 번호 열을 한 도형(ㄱ자 모양)으로 칠한 표는
      // 상자가 표 전체라, 흰 내용 칸까지 모두 검정이 됐다(검정 바탕에 검정 글씨). 색이 있다고 본 칸은 쪽을 그려 실제 색을 확인한다.
      try {
        const seen = withPage(this.doc, +m[1], (page) => regionBackgroundColor(page, [x0 + 1, y0 + 1, x1 - 1, y1 - 1]));
        const rgb = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
        const s = rgb(seen), want = rgb(c);
        if (s.reduce((d, v, k) => d + Math.abs(v - want[k]), 0) <= 60) return c;     // 도형 색 그대로 칠해져 있다(옅은 회색 머리 칸 포함)
        return s.every((v) => v >= 0xf0) ? null : seen;             // 실제로는 흰 칸, 아니면 위에 덧칠한 다른 색
      } catch { /* 그리지 못하면 도형 색 그대로 */ }
      return c;
    };
    const text = new Map();                                          // "행:열" → 칸 문단들
    for (const p of cellParts) { const c = this.partCell(p), k = `${c.row}:${c.col}`; if (!text.has(k)) text.set(k, []); text.get(k).push(p); }
    // 틈 열: 모든 행에서 비어 있는 좁은 열(나란히 놓인 두 카드 사이 등) — 테두리 없이 비워 둔다
    const tableW = xs[xs.length - 1] - xs[0];
    const gapCols = new Set();
    for (let k = 0; k < xs.length - 1; k++) {
      if (xs[k + 1] - xs[k] >= tableW * 0.15) continue;
      const empty = table.rows.every((row, r) => row.cells.some((cell, c) => col(cell.x0) === k && col(cell.x1) === k + 1 && !text.has(`${r}:${c}`)));
      if (empty) gapCols.add(k);
    }
    const rowHasText = table.rows.map((row, r) => row.cells.some((_, c) => text.has(`${r}:${c}`)));
    const used = new Set();
    const fit = this.fitsColumn(+m[1], table.bbox || [xs[0], table.rows[0].y0, xs[xs.length - 1], table.rows.at(-1).y1]);
    let html = `<table${fit ? ' data-og-fit="1"' : ""} style="border-collapse:collapse">`;
    table.rows.forEach((row, r) => {
      html += "<tr>";
      row.cells.forEach((cell, c) => {
        if (used.has(`${r}:${c}`)) return;
        const colspan = Math.max(1, col(cell.x1) - col(cell.x0));
        // 아래 행의 같은 폭 칸과 그 사이 행 경계에 가로선이 없으면 한 칸으로 합친다
        let rowspan = 1, height = row.y1 - row.y0;
        const parts = [...(text.get(`${r}:${c}`) || [])];
        for (let rr = r + 1; rr < table.rows.length; rr++) {
          const below = table.rows[rr].cells.findIndex((b) => near(b.x0, cell.x0) && near(b.x1, cell.x1));
          if (below < 0 || ruled(table.rows[rr].y0, (cell.x0 + cell.x1) / 2)) break;
          used.add(`${rr}:${below}`); rowspan++; height += table.rows[rr].y1 - table.rows[rr].y0;
          parts.push(...(text.get(`${rr}:${below}`) || []));
        }
        const span = (colspan > 1 ? ` colspan="${colspan}"` : "") + (rowspan > 1 ? ` rowspan="${rowspan}"` : "");
        const body = parts.length ? parts.map((p) => paraHtml(p, cell.x0, cell.x1)).join("") : "<p></p>";
        const gap = colspan === 1 && gapCols.has(col(cell.x0));
        const bg = gap ? null : cellFill(cell.x0, row.y0, cell.x1, row.y0 + height);
        // 높이: 글이 있는 행은 작은 최소 높이(12pt)만 알려 주고, 원본의 넉넉함은 위아래 여백으로 옮긴다. 예전에는 PDF 행 높이를
        // 그대로 알려 줬는데, 편집기 글자가 PDF 보다 커서 줄이 늘어나는 행과 높이가 남는 행이 한 표에 섞이면 편집기가 표 전체
        // 높이를 알려 준 합에 묶어 두어(남는 행에서 조금 덜어 줄 뿐) 줄이 늘어난 칸의 첫 줄 위가 잘렸다(4행 이상, 본문 폭에 맞춘 표).
        // 글이 하나도 없는 행은 높이를 알 길이 그것뿐이라 PDF 높이 그대로. (높이를 아예 안 주면 행마다 약 13px 로 눌린다.)
        // 세로 정렬: PDF 에서 글이 칸의 위·가운데·아래 어디에 있었는지로 정한다.
        const size = `height:${(rowHasText[r] || parts.length ? 12 : height).toFixed(1)}pt;`;
        const valign = this.cellVerticalAlign(parts, row.y0, row.y0 + height);
        const padV = Math.min(6, Math.max(1.4, this.cellFreeHeight(parts, height) / 2)).toFixed(1);
        html += `<td${span} style="width:${(cell.x1 - cell.x0).toFixed(1)}pt;${size}border:${gap || (table.edge === "none" && bg) ? "none" : `0.5pt solid ${Array.isArray(table.edge) ? hex(table.edge) : "#000000"}`};${bg ? `background-color:${bg};` : ""}padding:${padV}pt 2.8pt;vertical-align:${valign}">${body}</td>`;
      });
      html += "</tr>";
    });
    return html + "</table>";
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
  ensureFigureFiles(pageIndexes, onlyIds = null) {
    const selected = new Set(pageIndexes);
    const wanted = onlyIds ? new Set(onlyIds) : null;
    const figuresByPage = this.byPage(this.res.figures || []);
    for (const pageIndex of selected) {
      const pageFigures = figuresByPage.get(pageIndex) || [];
      const targets = pageFigures.filter((f) => (f.kind === "figure" || (f.kind === "inside-drawn" && this.insideCover(f))) && !f.file && (!wanted || wanted.has(f.id)));
      if (!targets.length) continue;
      const page = this.doc.getPage(pageIndex);
      try {
        // 보이는 그대로 그릴 그림(표지·그림 쪽, 조각난 그림, 쪽 밖으로 삐져나간 그림): 쪽의 그 부분을 그린다(긴 변 최대 2000px)
        for (const f of targets.filter((x) => x.render)) {
          const w = f.bbox[2] - f.bbox[0], h = f.bbox[3] - f.bbox[1];
          // 그림 위를 지나가지만 글로 따로 옮기는 문단(글자 대부분이 그림 밖)의 글자는 그릴 때 숨긴다 — 그대로 그리면
          // 기울인 쪽지·장식 그림에 본문 글 조각이 함께 찍혀 "그림 속 글"처럼 보였다
          // 사용자가 직접 분석해 찾은 스캔 속 사진은 확대·재사용을 고려해 조금 더 선명하게 자른다.
          // 파일은 드래그·내보내기·이미지 포함 문서화를 실제 요청했을 때만 만들어 메모리를 상시 쓰지 않는다.
          const maxSide = f.analyzed ? 2600 : 2200, quality = f.analyzed ? 93 : 90;
          const draw = () => renderPageJpeg(page, Math.min(3, maxSide / Math.max(w, h, 1)), quality, f.bbox);
          try {
            // 겹쳐 저장된 한 장식(띠 + 촉수 그림 등): 그 조각들만 그린다(종이 배경·글자·다른 그림 없이)
            // 겹쳐 저장된 한 장식, 기울인 그림 하나: 그 그림만 그린다(종이 배경·글자·다른 그림 없이)
            if (f.overlay || f.solo) { f.file = { ext: "jpg", data: withOnlyImages(page, f.ids, draw) }; continue; }
            const hide = this.keptTextCharsIn(pageIndex, f.bbox);
            // 쪽 대부분을 덮는 그림(표지)이 아니면 그 그림 조각만 그린다 — 종이 질감 등 배경 그림이 같이 찍히지 않게.
            // 그림 위 글씨(손글씨 쪽지)·선은 그대로 둔다
            const size = this.pageSizes[pageIndex], cover = w * h >= size.w * size.h * 0.7;
            // 이 그림 안에 들어 있어 따로 넣지 않는 그림(inside-drawn: 로고 등)도 함께 그린다
            const inner = pageFigures.filter((o) => o.kind === "inside-drawn"
              && (o.bbox[0] + o.bbox[2]) / 2 > f.bbox[0] && (o.bbox[0] + o.bbox[2]) / 2 < f.bbox[2]
              && (o.bbox[1] + o.bbox[3]) / 2 > f.bbox[1] && (o.bbox[1] + o.bbox[3]) / 2 < f.bbox[3]).flatMap((o) => o.ids || [o.id]);
            const keep = [...(f.ids || []), ...inner];
            f.file = { ext: "jpg", data: withHiddenText(page, hide, () => (cover || !keep.length ? draw() : withOnlyImages(page, keep, draw, { keepText: true }))) };
          } catch { /* 그리지 못한 그림은 건너뛴다 */ }
        }
        const targetById = new Map(targets.filter((x) => !x.render).map((f) => [f.id, f]));
        if (!targetById.size) continue;
        const inputById = new Map((this.input.pages[pageIndex]?.images || []).map((im) => [im.id, im]));
        for (const image of readPageObjects(page).images) {
          const target = targetById.get(image.id);
          if (!target) continue;                               // 목록에 든 그림만(배경이라도 내용 그림이면 목록에 있다)
          image.maxSide = 2400;
          try {
            const file = exportImage(this.doc, page, image);
            if (file) { target.file = file; const input = inputById.get(image.id); if (input) input.file = file; }
          } catch { /* 손상되었거나 PDFium이 꺼내지 못하는 그림 하나는 건너뛴다. */ }
        }
      } finally { closePage(page); }
    }
  }

  /** 두 글 문단 사이에 PDF 에서 비어 있던 줄 수(0~3). 같은 쪽·같은 단에서, 앞 문단 마지막 줄과 뒤 문단 첫 줄의
   *  기준선 간격이 보통 줄 간격(pitch)보다 0.75줄 이상 더 벌어졌으면 그만큼을 빈 줄로 본다. */
  blankLinesBetween(prev, part) {
    // OCR 문단: 줄 흐름(applyLineFlow)이 잰 앞 빈 줄 수(같은 쪽·같은 영역 안에서만 잰다)
    // 쪽이 바뀌면 빈 줄 하나: 스캔 쪽은 앞 쪽 문장이 이어지는지 알 수 없어 늘 새 문단으로 들어가는데, 빈 줄 없이 앞 쪽 끝 문장 바로 밑에
    // 다음 쪽 제목이 붙었다(사용자 화면)
    if (part.ocr) return prev && prev.ocr ? (prev.page === part.page ? part.blankBefore || 0 : Math.max(1, part.blankBefore || 0)) : 0;
    if (!prev || prev.ocr || prev.page !== part.page) return 0;
    const linesOf = (p) => (this.res.paragraphs[p.paragraphIndex]?.lines || []).map((i) => this.res.lines[i]).filter((l) => l.page === p.page);
    const a = linesOf(prev).at(-1), b = linesOf(part)[0];
    if (!a || !b || b.x1 <= a.x0 || b.x0 >= a.x1) return 0;              // 다른 단
    // 줄 간격을 좁게 둔 글(여러 줄 제목 등)도 빈 줄 하나는 글자 크기의 1.2배 이상이다
    const pitch = Math.max(a.pitch || b.pitch || 0, Math.max(a.size, b.size) * 1.2);
    const extra = (b.oy - a.oy) / pitch - 1;
    return Number.isFinite(extra) && extra >= 0.75 ? Math.min(3, Math.round(extra)) : 0;
  }

  /** 내용만 문서화용 HTML. 제목 묶음과 본문 사이에는 빈 문단 하나를 두고("빈 줄 살리기"면 PDF 의 빈 줄도),
   *  그림은 읽기 순서에 넣는다. */
  contentHtml(parts, pageIndexes, { includeImages = false, keepTables = false, keepBlankLines = false, aiTables = [], aiFurniture = [] } = {}) {
    if (includeImages) this.ensureFigureFiles(pageIndexes);
    const selected = new Set(pageIndexes);
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const figures = includeImages
      ? (this.res.figures || []).filter((f) => selected.has(f.page) && f.kind === "figure" && f.file?.data && !this.isScanImage(f) && !this.inFurniture(f, aiFurniture))
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
    let html = "", fi = 0, previousHeading = null, previousPart = null;   // previousPart: 바로 앞에 넣은 글 문단(빈 줄 셈용)
    let previousPlainTable = null;                                         // 표를 글로 풀 때 연속된 서로 다른 표의 경계를 기억
    const doneTables = new Set(), plainTables = new Set();
    const drawn = figures.filter((f) => f.render && !f.overlay && !f.solo);    // 이 그림 안의 글은 그림에 이미 그려져 있다(겹친 조각 묶음은 그림만 그린다)
    // 글상자(바탕 그림 위의 본문): 표 모양을 살리면 1칸 표로 감싼다
    const panels = keepTables ? (this.res.figures || []).filter((f) => selected.has(f.page) && f.kind === "panel") : [];
    const panelOf = new Map(), donePanels = new Set();
    // 목차: 점선 목차 줄이 있는 쪽의 "제목 … 쪽 번호" 문단은 오른쪽 탭(점선 채움) 하나로 쪽 번호를 맞춘다
    const tocPages = new Set(parts.filter((p) => p.toc).map((p) => p.page));
    if (panels.length) for (const p of parts) { const f = this.partInside(p, panels); if (f) panelOf.set(p, f); }
    // 표·글상자 하나를 만들 때마다 모든 문단을 다시 거르지 않는다. 문서화 조각의 순서를
    // 그대로 유지한 채 한 번만 묶어 두면 표가 많은 긴 PDF에서도 결과는 같고 검색량만 줄어든다.
    const cellOf = new Map(), tableParts = new Map(), panelParts = new Map();
    const tableBox = new Map();
    for (const n of pageIndexes) for (const t of this.input.pages[n]?._tables || []) tableBox.set(`p${n}-t${t.id}`, { page: n, bbox: t.bbox });
    for (const p of parts) {
      const cell = this.partCell(p); cellOf.set(p, cell);
      if (cell) {
        let list = tableParts.get(cell.table);
        if (!list) tableParts.set(cell.table, list = []);
        list.push(p);
      }
      const panel = panelOf.get(p);
      if (panel && !cell) {
        let list = panelParts.get(panel);
        if (!list) panelParts.set(panel, list = []);
        list.push(p);
      }
    }
    // 쪽(단)을 넘어 이어지는 문단: 두 조각을 한 문단으로 합치고, 그 사이에 오는 글상자는 문단이 끝난 뒤로 미룬다
    // (2단 끝 "…침실 두 개와 욕실" + 글상자 + 다음 쪽 "하나가 있습니다" 처럼 문장 한가운데 상자가 끼었다)
    let lastText = null, lastTextEnd = -1;
    const deferred = [];
    // 본문 조각(글상자·그림 속 글·스캔 표 말고)과 쪽마다 첫·마지막 본문 조각
    const mainPart = (p) => !p.html && !p.ocr && !panelOf.get(p) && !(drawn.length && this.partInside(p, drawn));
    const firstMain = new Map(), lastMain = new Map();
    for (const p of parts) if (mainPart(p)) { if (!firstMain.has(p.page)) firstMain.set(p.page, p); lastMain.set(p.page, p); }
    // part 가 prev 에서 이어지는 문단인가: 같은 문단의 뒷조각, 또는 쪽 마지막 본문이 문장부호 없이 끝나고
    // 다음 쪽 첫 본문이 제목이 아닐 때(쪽 사이에 글상자 줄이 끼어 문단 복원이 이음을 판단하지 못한 경우)
    const indexOf = new Map(parts.map((p, k) => [p, k]));
    const continues = (prev, part) => {
      if (!prev || !part || !mainPart(part) || part.paragraphIndex < 0) return false;
      if (part.paragraphIndex === prev.paragraphIndex) return true;
      // 두 조각 사이에 글상자 글이 끼어 있을 때만(그때는 문단 복원이 두 줄의 이음을 보지 못했다)
      const between = parts.slice(indexOf.get(prev) + 1, indexOf.get(part));
      return part.page === prev.page + 1 && firstMain.get(part.page) === part && lastMain.get(prev.page) === prev
        && between.some((p) => panelOf.get(p)) && !/[.!?。？！…:："”』」)\]]$/.test(prev.text.trim())
        && !/^\s*(?:[□■◆◇○●•▶ㅇo\-–*※]|\(?\d{1,3}[.)]|[①-⑳㉠-㉭ⓐ-ⓩ])/.test(part.text) && !part.heading && !prev.heading && !prev.toc;
    };
    // 목록: 본문 문단(표 칸·글상자·목차·가운데 줄 말고) 가운데 같은 모양 항목이 앞뒤 3문단 안에 또 있고(번호는 1 차이),
    // 번호 목록은 앞 항목과 이어지지 않는 첫 항목에서 그 번호로 다시 시작한다
    const listOf = new Map();
    {
      // 스캔 쪽 OCR 문단도 넣는다(예전에는 빠져 목록 기호가 글자 그대로 들어갔다). OCR 이 기호를 글자로 읽지 못한 줄(첫 글자 앞 빈자리 —
      // applyLineFlow 의 mark)로 시작한 문단은 글머리표 "•" 항목으로 본다.
      const cand = parts.filter((p) => (mainPart(p) || (p.ocr && !p.html)) && !cellOf.get(p) && !p.center && !TOC_LINE.test(p.text))
        .map((p) => ({ p, m: listMark(p.text) || (p.ocr && p.listItem ? { type: "b", key: "b•", mark: "•", len: 0 } : null) }));
      for (let i = 0; i < cand.length; i++) {
        const { m } = cand[i]; if (!m) continue;
        const near = (j) => j >= 0 && j < cand.length && cand[j].m && cand[j].m.key === m.key;
        let prev = -1, next = -1;
        for (let j = i - 1; j >= Math.max(0, i - 3); j--) if (near(j)) { prev = j; break; }
        for (let j = i + 1; j <= Math.min(cand.length - 1, i + 3); j++) if (near(j)) { next = j; break; }
        const okPrev = prev >= 0 && (m.type === "b" || cand[prev].m.value === m.value - 1);
        const okNext = next >= 0 && (m.type === "b" || cand[next].m.value === m.value + 1);
        if (okPrev || okNext) listOf.set(cand[i].p, { ...m, start: m.type === "n" && !okPrev ? m.value : null });
      }
    }
    const continuesAfter = (i) => !!lastText && continues(lastText, parts.slice(i + 1).find(mainPart));
    const joinAfter = (p) => {
      const kind = p.lastLine != null ? this.res.joins[p.lastLine]?.kind : "space";
      return kind === "none" || kind === "hyphen-drop" ? "" : " ";
    };
    // 일반 문단 다음에 표·글상자가 오면 그 블록은 아래의 보통 문단 경로를 지나지 않는다.
    // 따라서 원본에서 한 줄 이상 벌어진 간격을 블록을 넣기 직전에 따로 보존한다.
    const blankBeforeBlock = (part, box = null) => {
      let blanks = keepBlankLines ? this.blankLinesBetween(previousPart, part) : 0;
      // 표의 첫 칸까지의 거리가 그 문단의 pitch 로 잘못 잡히면 위 계산은 0이 된다. 표/패널 외곽선의
      // 실제 윗면과 앞 문단 마지막 줄 사이 여백은 글자 크기를 기준으로 다시 센다.
      if (keepBlankLines && previousPart && box?.bbox && previousPart.page === box.page) {
        const lines = (this.res.paragraphs[previousPart.paragraphIndex]?.lines || []).map((i) => this.res.lines[i]).filter((l) => l.page === previousPart.page);
        const a = lines.at(-1), b = box.bbox;
        if (a && b[2] > a.x0 && b[0] < a.x1) {
          const pitch = Math.max(1, a.size * 1.2);
          const gap = b[1] - (a.oy + a.size * 0.35);
          if (gap / pitch >= 0.75) blanks = Math.max(blanks, Math.min(3, Math.round(gap / pitch)));
        }
      }
      if (blanks) html += "<p><br></p>".repeat(blanks);
      return blanks;
    };
    // 쪽 나누기: 원본 쪽의 내용(글·그림·글상자)이 쪽 높이 60% 위에서 끝났으면 일부러 쪽을 넘긴 것이다(소개 쪽 뒤 본문,
    // 장 끝 등). 그 자리에 쪽 나누기 표시를 넣는다 — 앱이 문서에 넣을 때 실제 쪽 나누기로 바꾼다.
    // 쪽 아래 끝의 쪽 번호·꼬리말 같은 짧은 줄에 끌려가지 않게 본문 문단의 줄만 센다.
    const pageBottom = new Map();
    const lower = (pg, y) => { if (y > (pageBottom.get(pg) ?? -Infinity)) pageBottom.set(pg, y); };
    for (const p of parts) {
      if (p.paragraphIndex < 0 || p.ocr) continue;
      for (const li of this.res.paragraphs[p.paragraphIndex]?.lines || []) { const l = this.res.lines[li]; if (l.page === p.page) lower(l.page, l.oy + l.size * 0.3); }
    }
    for (const f of [...figures, ...panels]) lower(f.page, f.bbox[3]);
    const breakAfter = (pg) => pageBottom.has(pg) && pageBottom.get(pg) < (this.pageSizes[pg]?.h || 842) * 0.6;
    let shownPage = null;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (shownPage !== null && part.page > shownPage && html && breakAfter(shownPage) && !continues(lastText, part)) {
        // 빈 줄 하나를 앞에 둔다: 페이지 없음 화면은 쪽을 이어 붙여 쪽 나누기가 보이지 않으므로, 앞 쪽 끝과 다음 쪽 첫 줄이
        // 빈 줄 없이 붙어 보였다. 쪽 화면에서는 이 빈 줄이 앞 쪽 아래 빈칸에 들어가 보이지 않는다.
        html += '<p><br></p><hr data-og-page-break="1" style="page-break-after:always">';
        previousHeading = null; previousPart = null; lastText = null; previousPlainTable = null;
      }
      if (shownPage === null || part.page > shownPage) shownPage = part.page;
      while (fi < figures.length && figures[fi].beforeParagraph <= part.paragraphIndex) { html += imageHtml(figures[fi++]); previousPart = null; }
      // 스캔본 표(PP-Structure)
      if (part.html) { html += part.html + "<p></p>"; previousHeading = false; previousPart = null; previousPlainTable = null; continue; }
      if (drawn.length && this.partInside(part, drawn)) continue;
      // AI 가 찾은 표(선 없는 표 등): 표 영역에 든 줄은 빼고, 표는 처음 걸친 자리에 한 번 넣는다.
      // 줄 단위로 가른다 — 문단 복원이 표의 한 열을 표 밖 문장과 한 문단으로 묶기도 해서(Surnames B 열 + "Key" 문장)
      // 문단 단위로 가르면 그 열 글자가 표 아래에 한 번 더 나왔다.
      let partText = part.text;
      if (aiTables.length) {
        const cut = this.linesOutsideTables(part, aiTables, aiFurniture);
        if (cut) {
          for (const t of cut.touched) if (!doneTables.has(t)) { blankBeforeBlock(part, t); doneTables.add(t); html += t.html + "<p></p>"; previousHeading = false; previousPart = null; }
          if (!cut.text) continue;
          partText = cut.text;
        }
      }
      const panel = panelOf.get(part);
      if (panel && !cellOf.get(part)) {
        if (donePanels.has(panel)) continue;
        donePanels.add(panel);
        const box = this.panelHtml(panel, panelParts.get(panel) || [], esc, keepBlankLines);
        if (continuesAfter(i)) deferred.push(box);
        else { blankBeforeBlock(part, panel); html += box; previousHeading = false; previousPart = null; lastText = null; previousPlainTable = null; }
        continue;
      }
      // 표 칸 글: 표가 처음 나오는 자리에 표 전체를 한 번에 넣는다
      const cell = keepTables ? cellOf.get(part) : null;
      if (cell && !plainTables.has(cell.table)) {
        if (doneTables.has(cell.table)) continue;
        const table = this.tableHtml(cell.table, tableParts.get(cell.table) || [], esc);
        if (table) { blankBeforeBlock(part, tableBox.get(cell.table)); doneTables.add(cell.table); html += table + "<p></p>"; previousHeading = false; previousPart = null; continue; }
        plainTables.add(cell.table);                              // 표 모양을 알 수 없으면 문단으로
      }
      // "표 모양 유지"를 끄면 칸의 글을 일반 문단으로 풀어 쓴다. 이때 서로 다른 표가 연달아 나오면
      // 경계가 사라져 한 덩어리처럼 보이므로, 두 번째 표 앞에 빈 문단 하나를 둔다. 같은 표 안의 칸은 붙인다.
      const plainTable = !keepTables ? cellOf.get(part)?.table || null : null;
      if (plainTable && previousPlainTable && plainTable !== previousPlainTable) {
        html += "<p><br></p>";
        previousHeading = null; previousPart = null; lastText = null; lastTextEnd = -1;
      } else if (plainTable && !previousPlainTable && previousPart) {
        if (blankBeforeBlock(part, tableBox.get(plainTable))) previousPart = null;
      } else if (!plainTable) previousPlainTable = null;
      const toc = this.tocEntry(part, partText, tocPages);
      if (toc) { part.toc = true; partText = toc.text; }
      // 앞 쪽(단)에서 이어지는 같은 문단의 뒷조각: 바로 앞 문단에 붙이고, 미뤄 둔 글상자를 그 뒤에 넣는다
      if (lastText && continues(lastText, part) && lastTextEnd === html.length && !toc) {
        let head = html.slice(0, -"</p>".length);
        const same = part.paragraphIndex === lastText.paragraphIndex;
        if (same && this.res.joins[lastText.lastLine]?.kind === "hyphen-drop") head = head.replace(/[-‐]$/, "");   // 줄끝 하이픈 지우기
        html = head + (same ? joinAfter(lastText) : " ") + esc(partText) + "</p>";
        lastText = part; lastTextEnd = html.length; previousPart = part;
        previousPlainTable = plainTable;
        if (deferred.length) { html += deferred.join(""); deferred.length = 0; previousPart = null; lastText = null; }
        continue;
      }
      const heading = part.heading ?? this.partIsHeading(part);
      // 빈 줄: 본문이 끝나고 제목이 시작하는 곳에만 하나(본문 → 빈 줄 → 제목 → 본문). 제목 바로 뒤 본문은 붙이고, 이어지는 제목은 한 묶음.
      // 2026-10-08 에 "본문과 제목 사이를 띄워 달라"는 말을 제목 뒤에도 넣으라는 뜻으로 잘못 읽어 제목 앞뒤 모두에 넣었다가,
      // 사용자가 "본문 다음에 오는 제목을 띄우기로 했다"고 바로잡아 되돌렸다. 제목 뒤에는 넣지 않는다.
      // "빈 줄 살리기"면 PDF 에서 문단 사이가 한 줄 이상 벌어진 곳에도 그만큼 넣는다(둘 중 많은 쪽).
      // 목차 항목끼리는 PDF 의 줄 사이 거리로 빈 줄을 넣지 않는다: 장 제목(큰 글자, 두 줄)과 그 아래 작은 항목처럼 글자 크기와
      // 줄 간격이 줄마다 달라, 한 묶음인 "장 제목 → 첫 하위 항목" 사이에 빈 줄이 둘씩 들어가고 정작 장 사이에는 안 들어갔다.
      const tocRun = !!toc && !!previousPart?.toc;
      const aroundHeading = previousHeading === false && heading;
      const blanks = Math.max(aroundHeading ? 1 : 0, keepBlankLines && !tocRun ? this.blankLinesBetween(previousPart, part) : 0);
      html += "<p><br></p>".repeat(blanks);
      const tocStyle = toc ? `;tab-stops:right dotted ${toc.width.toFixed(1)}pt` : "";
      if (deferred.length) { html += deferred.join(""); deferred.length = 0; }   // 이어질 줄 알았던 문단이 안 이어졌으면 여기서
      const li = !toc ? listOf.get(part) : null;
      if (li && partText.startsWith(part.text.slice(0, li.len))) {
        const attrs = li.type === "b" ? ` data-og-list="b" data-og-mark="${esc(li.mark)}"`
          : ` data-og-list="n" data-og-fmt="${esc(li.fmt)}" data-og-code="${li.code}"${li.start != null ? ` data-og-start="${li.start}"` : ""}`;
        html += `<p${attrs} data-og-marker="${esc(partText.slice(0, li.len).trim())}" style="white-space:pre-wrap">${esc(partText.slice(li.len))}</p>`;
      } else html += `<p style="white-space:pre-wrap${part.toc ? ";text-align:left" : part.center ? ";text-align:center" : ""}${tocStyle}">${part.richHtml || esc(partText)}</p>`;
      previousHeading = heading; previousPart = part;
      previousPlainTable = plainTable;
      lastText = part.ocr ? null : part; lastTextEnd = html.length;
    }
    if (deferred.length) html += deferred.join("");
    while (fi < figures.length) html += imageHtml(figures[fi++]);
    return `<div>${html}</div>`;
  }

  /** 목차 항목이면 { text: "제목\t쪽번호", width: 단 폭(pt) } — 점선은 오른쪽 탭의 점선 채움으로 바꾼다.
   *  점선이 글자로 있는 줄(TOC_LINE), 또는 점선 목차가 있는 쪽에서 표·목차 단의 "제목  쪽번호" 줄
   *  (점선을 글자가 아닌 그림 등으로 그린 PDF). */
  tocEntry(part, text, tocPages) {
    const para = this.res.paragraphs[part.paragraphIndex];
    const lines = (para?.lines || []).map((i) => this.res.lines[i]).filter((l) => l && l.page === part.page);
    if (!lines.length || lines.some((l) => l.cell)) return null;
    const dotted = TOC_LINE.test(text);
    const tabbed = tocPages.has(part.page) && lines.every((l) => l.tableGroup)
      && /[\t ]\d{1,4}$/.test(text) && (text.match(/\t/g) || []).length <= 1;
    if (!dotted && !tabbed) return null;
    const m = text.match(/^(.*?)[\s.·…‥・ㆍ․_]*(\d{1,4}|[ivxlcIVXLC]{1,6})$/);
    if (!m || !m[1].trim()) return null;
    const last = lines.at(-1);
    return { text: `${m[1]}\t${m[2]}`, width: Math.max(1, last.R - last.L) };
  }

  /** 뒤에서: 글자 추출 → 줄바꿈·문단 복원 → 투명 글자 층 */
  //  inWorker(bytes, onProgress, onPhase): 서버가 주면 작업 스레드에서 준비한다(서버가 멈추지 않게). 실패하면 여기서.
  async prepareConversion(spacerPromise, inWorker = null) {
    try {
      let done = false;
      if (inWorker) {
        try {
          const r = await inWorker(new Uint8Array(this.bytes),
            (d, total) => { this.state.progress = { phase: "글자 읽기", done: d, total }; },
            (phase) => { this.state.progress = { phase, done: 0, total: 0 }; }, { kiwiCache: this.kiwiCache || null });
          if (this.closed) return;
          this.input = r.input; this.state.text = true; this.res = r.res;
          done = true;
        } catch (e) { console.warn("[PDF 준비] 작업 스레드에서 하지 못해 서버에서 직접 합니다:", e?.message || e); }
      }
      if (!done) {
        // 글자 추출(몇 쪽마다 양보해서 그동안 쪽 그림 요청을 처리한다)
        this.input = await extractGlyphs(new Uint8Array(this.bytes), { yieldEvery: 3, onPage: (d, total) => { this.state.progress = { phase: "글자 읽기", done: d, total }; } });
        const rasterOnly = isRasterOnlyDocument(this.input);
        this.state.progress = { phase: rasterOnly ? "스캔 문서 정리" : "문단 복원", done: 0, total: 0 };
        this.state.text = true;
        const spacer = !rasterOnly && needsKoreanSpacer(this.input) ? await (typeof spacerPromise === "function" ? spacerPromise() : spacerPromise) : null;
        await new Promise((r) => setImmediate(r));
        this.res = reconstruct(this.input, { spacer });
        // 원본 보기의 투명 글자 층은 요청한 쪽만 textLayer()에서 만든다.
      }
      this.state.ocrPages = this.input.pages.map((p) => p.index).filter((n) => this.ocrAreas(n).length);
      this.state.ready = true;
      this.state.progress = null;
    } catch (e) {
      this.state.progress = null;
      this.state.error = String(e && e.message || e);
    } finally {
      // PDFium 문서와 추출 결과가 준비된 뒤에는 업로드 원본 바이트를 따로 들고 있을 필요가 없다.
      // 큰 PDF에서 원본 Buffer + PDFium 내부 복사본이 열린 내내 중복되던 메모리를 돌려준다.
      this.bytes = null;
    }
  }

  /** 원본 쪽 그림(JPEG), 한 번 만든 것은 기억 */
  pageImage(n, scale = 1.25) {
    const bucket = Math.round(Math.max(.6, Math.min(2.75, scale)) * 4) / 4, key = `${n}@${bucket}`;
    if (this.pageJpeg.has(key)) {
      const cached = this.pageJpeg.get(key); this.pageJpeg.delete(key); this.pageJpeg.set(key, cached); return Promise.resolve(cached);
    }
    return this.renderJpeg(this.pageJpeg, key, n, bucket, 82, PAGE_JPEG_CACHE_BYTES, 8);
  }

  /** 쪽 목록의 작은 미리보기 그림(JPEG) */
  pageThumb(n) {
    this.pageThumbs ||= new Map();
    if (this.pageThumbs.has(n)) {
      const cached = this.pageThumbs.get(n); this.pageThumbs.delete(n); this.pageThumbs.set(n, cached); return Promise.resolve(cached);
    }
    const size = this.pageSizes[n] || { w: 595, h: 842 };
    return this.renderJpeg(this.pageThumbs, `t${n}`, n, Math.min(0.5, 240 / Math.max(size.w, 1)), 75, PAGE_THUMB_CACHE_BYTES, 32, n);   // 폭 약 240px
  }

  /** 쪽 그림 그리기: 쪽 그림 작업 스레드(pageRenderer, 서버가 붙여 준다)에서 그려 메인 프로세스를 막지 않는다.
   *  같은 그림을 동시에 여러 번 요청하면 한 번만 그린다. 작업 스레드를 못 쓰면 예전처럼 여기서 그린다. */
  renderJpeg(cache, key, n, scale, quality, byteLimit, countLimit, cacheKey = key) {
    this._jpegInFlight ||= new Map();
    if (this._jpegInFlight.has(key)) return this._jpegInFlight.get(key);
    const here = () => withPage(this.doc, n, (page) => renderPageJpeg(page, scale, quality));
    const p = (this.pageRenderer ? this.pageRenderer.render(n, scale, quality).catch(() => (this.closed ? null : here())) : Promise.resolve().then(here))
      .then((jpeg) => { if (jpeg && !this.closed) putByteLru(cache, cacheKey, jpeg, byteLimit, countLimit); return jpeg; })
      .finally(() => this._jpegInFlight.delete(key));
    this._jpegInFlight.set(key, p);
    return p;
  }

  /** 탭은 유지하고 다시 만들 수 있는 화면용 JPEG만 버린다. 문단·OCR·주석·레이아웃 결과는 보존한다. */
  trimViewCaches() {
    this.pageJpeg?.clear();
    this.pageThumbs?.clear();
    this.textLayerCache?.clear();
  }

  /** 원본 보기의 투명 글자 층. 긴 PDF 전체를 미리 만들지 않고 화면에서 요청한 쪽만 생성·기억한다. */
  textLayer(n) {
    if (!this.state.ready || !this.input || !this.res) return "";
    if (this.textLayerCache.has(n)) {
      const cached = this.textLayerCache.get(n); this.textLayerCache.delete(n); this.textLayerCache.set(n, cached); return cached;
    }
    const own = renderTextLayers(this.input, this.res, { pages: [n], isHeading: (pid) => this.partIsHeading({ paragraphIndex: pid }) })[0]?.textLayer || "";
    return putByteLru(this.textLayerCache, n, own + renderGraphicText(this.res, n), TEXT_LAYER_CACHE_BYTES, 12);
  }

  /** 끌어다 놓을 수 있는 그림 목록(쪽별, pt) */
  figureList() {
    if (!this.state.ready) return null;
    // 스캔 PDF 의 쪽 전체 그림은 끌어 넣기 대상에서 뺀다(쪽마다 화면 전체가 그림 잡기 영역이 된다).
    // 첫 쪽(표지)의 쪽 전체 그림은 그 그림이 곧 표지이므로 끌어 넣을 수 있게 둔다. 그 밖의 스캔 쪽 전체 그림은 목록에만 —
    // 끌어 넣기 영역이 쪽 전체를 덮으면 글자 옆 여백에서 끌기 시작할 때 글자 대신 그림이 끌렸다(쪽마다 스캔인 PDF)
    return (this.res.figures || []).filter((f) => this.figureListed(f)).map((f) => ({ page: f.page, id: f.id, bbox: f.bbox,
      ...((f.kind === "panel" || (f.page > 0 && this.isScanImage(f))) ? { listOnly: true } : {}) }));
  }

  /** 사용자가 요청한 쪽만 레이아웃 분석해 스캔 안의 사진·삽화를 독립 그림으로 만든다.
   *  자동으로 실행하지 않아 스캔 본문을 열고 읽는 평상시 비용은 늘지 않는다. */
  async analyzePageImages(n) {
    if (!this.state.ready || !Number.isInteger(n) || n < 0 || n >= this.pageSizes.length) return { added: 0, figures: this.figureList() || [] };
    if (!this.ppDir || !ppModelsInstalled(this.ppDir)) throw new Error("이미지 분석 모델이 설치되어 있지 않습니다.");
    const layout = await this.pageLayout(n);
    let found = imagesOf(layout, this.pageSizes[n]);
    // 레이아웃 모델이 글+그림 카드를 table/content로 본 경우: OCR 낱말을 지운 저해상도 화면에서
    // 남은 선화·사진 덩어리를 찾는다. 사용자가 이미지 분석을 눌렀을 때만 실행한다.
    if (this.isScanPage(n) && this.ocrReady()) {
      try {
        await this.ocrPage(n);
        const words = this.ocrWords?.get(n) || [], size = this.pageSizes[n], maxSide = 760;
        const ratio = Math.min(1, maxSide / Math.max(size.w, size.h)), rw = Math.max(1, Math.round(size.w * ratio)), rh = Math.max(1, Math.round(size.h * ratio));
        const raster = withPage(this.doc, n, (page) => renderRegionRGB(page, [0, 0, size.w, size.h], rw, rh));
        found = [...found, ...findRasterImageRegions(raster, size, words, found)];
      } catch { /* 레이아웃 모델 결과만 사용 */ }
    }
    const figures = this.res.figures ||= [], area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
    const inter = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    let added = 0; const addedIds = [];
    for (const hit of found) {
      // 모델 상자는 사진 가장자리에 매우 딱 맞게 잡히므로, 실제 추출에서는 주변 3%를 더 보존한다.
      // 쪽 밖으로는 나가지 않으며 최대 여백을 제한해 이웃 본문이 과도하게 섞이지 않게 한다.
      const size = this.pageSizes[n], rawW = hit.bbox[2] - hit.bbox[0], rawH = hit.bbox[3] - hit.bbox[1];
      const px = Math.min(18, Math.max(4, rawW * .03)), py = Math.min(18, Math.max(4, rawH * .03));
      const bbox = [Math.max(0, hit.bbox[0] - px), Math.max(0, hit.bbox[1] - py), Math.min(size.w, hit.bbox[2] + px), Math.min(size.h, hit.bbox[3] + py)];
      // 원래 PDF의 독립 그림과 거의 같은 후보는 중복 등록하지 않는다. 페이지 전체 스캔 이미지는 비교에서 제외한다.
      if (figures.some((f) => f.page === n && !this.isScanImage(f) && inter(f.bbox, bbox) >= .72 * Math.min(area(f.bbox), area(bbox)))) continue;
      let beforeParagraph = -1;
      for (let i = 0; i < (this.res.paragraphs || []).length; i++) {
        const ys = (this.res.paragraphs[i].lines || []).map((li) => this.res.lines[li]).filter((l) => l?.page === n).map((l) => l.oy);
        if (ys.length && Math.max(...ys) <= bbox[1]) beforeParagraph = i;
      }
      const key = bbox.map((v) => Math.round(v)).join("-");
      figures.push({ id: `layout-${n}-${key}`, page: n, bbox, px: [0, 0], kind: "figure", render: true,
        parts: 0, beforeParagraph, file: null, analyzed: true, layoutLabel: hit.label, layoutScore: hit.score });
      added++; addedIds.push(`layout-${n}-${key}`);
    }
    // 새로 찾은 것만 고해상도 영역 렌더링으로 만들며, 원본 스캔 한 쪽 전체는 추출하지 않는다.
    if (added) this.ensureFigureFiles([n], addedIds);
    return { added, figures: this.figureList() || [] };
  }

  /** 그림 추출 목록에 드는가: 그림, 그리고 문서화에서는 표(글상자)가 되는 그림 카드. 카드는 보이는 그대로(글까지) 한 장으로 꺼낸다.
   *  쪽을 거의 덮는 글상자 바탕은 뺀다(쪽 전체 화면이 될 뿐이다). */
  figureListed(f) {
    if (f.kind === "figure") return true;
    // 표지처럼 쪽을 덮는 그림에 함께 그려 넣은 작은 그림(로고 등)도 따로 끌어 넣고 내보낼 수 있다(문서화에는 표지 한 장만)
    if (f.kind === "inside-drawn") return this.insideCover(f);
    if (f.kind !== "panel") return false;
    const size = this.pageSizes[f.page] || { w: 595, h: 842 };
    return (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]) < size.w * size.h * 0.7;
  }

  /** f 가 쪽의 70% 이상을 덮는 그림(표지) 안에 든 그림인가 */
  insideCover(f) {
    const size = this.pageSizes[f.page] || { w: 595, h: 842 }, cx = (f.bbox[0] + f.bbox[2]) / 2, cy = (f.bbox[1] + f.bbox[3]) / 2;
    return (this.res.figures || []).some((o) => o.page === f.page && o.kind === "figure" && (o.bbox[2] - o.bbox[0]) * (o.bbox[3] - o.bbox[1]) >= size.w * size.h * 0.7
      && cx > o.bbox[0] && cx < o.bbox[2] && cy > o.bbox[1] && cy < o.bbox[3]);
  }

  /** 표(글상자)가 되는 그림 카드를 보이는 그대로 그림 파일로(추출 목록·ZIP 에서만 쓴다 — 문서화에는 넣지 않는다) */
  ensurePanelFiles(pageIndexes) {
    const figuresByPage = this.byPage(this.res.figures || []);
    for (const pageIndex of new Set(pageIndexes)) {
      const targets = (figuresByPage.get(pageIndex) || []).filter((f) => f.kind === "panel" && !f.file && this.figureListed(f));
      if (!targets.length) continue;
      withPage(this.doc, pageIndex, (page) => {
        for (const f of targets) {
          const w = f.bbox[2] - f.bbox[0], h = f.bbox[3] - f.bbox[1];
          try { f.file = { ext: "jpg", data: renderPageJpeg(page, Math.min(3, 2000 / Math.max(w, h, 1)), 88, f.bbox) }; } catch { /* 그리지 못한 카드는 건너뛴다 */ }
        }
      });
    }
  }

  /** 그림(보기 화면에서 끌어 넣을 수 있는 그림과 같은 것)을 ZIP 항목으로: "쪽3-그림02.png" 처럼 쪽·읽는 순서대로.
   *  keys("쪽:id" 목록)를 주면 그 그림만 담는다 — 번호는 모든 그림 기준이라 목록에서 뺀 그림 때문에 바뀌지 않는다. */
  figureZipEntries(keys = null) {
    if (!this.state.ready) return null;
    // 고른 그림이 있는 쪽만 그림 파일을 만든다(긴 PDF에서 몇 개만 고를 때 빠르게)
    const pagesOf = keys ? [...new Set(keys.map((k) => +String(k).split(":")[0]))].filter((n) => Number.isInteger(n) && n >= 0 && n < this.pageSizes.length) : this.pageSizes.map((_, i) => i);
    this.ensureFigureFiles(pagesOf); this.ensurePanelFiles(pagesOf);
    // 번호는 보기 화면 목록(figureList)과 같은 순서·같은 그림으로 매긴다
    const list = (this.res.figures || []).filter((f) => this.figureListed(f))
      .sort((a, b) => a.page - b.page || a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
    const want = keys ? new Set(keys.map(String)) : null;
    const pad = (n, w) => String(n).padStart(w, "0"), pw = String(this.pageSizes.length).length, perPage = new Map();
    return list.flatMap((f) => {
      const k = (perPage.get(f.page) || 0) + 1; perPage.set(f.page, k);
      if ((want && !want.has(f.page + ":" + f.id)) || !f.file?.data) return [];
      const ext = String(f.file.ext || "png").toLowerCase().replace("jpeg", "jpg");
      return { name: `쪽${pad(f.page + 1, pw)}-그림${pad(k, 2)}.${ext}`, data: Buffer.from(f.file.data), store: /^(jpg|png|webp|gif)$/.test(ext) };
    });
  }

  /** 그림 원본 파일(PDF 에서 꺼낸 그대로) */
  figureFile(page, id) {
    if (!this.state.ready) return null;
    this.ensureFigureFiles([page]); this.ensurePanelFiles([page]);
    const f = (this.res.figures || []).find((x) => x.page === page && x.id === id && this.figureListed(x));
    return f && f.file && f.file.data ? f.file : null;
  }

  /** OCR 을 쓸 수 있는가(고급 로컬 실행기 또는 Tesseract 언어 자료가 있는가) */
  ocrReady() { return !!(this.paddleOcr && this.paddlePacks?.length) || (!!this.ocrLangDir && ocrAvailable(this.ocrLangDir, this.ocrLanguages)); }

  /** 환경 설정에서 언어를 바꾸면 열어 둔 PDF도 새 언어로 다시 읽는다. */
  setOcrLanguages(languages) {
    this.setOcrConfig({ languages });
  }

  setOcrConfig({ languages = this.ocrLanguages, paddleOcr = this.paddleOcr, paddlePacks = this.paddlePacks,
    paddleDetector = this.paddleDetector } = {}) {
    this.ocrLanguages = [...languages];
    this.paddleOcr = paddleOcr || null;
    this.paddlePacks = [...(paddlePacks || [])];
    this.paddleDetector = paddleDetector || null;
    this.ocrGeneration++;
    this.ocrHtml.clear();
    this.ocrParas.clear();
    this.ocrDebug.clear();
    this.ocrCacheMeta.clear();
    this.scanTableCache?.clear();
    this.ocrWords?.clear();
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
    // 회전 행렬이 든 스캔 그림은 PDFium 개체 상자가 실제 보이는 쪽보다 좁게 보고되기도 한다
    // (841×595 쪽인데 595×595만 반환). 원문 글자가 없고 큰 그림이 쪽 절반 이상이면
    // 사진 한 조각이 아니라 스캔 쪽이므로 보이는 전체 쪽을 OCR 한다.
    const nativeChars = [...(this.byPage(this.res?.lines || []).get(n) || []), ...(this.byPage(this.res?.furniture || []).get(n) || [])]
      .reduce((sum, line) => sum + (line.glyphs || []).filter((g) => !/\s/u.test(g.c || "")).length, 0);
    const rasterArea = areas.reduce((sum, b) => sum + (b[2] - b[0]) * (b[3] - b[1]), 0);
    // 한 장짜리 그림뿐 아니라 여러 타일로 저장된 스캔도 전체 지면으로 합쳐 읽는다.
    if (nativeChars <= 48 && (rasterArea >= W * H * .5 || areas.some((b) => (b[2] - b[0]) * (b[3] - b[1]) >= W * H * .45))) areas = [[0, 0, W, H]];
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
  async ocrRegions(n, diagnostic = null, options = {}) {
    const page = this.input.pages[n], W = page.width, H = page.height;
    const scanPage = this.isScanPage(n);
    let boxes = [], layoutBoxes = [];
    // 이미 설치한 PP-DocLayoutV3가 있으면 표뿐 아니라 제목·본문·옆글·세로 글자 상자를 OCR 영역으로 쓴다.
    // 장식과 그림을 먼저 제외하므로 스캔 잡티를 글자로 고르는 일이 크게 줄고, 같은 모델을 다시 받을 필요도 없다.
    if (scanPage && options.layout === true && this.ppDir && ppModelsInstalled(this.ppDir)) {
      const textLabels = new Set(["abstract", "aside_text", "content", "doc_title", "figure_title", "footnote", "paragraph_title", "reference", "reference_content", "text", "vertical_text", "vision_footnote"]);
      const layout = await this.pageLayout(n).catch(() => []);
      // 검은 제목 카드가 image 로 분류되면 기존에는 OCR 후보에서 빠졌다. 어두운 image 영역만
      // 보조 후보로 넣어 흰 글자를 반전 OCR하되, 일반 사진 전부를 읽어 잡티가 늘지는 않게 한다.
      const darkImageLabels = new Set(["image", "chart", "seal", "header_image", "footer_image"]);
      const darkImages = withPage(this.doc, n, (page) => layout.filter((b) => darkImageLabels.has(b.label) && b.score >= .4).filter((b) => {
        const hex = regionAverageColor(page, b.bbox), rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
        return rgb[0] * .3 + rgb[1] * .59 + rgb[2] * .11 < 115;
      }).map((b) => ({ ...b, label: "image_text" })));
      const regions = uniqueOcrRegions([...layout.filter((b) => textLabels.has(b.label) && b.score >= .4), ...darkImages]);
      // 좌표만 넘기면 aside_text/vertical_text 구분이 사라진다. 배열에 선택용 메타데이터를
      // 붙여 정렬 뒤 화면 글자층까지 그대로 전달한다(JSON 배열 값에는 영향이 없다).
      layoutBoxes = regions.map((b) => Object.assign([...b.bbox], { ocrLabel: b.label, ocrScore: b.score }));
      if (diagnostic) diagnostic.layoutRegions = regions.map((b) => ({ label: b.label, score: b.score, bbox: b.bbox }));
    }
    // 레이아웃 분석은 문서 구조를 정리하는 보조 자료일 뿐, 글자 검출을 대체하지 않는다.
    // 예전에는 상자를 하나라도 찾으면 여기서 끝나 검은 카드나 낮은 점수의 본문이 영구 누락됐다.
    // 페이지 OCR을 한 번 더 훑어 레이아웃 상자 밖에서 실제로 검출된 글줄을 보완한다.
    for (const area of this.ocrAreas(n)) {
      // 쪽 전체가 그림인 스캔 책은 PSM 11(흩어진 글자)이 테두리·점선·장식을 글자로
      // 과인식하고 문단을 흩뜨린다. 자동 문서 배치(3)로 본문 블록을 먼저 찾는다.
      const r = await withPage(this.doc, n, (page) => ocrRegion(page, area, this.ocrLangDir, 2.5, { hide: this.hiddenChars(n), angles: [0], languages: this.ocrLanguages,
        ...(scanPage ? { psm: "3", cleanScan: true, autoInvert: true, normalizeDarkText: true, paddleOcr: this.paddleOcr,
          paddlePacks: this.paddlePacks, paddleDetector: this.paddleDetector,
          dualPolarity: !!options.dualPolarity } : {}) }));
      if (!r) continue;
      const S = r.S, ox = r.crop.x0 / S, oy = r.crop.y0 / S;                    // 잘라 낸 곳 기준 → 쪽 좌표
      const splitDebug = {};
      const splitLines = splitOcrColumns(r.lines.filter((l) => l.words.length), splitDebug);
      if (diagnostic) (diagnostic.firstPass ||= []).push({ area, rawLines: r.lines.length, split: splitDebug,
        lines: splitLines.map((l) => ({ text: String(l.text || "").slice(0, 100), par: l.par, box: [Math.min(...l.words.map((w) => w.bbox.x0)), Math.min(...l.words.map((w) => w.bbox.y0)), Math.max(...l.words.map((w) => w.bbox.x1)), Math.max(...l.words.map((w) => w.bbox.y1))] })) });
      for (const l of splitLines) {
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
    boxes = boxes.map((b) => [Math.max(0, b[0]), Math.max(0, b[1]), Math.min(W, b[2]), Math.min(H, b[3])]).filter((b) => b[2] - b[0] > 20 && b[3] - b[1] > 8);
    const uncovered = boxes.filter((b) => !layoutBoxes.some((known) => boxOverlap(known, b) >= boxArea(b) * .68))
      .map((b) => Object.assign(b, { ocrLabel: "detected_text" }));
    if (diagnostic) diagnostic.detectedOutsideLayout = uncovered.map((b) => [...b]);
    const complete = [...layoutBoxes, ...uncovered];
    return scanPage ? compactOcrRegions(complete, W) : complete;
  }

  /** 스캔 OCR 글줄의 띄어쓰기를 문서 증거·Kiwi·부호 규칙으로 한 번 더 본다(core/ocr-spacing.js). 네이티브 PaddleOCR 이
   *  자리마다 남긴 공백 확률·흰 틈(info)이 있는 줄만. 문서 증거는 이 PDF 의 글자층과 지금까지 OCR 한 쪽들의 글이다.
   *  Kiwi 는 서버가 붙여 준 kiwiAsk(문단 복원 작업 스레드에 묻기)로 — 없으면 문서 증거·부호 규칙만. */
  async refineScanSpacing(lines) {
    const work = lines.filter((l) => l.info && l.words?.length === 1).map((l) => ({ l, text: l.text, info: l.info }));
    if (!work.length) return;
    const { refineOcrSpacing, buildSpacingDict, spacingScale } = await import("./ocr-spacing.js");
    const texts = [...(this.res?.lines || []).map((x) => x.text), ...[...this.ocrParas.values()].flat().map((p) => p.text), ...work.map((w) => w.text)];
    // 간격 잣대(이 문서의 띄어쓰기 폭·음절 폭)는 지금까지 OCR 한 모든 쪽·영역의 자리 정보로 잰다 — 영역 하나는 표본이 적다
    (this._spacingInfo ||= []).push(...work.map((w) => ({ info: w.info })));
    if (this._spacingInfo.length > 4000) this._spacingInfo.splice(0, this._spacingInfo.length - 4000);
    try { await refineOcrSpacing(work, { dict: buildSpacingDict(texts), ask: this.kiwiAsk || null, scale: spacingScale(this._spacingInfo) }); }
    catch (e) { console.warn("[OCR 띄어쓰기] 다시 보지 못했습니다:", e?.message || e); return; }
    for (const w of work) if (w.text !== w.l.text) { w.l.text = w.text; w.l.words[0].text = w.text; }
  }

  /** 스캔 쪽의 머리말·꼬리말 빼기: 같은 글이 쪽 크기 대비 거의 같은 자리(가로·세로 3% 안, 홀짝 쪽의 좌우 뒤집힌 자리도)에
   *  다른 쪽(지금까지 OCR 한 쪽 모두)에도 나오면 되풀이되는 디자인으로 본다. 숫자만 있는 글(쪽 번호)은 값이 달라도 같은 자리면.
   *  글자 PDF 의 머리말·꼬리말(reconstruct.js isFurniture)과 같은 생각. 40자 넘는 글은 본문으로 둔다. 글자 층(선택·복사)에는 남는다. */
  dropRepeatedOcr(n, q) {
    const size = this.pageSizes[n]; if (!size) return [...q];
    const norm = (t) => String(t || "").replace(/\s/g, "");
    const place = (p, sz) => Number.isFinite(p.x0) && Number.isFinite(p.y1) ? [((p.x0 + p.x1) / 2) / sz.w, ((p.y + p.y1) / 2) / sz.h] : null;
    const others = [...this.ocrParas].filter(([m]) => m !== n && this.pageSizes[m]);
    if (!others.length) return [...q];
    const near = (a, b) => Math.abs(a[1] - b[1]) < 0.03 && (Math.abs(a[0] - b[0]) < 0.03 || Math.abs(a[0] - (1 - b[0])) < 0.03);
    return q.filter((p) => {
      const t = norm(p.text), at = place(p, size);
      if (!t || [...t].length > 40 || !at || p.html) return true;
      const digits = /^[0-9]{1,4}$/.test(t);
      const repeated = others.some(([m, list]) => list.some((o) => { const ot = norm(o.text), ob = place(o, this.pageSizes[m]); return ob && near(at, ob) && (ot === t || (digits && /^[0-9]{1,4}$/.test(ot))); }));
      return !repeated;
    });
  }

  /** 한 쪽의 OCR 문단(과 스캔 표)을 읽는 순서로: 단을 나눠 왼쪽 단 → 오른쪽 단(단을 가로지르는 제목 등은 위/아래). 가로 범위를 모르는
   *  항목(예전에 읽어 둔 문단 등)이 있으면 예전처럼 높이 순. */
  async orderOcrParas(q) {
    if (q.length < 3 || q.some((p) => !Number.isFinite(p.x0) || !Number.isFinite(p.x1))) return q.sort((a, b) => a.y - b.y);
    const { columnOrder } = await import("./ocr-spacing.js");
    const { order, col } = columnOrder(q.map((p) => ({ text: "", x0: p.x0, x1: p.x1, y0: p.y, y1: Number.isFinite(p.y1) ? p.y1 : p.y + 10 })), { minGutter: 6 });
    const out = order.map((i) => q[i]);
    // 빈 줄: 같은 단에서 이어지는 두 문단(영역이 달라도) 사이가 보통 줄 사이보다 0.75줄 넘게 벌어졌으면 그만큼 — OCR 이 벌어진 곳에서
    // 영역을 나누면 영역 안에서만 재던 빈 줄이 하나도 안 들어갔다. 줄 간격을 모르면 줄 높이 × 1.6 을 줄 간격으로 본다.
    for (let k = 1; k < out.length; k++) {
      const a = out[k - 1], b = out[k];
      if (col[k] !== col[k - 1] || col[k] < 0 || b.blankBefore || !Number.isFinite(a.y1) || !a.lh || !b.lh || a.html || b.html) continue;
      const lh = Math.max(a.lh, b.lh), pitch = Math.max(a.pitch || 0, b.pitch || 0) || lh * 1.6;
      const extra = (b.y - a.y1 - Math.max(0, pitch - lh)) / pitch;
      if (extra >= 0.75) b.blankBefore = Math.min(3, Math.round(extra));
    }
    return out;
  }

  /** 스캔 OCR 줄의 흐름(문단 나눔·빈 줄·줄 잇기)을 정한다(core/ocr-spacing.js lineFlow). 줄마다 par 를 다시 매기고
   *  _join("space"|"none": 앞 줄과 잇는 법)·_blank(문단 앞 빈 줄 수)를 단다. 예전에는 같은 문단의 줄을 무조건 띄어 이어
   *  "있 / 는" → "있 는", 짧게 끝난 줄 다음 새 문단도 앞 문단에 붙고, 빈 줄도 넣지 않았다. */
  async applyLineFlow(lines, rules = null) {
    if (lines.length < 2) return;
    const { lineFlow, buildSpacingDict, columnOrder } = await import("./ocr-spacing.js");
    // 같은 높이에 가깝게 붙은 조각은 한 줄로 합친다: OCR 이 "11." 과 "민원실 운용에 관한 사항" 을 따로 읽으면 번호가
    // 앞 항목 끝에 붙고 다음 항목이 번호 없이 시작했다(목록·번호 판정이 안 됨). 사이가 글자 2.5개보다 좁을 때만.
    {
      const bx = (l) => [Math.min(...l.words.map((w) => w.bbox.x0)), Math.min(...l.words.map((w) => w.bbox.y0)), Math.max(...l.words.map((w) => w.bbox.x1)), Math.max(...l.words.map((w) => w.bbox.y1))];
      const cw = (l) => { const b = bx(l); return (b[2] - b[0]) / Math.max(1, [...String(l.text || "").replace(/\s/g, "")].length); };
      for (let merged = true; merged;) {
        merged = false;
        for (let i = 0; i < lines.length && !merged; i++) for (let j = 0; j < lines.length && !merged; j++) {
          if (i === j) continue;
          const a = bx(lines[i]), b = bx(lines[j]), h = Math.min(a[3] - a[1], b[3] - b[1]);
          const vOver = Math.min(a[3], b[3]) - Math.max(a[1], b[1]), gap = b[0] - a[2];
          if (vOver < h * 0.6 || gap < 0 || gap > 2.5 * Math.max(cw(lines[i]), cw(lines[j]), 1)) continue;
          const A = lines[i], B = lines[j];
          A.text = `${A.text} ${B.text}`; A.words = [...A.words, ...B.words];
          if (A.words.length > 1) delete A.info;                    // 자리 정보는 한 조각짜리 줄에만 맞다
          lines.splice(j, 1); merged = true;
        }
      }
    }
    const box = (l) => ({ x0: Math.min(...l.words.map((w) => w.bbox.x0)), x1: Math.max(...l.words.map((w) => w.bbox.x1)), y0: Math.min(...l.words.map((w) => w.bbox.y0)), y1: Math.max(...l.words.map((w) => w.bbox.y1)) });
    let items = lines.map((l) => ({ text: spaceOcrWords(l, { trustText: true }).map(({ w, sp }) => w.text + (sp ? " " : "")).join("").trim(), par: l.par, ...box(l) }));
    // 단으로 나눠 읽는 순서로 다시 놓는다(줄 배열 자체를 바꾼다 — 문서화 문단·글자 층·복사 순서가 모두 이 순서를 따른다)
    const { order, col } = columnOrder(items);
    const reordered = order.map((i) => lines[i]);
    items = order.map((i, k) => ({ ...items[i], col: col[k] }));
    lines.splice(0, lines.length, ...reordered);
    // 줄 앞 목록 기호: 줄 상자 안 첫 글자 앞 빈자리(lead, 네이티브 OCR)가 글자 높이 1.2배 넘으면 — OCR 이 "▌·" 같은 기호를 글자로 내지 않는다.
    // (사용자 PDF: 기호 있는 줄 2.3~2.5, 없는 줄 0.62 이하.) 줄 바깥 왼쪽 잉크로 찾는 방법은 칸 테두리·사진 가장자리를 기호로 잘못 봐 뺐다.
    items.forEach((it, k) => { it.mark = lines[k].lead >= 1.2; });
    if (process.env.OG_FLOW_DEBUG) items.forEach((it, k) => console.error(`[앞자리] y${Math.round(it.y0)} lead${lines[k].lead} 기호${it.mark}`));
    const texts = [...(this.res?.lines || []).map((x) => x.text), ...[...this.ocrParas.values()].flat().map((p) => p.text), ...items.map((x) => x.text)];
    let flow;
    try { flow = await lineFlow(items, { dict: buildSpacingDict(texts), ask: this.kiwiAsk || null, rules }); }
    catch (e) { console.warn("[OCR 줄 흐름] 정하지 못했습니다:", e?.message || e); return; }
    if (process.env.OG_FLOW_DEBUG) items.forEach((it, i) => console.error(`[흐름] ${Math.round(it.x0)}-${Math.round(it.x1)} y${Math.round(it.y0)}-${Math.round(it.y1)} par${it.par} ${i ? (flow[i].newPara ? `새문단${flow[i].why || ""} 빈${flow[i].blank}` : flow[i].join) + ` 넘침${flow[i].extra}` : ""} | ${it.text.slice(0, 14)}…${it.text.slice(-6)}`));
    let par = 0;
    lines.forEach((l, i) => {
      if (i && flow[i].newPara) par++;
      l.par = l._par = par;
      l._join = i && !flow[i].newPara ? flow[i].join : "";
      l._blank = i && flow[i].newPara ? flow[i].blank : 0;
      l._pitch = flow[i].pitch || null;
      l._mark = !!items[i].mark;
    });
  }

  /** 2단계: 영역마다 기울기까지 맞춰 읽고, 원본 보기의 투명 글자 층과 같은 모양(줄마다 .tl)으로 만든다.
   *  같은 문단의 줄은 같은 data-pid 로 묶어 복사할 때 띄어쓰기로 잇는다. 한 번 읽은 쪽은 기억한다.
   *  반환: 투명 글자 층 HTML(""), 언어 자료가 없으면 null */
  ocrPage(n, options = {}) {
    if (!this.state.ready) return Promise.resolve("");
    if (!this.ocrReady()) return Promise.resolve(null);
    if (!this.ocrAreas(n).length) { this.ocrParas.set(n, []); return Promise.resolve(""); }   // 그림이 없는 쪽: OCR 하지 않는다
    if (this.ocrHtml.has(n)) {
      const meta = this.ocrCacheMeta.get(n); if (meta) meta.last = Date.now();
      return this.ocrHtml.get(n);
    }
    this.ocrHtml.set(n, (async () => {
      const generation = this.ocrGeneration;
      let html = "";
      const diagnostic = options.diagnostic ? { sourceAreas: this.ocrAreas(n), firstPass: [], secondPass: [] } : null;
      if (diagnostic) this.ocrDebug.set(n, diagnostic);
      const paras = [], words = [];                 // words: 바로 선 영역의 낱말(pt 위치, 뒤 띄어쓰기) — 스캔본 표 칸에 나눠 담는다
      const regions = await this.ocrRegions(n, diagnostic, options);
      if (regions.length > 1) {
        // 영역을 단 순서로: 두 단 쪽에서 영역(왼쪽 제목 상자·왼쪽 본문·오른쪽 제목·오른쪽 본문 …)을 위→아래로만 두면
        // 글자 층·복사·문서화에서 두 단이 번갈아 섞였다
        const { columnOrder } = await import("./ocr-spacing.js");
        const { order } = columnOrder(regions.map((b) => ({ text: "", x0: b[0], y0: b[1], x1: b[2], y1: b[3] })), { minGutter: 6 });
        regions.splice(0, regions.length, ...order.map((i) => regions[i]));
      }
      const scanPage = this.isScanPage(n);
      if (diagnostic) diagnostic.regions = regions;
      for (const b of regions) {
        const gid = 1000 + this.ocrSeq++;
        let r = null;
        // 스캔 본문 영역도 자동 문서 배치(PSM 3)로 다시 읽어 제목·목록·본문 문단을 보존한다.
        // 일반 PDF의 사진·광고는 기존의 흩어진 글자 방식과 기울기 탐색을 유지한다.
        try { r = await withPage(this.doc, n, (page) => ocrRegion(page, b, this.ocrLangDir, 3, { hide: this.hiddenChars(n), languages: this.ocrLanguages,
          ...(scanPage ? { psm: "3", cleanScan: true, autoInvert: true, normalizeDarkText: true, findRules: true, paddleOcr: this.paddleOcr,
            paddlePacks: this.paddlePacks, paddleDetector: this.paddleDetector,
            forceInvert: b.ocrLabel === "image_text", loose: b.ocrLabel === "image_text",
            dualPolarity: !!options.dualPolarity } : {}) })); } catch { r = null; }
        const splitDebug = diagnostic ? {} : null;
        // 스캔은 1차에서 이미 좌우 본문 영역을 나눴다. 2차에서 목록 번호와 본문 사이의
        // 반복 들여쓰기를 단 여백으로 다시 해석하면 한 줄이 둘로 갈라진다.
        const rawLines = r ? r.lines.filter((l) => l.words.length) : [];
        const lines = scanPage ? rawLines : splitOcrColumns(rawLines, splitDebug);
        if (scanPage) { await this.refineScanSpacing(lines); await this.applyLineFlow(lines, r?.rules); }
        if (scanPage && splitDebug) Object.assign(splitDebug, { skipped: "scan region already segmented", inputLines: rawLines.length, cuts: [], outputLines: rawLines.length });
        if (diagnostic) diagnostic.secondPass.push({ region: b, angle: r?.deg ?? null, rawLines: r?.lines?.length || 0, split: splitDebug,
          lines: lines.map((l) => ({ text: String(l.text || "").slice(0, 100), par: l.par, box: [Math.min(...l.words.map((w) => w.bbox.x0)), Math.min(...l.words.map((w) => w.bbox.y0)), Math.max(...l.words.map((w) => w.bbox.x1)), Math.max(...l.words.map((w) => w.bbox.y1))] })) });
        if (!lines.length) continue;
        const S = r.S, pt = (v) => (v / S).toFixed(2);
        const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
        // 낱말 사이 띄어쓰기: OCR 이 알려 준 줄 전체 글자에서 실제로 띄어 쓴 자리만(한국어는 음절 단위로 쪼개 알려 주는 일이 많다)
        const spacedWords = (l) => spaceOcrWords(l, { trustText: scanPage });
        // OCR도 PDF 글자층과 같은 인용부호 규칙을 쓴다. 같은 문단의 여러 줄을 먼저 합쳐 판단한 뒤
        // 각 낱말에 되돌려, 화면에서 복사한 글과 문서화한 글의 기호가 달라지지 않게 한다.
        for (const par of new Set(lines.map((l) => l.par))) {
          const group = lines.filter((l) => l.par === par);
          let raw = ""; const refs = [];
          group.forEach((l, li) => {
            if (li) { raw += " "; refs.push(null); }
            spacedWords(l).forEach(({ w, sp }) => {
              w.text.split("").forEach((c, k) => { raw += c; refs.push({ w, k }); });
              if (sp) { raw += " "; refs.push(null); }
            });
          });
          const fixed = repairPunctuationText(raw), chars = new Map();
          refs.forEach((ref, i) => { if (!ref) return; if (!chars.has(ref.w)) chars.set(ref.w, ref.w.text.split("")); chars.get(ref.w)[ref.k] = fixed[i]; });
          for (const [w, value] of chars) w.text = value.join("");
        }
        // 일본어 후리가나는 작은 별도 줄로 검출된다. 본문 문장에 섞기 전에 바로 아래 한자와 연결해 둔다.
        // 원본 보기의 투명 글자층에는 작은 줄도 그대로 남기고, 문서화용 문단에서만 독립 줄을 뺀다.
        if (scanPage && this.ocrLanguages.includes("jpn")) associateJapaneseRuby(lines);
        const lineText = (l) => spacedWords(l).map(({ w, sp }) => w.text + (sp ? " " : "")).join("");
        // 낱말 위치를 쪽 좌표(pt)로: 읽을 때 돌린 각도를 되돌린다(화면의 투명 글자 층과 같은 변환 — 아래 css 참고)
        const rad = (ROT_SIGN * r.deg * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad), hw = r.crop.w / 2, hh = r.crop.h / 2;
        const toPage = (x, y) => [(r.crop.x0 + hw + (x - hw) * cos - (y - hh) * sin) / S, (r.crop.y0 + hh + (x - hw) * sin + (y - hh) * cos) / S];
        lines.forEach((l, li) => { for (const { w, sp } of spacedWords(l)) {
          const [ax, ay] = toPage(w.bbox.x0, w.bbox.y0), [bx, by] = toPage(w.bbox.x1, w.bbox.y1);
          words.push({ text: w.text, sp, line: `${gid}-${li}`, x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) });
        } });
        // 문서화용 문단: 같은 문단 번호의 줄을 띄어쓰기로 잇는다(위치는 잘라 낸 곳 기준 pt)
        for (const l of lines) {
          if (l._isRuby) continue;
          // 세로로 쓴 짧은 글(쪽 옆 색인 "세계"·세로 쪽 번호 "0 5 8")은 머리말·꼬리말로 보고 문서화에 넣지 않는다 — 글자 층(선택·복사)에는 둔다.
          // 글자 PDF 의 기울어진 글자와 같은 규칙. 예전에는 본문 사이에 "세계" 가 끼었다.
          { const bw = Math.max(...l.words.map((w) => w.bbox.x1)) - Math.min(...l.words.map((w) => w.bbox.x0)), bh = Math.max(...l.words.map((w) => w.bbox.y1)) - Math.min(...l.words.map((w) => w.bbox.y0));
            if (bh > bw * 1.5 && [...String(l.text || "").replace(/\s/g, "")].length <= 8) continue; }
          const y = (r.crop.y0 + Math.min(...l.words.map((w) => w.bbox.y0))) / S;
          const x = (r.crop.x0 + (Math.min(...l.words.map((w) => w.bbox.x0)) + Math.max(...l.words.map((w) => w.bbox.x1))) / 2) / S;   // 줄 가운데(스캔 표 영역 안인지 가릴 때)
          const lx0 = (r.crop.x0 + Math.min(...l.words.map((w) => w.bbox.x0))) / S, lx1 = (r.crop.x0 + Math.max(...l.words.map((w) => w.bbox.x1))) / S;
          const ly1 = (r.crop.y0 + Math.max(...l.words.map((w) => w.bbox.y1))) / S;
          const last = paras.at(-1);
          const offset = last && last.region === gid && last.par === l.par ? [...last.text].length + 1 : 0;
          const ruby = (l._ruby || []).map((p) => ({ ...p, start: p.start + offset, end: p.end + offset }));
          if (last && last.region === gid && last.par === l.par) { last.text += (l._join === "none" ? "" : " ") + lineText(l); last.ruby.push(...ruby); last.xs.push(x); last.x0 = Math.min(last.x0, lx0); last.x1 = Math.max(last.x1, lx1); last.y1 = Math.max(last.y1, ly1); }
          else paras.push({ text: lineText(l), ruby, page: n, y, xs: [x], x0: lx0, x1: lx1, y1: ly1, region: gid, par: l.par, deg: r.deg, blankBefore: l._blank || 0,
            lh: (Math.max(...l.words.map((w) => w.bbox.y1)) - Math.min(...l.words.map((w) => w.bbox.y0))) / S, pitch: l._pitch ? l._pitch / S : null, listItem: !!l._mark });
        }
        // 영역을 넘는 빈 줄: 이 영역의 첫 문단과, 같은 단(가로로 절반 넘게 겹침)에서 바로 위에 있는 앞 영역의 문단 사이가
        // 보통 줄 사이보다 0.75줄 넘게 벌어졌으면 빈 줄 — OCR 이 벌어진 곳에서 영역을 나누면 영역 안 줄 흐름으로는 잴 수 없다.
        // 첫 줄에 _blank 를 달아 글자 층(복사)에도, 문단 blankBefore 로 문서화에도 들어가게 한다.
        {
          const fi = paras.findIndex((p) => p.region === gid), p = paras[fi];
          if (process.env.OG_FLOW_DEBUG) console.error(`[영역빈줄] fi${fi} 문단${paras.length} blank${p?.blankBefore} y${p && Math.round(p.y)} x${p && Math.round(p.x0)}-${p && Math.round(p.x1)}`);
          if (fi > 0 && !p.blankBefore) {
            const over = (q) => Math.min(q.x1, p.x1) - Math.max(q.x0, p.x0) > 0.5 * Math.min(q.x1 - q.x0, p.x1 - p.x0);
            const above = paras.slice(0, fi).filter((q) => q.region !== gid && q.y1 <= p.y + 1 && over(q)).sort((a, b) => b.y1 - a.y1)[0];
            if (above && above.lh && p.lh) {
              const lh = Math.max(above.lh, p.lh), pitch = Math.max(above.pitch || 0, p.pitch || 0) || lh * 1.6;
              const extra = (p.y - above.y1 - Math.max(0, pitch - lh)) / pitch;
              if (extra >= 0.75) {
                p.blankBefore = Math.min(3, Math.round(extra));
                const first = lines.find((l) => !l._isRuby && l.par === p.par);
                if (first) first._blank = p.blankBefore;
              }
            }
          }
        }
        let layer = "", open = null;
        lines.forEach((l, li) => {
          const pid = `o${gid}-p${l.par ?? li}`;
          if (pid !== open) { if (open) layer += "</div>"; layer += `<div class="opara" data-pid="${pid}">`; open = pid; }
          const ws = l.words, sameParNext = li < lines.length - 1 && lines[li + 1].par === l.par;
          const joinNext = sameParNext ? (lines[li + 1]._join === "none" ? "none" : "space") : "";
          const x0 = Math.min(...ws.map((w) => w.bbox.x0)), x1 = Math.max(...ws.map((w) => w.bbox.x1));
          const y0 = Math.min(...ws.map((w) => w.bbox.y0)), y1 = Math.max(...ws.map((w) => w.bbox.y1));
          layer += `<div class="tl" data-pid="${pid}" data-join="${joinNext}"${l._blank ? ` data-blank="${l._blank}"` : ""} data-w="${pt(x1 - x0)}" style="left:${pt(x0)}pt;top:${pt(y0)}pt;font-size:${pt((y1 - y0) * 0.9)}pt;line-height:${pt(y1 - y0)}pt">${esc(lineText(l))}</div>`;
        });
        if (open) layer += "</div>";
        // 화면 좌표 = 잘라 낸 곳 + 가운데 + 읽을 때 돌린 각도를 되돌림
        const cx = r.crop.w / 2, cy = r.crop.h / 2;
        const css = `translate(${pt(r.crop.x0 + cx)}pt,${pt(r.crop.y0 + cy)}pt) rotate(${ROT_SIGN * r.deg}deg) translate(${pt(-cx)}pt,${pt(-cy)}pt)`;
        const scope = String(b.ocrScope || `region-${gid}`).replace(/[^a-z0-9_-]/gi, "");
        const label = String(b.ocrLabel || "text").replace(/[^a-z0-9_-]/gi, "");
        html += `<div class="gtext ocr" data-g="${gid}" data-ocr-scope="${scope}" data-ocr-label="${label}" style="transform:${css}">${layer}</div>`;
      }
      if (generation !== this.ocrGeneration) return "";
      // 문서화에는 기울어진 글자를 넣지 않는다(PDF 글자와 같은 규칙: 기울어진 글자는 그림 속 글자로 본다).
      // 스캔은 쪽 전체가 조금 기울어 있을 수 있으므로, 그 쪽에서 가장 많은 글자가 읽힌 각도를 "바로 선 각도"로 삼고
      // 그 각도와 다른 영역(기울어진 광고·카드 등)만 뺀다. 화면의 투명 글자(드래그·복사)는 모두 둔다.
      const weight = new Map();
      for (const p of paras) weight.set(p.deg, (weight.get(p.deg) || 0) + p.text.length);
      const upright = [...weight].sort((a, b) => b[1] - a[1] || Math.abs(a[0]) - Math.abs(b[0]))[0]?.[0] ?? 0;
      if (process.env.OG_FLOW_DEBUG) for (const p of paras) console.error(`[문단] 영역${p.region} 각도${p.deg}${p.deg === upright ? "" : " 뺌"} y${Math.round(p.y)} | ${p.text.slice(0, 20)}`);
      this.ocrParas.set(n, paras.filter((p) => p.deg === upright).map(({ text, ruby, page, y, xs, x0, x1, y1, blankBefore, lh, pitch, listItem }) => ({ text: text.trim(), ruby, page, y, x: xs[0], x0, x1, y1, blankBefore, lh, pitch, listItem })).filter((p) => p.text));
      this.ocrWords ||= new Map();
      this.ocrWords.set(n, words);
      let bytes = Buffer.byteLength(html, "utf8");
      for (const value of [this.ocrParas.get(n), words, this.ocrDebug.get(n)]) {
        try { bytes += Buffer.byteLength(JSON.stringify(value || null), "utf8"); } catch { /* 진단 자료가 직렬화되지 않으면 HTML 크기만 센다 */ }
      }
      this.ocrCacheMeta.set(n, { bytes, last: Date.now() });
      this.trimOcrCaches(n);
      return html;
    })());
    return this.ocrHtml.get(n);
  }

  /** OCR HTML·문단·낱말·진단 로그는 한 쪽 단위로 함께 버린다. 무제한 누적되면 긴 스캔 PDF가 계속 무거워진다. */
  dropOcrCache(page) {
    this.ocrCacheMeta.delete(page); this.ocrHtml.delete(page); this.ocrParas.delete(page); this.ocrDebug.delete(page); this.ocrWords?.delete(page);
  }

  trimOcrCaches(keepPage = null) {
    LIVE_PDF_SESSIONS.add(this); // 실제 OCR 캐시가 생긴 세션만 전역 상한 계산에 참여한다
    let total = [...this.ocrCacheMeta.values()].reduce((sum, item) => sum + Number(item.bytes || 0), 0);
    const oldest = () => [...this.ocrCacheMeta].filter(([page]) => page !== keepPage).sort((a, b) => a[1].last - b[1].last)[0];
    while (this.ocrCacheMeta.size > 1 && (this.ocrCacheMeta.size > OCR_CACHE_PAGES || total > OCR_CACHE_BYTES)) {
      const victim = oldest(); if (!victim) break;
      const [page, meta] = victim; total -= Number(meta.bytes || 0);
      this.dropOcrCache(page);
    }
    // 쪽별 제한만 두면 PDF 탭마다 최대치가 따로 쌓인다. 모든 열린 PDF의 완료된 OCR 캐시를
    // 한 LRU로 보고 오래된 쪽부터 버리되, 방금 읽은 쪽 하나는 상한보다 커도 보존한다.
    const entries = [...LIVE_PDF_SESSIONS].flatMap((session) => [...(session.ocrCacheMeta || [])]
      .map(([page, meta]) => ({ session, page, bytes: Number(meta.bytes || 0), last: Number(meta.last || 0) })))
      .sort((a, b) => a.last - b.last);
    let globalBytes = entries.reduce((sum, item) => sum + item.bytes, 0), globalPages = entries.length;
    for (const item of entries) {
      if (globalPages <= 1 || (globalPages <= OCR_GLOBAL_CACHE_PAGES && globalBytes <= OCR_GLOBAL_CACHE_BYTES)) break;
      if (item.session === this && item.page === keepPage) continue;
      item.session.dropOcrCache(item.page); globalBytes -= item.bytes; globalPages--;
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    LIVE_PDF_SESSIONS.delete(this);
    try { this.pageRenderer?.close(); } catch { /* 작업 스레드가 이미 끝남 */ }
    this.pageRenderer = null;
    this.cancelLayoutPrefetch();
    clearTimeout(this._layoutSaveTimer);
    // 끝난 레이아웃 캐시는 닫기 직전에도 남긴다. 계산 중인 PDFium 쪽은 약속이 끝난 뒤 문서를 닫아 충돌을 피한다.
    const disk = this._layoutDisk;
    if (disk && this.layoutStore) {
      try { fs.mkdirSync(path.dirname(this.layoutStore), { recursive: true }); fs.writeFileSync(this.layoutStore, JSON.stringify(disk)); } catch { /* 다음에 다시 계산 */ }
    }
    const pending = [...(this.layoutCache?.values() || []), ...(this.ocrHtml?.values() || [])].filter((p) => p && typeof p.then === "function");
    const destroy = () => { try { this.doc?.destroy(); } catch { /* 이미 닫힘 */ } this.doc = null; this.pageJpeg?.clear(); this.pageThumbs?.clear(); this.textLayerCache?.clear(); this.ocrHtml?.clear(); this.ocrParas?.clear(); this.ocrDebug?.clear(); this.ocrWords?.clear(); this.ocrCacheMeta?.clear(); };
    if (pending.length) Promise.allSettled(pending).then(destroy); else destroy();
  }
}
