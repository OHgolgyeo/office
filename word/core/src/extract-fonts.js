// PDF에 들어 있는 글꼴에서, 문서에 실제로 쓰인 글자의 윤곽선과 폭을 PDFium으로 받아
// 브라우저·편집기가 쓸 수 있는 새 글꼴(OpenType)로 다시 만든다.
// PDF 속 글꼴은 대개 쓰인 글자만 남긴 부분 글꼴이고 글자 코드표가 지워져 있어 그대로는 못 쓰기 때문.
// (만든 글꼴은 이 문서를 보여 주는 데만 쓴다. 원본 글꼴의 라이선스를 따른다.)
import opentype from "opentype.js";

/** 쪽의 글자들을 훑어 글꼴별로 글자 윤곽을 모은다. acc: Map<글꼴이름, {glyphs: Map<코드, {cmds, w}>, asc, desc}> */
export function collectFontGlyphs(page, acc) {
  const M = page.module;
  const tp = M._FPDFText_LoadPage(page.pageIdx);
  const b = M.wasmExports.malloc(64);
  try {
    const n = M._FPDFText_CountChars(tp);
    const nameOf = new Map();
    for (let i = 0; i < n; i++) {
      const u = M._FPDFText_GetUnicode(tp, i);
      if (!u || u === 13 || u === 10) continue;
      const obj = M._FPDFText_GetTextObject(tp, i);
      if (!obj) continue;
      const rm = M._FPDFTextObj_GetTextRenderMode(obj);
      if (rm === 3 || rm === 7) continue;                 // 보이지 않는 글자(이미지 속 글자)
      const ang = M._FPDFText_GetCharAngle(tp, i);
      if (ang > 0.02 && ang < 2 * Math.PI - 0.02) continue; // 기울어지거나 회전한 글자(그래픽 속 글자, 변환하지 않음)
      const font = M._FPDFTextObj_GetFont(obj);
      if (!font) continue;
      let name = nameOf.get(font);
      if (name === undefined) {
        const nl = M._FPDFFont_GetBaseFontName(font, b, 64);
        name = nl > 1 ? new TextDecoder().decode(M.HEAPU8.subarray(b, b + nl - 1)).replace(/^[A-Z]{6}\+/, "") : "";
        nameOf.set(font, name);
      }
      if (!name) continue;
      if (!acc.has(name)) {
        let asc = 800, desc = -200;
        if (M._FPDFFont_GetAscent(font, 1000, b)) asc = M.HEAPF32[b >> 2];
        if (M._FPDFFont_GetDescent(font, 1000, b)) desc = M.HEAPF32[b >> 2];
        acc.set(name, { glyphs: new Map(), asc, desc, embedded: M._FPDFFont_GetIsEmbedded(font) === 1 });
      }
      const ent = acc.get(name);
      // 이 글꼴에 없는 글자를 요청하면 PDFium 이 "없는 글자(.notdef)" 모양(대개 네모 상자)을 돌려준다.
      // 그 모양의 서명을 한 번 구해 두고, 같은 모양이 나오면 그 글자는 없는 것으로 본다.
      if (ent.notdefSig === undefined) ent.notdefSig = sigOf(readGlyph(M, font, 0xfffe, b).cmds);
      for (const code of [u, 32]) {                       // 띄어쓰기 글자도 함께
        if (ent.glyphs.has(code)) continue;
        const g = readGlyph(M, font, code, b);
        const missing = g.cmds.length > 0 && sigOf(g.cmds) === ent.notdefSig;
        if (/\s/.test(String.fromCodePoint(code))) {
          // 띄어쓰기류: 모양은 항상 비우고, 폭을 모르면 1/4em
          ent.glyphs.set(code, { cmds: [], w: missing || !g.w ? 250 : g.w });
        } else if (!missing) {
          ent.glyphs.set(code, g);
        } else {
          ent.glyphs.set(code, null);                       // 없는 글자: 글꼴에 넣지 않는다(화면에서는 대체 글꼴로)
        }
      }
    }
  } finally {
    M.wasmExports.free(b);
    M._FPDFText_ClosePage(tp);
  }
}

function readGlyph(M, font, code, b) {
  let w = 0;
  if (M._FPDFFont_GetGlyphWidth(font, code, 1000, b)) w = M.HEAPF32[b >> 2];
  const cmds = [];
  const gp = M._FPDFFont_GetGlyphPath(font, code, 1000);
  if (gp) {
    const k = M._FPDFGlyphPath_CountGlyphSegments(gp);
    let pend = [];
    for (let s = 0; s < k; s++) {
      const sg = M._FPDFGlyphPath_GetGlyphPathSegment(gp, s);
      M._FPDFPathSegment_GetPoint(sg, b, b + 4);
      const x = M.HEAPF32[b >> 2] * 1000, y = M.HEAPF32[(b + 4) >> 2] * 1000;   // 좌표는 1em=1 단위로 온다
      const t = M._FPDFPathSegment_GetType(sg);
      if (t === 2) cmds.push(["M", x, y]);
      else if (t === 0) cmds.push(["L", x, y]);
      else if (t === 1) { pend.push(x, y); if (pend.length === 6) { cmds.push(["C", ...pend]); pend = []; } }
      if (M._FPDFPathSegment_GetClose(sg)) cmds.push(["Z"]);
    }
  }
  return { cmds, w };
}
const sigOf = (cmds) => cmds.length ? cmds.length + ":" + cmds.slice(0, 6).map((c) => c.slice(1).map((v) => Math.round(v)).join(",")).join("|") : "";

/** 모은 윤곽으로 OpenType 글꼴을 만든다. @returns Map<글꼴이름, {family, data: Uint8Array, asc, desc}> */
export function buildFonts(acc, variants = new Map()) {
  const out = new Map();
  let k = 0;
  for (const [name, ent] of acc) {
    if (!ent.embedded) continue;                            // 내장되지 않은 글꼴은 윤곽이 없다(시스템 글꼴로)
   for (const h of variants.get(name) || [1]) {           // 장평(가로 비율)마다 따로 만든다
    const glyphs = [new opentype.Glyph({ name: ".notdef", advanceWidth: 500, path: new opentype.Path() })];
    let drawn = 0;
    for (const [code, g] of ent.glyphs) {
      if (!g) continue;                                     // 없는 글자
      const path = new opentype.Path();
      for (const c of g.cmds) {
        if (c[0] === "M") path.moveTo(c[1] * h, c[2]);
        else if (c[0] === "L") path.lineTo(c[1] * h, c[2]);
        else if (c[0] === "C") path.curveTo(c[1] * h, c[2], c[3] * h, c[4], c[5] * h, c[6]);
        else path.close();
      }
      if (g.cmds.length) drawn++;
      glyphs.push(new opentype.Glyph({ name: `u${code.toString(16)}`, unicode: code, advanceWidth: Math.max(0, Math.round(g.w * h)), path }));
    }
    if (drawn < 1) continue;
    const family = `pdf-${k++}${h !== 1 ? "-w" + Math.round(h * 100) : ""}`;
    try {
      const font = new opentype.Font({ familyName: family, styleName: "Regular", unitsPerEm: 1000,
        ascender: Math.round(ent.asc || 800), descender: Math.round(ent.desc || -200), glyphs });
      out.set(h === 1 ? name : `${name}|${h}`, { family, hscale: h, data: new Uint8Array(font.toArrayBuffer()), asc: ent.asc, desc: ent.desc, glyphs: glyphs.length - 1 });
    } catch { /* 만들 수 없으면 대체 글꼴로 */ }
   }
  }
  return out;
}
