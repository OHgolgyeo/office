// 작은 zip 읽기(무압축·deflate). Word(.docx) 파일의 부품을 꺼내는 데 쓴다.
import zlib from "zlib";

export function unzipEntries(buf) {
  const b = Buffer.from(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("zip 파일이 아닙니다.");
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let k = 0; k < count; k++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error("zip 목록이 손상되었습니다.");
    const method = b.readUInt16LE(p + 10), csize = b.readUInt32LE(p + 20), nlen = b.readUInt16LE(p + 28), xlen = b.readUInt16LE(p + 30), clen = b.readUInt16LE(p + 32);
    const local = b.readUInt32LE(p + 42), name = b.slice(p + 46, p + 46 + nlen).toString("utf8");
    const lnlen = b.readUInt16LE(local + 26), lxlen = b.readUInt16LE(local + 28);
    const data = b.slice(local + 30 + lnlen + lxlen, local + 30 + lnlen + lxlen + csize);
    if (!name.endsWith("/")) out.set(name, method === 0 ? data : method === 8 ? zlib.inflateRawSync(data) : null);
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

// Word 파일에서 본문·스타일·관계·그림을 꺼낸다(글자는 화면에서 XML 로 읽어 중간 구조로 바꾼다)
export function docxParts(buf) {
  const z = unzipEntries(buf);
  const text = (n) => (z.get(n) ? z.get(n).toString("utf8") : "");
  const document = text("word/document.xml");
  if (!document) throw new Error("Word 문서의 본문을 찾지 못했습니다.");
  const media = {};
  for (const [n, data] of z) if (n.startsWith("word/media/") && data) media[n.slice(5)] = data.toString("base64");   // "media/…" 로 찾는다
  return { document, styles: text("word/styles.xml"), rels: text("word/_rels/document.xml.rels"), media };
}
