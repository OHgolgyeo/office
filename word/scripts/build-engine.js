// rhwp 편집 엔진(wasm)을 오골계 워드 패치를 적용해 빌드한다: npm run build-engine
// @rhwp/core 와 같은 버전의 소스를 GitHub 에서 받아 engine/patches/*.patch 를 적용하고,
// .toolchain(Rust·wasm-pack, D:\ogw-toolchain 의 바로가기)으로 빌드해 engine/pkg 에 넣는다.
// 그다음 npm run build-studio 가 이 엔진으로 편집 화면을 만든다.
//
// 필요: 인터넷(처음 한 번), Git(패치 적용), sh(Git for Windows 에 포함), .toolchain
//   .toolchain 은 GNU 링커가 한글·띄어쓰기 경로를 못 읽어 영문 경로(D:\ogw-toolchain)에 두고 바로가기로 연결한다.
// 시험용으로 빠르게 빌드하려면 FAST=1 (LTO 끔, 결과물이 조금 크고 느리다).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { createRequire } from "module";
import * as tar from "tar";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");   // 한글 경로도 그대로
const version = JSON.parse(fs.readFileSync(path.join(path.dirname(require.resolve("@rhwp/core")), "package.json"), "utf8")).version;
const fail = (msg) => { console.error(msg); process.exit(1); };

// 도구 위치(바로가기의 실제 경로). 링커 때문에 영문 경로여야 한다.
const toolLink = path.join(root, ".toolchain");
if (!fs.existsSync(toolLink)) fail("빌드 도구가 없습니다: .toolchain (Rust·wasm-pack 설치 필요, README 참고)");
const tools = fs.realpathSync(toolLink);
if (/[^\x20-\x7e]|\s/.test(tools)) fail(`빌드 도구 경로에 한글이나 띄어쓰기가 있으면 링커가 실패합니다: ${tools}`);
const T = tools.replace(/\\/g, "/");
const env = {
  ...process.env,
  RUSTUP_HOME: `${T}/rustup`, CARGO_HOME: `${T}/cargo`, CARGO_TARGET_DIR: `${T}/target`, WASM_PACK_CACHE: `${T}/wasm-pack-cache`,
  PATH: `${path.join(tools, "cargo", "bin")}${path.delimiter}${process.env.PATH}`,
};
const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", env });
  if (r.status !== 0) fail(`실패: ${cmd} ${args.join(" ")}`);
};

const patches = fs.readdirSync(path.join(root, "engine", "patches")).filter((f) => f.startsWith(`rhwp-${version}-`) && f.endsWith(".patch")).sort();
if (!patches.length) fail(`rhwp ${version} 용 패치가 없습니다(engine/patches). @rhwp/core 를 올렸다면 패치를 새 버전에 맞춰야 합니다.`);

// 소스 받기(작업 폴더도 영문 경로인 도구 폴더 안)
const work = path.join(tools, "work");
const src = path.join(work, `rhwp-${version}`);
fs.rmSync(src, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
console.log(`rhwp v${version} 소스 받는 중…`);
const res = await fetch(`https://codeload.github.com/edwardkim/rhwp/tar.gz/refs/tags/v${version}`);
if (!res.ok) fail(`다운로드 실패 ${res.status}`);
await pipeline(Readable.fromWeb(res.body), tar.x({ cwd: work }));

for (const p of patches) {
  console.log("패치 적용:", p);
  run("git", ["apply", "--whitespace=nowarn", path.join(root, "engine", "patches", p)], src);
}

console.log(process.env.FAST === "1" ? "엔진 빌드 중(시험용 빠른 빌드)…" : "엔진 빌드 중(최적화, 10분 안팎)…");
run("sh", ["scripts/wasm-pack-locked.sh", "--target", "web", ...(process.env.FAST === "1" ? ["--profile", "release-test"] : ["--release"])], src);

const out = path.join(root, "engine", "pkg");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of ["rhwp.js", "rhwp_bg.wasm", "rhwp.d.ts", "rhwp_bg.wasm.d.ts", "package.json"]) fs.copyFileSync(path.join(src, "pkg", f), path.join(out, f));
fs.writeFileSync(path.join(out, "BUILD.txt"), `rhwp ${version} + ${patches.join(", ")}\n${new Date().toISOString()}${process.env.FAST === "1" ? " (FAST)" : ""}\n`);
console.log("완료:", out);
