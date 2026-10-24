// 스캔 페이지 속 사진·삽화 보조 검출기.
// 새 AI 모델을 띄우지 않고, OCR 낱말을 지운 뒤 남은 잉크 덩어리를 낮은 해상도 격자에서 찾는다.
const area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const overlap = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

export function findRasterImageRegions(image, pageSize, textWords = [], existing = []) {
  const data = image?.data, w = Number(image?.w || 0), h = Number(image?.h || 0);
  const W = Number(pageSize?.w || pageSize?.width || 0), H = Number(pageSize?.h || pageSize?.height || 0);
  if (!data || !w || !h || !W || !H) return [];
  const sx = w / W, sy = h / H, masked = new Uint8Array(w * h), ink = new Uint8Array(w * h);
  for (const word of textWords) {
    const x0 = Math.max(0, Math.floor(Number(word.x0 || 0) * sx) - 3), y0 = Math.max(0, Math.floor(Number(word.y0 || 0) * sy) - 3);
    const x1 = Math.min(w, Math.ceil(Number(word.x1 || 0) * sx) + 3), y1 = Math.min(h, Math.ceil(Number(word.y1 || 0) * sy) + 3);
    for (let y = y0; y < y1; y++) masked.fill(1, y * w + x0, y * w + x1);
  }
  // 바탕색은 쪽 가장자리(바깥 4%)에서 가장 흔한 색으로 잡는다. 예전에는 흰 종이만 가정해(밝기 < 215 = 잉크)
  // 색 바탕 표지·누런 종이에서는 쪽 전체가 한 덩어리 잉크가 되어 그 안의 사진을 하나도 찾지 못했다.
  // 색이 바뀌는 바탕(그러데이션 표지)도 있어 가로 띠마다 왼쪽·오른쪽 여백 색을 따로 재고, 그 사이는 고르게 잇는다
  const strip = Math.max(4, Math.round(h * .04)), edge = Math.max(2, Math.round(Math.min(w, h) * .04)), bgs = [];
  const page = marginColor(data, w, 0, h, 0, edge, w - edge) || [255, 255, 255];
  for (let y0 = 0; y0 < h; y0 += strip) {
    const y1 = Math.min(h, y0 + strip);
    bgs.push([marginColor(data, w, y0, y1, 0, edge) || page, marginColor(data, w, y0, y1, w - edge, w) || page]);
  }
  for (let i = 0, p = 0; i < w * h; i++, p += 3) {
    if (masked[i]) continue;
    const [l, r] = bgs[Math.floor(i / w / strip)], t = (i % w) / Math.max(1, w - 1);
    const d = Math.max(Math.abs(data[p] - (l[0] + (r[0] - l[0]) * t)), Math.abs(data[p + 1] - (l[1] + (r[1] - l[1]) * t)), Math.abs(data[p + 2] - (l[2] + (r[2] - l[2]) * t)));
    if (d > 40) ink[i] = 1;
  }
  // 표 테두리·구분선이 사진과 글 영역을 하나로 잇지 않게 긴 가로/세로 선을 지운다.
  // 얇은 선만 지운다: 긴 줄의 위·아래(왼·오른) 몇 칸 떨어진 곳이 대부분 비어 있어야 선이다.
  // 예전에는 긴 줄이면 모두 지워, 꽉 찬 사진은 줄마다 지워져 통째로 사라졌다.
  const minHRun = Math.max(30, Math.round(w * .12)), minVRun = Math.max(30, Math.round(h * .12)), gap = 4, src = ink.slice();
  const thinH = (y, x0, x1) => { let hit = 0, n = 0; for (let x = x0; x < x1; x += 3) { n++; if ((y >= gap && src[(y - gap) * w + x]) || (y + gap < h && src[(y + gap) * w + x])) hit++; } return hit < n * .5; };
  const thinV = (x, y0, y1) => { let hit = 0, n = 0; for (let y = y0; y < y1; y += 3) { n++; if ((x >= gap && src[y * w + x - gap]) || (x + gap < w && src[y * w + x + gap])) hit++; } return hit < n * .5; };
  for (let y = 0; y < h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      if (x < w && src[y * w + x]) { if (start < 0) start = x; continue; }
      if (start >= 0 && x - start >= minHRun && thinH(y, start, x)) ink.fill(0, y * w + start, y * w + x);
      start = -1;
    }
  }
  for (let x = 0; x < w; x++) {
    let start = -1;
    for (let y = 0; y <= h; y++) {
      if (y < h && src[y * w + x]) { if (start < 0) start = y; continue; }
      if (start >= 0 && y - start >= minVRun && thinV(x, start, y)) for (let yy = start; yy < y; yy++) ink[yy * w + x] = 0;
      start = -1;
    }
  }
  const block = Math.max(6, Math.round(Math.min(w, h) / 105)), cols = Math.ceil(w / block), rows = Math.ceil(h / block);
  const active = new Uint8Array(cols * rows), original = new Uint8Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    const x1 = Math.min(w, (cx + 1) * block), y1 = Math.min(h, (cy + 1) * block), total = (x1 - cx * block) * (y1 - cy * block);
    let count = 0;
    for (let y = cy * block; y < y1; y++) for (let x = cx * block; x < x1; x++) count += ink[y * w + x];
    if (count >= Math.max(2, total * .035)) original[cy * cols + cx] = 1;
  }
  // 선화의 끊어진 획을 한 칸 범위에서 잇는다.
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    let near = 0;
    for (let yy = Math.max(0, cy - 1); yy <= Math.min(rows - 1, cy + 1); yy++) for (let xx = Math.max(0, cx - 1); xx <= Math.min(cols - 1, cx + 1); xx++) near += original[yy * cols + xx];
    if (original[cy * cols + cx] || near >= 2) active[cy * cols + cx] = 1;
  }
  const seen = new Uint8Array(active.length), candidates = [];
  for (let seed = 0; seed < active.length; seed++) {
    if (!active[seed] || seen[seed]) continue;
    const queue = [seed]; seen[seed] = 1; let minX = cols, minY = rows, maxX = 0, maxY = 0, cells = 0;
    while (queue.length) {
      const at = queue.pop(), x = at % cols, y = Math.floor(at / cols); cells++;
      // 테두리는 실제 잉크 칸으로만 잡는다(획을 잇느라 덧붙인 둘레 한 칸만큼 상자가 커지지 않게)
      if (original[at]) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
      for (let yy = Math.max(0, y - 1); yy <= Math.min(rows - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(cols - 1, x + 1); xx++) {
        const next = yy * cols + xx; if (active[next] && !seen[next]) { seen[next] = 1; queue.push(next); }
      }
    }
    const px = [minX * block, minY * block, Math.min(w, (maxX + 1) * block), Math.min(h, (maxY + 1) * block)];
    const bbox = [px[0] / sx, px[1] / sy, px[2] / sx, px[3] / sy], bw = bbox[2] - bbox[0], bh = bbox[3] - bbox[1];
    const fraction = area(bbox) / (W * H), aspect = bw / Math.max(1, bh), density = cells / Math.max(1, (maxX - minX + 1) * (maxY - minY + 1));
    // 표지의 큰 사진(쪽의 절반 넘게)도 찾는다. 쪽을 거의 다 덮는 덩어리는 쪽 그림 자체다
    if (bw < 32 || bh < 36 || fraction < .008 || fraction > .8 || aspect < .2 || aspect > 5 || density < .12) continue;
    if ((aspect > 2.8 && bh < H * .14) || (aspect < .3 && bw < W * .1)) continue; // 제목 띠·측면 색인
    if (existing.some((old) => overlap(old.bbox || old, bbox) >= .65 * Math.min(area(old.bbox || old), area(bbox)))) continue;
    candidates.push({ label: "raster_image", score: Math.min(.86, .42 + density * .35), bbox });
  }
  return candidates.sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
}

/** y0~y1 줄의 x0~x1 칸(skip0~skip1 은 건너뜀)에서 가장 흔한 색(채널마다 16단계로 묶어 센다)의 평균.
 *  그 색이 절반을 넘지 못하면(여백까지 사진이 찬 띠) null */
function marginColor(data, w, y0, y1, x0, x1, skip0 = -1, skip1 = -1) {
  const bins = new Map(); let n = 0;
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
    if (x >= skip0 && x < skip1) continue;
    const p = (y * w + x) * 3, key = (data[p] >> 4) << 8 | (data[p + 1] >> 4) << 4 | (data[p + 2] >> 4);
    const b = bins.get(key) || [0, 0, 0, 0]; b[0]++; b[1] += data[p]; b[2] += data[p + 1]; b[3] += data[p + 2]; bins.set(key, b); n++;
  }
  let best = null;
  for (const b of bins.values()) if (!best || b[0] > best[0]) best = b;
  return best && best[0] >= n * .5 ? [best[1] / best[0], best[2] / best[0], best[3] / best[0]] : null;
}
