// rhwp 편집 화면(rhwp-studio)을 로컬용으로 빌드해서 vendor/rhwp-studio 에 넣는다.
// @rhwp/core 와 같은 버전의 소스를 GitHub 에서 받아, npm 의 @rhwp/core 빌드 결과물을 엔진으로 쓴다.
// 필요: 인터넷(처음 한 번), Node 20+. 외부 웹폰트는 끄고(로컬 전용) 빌드한다.
import fs from "fs";
import path from "path";
import os from "os";
import { spawnSync } from "child_process";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { createRequire } from "module";
import * as tar from "tar";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const coreDir = path.dirname(require.resolve("@rhwp/core"));
const version = JSON.parse(fs.readFileSync(path.join(coreDir, "package.json"), "utf8")).version;
const work = fs.mkdtempSync(path.join(os.tmpdir(), "rhwp-"));
const run = (cmd, args, cwd, env = {}) => {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, ...env } });
  if (r.status !== 0) { console.error(`실패: ${cmd} ${args.join(" ")}`); process.exit(1); }
};

console.log(`rhwp v${version} 소스 받는 중…`);
const res = await fetch(`https://codeload.github.com/edwardkim/rhwp/tar.gz/refs/tags/v${version}`);
if (!res.ok) { console.error("다운로드 실패", res.status); process.exit(1); }
await pipeline(Readable.fromWeb(res.body), tar.x({ cwd: work }));
const src = path.join(work, `rhwp-${version}`);
fs.mkdirSync(path.join(src, "pkg"), { recursive: true });
for (const f of ["rhwp.js", "rhwp_bg.wasm", "rhwp.d.ts", "rhwp_bg.wasm.d.ts"]) fs.copyFileSync(path.join(coreDir, f), path.join(src, "pkg", f));

const studio = path.join(src, "rhwp-studio");
console.log("편집 화면 의존성 설치 중…");
run("npm", ["ci", "--no-audit", "--no-fund"], studio);
console.log("빌드 중…");
run("npx", ["vite", "build", "--base", "./"], studio, { RHWP_WITHOUT_HWPCTRL: "1", RHWP_DISABLE_EXTERNAL_WEBFONTS: "1" });

const dest = path.join(root, "vendor", "rhwp-studio");
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(path.join(studio, "dist"), dest, { recursive: true });
// 로컬 앱에는 필요 없는 것 정리: 예제 문서, 오프라인 캐시(서비스 워커 — 실행마다 포트가 바뀌어 캐시가 쌓인다)
fs.rmSync(path.join(dest, "samples"), { recursive: true, force: true });
for (const f of fs.readdirSync(dest)) if (/^(sw\.js|registerSW\.js|workbox-.*\.js)$/.test(f)) fs.rmSync(path.join(dest, f));
const idx = path.join(dest, "index.html");
fs.writeFileSync(idx, fs.readFileSync(idx, "utf8").replace(/<script[^>]*registerSW\.js[^>]*><\/script>/g, "").replace(/<link rel="manifest"[^>]*>/g, ""));
fs.copyFileSync(path.join(src, "LICENSE"), path.join(dest, "LICENSE.rhwp.txt"));
fs.copyFileSync(path.join(src, "THIRD_PARTY_LICENSES.md"), path.join(dest, "THIRD_PARTY_LICENSES.rhwp.md"));
fs.rmSync(work, { recursive: true, force: true });
console.log("완료:", dest);
