// npm start: Electron 을 띄우고 그 출력에서 외부 부품의 소음 로그만 걸러 낸다.
// 파일 열기 창이 PDF 썸네일을 만들 때 Windows 가 알PDF(ESTsoft) 미리보기 부품(PDFThumbnailHandler.dll)을
// 앱 프로세스 안으로 불러오는데, 그 부품이 "CheckLogLevel()∼∼GetHKCURegistryKeyAndValue failed." 를
// 줄바꿈 없이 수백 번 찍는다. 앱과 상관없는 로그라 지운다(다른 출력은 그대로).
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// 설치된 Electron 실행 파일 경로(OGOLGYE_START_CMD 는 걸러 내기 시험용: 대신 띄울 명령)
const electron = process.env.OGOLGYE_START_CMD || require("electron");
const NOISE = /CheckLogLevel\(\)[^\r\n]{0,16}?GetHKCURegistryKeyAndValue failed\.(?:\r?\n)?/g;
const PREFIX = "CheckLogLevel()";

const child = spawn(electron, process.env.OGOLGYE_START_CMD ? process.argv.slice(2) : [".", ...process.argv.slice(2)], { stdio: ["inherit", "pipe", "pipe"], windowsHide: false });

function filter(src, dst) {
  let held = "";                                              // 청크 경계에 걸린 로그 앞부분
  src.on("data", (chunk) => {
    let text = held + chunk.toString("latin1");               // 바이트 그대로(글자 코드와 상관없이) 다룬다
    held = "";
    text = text.replace(NOISE, "");
    // 끝에 로그가 잘려 걸려 있으면(다음 청크에서 완성될 수 있으면) 남겨 둔다
    const at = text.lastIndexOf("CheckLogLevel(");
    const tail = at >= 0 ? text.slice(at) : "";
    if (at >= 0 && tail.length < 80 && !/[\r\n]/.test(tail)) { held = tail; text = text.slice(0, at); }
    else {
      for (let k = Math.min(PREFIX.length - 1, text.length); k > 0; k--) {
        if (PREFIX.startsWith(text.slice(-k))) { held = text.slice(-k); text = text.slice(0, -k); break; }
      }
    }
    if (text) dst.write(Buffer.from(text, "latin1"));
  });
  src.on("end", () => { if (held) dst.write(Buffer.from(held.replace(NOISE, ""), "latin1")); });
}
filter(child.stdout, process.stdout);
filter(child.stderr, process.stderr);

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
