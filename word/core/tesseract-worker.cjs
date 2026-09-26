'use strict';

// Tesseract/Leptonica가 정상 처리 중 직접 내보내는 비치명적 진단만 숨긴다.
// 그 밖의 경고와 오류는 원래 console로 전달해 실제 고장을 감추지 않는다.
const harmless = /^(?:Detected \d+ diacritics|Error in boxClipToRectangle: box outside rectangle|Error in pixScanForForeground: invalid box)$/;
for (const level of ['log', 'warn', 'error']) {
  const write = console[level].bind(console);
  console[level] = (...args) => {
    if (args.length === 1 && harmless.test(String(args[0]).trim())) return;
    write(...args);
  };
}

require('tesseract.js/src/worker-script/node/index.js');
