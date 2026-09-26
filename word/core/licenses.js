// 제품 정보의 라이선스: 오골계 워드 라이선스(LICENSE)와 함께 쓰는 오픈소스들의 원래 라이선스 원문.
// 오픈소스 원문은 설치된 폴더의 라이선스 파일을 그대로 읽는다(요약·수정하지 않는다). 각 오픈소스가
// 다시 쓰는 부품(npm 의존성)도 함께 모은다. 인터넷에서 받아 둔 원문은 licenses/extra 에 있다.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const at = (...p) => path.join(ROOT, ...p);

// 제품 정보에 보이는 순서. packages 의 부품은 그 부품이 쓰는 부품까지 함께 싣는다(deep: false 면 그 부품만).
// besideApp: 부품 폴더가 없는 설치본에서 실행 파일 옆에서 찾을 라이선스 파일.
const ITEMS = [
  { id: "rhwp", name: "rhwp", use: "한글 문서 편집 화면과 문서 엔진", homepage: "https://github.com/edwardkim/rhwp",
    packages: ["@rhwp/core", "@rhwp/editor"],
    files: [["rhwp 라이선스", "vendor/rhwp-studio/LICENSE.rhwp.txt"], ["rhwp가 쓰는 오픈소스", "vendor/rhwp-studio/THIRD_PARTY_LICENSES.rhwp.md"],
      ["편집 화면 글꼴 목록과 라이선스", "vendor/rhwp-studio/fonts/FONTS.md"], ["Source Han Serif K 글꼴 라이선스(SIL OFL 1.1)", "vendor/rhwp-studio/fonts/SourceHanSerifK-OFL.txt"]] },
  { id: "pdfium", name: "PDFium", use: "PDF 보기와 글자 읽기", homepage: "https://pdfium.googlesource.com/pdfium/", license: "BSD-3-Clause, Apache-2.0",
    files: [["PDFium 라이선스", "licenses/extra/pdfium.LICENSE.txt"]], packages: ["@hyzyla/pdfium"] },
  { id: "tesseract", name: "Tesseract.js", use: "그림·스캔 속 글자 인식(OCR)", homepage: "https://github.com/naptha/tesseract.js",
    packages: ["tesseract.js", "tesseract.js-core"], files: [["글자 인식 학습 자료(tessdata_fast) 라이선스", "licenses/extra/tessdata_fast.LICENSE.txt"]] },
  { id: "kiwi", name: "Kiwi", use: "한국어 띄어쓰기 복원", homepage: "https://github.com/bab2min/Kiwi", license: "Apache-2.0",
    packages: ["kiwi-nlp"], files: [["Kiwi와 언어 모델 라이선스", "licenses/extra/kiwi-model.LICENSE.txt"]] },
  { id: "phosphor", name: "Phosphor Icons", use: "아이콘", homepage: "https://phosphoricons.com", packages: ["@phosphor-icons/web"] },
  { id: "pngjs", name: "pngjs", use: "그림 처리(PNG)", homepage: "https://github.com/pngjs/pngjs", packages: ["pngjs"] },
  { id: "jpeg-js", name: "jpeg-js", use: "그림 처리(JPEG)", homepage: "https://github.com/jpeg-js/jpeg-js", packages: ["jpeg-js"] },
  { id: "electron-updater", name: "electron-updater", use: "자동 업데이트", homepage: "https://github.com/electron-userland/electron-builder", packages: ["electron-updater"] },
  { id: "tar", name: "node-tar", use: "개발 도구(편집 화면 만들기·모델 받기)", homepage: "https://github.com/isaacs/node-tar", packages: ["tar"] },
  { id: "electron", name: "Electron", use: "데스크톱 앱(Chromium 포함)", homepage: "https://www.electronjs.org", license: "MIT (Chromium은 여러 라이선스)",
    packages: ["electron"], deep: false, besideApp: [["Electron 라이선스", "LICENSE.electron.txt"], ["Electron 라이선스", "LICENSE"]], chromium: true },
];

const LICENSE_FILE = /^(licen[cs]e|copying|notice)/i;
const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return null; } };
function packageDir(name, from = ROOT) {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const d = path.join(dir, "node_modules", name);
    if (fs.existsSync(path.join(d, "package.json"))) return d;
    if (dir === ROOT || path.dirname(dir) === dir) return null;
  }
}
// 부품과 그 부품이 쓰는 부품들(중복 없이)
function collect(names, deep) {
  const out = new Map();
  const walk = (name, from) => {
    const dir = packageDir(name, from);
    if (!dir) return;
    let pkg = {};
    try { pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")); } catch { /* 설명 없음 */ }
    const key = `${pkg.name || name}@${pkg.version || ""}`;
    if (out.has(key)) return;
    out.set(key, { dir, pkg });
    if (deep) for (const dep of Object.keys(pkg.dependencies || {})) walk(dep, dir);
  };
  for (const n of names) walk(n, ROOT);
  return [...out.values()];
}
const licenseOf = (pkg) => typeof pkg.license === "string" ? pkg.license : (pkg.license?.type || (pkg.licenses || []).map((l) => l.type || l).join(", ") || "적혀 있지 않음");

/** 제품 정보 첫 화면: 오골계 워드 라이선스 전문과 오픈소스 목록 */
export function licenseSummary() {
  let version = "";
  try { version = JSON.parse(fs.readFileSync(at("package.json"), "utf8")).version; } catch { /* 모름 */ }
  return {
    app: { name: "오골계 워드", version },
    license: read(at("LICENSE")) || "",
    items: ITEMS.map((it) => {
      const main = collect([it.packages[0]], false)[0];
      return { id: it.id, name: it.name, use: it.use, homepage: it.homepage, license: it.license || (main ? licenseOf(main.pkg) : "") };
    }),
  };
}

/** 오픈소스 하나의 원래 라이선스 원문들 */
export function licenseDetail(id) {
  const it = ITEMS.find((x) => x.id === id);
  if (!it) return null;
  const sections = [];
  for (const [title, file] of it.files || []) { const text = read(at(file)); if (text) sections.push({ title, text }); }
  for (const { dir, pkg } of collect(it.packages, it.deep !== false)) {
    const files = fs.readdirSync(dir).filter((f) => LICENSE_FILE.test(f)).sort();
    const title = `${pkg.name}${pkg.version ? " " + pkg.version : ""} (${licenseOf(pkg)})`;
    if (!files.length) sections.push({ title, text: `이 부품에는 라이선스 파일이 들어 있지 않습니다. 부품 정보(package.json)에 적힌 라이선스: ${licenseOf(pkg)}` });
    for (const f of files) sections.push({ title: files.length > 1 ? `${title} — ${f}` : title, text: read(path.join(dir, f)) || "" });
  }
  // 설치본에는 node_modules 의 부품 폴더가 없고, 라이선스가 실행 파일 옆에 있다
  if (!sections.length) for (const [title, file] of it.besideApp || []) { const text = read(path.join(path.dirname(process.execPath), file)); if (text) { sections.push({ title, text }); break; } }
  return { id: it.id, name: it.name, use: it.use, homepage: it.homepage, license: licenseSummary().items.find((x) => x.id === id)?.license, chromium: !!it.chromium, sections };
}

/** Chromium 라이선스 모음(Electron 과 함께 배포되는 HTML). 개발 중에는 node_modules, 설치본에서는 실행 파일 옆 */
export function chromiumLicensePath() {
  const candidates = [path.join(path.dirname(process.execPath), "LICENSES.chromium.html"), at("node_modules", "electron", "dist", "LICENSES.chromium.html")];
  return candidates.find((f) => fs.existsSync(f)) || null;
}
