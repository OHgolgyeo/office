// 가볍게 뜨는 PDF 보기 화면. 쪽마다 자리만 먼저 깔고, 화면에 들어오는 쪽만 불러온다.
export function buildShellHtml(id, meta) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pages = meta.pages.map((p, i) => `<section class="pg" data-n="${i}" style="--w:${p.w}pt;--h:${p.h}pt">
  <div class="sheet orig"><div class="loading">PDF를 불러오고 있습니다.</div><img class="bg" data-src="/pdf/${id}/page/${i}.jpg" alt="" onload="this.previousElementSibling.remove()"><div class="tlayer"></div></div>
  <div class="sheet conv"><div class="loading">PDF를 불러오고 있습니다.</div></div>
</section>`).join("\n");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(meta.name)}</title>
<style id="fonts"></style>
<style>
:root{--og-accent:#6b7b3a;--og-soft:color-mix(in srgb,var(--og-accent) 12%,#fff)}
body{margin:0;background:#f4f5f2;font-family:system-ui,sans-serif}
.menu{position:sticky;top:0;z-index:20;display:flex;gap:8px;align-items:center;padding:6px 12px;background:#fff;color:#333;font-size:13px;border-bottom:1px solid #e6e7e3}
.menu b{margin-right:4px}
.menu button{white-space:nowrap;background:#fff;color:#333;border:1px solid #d4d6d0;border-radius:6px;padding:4px 12px;font-size:13px;cursor:pointer}
.menu button:hover:not(:disabled){background:var(--og-soft);border-color:var(--og-accent)}
.menu button.on,.menu button.on:hover:not(:disabled){background:var(--og-accent);border-color:var(--og-accent);color:#fff;font-weight:600}
.menu button:disabled{color:#aaa;cursor:progress}
.docbox{position:relative}
.docmenu{display:none;position:absolute;left:0;top:calc(100% + 5px);min-width:150px;padding:4px 0;background:#fff;border:1px solid #d4d6d0;border-radius:7px;box-shadow:0 3px 14px rgba(0,0,0,.14);z-index:30}
.docbox.open .docmenu{display:block}
.docitem{position:relative;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:7px 13px;white-space:nowrap;cursor:default}
.docitem:hover{background:var(--og-soft)}
.docarrow{color:#777}
.docsub{display:none;position:absolute;left:100%;top:-5px;min-width:165px;padding:4px 0;background:#fff;border:1px solid #d4d6d0;border-radius:7px;box-shadow:0 3px 14px rgba(0,0,0,.14)}
.docitem:hover>.docsub{display:block}
.docmenu button,.docsub button{display:block;width:100%;border:0;border-radius:0;text-align:left;padding:7px 13px}
.docmenu button:hover{background:var(--og-soft)}
.doccheck{display:flex!important;align-items:center;gap:7px;padding:7px 13px;white-space:nowrap;cursor:pointer;border-bottom:1px solid #e6e7e3}
.doccheck input{margin:0}
.menu>label{display:none;gap:4px;align-items:center;white-space:nowrap}
body.converted .menu>label{display:inline-flex}
.pg{margin:14px auto;width:max-content;transform-origin:top left}
.sheet{position:relative;width:var(--w);height:var(--h);background:#fff;box-shadow:0 0 0 1px #e6e7e3;overflow:hidden}
.orig .bg{position:absolute;inset:0;width:100%;height:100%;user-select:none;-webkit-user-drag:none}
.tlayer{position:absolute;inset:0;z-index:3;cursor:text}
.tlayer .tl{user-select:text;-webkit-user-select:text}
.tl{position:absolute;white-space:pre;color:transparent;transform-origin:0 0;line-height:1}
.tl::selection{background:rgba(0,100,255,.25);color:transparent}
.conv{display:none}
body.converted .orig{display:none}
body.converted .conv{display:block}
.loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#999;font-size:14px;z-index:0}
.orig .bg{z-index:1}
.shape,.img{position:absolute;z-index:1;user-select:none}
/* 그림 속 글자: 그림은 원본 그대로, 같은 위치·기울기로 투명한 글자를 겹친다 */
.gtext{position:absolute;left:0;top:0;transform-origin:0 0;z-index:4}
.garea{position:absolute;z-index:2}
.garea.pending,.garea.nodata{z-index:1}
.gtext .garea{z-index:0}
.gtext .para,.gtext .tl,.gtext .para *{color:transparent!important}
.gtext .para{z-index:1}.gtext .tl{z-index:1}
.gtext ::selection{background:rgba(0,100,255,.25);color:transparent}
.gtext .ow{position:absolute;white-space:pre;transform-origin:0 0;z-index:1}
.gtext .gorig{display:none}.gtext.off .gconv{display:none}.gtext.off .gorig{display:block}
body.showfix .gtext .seam{background:transparent;box-shadow:0 0 0 1px var(--og-accent)}
#gmenu{position:fixed;z-index:100;background:#fff;border:1px solid #d4d6d0;border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.12);padding:4px 0;font-size:13px;display:none}
#gmenu div{padding:6px 14px;cursor:pointer;white-space:nowrap}
#gmenu div:hover{background:var(--og-soft)}
.bgconv{position:absolute;inset:0;width:100%;height:100%;z-index:0;user-select:none;-webkit-user-drag:none}
.para,.furn{position:absolute;z-index:3;white-space:pre-wrap;word-break:break-all;overflow-wrap:anywhere;margin:0;font-synthesis:style}
.para{text-align-last:left}
.furn,.para.one{white-space:pre}
.para.fixed{overflow:hidden}
.para.locked{white-space:pre}
.para.locked .ln{display:block;white-space:pre;text-align:left;transform-origin:0 0}
.para.locked .ln.full{text-align:justify;text-align-last:justify}
.cell2{float:right}.tabch{font-size:0}
.seam{border-radius:2px}
body.showfix .seam{background:var(--og-soft);box-shadow:0 0 0 1px var(--og-accent)}
body.showfix .seam.flagged{background:#ffe066;box-shadow:0 0 0 1px #e0b000}
</style></head>
<body>
<div class="menu"><b>PDF</b>
  <div class="docbox" id="docbox"><button id="conv" disabled>문서화 ▾</button><div class="docmenu">
    <div class="docitem">전체 변환 <span class="docarrow">▶</span><div class="docsub"><button data-all data-images="0">글</button><button data-all data-images="1">글+이미지</button></div></div>
    <div class="docitem">부분 변환 <span class="docarrow">▶</span><div class="docsub">
      <label class="doccheck"><input type="checkbox" id="partial-images"> 이미지 포함</label>
      <button data-partial="even">짝수 페이지</button><button data-partial="odd">홀수 페이지</button><button data-partial="range">페이지 지정…</button><button data-partial="current">보고 있는 페이지</button>
    </div></div>
  </div></div>
  <label><input type="checkbox" id="fix"> 교정 위치 보기</label>
</div>
${pages}
<div id="gmenu"><div id="gmenu-item"></div></div>
<script>
const ID=${JSON.stringify(id)}, PAGE_COUNT=${meta.pages.length}, B=document.body, btn=document.getElementById('conv'),docbox=document.getElementById('docbox');
addEventListener('message',e=>{
  if(e.origin!==location.origin||!e.data)return;
  if(e.data.type==='ogolgye:theme')document.documentElement.style.setProperty('--og-accent',e.data.color);
  if(e.data.type==='ogolgye:documentized'){
    btn.disabled=false;btn.textContent='문서화 ▾';
    if(!e.data.ok)alert('문서화하지 못했습니다.\\n'+(e.data.error||''));
  }
});
let ready=false;
// 변환 준비 상태 확인
async function poll(){
  try{
    const st=await (await fetch('/pdf/'+ID+'/status')).json();
    if(st.error){btn.title='변환할 수 없습니다: '+st.error;return;}
    if(st.conv){
      ready=true;btn.disabled=false;btn.textContent='문서화 ▾';
      document.getElementById('fonts').textContent=await (await fetch('/pdf/'+ID+'/fonts.css')).text();
      visible.forEach(loadPage);return;
    }
  }catch{}
  setTimeout(poll,600);
}
// 화면에 들어온 쪽만 불러오기
const visible=new Set();
function loadPage(sec){
  const n=sec.dataset.n, img=sec.querySelector('.orig .bg');
  if(!img.src)img.src=img.dataset.src;
  if(ready&&!sec.dataset.tl){sec.dataset.tl=1;fetch('/pdf/'+ID+'/text/'+n).then(r=>r.text()).then(h=>{sec.querySelector('.tlayer').innerHTML=h;fitTextLayer(sec);});}
  if(ready&&B.classList.contains('converted')&&!sec.dataset.cv){sec.dataset.cv=1;
    fetch('/pdf/'+ID+'/conv/'+n).then(r=>r.text()).then(h=>{const c=sec.querySelector('.conv');c.innerHTML=h;applyOff(c,n);requestAnimationFrame(()=>{fitLockedLines(c);fitTextLayer(c);});
      // 그림 속 글자(OCR)는 뒤에서 읽고, 끝나면 투명 층을 덧붙인다
      fetch('/pdf/'+ID+'/ocr/'+n).then(r=>r.ok?r.text():'').then(o=>{c.querySelectorAll('.garea.pending').forEach(x=>x.remove());if(o){c.insertAdjacentHTML('beforeend',o);applyOff(c,n);requestAnimationFrame(()=>{fitLockedLines(c);fitTextLayer(c);});}});});}
}
const io=new IntersectionObserver(es=>es.forEach(e=>{const s=e.target;if(e.isIntersecting){visible.add(s);loadPage(s);}else visible.delete(s);}),{rootMargin:'1200px 0px'});
document.querySelectorAll('.pg').forEach(s=>io.observe(s));
btn.onclick=e=>{e.stopPropagation();if(ready)docbox.classList.toggle('open');};
function pageList(raw){
  const set=new Set();
  for(const bit of raw.split(',')){
    const s=bit.trim();if(!s)continue;
    const m=s.match(/^(\d+)(?:\s*-\s*(\d+))?$/);if(!m)throw Error('페이지는 1-3, 5처럼 입력해 주세요.');
    let a=+m[1],b=+(m[2]||m[1]);if(a>b){const t=a;a=b;b=t;}
    if(a<1||b>PAGE_COUNT)throw Error('페이지는 1부터 '+PAGE_COUNT+' 사이로 입력해 주세요.');
    for(let n=a;n<=b;n++)set.add(n-1);
  }
  if(!set.size)throw Error('문서화할 페이지를 입력해 주세요.');
  return [...set].sort((a,b)=>a-b);
}
async function documentize(pages,includeImages){
  docbox.classList.remove('open');btn.disabled=true;btn.textContent='문서화 중…';
  try{
    const r=await fetch('/pdf/'+ID+'/content?pages='+pages.join(',')+'&images='+(includeImages?'1':'0'));const data=await r.json();
    if(!r.ok)throw Error(data.error||'본문을 만들지 못했습니다.');
    parent.postMessage({type:'ogolgye:documentize',id:ID,text:data.text,html:data.html,pages:data.pages},location.origin);
  }catch(err){btn.disabled=false;btn.textContent='문서화 ▾';alert(String(err.message||err));}
}
function currentPage(){
  const top=document.querySelector('.menu').getBoundingClientRect().bottom,target=top+(innerHeight-top)/2;
  let best=0,dist=Infinity;document.querySelectorAll('.pg').forEach((pg,i)=>{const r=pg.getBoundingClientRect(),d=Math.abs((r.top+r.bottom)/2-target);if(d<dist){dist=d;best=i;}});return best;
}
docbox.querySelector('.docmenu').onclick=e=>{
  const all=e.target.closest('[data-all]');if(all){documentize(Array.from({length:PAGE_COUNT},(_,i)=>i),all.dataset.images==='1');return;}
  const item=e.target.closest('[data-partial]');if(!item)return;
  const images=document.getElementById('partial-images').checked;
  let pages=[];
  if(item.dataset.partial==='even')pages=Array.from({length:PAGE_COUNT},(_,i)=>i).filter(i=>(i+1)%2===0);
  else if(item.dataset.partial==='odd')pages=Array.from({length:PAGE_COUNT},(_,i)=>i).filter(i=>(i+1)%2===1);
  else if(item.dataset.partial==='current')pages=[currentPage()];
  else{const raw=prompt('문서화할 페이지를 입력하세요.\\n예: 1-3, 5, 8-10','1-'+PAGE_COUNT);if(raw===null)return;try{pages=pageList(raw);}catch(err){alert(String(err.message||err));return;}}
  if(!pages.length){alert('해당하는 페이지가 없습니다.');return;}documentize(pages,images);
};
document.addEventListener('click',e=>{if(!docbox.contains(e.target))docbox.classList.remove('open');});
// PDF 보기 iframe 위에 새 PDF를 놓아도 바깥 앱이 새 파일을 열 수 있게 전달한다.
document.addEventListener('dragover',e=>{if(e.dataTransfer&&e.dataTransfer.types.includes('Files'))e.preventDefault();},true);
document.addEventListener('drop',async e=>{
  const file=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0];if(!file||!/.pdf$/i.test(file.name))return;
  e.preventDefault();e.stopImmediatePropagation();const bytes=await file.arrayBuffer();
  parent.postMessage({type:'ogolgye:subview-drop',file:{name:file.name,path:file.path||null,bytes:bytes}},location.origin,[bytes]);
},true);
// 그림 속 글자 위에서 오른쪽 클릭 → 이 그림의 글자 변환 끄기/켜기
const gOff=new Set(), gmenu=document.getElementById('gmenu'), gitem=document.getElementById('gmenu-item');let gTarget=null;
function applyOff(c,n){c.querySelectorAll('.gtext').forEach(g=>{if(gOff.has(n+':'+g.dataset.g))g.classList.add('off');});}
document.addEventListener('contextmenu',e=>{
  if(!B.classList.contains('converted')){gmenu.style.display='none';return;}
  const hit=e.target.closest('.conv .gtext,.conv .garea');
  if(!hit){gmenu.style.display='none';return;}
  e.preventDefault();
  const conv=hit.closest('.conv');
  const g=hit.classList.contains('gtext')?hit:(hit.dataset.g&&conv.querySelector('.gtext[data-g="'+hit.dataset.g+'"]'));
  gTarget=g||null;
  gitem.textContent=g?(g.classList.contains('off')?'이 그림의 글자 변환 켜기':'이 그림의 글자 변환 끄기'):hit.classList.contains('pending')?'그림 속 글자를 읽고 있습니다…':hit.classList.contains('nodata')?'그림 속 글자 읽기 자료가 없습니다 (npm run get-model)':'이 그림에서 읽은 글자가 없습니다';
  gitem.style.color=g?'':'#999';
  gmenu.style.left=e.clientX+'px';gmenu.style.top=e.clientY+'px';gmenu.style.display='block';
});
gitem.onclick=()=>{if(!gTarget)return;const off=gTarget.classList.toggle('off');const key=gTarget.closest('.pg').dataset.n+':'+gTarget.dataset.g;off?gOff.add(key):gOff.delete(key);if(off)fitTextLayer(gTarget);gmenu.style.display='none';getSelection().removeAllRanges();};
addEventListener('mousedown',e=>{if(!gmenu.contains(e.target))gmenu.style.display='none';});
document.getElementById('fix').onchange=e=>B.classList.toggle('showfix',e.target.checked);
// 그림 글자에서 시작한 드래그 선택이 DOM 순서상 이웃한 광고·본문으로 번지지 않게 한다.
// 좌표가 들어 있는 그림 글자는 재구성된 문단 단위로, OCR 글자는 검출 영역 단위로 끝점을 고정한다.
let gSelect=null,gSelectFixing=false,gSelectAfter=true;
function visibleEdgeText(root,last){
  const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.data&&n.parentElement&&n.parentElement.getClientRects().length?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT});
  let n,edge=null;while(n=w.nextNode()){edge=n;if(!last)return n;}return edge;
}
function finishGSelect(){gSelect=null;}
document.addEventListener('mousedown',e=>{
  if(e.button!==0)return;
  const g=e.target.closest('.sheet .gtext');
  const unit=g&&!g.classList.contains('ocr')&&e.target.closest('.gconv .para,.gorig .opara');
  gSelect=unit||g;
  gSelectAfter=true;
},true);
document.addEventListener('mousemove',e=>{
  if(!gSelect)return;const r=gSelect.getBoundingClientRect();
  gSelectAfter=e.clientY>r.bottom||(e.clientY>=r.top&&e.clientX>=r.right);
},true);
document.addEventListener('selectionchange',()=>{
  if(!gSelect||gSelectFixing)return;
  const s=getSelection();if(!s.rangeCount||s.isCollapsed)return;
  const inside=n=>n&&(n===gSelect||gSelect.contains(n.nodeType===1?n:n.parentNode));
  const ai=inside(s.anchorNode),fi=inside(s.focusNode);if(ai&&fi)return;
  if(!ai){s.removeAllRanges();return;}
  const rel=gSelect.compareDocumentPosition(s.focusNode);
  const after=rel&Node.DOCUMENT_POSITION_CONTAINED_BY?gSelectAfter:!!(rel&Node.DOCUMENT_POSITION_FOLLOWING);
  const edge=visibleEdgeText(gSelect,after);if(!edge)return;
  gSelectFixing=true;
  try{s.setBaseAndExtent(s.anchorNode,s.anchorOffset,edge,after?edge.data.length:0);}finally{gSelectFixing=false;}
});
addEventListener('mouseup',()=>setTimeout(finishGSelect),true);
addEventListener('blur',finishGSelect);
function scaleOf(el){const pg=el.closest('.pg');const m=getComputedStyle(pg).transform;return m&&m!=='none'?parseFloat(m.split('(')[1]):1;}
// 줄 폭 맞추기(회전·축소와 무관한 배치 폭으로 잰다)
function fitTextLayer(root){root.querySelectorAll('.tl').forEach(el=>{el.style.transform='';const want=parseFloat(el.dataset.w)*96/72;const got=el.offsetWidth;if(got>0)el.style.transform='scaleX('+(want/got)+')';});}
function fitLockedLines(root){root.querySelectorAll('.para.locked .ln').forEach(l=>{l.style.transform='';const over=l.scrollWidth-l.clientWidth;if(over>1&&l.clientWidth>0)l.style.transform='scaleX('+(l.clientWidth/l.scrollWidth).toFixed(4)+')';});}
function fit(){document.querySelectorAll('.pg').forEach(pg=>{pg.style.transform='';pg.style.margin='';const w=pg.offsetWidth,h=pg.offsetHeight;const k=Math.min(1,(innerWidth-20)/w);pg.style.transform='scale('+k+')';pg.style.marginBottom=(14-h*(1-k))+'px';pg.style.marginLeft=Math.max(10,(innerWidth-w*k)/2)+'px';});}
addEventListener('resize',fit);
// 복사: 화면 변환 여부와 관계없이 같은 문단의 원본 줄들을 판정된 이음새대로 합친다.
document.addEventListener('copy',e=>{
  const conv=B.classList.contains('converted');const sel=getSelection();if(!sel.rangeCount)return;
  const r=sel.getRangeAt(0);const root=r.commonAncestorContainer.nodeType===1?r.commonAncestorContainer:r.commonAncestorContainer.parentElement;
  const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:n=>r.intersectsNode(n)?1:2});
  let out='',last=null,n;
  while(n=w.nextNode()){
    const blk=n.parentElement.closest(conv?'.para,.furn,.gtext.off .tl':'.tl');if(!blk||!blk.closest(conv?'.conv':'.orig'))continue;
    if(conv&&blk.closest('.gtext')&&getComputedStyle(blk.closest('.gconv,.gorig')).display==='none')continue;
    if(conv&&n.parentElement.closest('.hy'))continue;
    let t=n.data;
    if(n===r.startContainer&&n===r.endContainer)t=t.slice(r.startOffset,r.endOffset);else if(n===r.startContainer)t=t.slice(r.startOffset);else if(n===r.endContainer)t=t.slice(0,r.endOffset);
    if(last&&blk!==last){
      const sameScope=last.closest('.gtext')===blk.closest('.gtext');
      if(sameScope&&last.dataset.pid&&last.dataset.pid===blk.dataset.pid){const j=last.dataset.join;if(j==='hyphen-drop')out=out.replace(/[-\\u2010]$/,'');out+=j==='space'?' ':j==='gap'?'\\t':'';}
      else out+='\\n';
    }
    out+=t;last=blk;
  }
  e.clipboardData.setData('text/plain',out);e.preventDefault();
});
fit();poll();
</script></body></html>`;
}
