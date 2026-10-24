// 일본어 OCR의 작은 후리가나 줄을 바로 아래 본문 한자에 연결한다.
// OCR 엔진은 루비를 별도 글줄로 돌려주므로 그대로 문단화하면 작은 읽기가
// 독립 문장으로 끼어든다.
const chars = (s) => [...String(s || "")];
const kana = /[ぁ-ゟ゠-ヿー・]/u;
const han = /\p{Script=Han}/u;
const letter = /[\p{L}\p{N}]/u;
const boxOf = (line) => {
  const ws = (line?.words || []).filter((w) => w?.bbox);
  return ws.length ? { x0: Math.min(...ws.map((w) => w.bbox.x0)), y0: Math.min(...ws.map((w) => w.bbox.y0)),
    x1: Math.max(...ws.map((w) => w.bbox.x1)), y1: Math.max(...ws.map((w) => w.bbox.y1)) } : null;
};
function kanaRatio(text) {
  const meaningful = chars(text).filter((c) => letter.test(c) || kana.test(c));
  return meaningful.length ? meaningful.filter((c) => kana.test(c)).length / meaningful.length : 0;
}
function baseSpan(text, base, ruby) {
  const cs = chars(text), n = cs.length;
  if (!n || base.x1 <= base.x0) return null;
  const from = Math.max(0, Math.floor((ruby.x0 - base.x0) / (base.x1 - base.x0) * n) - 1);
  const to = Math.min(n, Math.ceil((ruby.x1 - base.x0) / (base.x1 - base.x0) * n) + 1);
  const hit = [];
  for (let i = from; i < to; i++) {
    const cx = base.x0 + (i + .5) * (base.x1 - base.x0) / n;
    if (cx >= ruby.x0 && cx <= ruby.x1 && han.test(cs[i])) hit.push(i);
  }
  if (!hit.length) return null;
  let start = Math.min(...hit), end = Math.max(...hit) + 1;
  while (start > 0 && han.test(cs[start - 1]) && base.x0 + start * (base.x1 - base.x0) / n >= ruby.x0 - (ruby.x1 - ruby.x0) * .2) start--;
  while (end < n && han.test(cs[end]) && base.x0 + end * (base.x1 - base.x0) / n <= ruby.x1 + (ruby.x1 - ruby.x0) * .2) end++;
  return { start, end };
}

/** base._ruby=[{start,end,text}], ruby._isRuby=true 를 줄 배열에 표시한다. */
export function associateJapaneseRuby(lines) {
  const rows = (lines || []).map((line) => ({ line, box: boxOf(line) })).filter((x) => x.box);
  for (const r of rows) {
    const rh = r.box.y1 - r.box.y0, reading = String(r.line.text || "").trim();
    if (!reading || reading.length > 24 || kanaRatio(reading) < .72) continue;
    let best = null;
    for (const b of rows) {
      if (b === r || !han.test(String(b.line.text || ""))) continue;
      const bh = b.box.y1 - b.box.y0;
      if (rh > bh * .72 || b.box.y0 < r.box.y0) continue;
      const gap = b.box.y0 - r.box.y1;
      if (gap < -rh * .45 || gap > bh * .8) continue;
      const ox = Math.max(0, Math.min(r.box.x1, b.box.x1) - Math.max(r.box.x0, b.box.x0));
      if (ox < Math.min(r.box.x1 - r.box.x0, b.box.x1 - b.box.x0) * .3) continue;
      const span = baseSpan(b.line.text, b.box, r.box); if (!span) continue;
      const score = Math.abs(gap) + Math.abs((r.box.x0 + r.box.x1 - b.box.x0 - b.box.x1) / 2) * .08;
      if (!best || score < best.score) best = { ...b, ...span, score };
    }
    if (!best) continue;
    (best.line._ruby ||= []).push({ start: best.start, end: best.end, text: reading, bbox: r.box });
    r.line._isRuby = true;
  }
  for (const { line } of rows) if (line._ruby) line._ruby.sort((a, b) => a.start - b.start || a.end - b.end);
  return lines;
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
export function renderJapaneseRuby(text, pairs, mode = "position") {
  const cs = chars(text), valid = (pairs || []).filter((p) => p.start >= 0 && p.end > p.start && p.end <= cs.length);
  if (!valid.length) return { text: String(text || ""), html: esc(text) };
  let plain = "", html = "", at = 0;
  for (const p of valid) {
    if (p.start < at) continue;
    const before = cs.slice(at, p.start).join(""), base = cs.slice(p.start, p.end).join(""), ruby = String(p.text || "");
    plain += before + base + `（${ruby}）`;
    html += esc(before) + (mode === "parentheses" ? `${esc(base)}（${esc(ruby)}）` : `<ruby>${esc(base)}<rt>${esc(ruby)}</rt></ruby>`);
    at = p.end;
  }
  plain += cs.slice(at).join(""); html += esc(cs.slice(at).join(""));
  return { text: plain, html };
}
