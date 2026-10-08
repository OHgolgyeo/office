'use strict';

// Tesseract/Leptonica가 정상 처리 중 직접 내보내는 비치명적 진단만 숨긴다.
// 그 밖의 경고와 오류는 원래 console로 전달해 실제 고장을 감추지 않는다.
// "Image too small to scale!! (2x48 vs min width of 3)" / "Line cannot be recognized!!": 글자 줄로 잡힌 조각이 너무 가늘어(세로선·얼룩 등
// 폭 1~2px) 읽지 않고 건너뛴다는 알림이다. 결과에는 영향이 없다(그 조각만 빈 글이 된다).
const harmless = /^(?:Detected \d+ diacritics|Error in boxClipToRectangle: box outside rectangle|Error in pixScanForForeground: invalid box|Image too small to scale!! \(\d+x\d+ vs min width of \d+\)|Line cannot be recognized!!)$/;
for (const level of ['log', 'warn', 'error']) {
  const write = console[level].bind(console);
  console[level] = (...args) => {
    if (args.length === 1 && harmless.test(String(args[0]).trim())) return;
    write(...args);
  };
}

require('tesseract.js/src/worker-script/node/index.js');
