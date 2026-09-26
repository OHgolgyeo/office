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

export function htmlArchive(source) {
  const entries = [];
  let sequence = 0;
  const html = String(source).replace(/(<img\b[^>]*?\bsrc=["'])data:([^;,"']+);base64,([^"']+)(["'])/gi, (_all, before, mime, base64, quote) => {
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

function svgSize(svg) {
  const tag = String(svg).match(/<svg\b[^>]*>/i)?.[0] || "";
  const viewBox = tag.match(/\bviewBox=["']\s*[\d.+-]+\s+[\d.+-]+\s+([\d.+-]+)\s+([\d.+-]+)["']/i);
  const width = tag.match(/\bwidth=["']([\d.+-]+)/i);
  const height = tag.match(/\bheight=["']([\d.+-]+)/i);
  return { width: +(viewBox?.[1] || width?.[1] || 595), height: +(viewBox?.[2] || height?.[1] || 842) };
}

export function pdfPrintHtml(svgs) {
  if (!Array.isArray(svgs) || !svgs.length) throw new Error("내보낼 쪽이 없습니다.");
  const rules = [];
  const pages = svgs.map((svg, index) => {
    const { width, height } = svgSize(svg);
    rules.push(`@page p${index}{size:${width}pt ${height}pt;margin:0}.p${index}{page:p${index};width:${width}pt;height:${height}pt}`);
    return `<section class="page p${index}">${svg}</section>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src 'none'"><style>${rules.join("")}*{box-sizing:border-box}html,body{margin:0;padding:0}.page{overflow:hidden;break-after:page}.page:last-child{break-after:auto}.page>svg{display:block;width:100%;height:100%}</style></head><body>${pages}</body></html>`;
}
