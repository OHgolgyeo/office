// 지면 그대로 재구성 쪽을 HTML 조각으로 만든다(비교 테스터와 PDF 뷰어가 함께 쓴다).
import { PNG } from "pngjs";
import jpeg from "jpeg-js";

// opts.lockLines: 원본 줄바꿈 위치를 그대로 고정(뷰어용). 끄면 브라우저가 상자 폭에 맞춰 다시 흘린다(비교 테스터용).
export function renderLayout(input, res, opts = {}) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const rgba = (c, def = "#000") => (c ? `rgba(${c[0]},${c[1]},${c[2]},${(c[3] ?? 255) / 255})` : def);
  const b64 = (u8) => Buffer.from(u8).toString("base64");
  const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  // 글꼴 이름 → CSS. 원래 이름을 먼저 두고(컴퓨터에 있으면 그대로 쓰임) 명조/고딕 계열로 대체
  const fontMap = input.fonts || new Map();
  const fontKey = (name, h) => { const n = (name || "").replace(/^[A-Z]{6}\+/, ""); return h && h !== 1 && fontMap.has(`${n}|${h}`) ? `${n}|${h}` : n; };
  const rebuilt = (name, h) => fontMap.get(fontKey(name, h));
  function fontCss(name, h) {
    const rb = rebuilt(name, h);
    if (rb) return `"${rb.family}",${fallbackCss(name)}`;   // PDF에서 되살린 원본 글꼴, 혹시 빠진 글자는 대체 글꼴로
    return fallbackCss(name);
  }
  function fallbackCss(name) {
    const base = (name || "").replace(/^[A-Z]{6}\+/, "").replace(/[-,](Bold|Regular|Medium|Light|SemiBold|ExtraBold|Italic|[a-z]{1,2}[A-Z][a-z]+).*$/, "");
    const spaced = base.replace(/([a-z])([A-Z])/g, "$1 $2");
    const serif = /myeong|batang|serif|book|명조|바탕|gowun|times|mincho/i.test(name || "");
    const list = [base, spaced].filter(Boolean).map((f) => `"${f}"`);
    list.push(serif ? '"Noto Serif KR","Noto Serif CJK KR","Nanum Myeongjo","Batang",serif' : '"Noto Sans KR","Noto Sans CJK KR","Nanum Gothic","Malgun Gothic",sans-serif');
    return list.join(",");
  }

  // 줄 하나를 글자 단위 항목으로(글자마다 색·굵기·기울임). l.text 와 같은 순서로 공백/탭을 끼운다.
  function lineItems(l) {
    if (l.rotated) return Array.from(l.text).map((c) => ({ c, g: l.glyphs[0] }));
    const items = [];
    l.glyphs.forEach((g, i) => {
      if (i > 0) { const gp = l.gaps[i - 1]; if (gp && gp.isSp) items.push({ c: gp.cell ? "\t" : " ", g: l.glyphs[i - 1], gap: gp.gap }); }
      items.push({ c: g.c, g });
    });
    return items;
  }
  const styleOf = (g, base) => {
    const st = [];
    if (fontKey(g.font, g.hscale) !== fontKey(base.font, base.hscale)) st.push(`font-family:${fontCss(g.font, g.hscale).replace(/"/g, "'")}`);
    if (g.color && base.color && g.color.join() !== base.color.join()) st.push(`color:${rgba(g.color)}`);
    const b = !rebuilt(g.font, g.hscale) && (g.weight || 400) >= 600, bb = !rebuilt(base.font, base.hscale) && (base.weight || 400) >= 600;
    if (b !== bb) st.push(`font-weight:${b ? 700 : 400}`);
    if (!!g.italic !== !!base.italic) st.push(`font-style:${g.italic ? "italic" : "normal"}`);
    return st.join(";");
  };
  // 항목들을 같은 모양끼리 묶어 span 으로
  function runsHtml(items, base) {
    let html = "", cur = null, buf = "";
    const flush = () => { if (!buf) return; html += cur ? `<span style="${cur}">${esc(buf)}</span>` : esc(buf); buf = ""; };
    for (const it of items) {
      const st = styleOf(it.g, base);
      if (st !== cur) { flush(); cur = st; }
      buf += it.c;
    }
    flush();
    return html;
  }
  // 문단 하나의 HTML: 이음새마다 (앞 줄 끝 글자 + 공백 + 다음 줄 첫 글자)를 span 으로 감싼다(배경만, 간격 불변)
  // 원본 줄바꿈을 고정한 문단: 줄마다 블록으로 두되 한 문단 상자 안에 있어서 드래그 선택은 줄을 넘어 이어진다.
  // 이어 붙일 공백은 줄 끝에 넣고(복사에 들어감), 지울 하이픈은 .hy 로 표시(복사할 때 뺀다).
  function paraLockedHtml(p, base, L, R, justifyPara) {
    let html = "";
    p.lines.forEach((li, k) => {
      const l = res.lines[li];
      const items = lineItems(l);
      const after = k < p.lines.length - 1 ? res.joins[li] : null;
      const before = k > 0 ? res.joins[li - 1] : null;
      const seamCls = (j) => `seam${j && j.flagged ? " flagged" : ""}`;
      let hy = null;
      if (after && after.kind === "hyphen-drop") hy = items.pop();
      let inner = "";
      const n = items.length;
      items.forEach((it, i) => {
        let t = runsHtml([it], base);
        if (i === 0 && before) t = `<span class="${seamCls(before)}">${t}</span>`;
        if (i === n - 1 && after) t = `<span class="${seamCls(after)}">${t}${after.kind === "space" ? " " : ""}</span>`;
        inner += t;
      });
      if (hy) inner += `<span class="hy ${seamCls(after)}">${runsHtml([hy], base)}</span>`;
      inner = inner.replace(/\t/g, '</span><span class="tabch">\t</span><span class="cell2">');
      // 줄 폭까지 펴기: 원본에서 오른쪽 끝까지 찬 줄(양쪽 정렬)만
      const full = justifyPara && after && Math.abs(l.x1 - R) < l.size * 0.25;
      const cells = l.cells && l.cells.length > 1;
      const w = cells ? R - l.x0 : full ? R - l.x0 : l.x1 - l.x0 + l.size * 2;
      html += `<span class="ln${full ? " full" : ""}" style="margin-left:${(l.x0 - L).toFixed(2)}pt;width:${w.toFixed(2)}pt;letter-spacing:${(l.tracking || 0).toFixed(3)}pt"><span class="cell1">${inner}</span></span>`;
    });
    return html;
  }

  function paraHtml(p, base) {
    let html = "";
    p.lines.forEach((li, k) => {
      const l = res.lines[li];
      let items = lineItems(l);
      const after = k < p.lines.length - 1 ? res.joins[li] : null;
      const before = k > 0 ? res.joins[li - 1] : null;
      if (after && after.kind === "hyphen-drop") items = items.slice(0, -1);
      const head = before && items.length ? 0 : -1, tail = after && items.length > (head === 0 ? 1 : 0) ? items.length - 1 : -1;
      if (head === 0) html += runsHtml([items[0]], base) + "</span>";
      html += runsHtml(items.slice(head === 0 ? 1 : 0, tail >= 0 ? tail : items.length), base).replace(/\t/g, '</span><span class="tabch">\t</span><span class="cell2">');
      if (after) {
        const cls = `seam${after.flagged ? " flagged" : ""}`;
        html += `<span class="${cls}" title="${esc(`[${after.kind} ${after.conf}]\n` + after.reasons.join("\n"))}">` + (tail >= 0 ? runsHtml([items[tail]], base) : "") + (after.kind === "space" ? " " : "");
      }
    });
    return `<span class="cell1">${html}</span>`;
  }
  // 한 줄짜리 문단: 줄 안의 큰 간격(라벨과 값 사이 등)은 원래 x 위치 그대로 조각을 놓는다
  function singleLineHtml(l, base) {
    const items = lineItems(l);
    const pieces = [];
    let cur = [], startX = l.x0, gi = 0;
    items.forEach((it) => {
      if ((it.c === " " || it.c === "\t") && it.gap > l.size * 1.5) { pieces.push({ x: startX, items: cur }); cur = []; startX = null; return; }
      if (startX === null) startX = it.g && l.glyphs.includes(it.g) ? null : startX;
      cur.push(it);
    });
    pieces.push({ x: startX, items: cur });
    // 각 조각의 시작 x: 조각 첫 글자의 x0
    return pieces.map((pc) => {
      const first = pc.items.find((it) => it.c !== " " && it.c !== "\t");
      return { x: first ? first.g.x0 : l.x0, html: runsHtml(pc.items, base) };
    });
  }

  // 비교 화면용 이미지 줄이기(추출 결과 자체는 그대로): 불투명 PNG → JPEG, 큰 투명 PNG → 해상도 절반씩
  function compactImage(file) {
    if (file.ext === "jpg") return `data:image/jpeg;base64,${b64(file.data)}`;
    let img = PNG.sync.read(Buffer.from(file.data));
    let opaque = true;
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i] < 250) { opaque = false; break; }
    if (opaque) return `data:image/jpeg;base64,${b64(jpeg.encode({ data: img.data, width: img.width, height: img.height }, 80).data)}`;
    let bytes = file.data;
    while (bytes.length > 400000 && img.width > 300) {
      const w = img.width >> 1, h = img.height >> 1, half = new PNG({ width: w, height: h });
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
        const a = ((2 * y) * img.width + 2 * x) * 4 + c, b = a + 4, d = a + img.width * 4, e = d + 4;
        half.data[(y * w + x) * 4 + c] = (img.data[a] + img.data[b] + img.data[d] + img.data[e]) >> 2;
      }
      img = half; bytes = PNG.sync.write(img);
    }
    return `data:image/png;base64,${b64(bytes)}`;
  }

  const mode = res.stats.wrapMode;
  const pages = [];
  const counts = { paras: 0 };
  for (const page of input.pages) {
    if (opts.pages && !opts.pages.includes(page.index)) continue;
    const W = page.width, H = page.height;
    let layer = "";
    let png = "";
    if (!opts.textOnly) {   // textOnly: 원본 보기용 투명 글자 층만(빠름)
    // 1) 도형과 이미지: PDF에 그려진 순서 그대로(뒤에 그려진 것이 위로)
    const objs = [...(page.paths || []).map((o) => ({ o, t: "path" })), ...(page.images || []).map((o) => ({ o, t: "img" }))]
      .sort((a, b) => (a.o.seq ?? 0) - (b.o.seq ?? 0));
    let svgBuf = "";
    const flushSvg = () => { if (svgBuf) { layer += `<svg class="shape" viewBox="0 0 ${W} ${H}" style="left:0;top:0;width:${W}pt;height:${H}pt;overflow:visible">${svgBuf}</svg>`; svgBuf = ""; } };
    for (const { o, t } of (opts.noGraphics ? [] : objs)) {
      const [x0, y0, x1, y1] = o.bbox;
      if (x1 < 0 || y1 < 0 || x0 > W || y0 > H) continue;
      if (t === "img") {
        if (!o.file) continue;
        flushSvg();
        layer += `<img class="img" src="${compactImage(o.file)}" style="left:${x0}pt;top:${y0}pt;width:${x1 - x0}pt;height:${y1 - y0}pt">`;
        continue;
      }
      // 도형: 실제 모양 그대로(고리 모양 테두리처럼 안쪽이 빈 도형도 채우기 규칙대로)
      const fill = o.fill && o.fill[3] > 0 ? rgba(o.fill) : "none";
      const stroke = o.stroke ? rgba(o.stroke) : "none";
      if (fill === "none" && stroke === "none") continue;
      if (o.d) svgBuf += `<path d="${o.d}" fill="${fill}" fill-rule="${o.fillRule || "nonzero"}" stroke="${stroke}" stroke-width="${Math.max(o.strokeWidth || 0, stroke === "none" ? 0 : 0.3)}"/>`;
      else svgBuf += `<rect x="${x0}" y="${y0}" width="${Math.max(x1 - x0, 0.5)}" height="${Math.max(y1 - y0, 0.5)}" fill="${fill}" stroke="${stroke}"/>`;
    }
    flushSvg();
    // 3) 머리글·꼬리글: 원래 자리에 그대로
    for (const l of res.furniture.filter((l) => l.page === page.index)) {
      const g = l.glyphs[0];
      layer += `<div class="furn" style="left:${l.x0}pt;top:${l.oy - l.size * 0.88}pt;font-size:${l.size}pt;font-family:${esc(fontCss(g.font, g.hscale))};color:${rgba(g.color)}">${esc(l.text)}</div>`;
    }
    // 4) 문단 상자
    // 문단이 단이나 쪽을 넘어가면 넘어간 부분(조각)을 그 자리에 따로 그린다. 조각끼리는 같은 문단 번호라 복사하면 이어진다.
    const parts = [];
    res.paragraphs.forEach((p, pid) => {
      const runs = [];
      for (const li of p.lines) {
        const l = res.lines[li], last = runs.at(-1) && res.lines[runs.at(-1).at(-1)];
        if (!last || l.group !== last.group || l.page !== last.page || l.oy < last.oy - 1) runs.push([li]); else runs.at(-1).push(li);
      }
      runs.forEach((run, ri) => {
        if (res.lines[run[0]].page !== page.index) return;
        parts.push({ p: runs.length > 1 ? { ...p, lines: run } : p, pid, joinAfter: ri < runs.length - 1 ? res.joins[run.at(-1)].kind : "" });
      });
    });
    for (const { p, pid, joinAfter } of parts) {
      const ls = p.lines.map((i) => res.lines[i]);
      if (ls[0].rotated) continue;
      const f = ls[0], lay = p.layout || {};
      const size = lay.fontSize || f.size;
      const lh = lay.lineHeight || size * 1.25;
      // 첫 줄 기준선을 원래 자리에: CSS 줄 상자에서 기준선 = 위쪽 반행간 + ascent
      const rbf = rebuilt(f.glyphs.find((g) => !/\s/.test(g.c))?.font, f.glyphs.find((g) => !/\s/.test(g.c))?.hscale);
      const asc = rbf ? rbf.asc / 1000 : 0.88, dsc = rbf ? -rbf.desc / 1000 : 0.12;
      const top = f.oy - ((lh - (asc + dsc) * size) / 2 + asc * size);
      const base = f.glyphs.find((g) => !/\s/.test(g.c)) || f.glyphs[0];
      const synthBold = !rebuilt(base.font, base.hscale) && (base.weight || 400) >= 600;
      const font = `font-size:${size}pt;line-height:${lh}pt;font-family:${esc(fontCss(base.font, base.hscale))};font-weight:${synthBold ? 700 : 400};${base.italic ? "font-style:italic;" : ""}color:${rgba(base.color)}`;
      counts.paras++;
      if (ls.length === 1) {
        // 원본도 한 줄: 줄바꿈 없이, 큰 간격은 원래 자리 그대로
        for (const pc of singleLineHtml(f, base))
          layer += `<div class="para one" data-pid="${pid}" data-join="gap" data-lines="1" style="left:${pc.x}pt;top:${top}pt;${font};letter-spacing:${f.tracking || 0}pt">${pc.html}</div>`;
        continue;
      }
      // 그림 윤곽을 따라 흐르는 문단: 사각형 상자로 다시 흘릴 수 없으므로 줄마다 원래 자리에 고정(이음새 표시는 유지)
      if (ls.some((l) => l.wrapLeft || l.wrapRight)) {
        const html = paraHtml(p, base).replace(/^<span class="cell1">|<\/span>$/g, "");
        // 이음새 span 이 줄을 넘나들므로, 줄 단위 고정은 텍스트 기준으로 다시 만든다
        ls.forEach((l, k) => {
          const full = k < ls.length - 1;
          const items = lineItems(l);
          const after = full ? res.joins[p.lines[k]] : null;
          const cls = after && after.flagged ? " flagged" : "";
          layer += `<div class="para fixed${cls}" data-pid="${pid}" data-join="${after ? after.kind : ""}" data-fixed="1" style="left:${l.x0}pt;top:${l.oy - ((lh - (asc + dsc) * size) / 2 + asc * size)}pt;width:${l.x1 - l.x0 + 0.5}pt;${font};text-align:${full ? "justify" : "left"};text-align-last:${full ? "justify" : "left"};white-space:pre">${runsHtml(items, base)}</div>`;
        });
        continue;
      }
      const L = Math.min(...ls.map((l) => l.x0)), R = Math.max(...ls.map((l) => l.x1));
      if (opts.lockLines) {
        const justifyPara = !!f.justified;
        layer += `<div class="para locked" data-pid="${pid}" data-join="${joinAfter}" data-lines="${ls.length}" style="left:${L}pt;top:${top}pt;width:${R - L + 1}pt;${font}">${paraLockedHtml(p, base, L, R, justifyPara)}</div>`;
        continue;
      }
      // 양쪽 정렬은 "단 자체가 양쪽 정렬"이고 마지막 줄 말고는 오른쪽 끝이 딱 맞을 때만
      const body = ls.slice(0, -1);
      const justify = f.justified && body.every((l) => Math.abs(l.x1 - R) < l.size * 0.15);
      const centered = ls.every((l) => Math.abs((l.x0 + l.x1) / 2 - (L + R) / 2) < l.size * 0.6) && f.x0 - L > size;
      const align = centered ? "center" : justify ? "justify" : "left";
      const indent = centered ? 0 : f.x0 - L;
      layer += `<div class="para${p.text.includes("\t") ? " tabrow" : ""}" data-pid="${pid}" data-join="${joinAfter}" data-lines="${ls.length}" style="left:${L}pt;top:${top}pt;width:${R - L + 0.5}pt;${font};letter-spacing:${lay.letterSpacing || 0}pt;text-align:${align};text-indent:${indent}pt">${paraHtml(p, base)}</div>`;
    }
    
    if (page.render) {
      const dec = PNG.sync.read(Buffer.from(page.render));
      png = `data:image/jpeg;base64,${b64(jpeg.encode({ data: dec.data, width: dec.width, height: dec.height }, 82).data)}`;
    }
    }
    // 원본 보기용 투명 글자 층: 배치는 원래 줄 그대로 두고, 복사할 때 쓸 문단·이음 정보를 함께 싣는다.
    let textLayer = "";
    const tlHtml = (l, pid, join = "") => {
      const g = l.glyphs.find((q) => !/\s/.test(q.c)) || l.glyphs[0];
      return `<div class="tl" data-pid="${pid}" data-join="${join}" data-w="${(l.x1 - l.x0).toFixed(2)}" style="left:${l.x0}pt;top:${l.oy - l.size * 0.88}pt;font-size:${l.size}pt;font-family:${esc(fontCss(g.font, g.hscale))}">${esc(l.text.replace(/\t/g, " "))}</div>`;
    };
    const groupedLines = new Set();
    res.paragraphs.forEach((p, pid) => {
      const lines = p.lines.map((li, k) => ({ li, k, l: res.lines[li] })).filter(({ l }) => l.page === page.index && !l.rotated);
      if (!lines.length) return;
      lines.forEach(({ li }) => groupedLines.add(li));
      const inner = lines.map(({ li, k, l }) => tlHtml(l, `p${pid}`, k < p.lines.length - 1 ? (res.joins[li]?.kind || "") : "")).join("");
      textLayer += `<div class="opara" data-pid="p${pid}">${inner}</div>`;
    });
    res.lines.forEach((l, i) => { if (!groupedLines.has(i) && l.page === page.index && !l.rotated) textLayer += tlHtml(l, `l${i}`); });
    res.furniture.forEach((l, i) => { if (l.page === page.index && !l.rotated) textLayer += tlHtml(l, `f${i}`); });
    pages.push({ index: page.index, W, H, png, layer, textLayer });
  }
  const fontFaceCss = [...fontMap.values()].map((f) => `@font-face{font-family:"${f.family}";src:url(data:font/otf;base64,${b64(f.data)}) format("opentype");font-display:block}`).join("\n");
  return { pages, fontFaceCss, mode, fontCount: fontMap.size };
}

/**
 * 그림 속 글자의 투명 층. 그림은 원본 그대로 두고, 같은 위치·기울기로 투명한 글자를 겹친다.
 *  mode "conv": 변환(줄바꿈 이음) 층 + 원본(줄마다) 층을 함께 넣고, 그림마다 .off 로 전환
 *  mode "orig": 원본(줄마다) 층만
 */
export function renderGraphicText(res, n, mode = "conv") {
  return (res.graphics || []).filter((g) => g.page === n).map((g) => {
    // 화면 p = R(-a)·(q + t)  →  CSS: rotate(-a) translate(t)
    const tr = g.css || `rotate(${(-g.angle * 180 / Math.PI).toFixed(4)}deg) translate(${g.t[0].toFixed(2)}pt,${g.t[1].toFixed(2)}pt)`;
    const orig = renderLayout(g.input, g.res, { lockLines: true, pages: [n], textOnly: true }).pages[0]?.textLayer || "";
    if (mode === "orig") return `<div class="gtext off" data-g="${g.id}" style="transform:${tr}"><div class="gorig">${orig}</div></div>`;
    const conv = (renderLayout(g.input, g.res, { lockLines: true, pages: [n], noGraphics: true }).pages[0]?.layer || "")
      .replace(/data-pid="/g, `data-pid="g${g.id}-`);
    const ls = g.res.lines;
    const bx = ls.length ? [Math.min(...ls.map((l) => l.x0)), Math.min(...ls.map((l) => l.oy - l.size)), Math.max(...ls.map((l) => l.x1)), Math.max(...ls.map((l) => l.oy + l.size * 0.3))] : [0, 0, 0, 0];
    // 그림 자리: OCR 층은 그림 전체(쪽 좌표), 글자 데이터 층은 글자가 모인 영역(기울어진 좌표)
    const outerArea = g.area ? `<div class="garea" data-g="${g.id}" style="left:${g.area[0]}pt;top:${g.area[1]}pt;width:${g.area[2] - g.area[0]}pt;height:${g.area[3] - g.area[1]}pt"></div>` : "";
    const innerArea = g.area ? "" : `<div class="garea" data-g="${g.id}" style="left:${bx[0] - 4}pt;top:${bx[1] - 4}pt;width:${bx[2] - bx[0] + 8}pt;height:${bx[3] - bx[1] + 8}pt"></div>`;
    return outerArea + `<div class="gtext" data-g="${g.id}" style="transform:${tr}">` + innerArea +
      `<div class="gconv">${conv}</div><div class="gorig">${orig}</div></div>`;
  }).join("");
}
