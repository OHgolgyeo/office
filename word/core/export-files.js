import zlib from "zlib";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipBytes(entries) {
  const local = [], central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/\\/g, "/"), "utf8");
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    // store: 압축하지 않고 그대로(ODT·EPUB 의 mimetype 은 규격상 반드시 무압축)
    const deflated = entry.store ? raw : zlib.deflateRawSync(raw, { level: 6 });
    const packed = !entry.store && deflated.length < raw.length ? deflated : raw;
    const method = packed === raw ? 0 : 8;
    const crc = crc32(raw);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x800, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(packed.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    local.push(localHeader, name, packed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(packed.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    central.push(centralHeader, name);
    offset += localHeader.length + name.length + packed.length;
  }
  const centralSize = central.reduce((size, part) => size + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

// images: 따로 넘어온 그림 [{ mime, bytes }] — HTML 에는 src="og-img:번호" 로 들어 있다(같은 그림은 파일 하나).
export function htmlArchive(source, images = []) {
  const entries = [];
  let sequence = 0;
  const extensionOf = (mime) => ({ "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg" })[String(mime).toLowerCase()] || "bin";
  const lifted = new Map();
  const html = String(source).replace(/(<img\b[^>]*?\bsrc=["'])og-img:(\d+)(["'])/gi, (all, before, index, quote) => {
    const im = images[+index];
    if (!im) return all;
    if (!lifted.has(+index)) {
      const name = `assets/image-${String(++sequence).padStart(3, "0")}.${extensionOf(im.mime)}`;
      entries.push({ name, data: Buffer.from(im.bytes.buffer, im.bytes.byteOffset, im.bytes.byteLength) });
      lifted.set(+index, name);
    }
    return before + lifted.get(+index) + quote;
  }).replace(/(<img\b[^>]*?\bsrc=["'])data:([^;,"']+);base64,([^"']+)(["'])/gi, (_all, before, mime, base64, quote) => {
    const extension = ({
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/gif": "gif",
      "image/webp": "webp",
      "image/svg+xml": "svg",
    })[mime.toLowerCase()] || "bin";
    const name = `assets/image-${String(++sequence).padStart(3, "0")}.${extension}`;
    entries.push({ name, data: Buffer.from(base64, "base64") });
    return before + name + quote;
  });
  return zipBytes([{ name: "index.html", data: Buffer.from(html, "utf8") }, ...entries]);
}

export function svgSize(svg) {
  const tag = String(svg).match(/<svg\b[^>]*>/i)?.[0] || "";
  const viewBox = tag.match(/\bviewBox=["']\s*[\d.+-]+\s+[\d.+-]+\s+([\d.+-]+)\s+([\d.+-]+)["']/i);
  const width = tag.match(/\bwidth=["']([\d.+-]+)/i);
  const height = tag.match(/\bheight=["']([\d.+-]+)/i);
  return { width: +(viewBox?.[1] || width?.[1] || 595), height: +(viewBox?.[2] || height?.[1] || 842) };
}

export function pdfPrintStreamShell() {
  return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src \'none\'"><style id="page-rules"></style><style>*{box-sizing:border-box}html,body{margin:0;padding:0}.page{break-after:page}.page:last-child{break-after:auto}.page>svg{display:block;width:100%;height:100%}</style></head><body></body></html>';
}

/** SVG 한 쪽을 인쇄 DOM 조각으로 만든다. names는 스트림 동안 유지해 같은 크기의 @page 규칙을 공유한다. */
export function pdfPrintStreamPage(svg, names = new Map()) {
  const { width, height } = svgSize(svg), key = `${width}x${height}`;
  let name = names.get(key), rule = "";
  if (!name) {
    name = `p${names.size}`; names.set(key, name);
    rule = `@page ${name}{size:${width}px ${height}px;margin:0}.${name}{page:${name};width:${width}px;height:${Math.max(1, height - 1)}px}`;
  }
  return { rule, page: `<section class="page ${name}">${String(svg).trim()}</section>` };
}

export function pdfPrintHtml(svgs) {
  const { shell, pages } = pdfPrintParts(svgs);
  return shell.replace("<body></body>", `<body>${pages.join("")}</body>`);
}

/** PDF 인쇄용 HTML 을 틀(쪽 크기 스타일, 빈 body)과 쪽 조각들로 나눠 준다.
 *  그림이 많은 문서는 한 덩어리 HTML 이 수 MB 가 되어 data 주소(약 2MB 한도)나 파일로도 열리지 않았다 →
 *  작은 틀을 먼저 열고 쪽 조각을 하나씩 붙인다(main.js pdfFromSvgs). */
export function pdfPrintParts(svgs) {
  if (!Array.isArray(svgs) || !svgs.length) throw new Error("내보낼 쪽이 없습니다.");
  // 쪽 SVG 의 크기는 단위 없는 사용자 단위 = CSS px(엔진은 96dpi px, A4 = 793.7×1122.5). 예전에는 pt 로 써서 쪽이 1.33배 컸다.
  // 같은 크기의 쪽은 쪽 설정(@page) 하나를 같이 쓴다. 예전에는 쪽마다 다른 이름(p0, p1 …)을 줘서, 이름이 바뀔 때의 강제
  // 쪽 나눔과 break-after 가 겹쳐 쪽마다 빈 쪽이 하나씩 끼었다(6쪽 문서가 12쪽).
  const rules = [], names = new Map();
  const pages = svgs.map((svg) => {
    const part = pdfPrintStreamPage(svg, names); if (part.rule) rules.push(part.rule); return part.page;
  });
  // 쪽 상자에 overflow:hidden 을 두면 Chromium 인쇄가 쪽마다 빈 쪽을 하나씩 더 만든다(실측: 3쪽 → 6쪽). 쪽 그림은 쪽 크기에
  // 딱 맞으므로 넘칠 것이 없어 두지 않는다.
  const shell = pdfPrintStreamShell().replace('<style id="page-rules"></style>', `<style id="page-rules">${rules.join("")}</style>`);
  return { shell, pages };
}
