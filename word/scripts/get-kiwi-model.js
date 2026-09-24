// Kiwi 모델 내려받기: npm run get-model
// GitHub 릴리스에서 kiwi_model_v<버전>_base.tgz 를 받아 models/kiwi 에 풉니다(약 88MB → 풀면 약 105MB).
// 모델은 세종계획·모두의 말뭉치로 학습되어 해당 말뭉치의 이용 조건을 따릅니다.
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { createRequire } from "module";
import * as tar from "tar";

const require = createRequire(import.meta.url);
const version = JSON.parse(fs.readFileSync(path.join(path.dirname(require.resolve("kiwi-nlp")), "..", "package.json"), "utf8")).version;
const url = `https://github.com/bab2min/Kiwi/releases/download/v${version}/kiwi_model_v${version}_base.tgz`;
const dest = path.resolve("models", "kiwi");

// 그림 속 글자 읽기(OCR)용 언어 자료: 한국어·영어
const ocrDir = path.resolve("models", "ocr");
fs.mkdirSync(ocrDir, { recursive: true });
for (const lang of ["kor", "eng"]) {
  const f = path.join(ocrDir, `${lang}.traineddata`);
  if (fs.existsSync(f) && fs.statSync(f).size > 100000) continue;
  console.log("OCR 언어 자료 받는 중:", lang);
  const r = await fetch(`https://github.com/tesseract-ocr/tessdata_fast/raw/main/${lang}.traineddata`);
  if (!r.ok) { console.error("다운로드 실패:", lang, r.status); process.exit(1); }
  fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
}

if (fs.existsSync(dest) && fs.readdirSync(dest).length) {
  console.log("Kiwi 모델은 이미 있습니다:", dest);
  process.exit(0);
}
fs.mkdirSync(dest, { recursive: true });
console.log("내려받는 중:", url);
const res = await fetch(url);
if (!res.ok) { console.error("다운로드 실패:", res.status, res.statusText); process.exit(1); }
const total = +res.headers.get("content-length") || 0;
let got = 0, last = 0;
const body = Readable.fromWeb(res.body);
body.on("data", (c) => {
  got += c.length;
  const p = total ? Math.floor((got / total) * 100) : 0;
  if (p >= last + 10) { last = p; process.stdout.write(` ${p}%`); }
});
await pipeline(body, tar.x({ cwd: dest }));
console.log("\n완료:", dest);
