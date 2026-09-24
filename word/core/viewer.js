// PDF 보기 창(앱의 PDF 메뉴에 들어갈 부분)의 동작 시험판.
// 사용법: node tools/viewer.js 파일.pdf [출력.html]
//
//  - 변환 끄기(기본): 원본 쪽 그림 + 투명 글자 층. 드래그·복사하면 원본처럼 줄마다 끊긴다.
//  - 변환: 재구성 쪽(되살린 원본 글꼴, 원래 위치·자간). 문단이 이어진 글이라 드래그해도 줄바꿈 없이 이어지고,
//          복사도 이음새 판정(붙임/띄움/하이픈 제거)대로 이어 붙는다. 문단 사이는 줄바꿈 하나.
//
// 앱(Electron)에서는 메인 프로세스가 extractGlyphs → reconstruct → buildViewerHtml 을 돌려
// 결과 HTML 을 PDF 창(webview/iframe)에 넣으면 된다. PDFium·Kiwi 모두 Node 쪽에서 돈다.
import fs from "fs";
import { extractGlyphs } from "./src/extract-pdfium.js";
import { reconstruct } from "./src/reconstruct.js";
import { createKiwiSpacer } from "./src/kiwi-spacer.js";
import { renderLayout } from "./src/render-layout.js";

export function buildViewerHtml(input, res, title = "") {
  const { pages, fontFaceCss, mode } = renderLayout(input, res, { lockLines: true });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const body = pages.map((pg) => `<section class="pg" style="--w:${pg.W}pt;--h:${pg.H}pt">
  <div class="sheet orig"><img class="bg" src="${pg.png}" alt="">${pg.textLayer}</div>
  <div class="sheet conv">${pg.layer}</div>
</section>`).join("\n");
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
${fontFaceCss}
:root{--og-accent:#6b7b3a;--og-soft:color-mix(in srgb,var(--og-accent) 12%,#fff)}
body{margin:0;background:#f4f5f2;font-family:system-ui,sans-serif}
.menu{position:sticky;top:0;z-index:20;display:flex;gap:8px;align-items:center;padding:6px 12px;background:#fff;color:#333;font-size:13px;border-bottom:1px solid #e6e7e3}
.menu b{margin-right:4px}
.menu button{white-space:nowrap;background:#fff;color:#333;border:1px solid #d4d6d0;border-radius:6px;padding:4px 12px;font-size:13px;cursor:pointer}
.menu button:hover{background:var(--og-soft);border-color:var(--og-accent)}
.menu button.on,.menu button.on:hover:not(:disabled){background:var(--og-accent);border-color:var(--og-accent);color:#fff;font-weight:600}
.menu label{display:none;gap:4px;align-items:center}
body.converted .menu label{display:inline-flex}
.menu .hint{margin-left:auto;color:#999;font-size:12px}
.menu label{white-space:nowrap}
@media (max-width:600px){.menu .hint{display:none}}
.pg{margin:14px auto;width:max-content;transform-origin:top left}
.sheet{position:relative;width:var(--w);height:var(--h);background:#fff;box-shadow:0 0 0 1px #e6e7e3;overflow:hidden}
.orig .bg{position:absolute;inset:0;width:100%;height:100%;user-select:none;-webkit-user-drag:none}
.tl{position:absolute;white-space:pre;color:transparent;transform-origin:0 0;line-height:1}
.tl::selection{background:rgba(0,100,255,.25);color:transparent}
.conv{display:none}
body.converted .orig{display:none}
body.converted .conv{display:block}
.shape,.img{position:absolute;z-index:1;user-select:none}
.para,.furn{position:absolute;z-index:3;white-space:pre-wrap;word-break:${mode === "char" ? "break-all" : "keep-all"};overflow-wrap:anywhere;margin:0;font-synthesis:style}
.para{text-align-last:left}
.furn,.para.one{white-space:pre}
.para.fixed{overflow:hidden}
/* 원본 줄바꿈 고정: 줄마다 블록, 줄 안에서는 꺾지 않음. 양쪽 정렬 줄은 원래 폭까지 편다 */
.para.locked{white-space:pre}
.para.locked .ln{display:block;white-space:pre;text-align:left}
.para.locked .ln.full{text-align:justify;text-align-last:justify}
.para.locked .ln{transform-origin:0 0}
.cell2{float:right}.tabch{font-size:0}
.seam{border-radius:2px}
body.showfix .seam{background:#d6e6ff;box-shadow:0 0 0 1px #8fb3ef}
body.showfix .seam.flagged{background:#ffe066;box-shadow:0 0 0 1px #e0b000}
</style>
<body>
<div class="menu"><b>PDF</b>
  <button id="conv" title="줄바꿈을 이어 붙인 재구성 보기로 바꿉니다">변환</button>
  <label><input type="checkbox" id="fix"> 교정 위치 보기</label>
  <span class="hint" id="hint">원본 보기 · 드래그하면 줄마다 끊겨 복사됩니다</span>
</div>
${body}
<script>
addEventListener('message',e=>{if(e.origin===location.origin&&e.data&&e.data.type==='ogolgye:theme')document.documentElement.style.setProperty('--og-accent',e.data.color);});
const B=document.body, btn=document.getElementById('conv'), hint=document.getElementById('hint');
btn.onclick=()=>{const on=!B.classList.contains('converted');B.classList.toggle('converted',on);btn.textContent=on?'변환 끄기':'변환';btn.classList.toggle('on',on);
  if(on)requestAnimationFrame(fitLockedLines);
  hint.textContent=on?'변환 보기 · 드래그·복사해도 문장이 이어집니다':'원본 보기 · 드래그하면 줄마다 끊겨 복사됩니다';getSelection().removeAllRanges();fit();};
document.getElementById('fix').onchange=e=>B.classList.toggle('showfix',e.target.checked);
// 원본 보기의 투명 글자를 원래 줄 폭에 맞춘다
function fitTextLayer(){document.querySelectorAll('.tl').forEach(el=>{el.style.transform='';const want=parseFloat(el.dataset.w)*96/72;const got=el.getBoundingClientRect().width/(scaleOf(el)||1);if(got>0)el.style.transform='scaleX('+(want/got)+')';});}
function scaleOf(el){const pg=el.closest('.pg');const m=getComputedStyle(pg).transform;return m&&m!=='none'?parseFloat(m.split('(')[1]):1;}
// 화면 폭에 맞춰 줄이기
function fit(){document.querySelectorAll('.pg').forEach(pg=>{pg.style.transform='';pg.style.margin='';const w=pg.offsetWidth,h=pg.offsetHeight;const k=Math.min(1,(innerWidth-20)/w);pg.style.transform='scale('+k+')';pg.style.marginBottom=(14-h*(1-k))+'px';pg.style.marginLeft=Math.max(10,(innerWidth-w*k)/2)+'px';});}
addEventListener('resize',fit);
// 변환 보기에서 복사: 같은 문단 조각끼리는 이음새 판정대로 잇고, 문단 사이는 줄바꿈
document.addEventListener('copy',e=>{
  const conv=B.classList.contains('converted');
  const sel=getSelection();if(!sel.rangeCount)return;
  const r=sel.getRangeAt(0);
  const root=r.commonAncestorContainer.nodeType===1?r.commonAncestorContainer:r.commonAncestorContainer.parentElement;
  const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:n=>r.intersectsNode(n)?1:2});
  let out='',last=null,n;
  while(n=w.nextNode()){
    const blk=n.parentElement.closest(conv?'.para,.furn':'.tl');if(!blk||!blk.closest(conv?'.conv':'.orig'))continue;
    if(conv&&n.parentElement.closest('.hy'))continue;
    let t=n.data;
    if(n===r.endContainer)t=t.slice(0,r.endOffset);
    if(n===r.startContainer)t=t.slice(r.startOffset-(n===r.endContainer?0:0));
    if(n===r.startContainer&&n===r.endContainer)t=n.data.slice(r.startOffset,r.endOffset);
    if(last&&blk!==last){
      // 원본 보기: 원본 PDF처럼 줄마다 줄바꿈
      if(!conv)out+='\\n'; else if(last.dataset.pid&&last.dataset.pid===blk.dataset.pid){const j=last.dataset.join;if(j==='hyphen-drop')out=out.replace(/[-\u2010]$/,'');out+=j==='space'?' ':j==='gap'?'\\t':'';}
      else out+='\\n';
    }
    out+=t;last=blk;
  }
  e.clipboardData.setData('text/plain',out);e.preventDefault();
});
// 원본 줄을 고정한 줄이 글꼴 차이로 원래 폭을 넘치면 그 줄만 가로로 살짝 좁혀 맞춘다(꺾이지 않게)
function fitLockedLines(){document.querySelectorAll('.para.locked .ln').forEach(l=>{l.style.transform='';const over=l.scrollWidth-l.clientWidth;if(over>1&&l.clientWidth>0)l.style.transform='scaleX('+(l.clientWidth/l.scrollWidth).toFixed(4)+')';});}
addEventListener('load',()=>{fitTextLayer();fit();});
document.fonts&&document.fonts.ready.then(()=>{if(B.classList.contains('converted'))fitLockedLines();});
</script></body></html>`;
}

// 명령줄에서 실행했을 때
if (process.argv[1] && process.argv[1].endsWith("viewer.js")) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) { console.error("사용법: node tools/viewer.js 파일.pdf [출력.html]"); process.exit(1); }
  const out = args.filter((a) => !a.startsWith("--"))[1] || file.replace(/\.pdf$/i, "") + ".viewer.html";
  const input = await extractGlyphs(new Uint8Array(fs.readFileSync(file)),
    { images: true, backgrounds: true, pageImages: true, pageImageScale: 1.25, maxImageSide: 1400, fonts: true });
  const spacer = args.includes("--no-kiwi") ? null : await createKiwiSpacer();
  const res = reconstruct(input, { spacer });
  fs.writeFileSync(out, buildViewerHtml(input, res, file));
  console.log(`→ ${out}`);
}
