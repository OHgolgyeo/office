// 원본 보기의 쪽 그림·쪽 목록 미리보기(JPEG)를 앱 본체 쪽에서 맡는다: 그리기는 쪽 그림 작업 스레드(page-renderer.js),
// JPEG 은 본체의 내장 변환(nativeImage, 수 ms). PDF 세션은 다른 작업 스레드에 있어도 그림은 PDF 바이트만 있으면 된다.
// 쪽 그림 작업 스레드를 못 쓰면 fallback(쪽, 배율, 품질)으로 세션 쪽에 맡긴다.
import { openPageRenderer } from "./page-renderer.js";

const MB = 1024 * 1024;
const PAGE_JPEG_CACHE_BYTES = Math.max(12 * MB, Number(process.env.OG_PDF_PAGE_CACHE_MB || 48) * MB);
const PAGE_THUMB_CACHE_BYTES = Math.max(4 * MB, Number(process.env.OG_PDF_THUMB_CACHE_MB || 12) * MB);

function putLru(map, key, value, byteLimit, countLimit) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  let bytes = 0;
  for (const v of map.values()) bytes += v.byteLength || 0;
  while (map.size > 1 && (map.size > countLimit || bytes > byteLimit)) {
    const oldest = map.keys().next().value;
    bytes -= map.get(oldest).byteLength || 0; map.delete(oldest);
  }
}

export class PageImages {
  /** @param bytes PDF 바이트  @param pageSizes [{w,h}]  @param fallback (kind, n, scale) => Promise<JPEG> */
  constructor(bytes, pageSizes, fallback) {
    this.pageSizes = pageSizes;
    this.fallback = fallback;
    try { this.renderer = openPageRenderer(bytes); } catch (e) { console.warn("[쪽 그림] 작업 스레드 없이 그립니다:", e?.message || e); this.renderer = null; }
    this.pages = new Map();     // `${n}@${배율}` → JPEG
    this.thumbs = new Map();    // n → JPEG
    this.inFlight = new Map();
    this.closed = false;
  }
  /** 원본 쪽 그림(JPEG), 한 번 만든 것은 기억 */
  image(n, scale = 1.25) {
    const bucket = Math.round(Math.max(.6, Math.min(2.75, scale)) * 4) / 4;
    return this.get(this.pages, `${n}@${bucket}`, "page", n, bucket, 82, PAGE_JPEG_CACHE_BYTES, 8);
  }
  /** 쪽 목록의 작은 미리보기 그림(JPEG), 폭 약 240px */
  thumb(n) {
    const size = this.pageSizes[n] || { w: 595, h: 842 };
    return this.get(this.thumbs, n, "thumb", n, Math.min(0.5, 240 / Math.max(size.w, 1)), 75, PAGE_THUMB_CACHE_BYTES, 32);
  }
  get(cache, key, kind, n, scale, quality, byteLimit, countLimit) {
    if (cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return Promise.resolve(v); }
    const fk = kind + ":" + key;
    if (this.inFlight.has(fk)) return this.inFlight.get(fk);
    const viaSession = () => this.fallback(kind, n, scale);
    const p = (this.renderer ? this.renderer.render(n, scale, quality).catch(viaSession) : viaSession())
      .then((jpeg) => { if (jpeg && !this.closed) putLru(cache, key, jpeg, byteLimit, countLimit); return jpeg; })
      .finally(() => this.inFlight.delete(fk));
    this.inFlight.set(fk, p);
    return p;
  }
  /** 다시 만들 수 있는 화면용 JPEG 만 버린다(다른 PDF 탭을 볼 때) */
  trim() { this.pages.clear(); this.thumbs.clear(); }
  close() {
    this.closed = true; this.trim();
    try { this.renderer?.close(); } catch { /* 이미 끝남 */ }
    this.renderer = null;
  }
}
