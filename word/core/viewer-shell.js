// 가볍게 뜨는 PDF 보기 화면. 쪽마다 자리만 먼저 깔고, 화면에 들어오는 쪽만 불러온다.
export function buildShellHtml(id, meta) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pages = meta.pages.map((p, i) => `<section class="pg" data-n="${i}" style="--w:${p.w}pt;--h:${p.h}pt">
  <div class="sheet"><div class="loading">PDF를 불러오고 있습니다.</div><img class="bg" data-src="/pdf/${id}/page/${i}.jpg" alt="" onload="this.previousElementSibling.remove()"><div class="ann-layer"></div><div class="tlayer"></div></div>
</section>`).join("\n");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(meta.name)}</title>
<link rel="stylesheet" href="/vendor/phosphor/regular/style.css">
<style>
:root{--og-accent:#6b7b3a;--og-soft:color-mix(in srgb,var(--og-accent) 12%,#fff)}
body{margin:0;background:#f4f5f2;font-family:system-ui,sans-serif}
.menu{position:sticky;top:0;z-index:110;display:flex;gap:8px;align-items:center;padding:6px 12px;background:#fff;color:#333;font-size:13px;border-bottom:1px solid #e6e7e3;flex-wrap:wrap;row-gap:4px}
.menu b{margin-right:4px}
.menu button{white-space:nowrap;background:#fff;color:#333;border:1px solid #d4d6d0;border-radius:6px;padding:4px 12px;font-size:13px;cursor:pointer}
.menu button:hover:not(:disabled){background:var(--og-soft);border-color:var(--og-accent)}
.menu button.on,.menu button.on:hover:not(:disabled){background:var(--og-accent);border-color:var(--og-accent);color:#fff;font-weight:600}
.menu button:disabled{color:#aaa;cursor:progress}
/* 오른쪽 도구: 상자 없는 아이콘, 켜졌을 때만 테마색 배경 */
.tools{display:flex;align-items:center;gap:2px;margin-left:auto;padding-left:12px}
.menu .tool{position:relative;display:inline-flex;align-items:center;justify-content:center;height:30px;min-width:30px;padding:0 6px;border:0;border-radius:6px;background:transparent;color:#4a4d45;font-size:19px;cursor:pointer}
.menu .tool:hover:not(:disabled){background:transparent;color:var(--og-accent)}
.menu .tool.on,.menu .tool.on:hover:not(:disabled){background:var(--og-accent);color:#fff;font-weight:normal}
.menu .tool.caret{min-width:0;padding:0 3px;font-size:12px;margin-left:-3px}
.menu .tool .hlbar{position:absolute;left:7px;right:7px;bottom:4px;height:3px;border-radius:2px;background:var(--hl,#ffe066)}
.hlbox{display:flex;align-items:center}
.pop{position:fixed;z-index:120;display:none;padding:8px;background:#fff;border:1px solid #e1e3dd;border-radius:10px;box-shadow:0 6px 22px rgba(0,0,0,.14)}
.pop.open{display:block}
.swatches{display:grid;grid-template-columns:repeat(3,24px);gap:7px}
.menu .swatch,.swatch{width:24px;height:24px;padding:0;border:0;border-radius:50%;cursor:pointer;box-shadow:inset 0 0 0 1px rgba(0,0,0,.12);display:flex;align-items:center;justify-content:center;color:#333;font-size:14px}
.swatch:hover{transform:scale(1.1)}
/* 체크박스도 앱 디자인으로 */
input[type=checkbox]{appearance:none;-webkit-appearance:none;margin:0;width:15px;height:15px;flex:none;border:1.5px solid #b9bcb4;border-radius:4px;background:#fff;display:inline-grid;place-content:center;cursor:pointer;vertical-align:middle}
input[type=checkbox]:checked{background:var(--og-accent);border-color:var(--og-accent)}
input[type=checkbox]:checked::after{content:"";width:7px;height:3.5px;border:2px solid #fff;border-top:0;border-right:0;transform:translateY(-1px) rotate(-45deg)}
.docbox{position:relative}
.docmenu{display:none;position:fixed;left:0;top:0;min-width:150px;padding:4px 0;background:#fff;border:1px solid #d4d6d0;border-radius:7px;box-shadow:0 3px 14px rgba(0,0,0,.14);z-index:120}
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
.docrules{min-width:220px}
.rulecheck{display:flex;align-items:center;gap:7px;padding:7px 13px;white-space:nowrap;cursor:pointer}
.rulecheck:hover{background:var(--og-soft)}
.pg{margin:14px auto;width:max-content;transform-origin:top left}
.sheet{position:relative;width:var(--w);height:var(--h);background:#fff;box-shadow:0 0 0 1px #e6e7e3;overflow:hidden}
.bg{position:absolute;inset:0;z-index:1;width:100%;height:100%;user-select:none;-webkit-user-drag:none}
.tlayer{position:absolute;inset:0;z-index:3;cursor:text}
.ann-layer{position:absolute;inset:0;z-index:4;pointer-events:none}
.ann-hl{position:absolute;border-radius:2px;opacity:.46;mix-blend-mode:multiply;box-shadow:inset 0 0 0 .4px rgba(0,0,0,.06)}
/* 포스트잇 메모 */
.sticky{position:absolute;z-index:7;width:176px;transform:scale(var(--inv,1));transform-origin:0 0;display:flex;flex-direction:column;background:#fff4a3;border-radius:2px 2px 2px 12px;box-shadow:0 1px 2px rgba(0,0,0,.12),0 5px 14px rgba(0,0,0,.16);pointer-events:auto;font:10pt/1.5 system-ui,sans-serif;color:#3d3a1c}
.sticky-head{display:flex;align-items:center;gap:2px;height:22px;padding:0 3px 0 6px;background:rgba(0,0,0,.05);cursor:grab;user-select:none}
.sticky-head:active{cursor:grabbing}
.sticky-head .grip{flex:1;color:rgba(0,0,0,.35);font-size:14px}
.sticky-head button{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border:0;border-radius:4px;background:transparent;color:rgba(0,0,0,.5);font-size:13px;cursor:pointer}
.sticky-head button:hover{background:rgba(0,0,0,.08);color:#000}
.sticky textarea{box-sizing:border-box;width:100%;min-height:74px;max-height:260px;field-sizing:content;resize:none;border:0;outline:0;padding:6px 9px 10px;background:transparent;font:inherit;color:inherit}
.sticky textarea::placeholder{color:rgba(61,58,28,.45)}
.sticky .quote{margin:6px 9px 0;padding-left:7px;border-left:2px solid rgba(0,0,0,.18);font-size:.88em;color:rgba(61,58,28,.7);max-height:3em;overflow:hidden}
.sticky.folded{width:26px;height:26px;border-radius:4px;align-items:center;justify-content:center;cursor:pointer;font-size:16px}
.sticky.folded>*{display:none}.sticky.folded>.fold-icon{display:block;color:#7a6a00}
.sticky:not(.folded)>.fold-icon{display:none}
.ann-bookmark{position:absolute;right:8px;top:0;width:19px;height:31px;background:var(--og-accent);clip-path:polygon(0 0,100% 0,100% 100%,50% 75%,0 100%);z-index:6;pointer-events:none}
.ann-panel{position:fixed;right:12px;top:48px;bottom:12px;width:285px;z-index:40;display:none;flex-direction:column;background:#fff;border:1px solid #d4d6d0;border-radius:9px;box-shadow:0 5px 20px rgba(0,0,0,.18);overflow:hidden}
.ann-panel.open{display:flex}.ann-panel-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #e6e7e3;font-weight:700}
.ann-list{overflow:auto;padding:7px}.ann-empty{padding:24px 10px;color:#888;text-align:center}.ann-item{position:relative;padding:9px 34px 9px 10px;margin-bottom:6px;border:1px solid #e4e5e1;border-radius:7px;background:#fff;cursor:pointer}.ann-item:hover{border-color:var(--og-accent);background:var(--og-soft)}
.ann-item b{display:flex;align-items:center;gap:5px;font-size:12px;color:var(--og-accent);margin-bottom:3px}.ann-item b i{font-size:14px}.ann-item span{display:block;white-space:pre-wrap;overflow:hidden;text-overflow:ellipsis;max-height:3.2em}.ann-item .sw{display:inline-block;width:10px;height:10px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(0,0,0,.15)}
.ann-del{position:absolute;right:5px;top:6px;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border:0;border-radius:5px;padding:0;background:transparent;color:#999;font-size:14px;cursor:pointer}.ann-del:hover{color:#b00020;background:#fdecee}
.ann-panel-head button{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:0;border-radius:6px;background:transparent;color:#666;font-size:18px;cursor:pointer}.ann-panel-head button:hover{background:var(--og-soft);color:#000}
body.note-mode .sheet{cursor:crosshair}body.hl-mode .tlayer{cursor:text}.ann-help{font-size:12px;color:#777;padding:8px 12px 0}
/* 오른쪽 클릭 메뉴 */
.ctx{position:fixed;z-index:130;display:none;min-width:150px;padding:4px;background:#fff;border:1px solid #e1e3dd;border-radius:9px;box-shadow:0 6px 22px rgba(0,0,0,.14);font-size:13px;color:#333}
.ctx.open{display:block}
.ctx-item{display:flex;align-items:center;gap:9px;padding:7px 10px;border-radius:6px;cursor:pointer;white-space:nowrap}
.ctx-item i{font-size:16px;color:#555}
.ctx-item:hover{background:var(--og-soft)}.ctx-item:hover i{color:var(--og-accent)}
.ctx-item.dim{color:#999;cursor:default}.ctx-item.dim:hover{background:transparent}
.ctx-item .dot{width:12px;height:12px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(0,0,0,.15);margin-left:auto}
.ctx-sep{height:1px;margin:4px 6px;background:#eceee9}
/* 앱 대화상자·알림 */
.ogdlg{position:fixed;inset:0;z-index:140;display:flex;align-items:center;justify-content:center;background:rgba(20,22,18,.28)}.ogdlg[hidden]{display:none}
.ogdlg-card{width:min(340px,calc(100vw - 32px));background:#fff;border-radius:12px;box-shadow:0 10px 32px rgba(0,0,0,.22);padding:18px}
.ogdlg-card h3{margin:0 0 4px;font-size:15px}.ogdlg-card p{margin:0 0 12px;font-size:12.5px;color:#777}
.ogdlg-card input[type=text]{box-sizing:border-box;width:100%;height:34px;padding:0 10px;border:1px solid #d4d6d0;border-radius:7px;font:14px system-ui,sans-serif;outline:0}
.ogdlg-card input[type=text]:focus{border-color:var(--og-accent);box-shadow:0 0 0 3px var(--og-soft)}
.ogdlg-err{min-height:16px;margin-top:6px;font-size:12px;color:#b00020}
.ogdlg-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:8px}
.ogbtn{height:30px;padding:0 14px;border:0;border-radius:7px;font:13px system-ui,sans-serif;cursor:pointer;background:#f0f1ed;color:#333}.ogbtn:hover{background:#e6e8e2}
.ogbtn.primary{background:var(--og-accent);color:#fff}.ogbtn.primary:hover{filter:brightness(1.08)}
.imgdlg .imgdlg-card{width:min(760px,calc(100vw - 32px));max-height:calc(100vh - 64px);display:flex;flex-direction:column;background:#fff;border-radius:12px;box-shadow:0 10px 32px rgba(0,0,0,.22);overflow:hidden}
.imgdlg-head{display:flex;align-items:center;gap:10px;padding:14px 16px 6px}.imgdlg-head h3{margin:0;font-size:15px;flex:1}
.imgdlg-head button{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:6px;background:transparent;color:#666;font-size:18px;cursor:pointer}.imgdlg-head button:hover{background:var(--og-soft);color:#000}
.imgdlg-help{padding:0 16px 10px;font-size:12.5px;color:#777;border-bottom:1px solid #e6e7e3}
.imgdlg-grid{flex:1;overflow:auto;padding:12px 16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;align-content:start}
.imgtile{position:relative;display:flex;flex-direction:column;gap:5px}.imgtile[hidden]{display:none}
.imgpic{height:130px;border:1px solid #dcdeda;border-radius:7px;background:#fff repeating-conic-gradient(#f1f2ef 0 25%,#fff 0 50%) 0 0/16px 16px;display:flex;align-items:center;justify-content:center;overflow:hidden}
.imgpic img{max-width:100%;max-height:100%;object-fit:contain}
.imgcap{font-size:12px;color:#555;text-align:center}
.imgdel{position:absolute;top:5px;right:5px;width:26px;height:26px;border:0;border-radius:50%;background:rgba(46,48,43,.72);color:#fff;font-size:14px;display:flex;align-items:center;justify-content:center;cursor:pointer}.imgdel:hover{background:#b00020}
.imgdlg-foot{display:flex;align-items:center;gap:8px;padding:10px 16px;border-top:1px solid #e6e7e3}.imgdlg-foot .grow{flex:1;font-size:12.5px;color:#555}
.imgdlg-foot .linkbtn{border:0;background:transparent;color:var(--og-accent);font:12.5px system-ui,sans-serif;cursor:pointer;padding:0 6px}.imgdlg-foot .linkbtn[hidden]{display:none}
.ogbtn:disabled{opacity:.5;cursor:default}
.toast{position:fixed;left:50%;bottom:24px;z-index:150;transform:translate(-50%,12px);max-width:calc(100vw - 32px);padding:9px 16px;border-radius:9px;background:#2e302b;color:#fff;font-size:13px;white-space:pre-line;box-shadow:0 6px 20px rgba(0,0,0,.22);opacity:0;pointer-events:none;transition:opacity .18s,transform .18s}
.toast.show{opacity:1;transform:translate(-50%,0)}
/* 지금 하는 일(문서화 진행): 오른쪽 아래 떠 있는 창 — 그림 글자 읽기 안내(.ocr-wait)와 같은 모양, 배경만 불투명. 위 메뉴가 길어지지 않게 */
.busy{position:fixed;right:16px;bottom:16px;z-index:140;display:none;max-width:calc(100vw - 32px);padding:4px 10px;border-radius:12px;background:#2e302b;color:#fff;font-size:12px;pointer-events:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.busy.show{display:block}

.tlayer .tl{user-select:text;-webkit-user-select:text}
.figgrab{position:absolute;cursor:grab;border-radius:2px}
.figgrab:hover{outline:2px dashed var(--og-accent);outline-offset:-2px;background:color-mix(in srgb,var(--og-accent) 7%,transparent)}
/* 글자를 드래그하는 동안에는 그림 잡기 영역이 반응하지 않는다(그림 속 글자를 끌다가 글자 없는 곳에 닿으면 그림 선택 표시가 떴다) */
body.selecting .figgrab{pointer-events:none}
.tl{position:absolute;white-space:pre;color:transparent;transform-origin:0 0;line-height:1}
.tl::selection{background:rgba(0,100,255,.25);color:transparent}
.loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#999;font-size:14px;z-index:0}
/* 그림 속 글자: 그림은 원본 그대로, 같은 위치·기울기로 투명한 글자를 겹친다 */
.gtext{position:absolute;left:0;top:0;transform-origin:0 0;z-index:4}
.gtext ::selection{background:rgba(0,100,255,.25);color:transparent}
/* 쪽 이동(위 메뉴 가운데): 쪽 목록 · 이전 · 현재 쪽 / 전체 · 다음 */
.pagenav{display:flex;align-items:center;gap:2px;margin-left:auto;padding-left:12px;color:#444}
.menu .pagenav .tool{font-size:17px}
.menu .pagenav .tool:disabled{color:#c5c7c1;cursor:default}
.pagenav input{box-sizing:border-box;width:48px;height:26px;margin:0 2px;padding:0 6px;border:1px solid #d4d6d0;border-radius:6px;font:13px system-ui,sans-serif;text-align:center;outline:0}
.pagenav input:focus{border-color:var(--og-accent);box-shadow:0 0 0 3px var(--og-soft)}
.pagenav .total{min-width:34px;color:#777;white-space:nowrap}
/* 쪽 목록(왼쪽) */
.thumbs{position:fixed;left:0;top:var(--menu-h,43px);bottom:0;z-index:30;width:172px;display:none;flex-direction:column;background:#fbfbf9;border-right:1px solid #e6e7e3}
body.thumbs-open .thumbs{display:flex}
.thumbs-list{flex:1;overflow:auto;padding:10px 12px}
.thumb{display:flex;flex-direction:column;align-items:center;gap:4px;margin-bottom:12px;cursor:pointer;font-size:12px;color:#666}
.thumb .pic{box-sizing:border-box;width:124px;background:#fff center/contain no-repeat;border:2px solid transparent;box-shadow:0 0 0 1px #dcdeda;border-radius:3px}
.thumb:hover .pic{box-shadow:0 0 0 1px var(--og-accent)}
.thumb.on .pic{border-color:var(--og-accent);box-shadow:none}
.thumb.on{color:var(--og-accent);font-weight:600}
.ocr-wait{position:absolute;right:8px;bottom:8px;z-index:8;padding:4px 10px;border-radius:12px;background:rgba(46,48,43,.78);color:#fff;font-size:12px;pointer-events:none;transform:scale(var(--inv,1));transform-origin:100% 100%}
</style></head>
<body>
<div class="menu"><b>PDF</b>
  <div class="docbox" id="docbox"><button id="docbtn" disabled>문서화 ▾</button><div class="docmenu">
    <div class="docitem">전체 변환 <span class="docarrow">▶</span><div class="docsub"><button data-all data-rules="0">글</button><button data-all data-rules="1">규칙 적용</button></div></div>
    <div class="docitem">부분 변환 <span class="docarrow">▶</span><div class="docsub">
      <label class="doccheck"><input type="checkbox" id="partial-rules"> 규칙 적용</label>
      <button data-partial="even">짝수 페이지</button><button data-partial="odd">홀수 페이지</button><button data-partial="range">페이지 지정…</button><button data-partial="current">보고 있는 페이지</button>
    </div></div>
    <div class="docitem">문서화 규칙 <span class="docarrow">▶</span><div class="docsub docrules">
      <label class="rulecheck"><input type="checkbox" data-rule="objectImages"> 오브젝트 이미지 가져오기</label>
      <label class="rulecheck"><input type="checkbox" data-rule="tables"> 표 모양 그대로 살리기</label>
      <label class="rulecheck"><input type="checkbox" data-rule="blankLines"> 문단 사이 빈 줄 살리기</label>
      <label class="rulecheck" title="쪽의 짜임(레이아웃)을 분석하는 모델(컴퓨터 안에서 실행)로 선 없는 표·스캔본의 표를 찾고, 쪽마다 되풀이되는 머리말·꼬리말(장 제목·쪽 번호·장식 띠)을 뺍니다. 처음 켤 때 모델(약 131MB)을 한 번 내려받습니다"><input type="checkbox" data-rule="scanTables"> 레이아웃 분석 (선 없는 표·스캔본·머리말/꼬리말)</label>    </div></div>
  </div></div>
  <div class="pagenav">
    <button id="thumbs-btn" class="tool" title="쪽 목록"><i class="ph ph-squares-four"></i></button>
    <button id="page-prev" class="tool" title="이전 쪽"><i class="ph ph-caret-left"></i></button>
    <input id="page-input" type="text" inputmode="numeric" value="1" title="쪽 번호를 입력하고 Enter를 누르면 그 쪽으로 이동합니다" aria-label="현재 쪽">
    <span class="total">/ ${meta.pages.length}</span>
    <button id="page-next" class="tool" title="다음 쪽"><i class="ph ph-caret-right"></i></button>
  </div>
  <div class="tools">
    <button id="bookmark" class="tool" title="현재 페이지 북마크"><i class="ph ph-bookmark"></i></button>
    <div class="hlbox"><button id="highlight" class="tool" title="형광펜 (글자를 드래그하면 칠합니다)"><i class="ph ph-pencil-simple-line"></i><span class="hlbar"></span></button><button id="hl-caret" class="tool caret" title="형광펜 색"><i class="ph ph-caret-down"></i></button></div>
    <button id="note" class="tool" title="메모 (PDF의 원하는 곳을 누르면 붙습니다)"><i class="ph ph-note"></i></button>
    <button id="ann-list-btn" class="tool" title="주석 목록"><i class="ph ph-list-checks"></i></button>
    <button id="img-zip" class="tool" title="그림 내보내기 (목록에서 골라 ZIP으로 내려받기)"><i class="ph ph-images"></i></button>
  </div>
</div>
<div id="hl-pop" class="pop"><div class="swatches"></div></div>
<aside id="ann-panel" class="ann-panel"><div class="ann-panel-head"><span>주석 목록</span><button id="ann-close" title="닫기"><i class="ph ph-x"></i></button></div><div class="ann-help">항목을 누르면 해당 위치로 이동합니다.</div><div id="ann-list" class="ann-list"></div></aside>
<div id="ogdlg" class="ogdlg" hidden><div class="ogdlg-card" role="dialog" aria-modal="true"><h3 id="ogdlg-title"></h3><p id="ogdlg-desc"></p><input type="text" id="ogdlg-input"><div class="ogdlg-err" id="ogdlg-err"></div><div class="ogdlg-actions"><button class="ogbtn" id="ogdlg-cancel">취소</button><button class="ogbtn primary" id="ogdlg-ok">확인</button></div></div></div>
<div id="imgdlg" class="ogdlg imgdlg" hidden><div class="imgdlg-card" role="dialog" aria-modal="true" aria-labelledby="imgdlg-title">
  <div class="imgdlg-head"><h3 id="imgdlg-title">그림 내보내기</h3><button id="imgdlg-close" title="닫기"><i class="ph ph-x"></i></button></div>
  <div class="imgdlg-help">필요 없는 그림은 ✕를 눌러 목록에서 빼세요. 목록에서만 빠지고 PDF에는 그대로 남습니다.</div>
  <div class="imgdlg-grid" id="imgdlg-grid"></div>
  <div class="imgdlg-foot"><span class="grow" id="imgdlg-count"></span><button class="linkbtn" id="imgdlg-restore" hidden></button><button class="ogbtn" id="imgdlg-cancel">취소</button><button class="ogbtn primary" id="imgdlg-ok">내려받기</button></div>
</div></div>
<div id="toast" class="toast"></div>
<div id="busy" class="busy" role="status"></div>
<aside id="thumbs" class="thumbs" aria-label="쪽 목록"><div class="thumbs-list" id="thumbs-list"></div></aside>
${pages}
<div id="ctx" class="ctx"></div>
<script>
const ID=${JSON.stringify(id)}, PAGE_COUNT=${meta.pages.length}, B=document.body, btn=document.getElementById('docbtn'),docbox=document.getElementById('docbox');
let ANN={version:1,highlights:[],bookmarks:[],notes:[]},annSaveTimer=0,noteMode=false,hlMode=false;
const annPanel=document.getElementById('ann-panel'),annList=document.getElementById('ann-list'),hlBtn=document.getElementById('highlight'),bmBtn=document.getElementById('bookmark'),noteBtn=document.getElementById('note'),listBtn=document.getElementById('ann-list-btn');
const annId=()=>Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9);
// 앱 디자인의 알림·입력 창(브라우저 기본 창 대신)
const toastEl=document.getElementById('toast');
const busyEl=document.getElementById('busy');
function busy(msg){busyEl.textContent=msg||'';busyEl.classList.toggle('show',!!msg);}
function toast(msg){toastEl.textContent=msg;toastEl.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>toastEl.classList.remove('show'),2600);}
// 그림 내보내기: 이 PDF의 그림(끌어서 넣을 수 있는 것과 같은 그림)을 목록으로 보여 주고, 필요 없는 그림은 목록에서만 빼고(PDF는 그대로)
// 남은 그림을 ZIP 하나로 저장한다. 파일 이름은 빼기 전 번호 그대로("쪽2-그림01.jpg") — 뺀 그림 때문에 번호가 바뀌지 않는다.
const imgDlg=document.getElementById('imgdlg'),imgGrid=document.getElementById('imgdlg-grid'),imgCount=document.getElementById('imgdlg-count'),imgOk=document.getElementById('imgdlg-ok'),imgRestore=document.getElementById('imgdlg-restore');
let imgList=[],imgOut=new Set();
const imgKey=f=>f.page+':'+f.id;
function imgRender(){
  const keep=imgList.filter(f=>!imgOut.has(imgKey(f)));
  imgCount.textContent=imgList.length+'개 중 '+keep.length+'개를 내려받습니다';
  imgOk.textContent='내려받기 ('+keep.length+'개)';imgOk.disabled=!keep.length;
  imgRestore.hidden=!imgOut.size;imgRestore.textContent='뺀 그림 다시 넣기 ('+imgOut.size+'개)';
  imgGrid.querySelectorAll('.imgtile').forEach(t=>{t.hidden=imgOut.has(t.dataset.key);});
}
function openImgDlg(){
  // 쪽·위→아래·왼→오른 순서, 쪽마다 1부터(서버의 파일 이름과 같은 번호)
  imgList=FIGS.slice().sort((a,b)=>a.page-b.page||a.bbox[1]-b.bbox[1]||a.bbox[0]-b.bbox[0]);
  const per=new Map();imgOut=new Set();imgGrid.textContent='';
  for(const f of imgList){
    const k=(per.get(f.page)||0)+1;per.set(f.page,k);
    const t=document.createElement('div');t.className='imgtile';t.dataset.key=imgKey(f);
    const pic=document.createElement('div');pic.className='imgpic';
    const im=document.createElement('img');im.loading='lazy';im.alt='';im.src='/pdf/'+ID+'/image/'+f.page+'/'+f.id;pic.appendChild(im);
    const cap=document.createElement('div');cap.className='imgcap';cap.textContent=(f.page+1)+'쪽 · 그림 '+k;
    const x=document.createElement('button');x.className='imgdel';x.title='목록에서 빼기 (PDF에는 그대로 남습니다)';x.innerHTML='<i class="ph ph-x"></i>';
    x.onclick=()=>{imgOut.add(t.dataset.key);imgRender();};
    t.append(pic,cap,x);imgGrid.appendChild(t);
  }
  imgRender();imgDlg.hidden=false;imgOk.focus();
}
function closeImgDlg(){imgDlg.hidden=true;imgGrid.textContent='';}
document.getElementById('img-zip').addEventListener('click',()=>{
  if(!ready){toast('아직 그림을 찾는 중입니다. 잠시 뒤 다시 눌러 주세요.');return;}
  if(!FIGS.length){toast('이 PDF에는 꺼낼 그림이 없습니다.');return;}
  openImgDlg();
});
document.getElementById('imgdlg-close').onclick=closeImgDlg;
document.getElementById('imgdlg-cancel').onclick=closeImgDlg;
imgRestore.onclick=()=>{imgOut.clear();imgRender();};
imgDlg.addEventListener('mousedown',e=>{if(e.target===imgDlg)closeImgDlg();});
imgDlg.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();closeImgDlg();}});
imgOk.onclick=async()=>{
  const keep=imgList.filter(f=>!imgOut.has(imgKey(f))).map(imgKey);
  if(!keep.length)return;
  imgOk.disabled=true;toast('그림 '+keep.length+'개를 모으고 있습니다…');
  try{
    const r=await fetch('/pdf/'+ID+'/images.zip',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:keep})});
    if(!r.ok){let m='그림을 모으지 못했습니다.';try{m=(await r.json()).error||m;}catch{}toast(m);return;}
    const cd=r.headers.get('Content-Disposition')||'',enc=cd.split("filename*=UTF-8''")[1];
    const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');
    a.href=url;a.download=enc?decodeURIComponent(enc.split(';')[0]):'images.zip';document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    closeImgDlg();
  }catch{toast('그림을 모으지 못했습니다.');}
  finally{imgOk.disabled=false;}
};
// 떠 있는 창(대화상자·그림 목록·주석 목록) 위의 휠은 그 안에서만: 안쪽 목록이 그 방향으로 더 움직일 수 있을 때만 두고,
// 아니면(넘치지 않거나 끝에 닿았거나 창 바깥 어두운 곳) 막는다 — 막지 않으면 뒤의 PDF 가 스크롤됐다
function trapWheel(root){
  root.addEventListener('wheel',e=>{
    if(e.ctrlKey)return;
    for(let el=e.target;el&&el!==root.parentNode;el=el.parentElement){
      const cs=getComputedStyle(el);
      if(e.deltaY&&el.scrollHeight>el.clientHeight+1&&/auto|scroll/.test(cs.overflowY)&&(e.deltaY<0?el.scrollTop>0:el.scrollTop+el.clientHeight<el.scrollHeight-1))return;
      if(e.deltaX&&el.scrollWidth>el.clientWidth+1&&/auto|scroll/.test(cs.overflowX)&&(e.deltaX<0?el.scrollLeft>0:el.scrollLeft+el.clientWidth<el.scrollWidth-1))return;
      if(el===root)break;
    }
    e.preventDefault();
  },{passive:false});
}
document.querySelectorAll('.ogdlg,.ann-panel').forEach(trapWheel);
const dlg=document.getElementById('ogdlg'),dlgInput=document.getElementById('ogdlg-input'),dlgErr=document.getElementById('ogdlg-err');
function askText(title,desc,value,okLabel,check){return new Promise(done=>{
  document.getElementById('ogdlg-title').textContent=title;document.getElementById('ogdlg-desc').textContent=desc;document.getElementById('ogdlg-ok').textContent=okLabel||'확인';
  dlgInput.value=value||'';dlgErr.textContent='';dlg.hidden=false;setTimeout(()=>{dlgInput.focus();dlgInput.select();},0);
  const close=v=>{dlg.hidden=true;dlgInput.onkeydown=null;document.getElementById('ogdlg-ok').onclick=null;document.getElementById('ogdlg-cancel').onclick=null;dlg.onmousedown=null;done(v);};
  const ok=()=>{try{close(check?check(dlgInput.value):dlgInput.value);}catch(err){dlgErr.textContent=String(err.message||err);dlgInput.focus();}};
  document.getElementById('ogdlg-ok').onclick=ok;document.getElementById('ogdlg-cancel').onclick=()=>close(null);
  dlgInput.onkeydown=e=>{if(e.key==='Enter')ok();else if(e.key==='Escape')close(null);};
  dlg.onmousedown=e=>{if(e.target===dlg)close(null);};
});}
// 형광펜 색
const HL_COLORS=['#ffe066','#ffb3c1','#b5f0a0','#a8dcff','#d7b8ff','#ffc98a'];
let hlColor=HL_COLORS[0];try{const c=localStorage.getItem('ogolgye:pdf-hl');if(HL_COLORS.includes(c))hlColor=c;}catch{}
const hlPop=document.getElementById('hl-pop'),hlCaret=document.getElementById('hl-caret');
function paintHlColor(){document.documentElement.style.setProperty('--hl',hlColor);hlPop.querySelector('.swatches').innerHTML=HL_COLORS.map(c=>'<button class="swatch" data-color="'+c+'" style="background:'+c+'" title="'+c+'">'+(c===hlColor?'<i class="ph ph-check"></i>':'')+'</button>').join('');}
function openPop(pop,anchor){const r=anchor.getBoundingClientRect();pop.classList.add('open');const w=pop.offsetWidth;pop.style.left=Math.max(8,Math.min(innerWidth-w-8,r.right-w))+'px';pop.style.top=(r.bottom+6)+'px';}
hlCaret.onclick=e=>{e.stopPropagation();if(hlPop.classList.contains('open'))hlPop.classList.remove('open');else openPop(hlPop,hlCaret.closest('.hlbox'));};
hlPop.onclick=e=>{const s=e.target.closest('.swatch');if(!s)return;hlColor=s.dataset.color;try{localStorage.setItem('ogolgye:pdf-hl',hlColor);}catch{}paintHlColor();hlPop.classList.remove('open');if(hasPdfSelection())addHighlight();};
paintHlColor();
function annLayer(sheet){let layer=sheet.querySelector(':scope>.ann-layer');if(!layer){layer=document.createElement('div');layer.className='ann-layer';sheet.appendChild(layer);}return layer;}
function annEsc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function stickyHtml(n){return '<div class="sticky'+(n.folded?' folded':'')+'" data-note="'+n.id+'" style="left:'+n.x+'%;top:'+n.y+'%"><i class="ph ph-note fold-icon"></i><div class="sticky-head"><i class="ph ph-dots-six grip"></i><button data-act="fold" title="접기"><i class="ph ph-minus"></i></button><button data-act="del" title="메모 삭제"><i class="ph ph-x"></i></button></div>'+(n.quote?'<div class="quote">'+annEsc(n.quote)+'</div>':'')+'<textarea placeholder="메모를 입력하세요">'+annEsc(n.text)+'</textarea></div>';}
function renderAnnotationsPage(page){
  const pg=document.querySelector('.pg[data-n="'+page+'"]');if(!pg)return;
  pg.querySelectorAll('.sheet').forEach(sheet=>{
    const layer=annLayer(sheet);layer.innerHTML='';
    ANN.highlights.filter(x=>x.page===page).forEach(h=>h.rects.forEach(r=>{const el=document.createElement('div');el.className='ann-hl';el.dataset.ann=h.id;el.title=h.text||'형광펜';Object.assign(el.style,{left:r.x+'%',top:r.y+'%',width:r.w+'%',height:r.h+'%',background:h.color||'#ffe066'});layer.appendChild(el);}));
    if(ANN.bookmarks.some(x=>x.page===page)){const mark=document.createElement('div');mark.className='ann-bookmark';mark.title='북마크된 페이지';layer.appendChild(mark);}
    layer.insertAdjacentHTML('beforeend',ANN.notes.filter(x=>x.page===page).map(stickyHtml).join(''));
  });
}
function renderAnnotations(){for(let n=0;n<PAGE_COUNT;n++)renderAnnotationsPage(n);renderAnnotationList();markBookmarkButton();}
const ANN_ICON={bookmark:'ph-bookmark',note:'ph-note',highlight:'ph-pencil-simple-line'};
function annLabel(type,kind,page,text,extra){return '<b><i class="ph '+ANN_ICON[type]+'"></i>'+(page+1)+'쪽 · '+kind+(extra||'')+'</b><span>'+annEsc(text||'')+'</span>';}
function renderAnnotationList(){
  const rows=[];
  ANN.bookmarks.slice().sort((a,b)=>a.page-b.page||(a.y||0)-(b.y||0)).forEach(x=>rows.push({id:x.id,type:'bookmark',page:x.page,y:x.y,html:annLabel('bookmark','북마크',x.page,x.label||((x.page+1)+'쪽'))}));
  ANN.notes.slice().sort((a,b)=>a.page-b.page||a.y-b.y).forEach(x=>rows.push({id:x.id,type:'note',page:x.page,y:x.y,html:annLabel('note','메모',x.page,x.text||'(빈 메모)')}));
  ANN.highlights.slice().sort((a,b)=>a.page-b.page).forEach(x=>rows.push({id:x.id,type:'highlight',page:x.page,y:x.rects[0]&&x.rects[0].y,html:annLabel('highlight','형광펜',x.page,x.text,' <span class="sw" style="background:'+(x.color||'#ffe066')+'"></span>')}));
  annList.innerHTML=rows.length?rows.map(x=>'<div class="ann-item" data-type="'+x.type+'" data-id="'+x.id+'" data-page="'+x.page+'" data-y="'+(x.y==null?'':x.y)+'">'+x.html+'<button class="ann-del" title="삭제"><i class="ph ph-trash"></i></button></div>').join(''):'<div class="ann-empty">아직 추가한 주석이 없습니다.</div>';
}
function postAnnotations(){annSaveTimer=0;return fetch('/pdf/'+ID+'/annotations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(ANN)}).catch(()=>{});}
function saveAnnotations(){clearTimeout(annSaveTimer);annSaveTimer=setTimeout(postAnnotations,180);}
// 탭을 닫기 직전(app.js closeSub): 아직 안 보낸 주석이 있으면 바로 보낸다 — 닫힌 뒤엔 서버 세션이 없어진다
window.ogFlushAnnotations=()=>{if(!annSaveTimer)return Promise.resolve();clearTimeout(annSaveTimer);return postAnnotations();};
function changed(page){renderAnnotationsPage(page);renderAnnotationList();markBookmarkButton();saveAnnotations();}
async function loadAnnotations(){try{const r=await fetch('/pdf/'+ID+'/annotations',{cache:'no-store'});if(r.ok)ANN=await r.json();}catch{}ANN.highlights||=[];ANN.bookmarks||=[];ANN.notes||=[];renderAnnotations();}
const viewSheet=page=>document.querySelector('.pg[data-n="'+page+'"]>.sheet');
function jumpAnnotation(page,y){const pg=document.querySelector('.pg[data-n="'+page+'"]');if(!pg)return;if(y==null||y===''){pg.scrollIntoView({behavior:'smooth',block:'start'});return;}const sr=viewSheet(page).getBoundingClientRect(),top=document.querySelector('.menu').getBoundingClientRect().bottom;scrollBy({top:sr.top+sr.height*(+y)/100-top-80,behavior:'smooth'});}
function markBookmarkButton(){const page=currentPage(),on=ANN.bookmarks.some(x=>x.page===page);bmBtn.classList.toggle('on',on);bmBtn.title=on?'현재 페이지 북마크 삭제':'현재 페이지 북마크';}
function toggleBookmark(){const page=currentPage();if(ANN.bookmarks.some(x=>x.page===page))ANN.bookmarks=ANN.bookmarks.filter(x=>x.page!==page);else ANN.bookmarks.push({id:annId(),page,label:(page+1)+'쪽'});changed(page);}
function mergeHighlightRects(rects){
  const out=[];rects.sort((a,b)=>a.y-b.y||a.x-b.x).forEach(r=>{const last=out[out.length-1];if(last&&Math.abs(last.y-r.y)<.35&&Math.abs(last.h-r.h)<.5&&r.x<=last.x+last.w+1){last.w=Math.max(last.w,r.x+r.w-last.x);last.h=Math.max(last.h,r.h);}else out.push({...r});});return out;
}
// 선택한 글자가 PDF 쪽 안에 있는지, 있다면 쪽별 위치(%)
function hasPdfSelection(){const s=getSelection();if(!s||!s.rangeCount||s.isCollapsed||!s.toString().trim())return false;const n=s.anchorNode,el=n&&(n.nodeType===1?n:n.parentElement);return !!(el&&el.closest('.sheet')&&!el.closest('.sticky'));}
function selectionPlaces(){
  const sel=getSelection();if(!hasPdfSelection())return null;
  const range=sel.getRangeAt(0),clientRects=[...range.getClientRects()].filter(r=>r.width>.5&&r.height>.5),byPage=new Map();
  const sheets=[...document.querySelectorAll('.pg>.sheet')];
  for(const cr of clientRects){let best=null,area=0;for(const sheet of sheets){const sr=sheet.getBoundingClientRect(),w=Math.max(0,Math.min(cr.right,sr.right)-Math.max(cr.left,sr.left)),h=Math.max(0,Math.min(cr.bottom,sr.bottom)-Math.max(cr.top,sr.top));if(w*h>area){area=w*h;best={sheet,sr};}}if(!best||!area)continue;const page=+best.sheet.closest('.pg').dataset.n,sr=best.sr,r={x:(cr.left-sr.left)/sr.width*100,y:(cr.top-sr.top)/sr.height*100,w:cr.width/sr.width*100,h:cr.height/sr.height*100};if(!byPage.has(page))byPage.set(page,[]);byPage.get(page).push(r);}
  return byPage.size?{byPage,text:sel.toString().trim()}:null;
}
function dropOverlapped(page,rects){const hit=(a,b)=>{const w=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x),h=Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y);return w>0&&h>a.h*.5;};ANN.highlights=ANN.highlights.filter(o=>o.page!==page||!o.rects.some(a=>rects.some(b=>hit(a,b))));}
function addHighlight(){
  if(!hasPdfSelection()){toast('먼저 PDF의 글자를 드래그해 선택해 주세요.');return;}
  const at=selectionPlaces();if(!at){toast('선택한 글자의 위치를 찾지 못했습니다.');return;}
  at.byPage.forEach((rects,page)=>{rects=mergeHighlightRects(rects);dropOverlapped(page,rects);ANN.highlights.push({id:annId(),page,color:hlColor,text:at.text,rects});changed(page);});getSelection().removeAllRanges();setHlMode(false);
}
function bookmarkSelection(){
  const at=selectionPlaces();if(!at)return;const [page,rects]=[...at.byPage][0],y=Math.min(...rects.map(r=>r.y));
  ANN.bookmarks.push({id:annId(),page,y,label:at.text.length>60?at.text.slice(0,60)+'…':at.text});changed(page);getSelection().removeAllRanges();toast((page+1)+'쪽에 북마크를 추가했습니다.');
}
// 포스트잇 메모
function addNote(page,x,y,quote){const n={id:annId(),page,x:Math.max(0,Math.min(x,88)),y:Math.max(0,Math.min(y,94)),text:''};if(quote)n.quote=quote.length>80?quote.slice(0,80)+'…':quote;ANN.notes.push(n);changed(page);focusNote(n.id);}
function noteSelection(){
  const at=selectionPlaces();if(!at)return;const entries=[...at.byPage],[page,rects]=entries[entries.length-1],last=rects.reduce((a,b)=>b.y+b.h>a.y+a.h?b:a);
  getSelection().removeAllRanges();addNote(page,last.x+last.w+1,last.y+last.h+.5,at.text);
}
function focusNote(id){const n=ANN.notes.find(x=>x.id===id);if(!n)return;if(n.folded){n.folded=false;changed(n.page);}const el=viewSheet(n.page)?.querySelector('.sticky[data-note="'+id+'"] textarea');if(el)setTimeout(()=>el.focus({preventScroll:true}),0);}
function setNoteMode(on){noteMode=on;if(on)setHlMode(false);B.classList.toggle('note-mode',on);noteBtn.classList.toggle('on',on);}
function setHlMode(on){hlMode=on;if(on)setNoteMode(false);B.classList.toggle('hl-mode',on);hlBtn.classList.toggle('on',on);}
function removeAnnotation(type,id){const key=type==='bookmark'?'bookmarks':type==='note'?'notes':'highlights',i=ANN[key].findIndex(x=>x.id===id);if(i<0)return;const page=ANN[key][i].page;ANN[key].splice(i,1);changed(page);}
document.addEventListener('input',e=>{const box=e.target.closest('.sticky');if(!box||e.target.tagName!=='TEXTAREA')return;const n=ANN.notes.find(x=>x.id===box.dataset.note);if(!n)return;n.text=e.target.value;renderAnnotationList();saveAnnotations();});
document.addEventListener('focusout',e=>{const box=e.target.closest&&e.target.closest('.sticky');if(!box||e.target.tagName!=='TEXTAREA')return;const n=ANN.notes.find(x=>x.id===box.dataset.note);if(n&&!n.text.trim()&&!n.quote&&!box.contains(e.relatedTarget))setTimeout(()=>{if(!n.text.trim()&&document.activeElement?.closest('.sticky')?.dataset.note!==n.id)removeAnnotation('note',n.id);},150);});
// 포스트잇 끌어 옮기기·접기·삭제
let noteDrag=null;
document.addEventListener('mousedown',e=>{
  const box=e.target.closest('.sticky');if(!box||e.button!==0)return;
  const n=ANN.notes.find(x=>x.id===box.dataset.note);if(!n)return;
  const act=e.target.closest('[data-act]');
  if(act){e.preventDefault();e.stopPropagation();if(act.dataset.act==='del')removeAnnotation('note',n.id);else{n.folded=true;changed(n.page);}return;}
  if(box.classList.contains('folded')){e.preventDefault();e.stopPropagation();n.folded=false;changed(n.page);focusNote(n.id);return;}
  if(!e.target.closest('.sticky-head'))return;
  e.preventDefault();e.stopPropagation();const sr=box.closest('.sheet').getBoundingClientRect();
  noteDrag={n,box,sr,dx:e.clientX-box.getBoundingClientRect().left,dy:e.clientY-box.getBoundingClientRect().top,moved:false};
},true);
addEventListener('mousemove',e=>{if(!noteDrag)return;const d=noteDrag;d.moved=true;d.n.x=Math.max(0,Math.min(96,(e.clientX-d.dx-d.sr.left)/d.sr.width*100));d.n.y=Math.max(0,Math.min(97,(e.clientY-d.dy-d.sr.top)/d.sr.height*100));d.box.style.left=d.n.x+'%';d.box.style.top=d.n.y+'%';});
addEventListener('mouseup',()=>{if(!noteDrag)return;const d=noteDrag;noteDrag=null;if(d.moved)changed(d.n.page);});
for(const el of [hlBtn,bmBtn,noteBtn,listBtn,hlCaret])el.addEventListener('mousedown',e=>e.preventDefault());
hlBtn.onclick=()=>{if(hasPdfSelection()){addHighlight();return;}setHlMode(!hlMode);if(hlMode)toast('글자를 드래그하면 형광펜이 칠해집니다.');};
bmBtn.onclick=toggleBookmark;
noteBtn.onclick=()=>{if(hasPdfSelection()){noteSelection();return;}setNoteMode(!noteMode);if(noteMode)toast('메모를 붙일 곳을 누르세요.');};
listBtn.onclick=()=>{annPanel.classList.toggle('open');listBtn.classList.toggle('on',annPanel.classList.contains('open'));};
document.getElementById('ann-close').onclick=()=>{annPanel.classList.remove('open');listBtn.classList.remove('on');};
annList.onclick=e=>{const row=e.target.closest('.ann-item');if(!row)return;if(e.target.closest('.ann-del')){e.stopPropagation();removeAnnotation(row.dataset.type,row.dataset.id);return;}jumpAnnotation(+row.dataset.page,row.dataset.y);if(row.dataset.type==='note')focusNote(row.dataset.id);};
addEventListener('mouseup',e=>{if(hlMode&&e.button===0&&!e.target.closest('.menu,.ann-panel,.sticky,.pop,.ctx'))setTimeout(()=>{if(hasPdfSelection())addHighlight();},0);});
document.addEventListener('click',e=>{if(!e.target.closest('.pop,#hl-caret'))hlPop.classList.remove('open');if(!noteMode||e.target.closest('.sticky'))return;const sheet=e.target.closest('.sheet');if(!sheet||e.target.closest('.menu,.ann-panel'))return;e.preventDefault();const sr=sheet.getBoundingClientRect(),page=+sheet.closest('.pg').dataset.n;setNoteMode(false);addNote(page,(e.clientX-sr.left)/sr.width*100,(e.clientY-sr.top)/sr.height*100);},true);
addEventListener('keydown',e=>{if(e.key==='Escape'){setNoteMode(false);setHlMode(false);hlPop.classList.remove('open');ctx.classList.remove('open');}});
addEventListener('scroll',()=>{clearTimeout(markBookmarkButton._t);markBookmarkButton._t=setTimeout(markBookmarkButton,80);},{passive:true});
addEventListener('message',e=>{
  if(e.origin!==location.origin||!e.data)return;
  if(e.data.type==='ogolgye:theme')document.documentElement.style.setProperty('--og-accent',e.data.color);
  if(e.data.type==='ogolgye:ocr-updated')document.querySelectorAll('.pg[data-tl]').forEach(s=>{s.dataset.ocr='';loadOcr(s);});   // 언어를 바꾸면 다시 읽는다
  if(e.data.type==='ogolgye:documentized'){
    btn.disabled=false;btn.textContent='문서화 ▾';busy('');
    if(!e.data.ok)toast('문서화하지 못했습니다.\\n'+(e.data.error||''));
  }
});
let ready=false,OCR_PAGES=new Set();                    // 글자를 담을 만한 그림이 있는 쪽(서버가 알려 준다)
// 글자 층·문서화 준비 상태 확인
async function poll(){
  try{
    const st=await (await fetch('/pdf/'+ID+'/status')).json();
    if(st.error){btn.title='변환할 수 없습니다: '+st.error;busy('');return;}
    if(!st.ready&&st.progress){btn.textContent='준비 중…';busy('문서화 준비 중… '+progressText(st.progress));}
    if(st.ready){
      ready=true;btn.disabled=false;btn.textContent='문서화 ▾';busy('');OCR_PAGES=new Set(st.ocrPages||[]);
      try{FIGS=await (await fetch('/pdf/'+ID+'/figures')).json();}catch{FIGS=[];}
      visible.forEach(loadPage);return;
    }
  }catch{}
  setTimeout(poll,600);
}
// 끌어다 놓을 수 있는 그림: 글자층 안에서 글자들보다 아래에 둔다(글자 위는 글자 드래그, 그림의 빈 곳은 그림 끌기)
let FIGS=[];
function figHtml(n){return FIGS.filter(f=>f.page===+n&&!f.listOnly).map(f=>'<div class="figgrab" draggable="true" data-page="'+f.page+'" data-img="'+f.id+'" title="끌어서 문서에 넣기" style="left:'+f.bbox[0]+'pt;top:'+f.bbox[1]+'pt;width:'+(f.bbox[2]-f.bbox[0])+'pt;height:'+(f.bbox[3]-f.bbox[1])+'pt"></div>').join('');}
const figPreview=new Map();
function figUrl(el){return '/pdf/'+ID+'/image/'+el.dataset.page+'/'+el.dataset.img;}
// 그림 잡기 영역이 아닌 곳(글자 등)에서 마우스를 누르면 놓을 때까지 그림 잡기를 끈다
addEventListener('mousedown',e=>{if(e.button===0&&!(e.target.closest&&e.target.closest('.figgrab')))document.body.classList.add('selecting');},true);
for(const ev of ['mouseup','blur','dragend'])addEventListener(ev,()=>document.body.classList.remove('selecting'),true);
document.addEventListener('mouseover',e=>{const f=e.target.closest&&e.target.closest('.figgrab');if(f&&!figPreview.has(figUrl(f))){const im=new Image();im.src=figUrl(f);figPreview.set(figUrl(f),im);}});
document.addEventListener('dragstart',e=>{
  const f=e.target.closest&&e.target.closest('.figgrab');if(!f)return;
  e.dataTransfer.setData('application/x-ogolgye-pdf-image',JSON.stringify({url:figUrl(f),name:'pdf-'+(+f.dataset.page+1)+'쪽-'+f.dataset.img}));
  e.dataTransfer.effectAllowed='copy';
  const im=figPreview.get(figUrl(f));
  if(im&&im.complete&&im.naturalWidth){const k=Math.min(1,220/im.naturalWidth,220/im.naturalHeight);const c=document.createElement('canvas');c.width=Math.max(1,im.naturalWidth*k);c.height=Math.max(1,im.naturalHeight*k);c.getContext('2d').drawImage(im,0,0,c.width,c.height);c.style.cssText='position:fixed;left:-9999px;top:0';document.body.appendChild(c);e.dataTransfer.setDragImage(c,c.width/2,c.height/2);setTimeout(()=>c.remove(),0);}
});
// 화면에 들어온 쪽만 불러오기
const visible=new Set();
function loadPage(sec){
  const n=sec.dataset.n, img=sec.querySelector('.bg');
  if(!img.src)img.src=img.dataset.src;
  if(ready&&!sec.dataset.tl){sec.dataset.tl=1;fetch('/pdf/'+ID+'/text/'+n).then(r=>r.text()).then(h=>{sec.querySelector('.tlayer').innerHTML=figHtml(n)+h;fitTextLayer(sec);renderAnnotationsPage(+n);loadOcr(sec);});}
}
// 사진·스캔처럼 글자 데이터가 없는 곳의 글자(OCR): 글자 층을 깐 뒤 뒤에서 읽고, 끝나면 투명 글자를 덧붙인다
// OCR 차례: 한 번에 하나만 요청한다(서버도 하나씩 읽는다). 브라우저는 한 서버에 동시 요청을 6개까지만 보내서,
// 쪽마다 몇 초 걸리는 OCR 요청이 여럿 걸려 있으면 쪽 그림 요청이 줄을 섰다(771쪽 PDF에서 쪽 그림이 7초 넘게 늦음).
// 지금 보는 쪽에 가까운 쪽부터 읽고, 화면 근처를 벗어난 쪽은 다시 들어올 때까지 미룬다.
const ocrWant=new Set();let ocrBusy=false;
function loadOcr(sec){
  if(!OCR_PAGES.has(+sec.dataset.n)||sec.dataset.ocr==='done')return;   // 그림이 없는 쪽·이미 읽은 쪽은 하지 않는다
  ocrWant.add(sec);pumpOcr();
}
function pumpOcr(){
  if(ocrBusy)return;
  const cur=currentPage();
  const sec=[...ocrWant].filter(s=>visible.has(s)).sort((a,b)=>Math.abs(+a.dataset.n-cur)-Math.abs(+b.dataset.n-cur))[0];
  if(!sec)return;
  ocrWant.delete(sec);ocrBusy=true;
  const n=sec.dataset.n,sheet=sec.querySelector('.sheet'),layer=sec.querySelector('.tlayer');
  layer.querySelectorAll('.gtext.ocr').forEach(x=>x.remove());
  let badge=sheet.querySelector('.ocr-wait');if(!badge){badge=document.createElement('div');badge.className='ocr-wait';badge.textContent='그림 속 글자를 읽고 있습니다…';sheet.appendChild(badge);}
  fetch('/pdf/'+ID+'/ocr/'+n).then(async r=>{
    if(r.status===409)return null;
    if(!r.ok)throw Error('OCR HTTP '+r.status);
    return r.text();
  }).then(h=>{badge.remove();sec.dataset.ocr='done';if(h){layer.insertAdjacentHTML('beforeend',h);fitTextLayer(sec);}}).catch(()=>badge.remove())
    .finally(()=>{ocrBusy=false;pumpOcr();});
}
const io=new IntersectionObserver(es=>{es.forEach(e=>{const s=e.target;if(e.isIntersecting){visible.add(s);loadPage(s);}else visible.delete(s);});pumpOcr();},{rootMargin:'1200px 0px'});
document.querySelectorAll('.pg').forEach(s=>io.observe(s));
function placeDocMenu(){
  const menu=docbox.querySelector('.docmenu'),r=btn.getBoundingClientRect(),gap=5;
  menu.style.left=Math.max(6,Math.min(r.left,innerWidth-menu.offsetWidth-6))+'px';
  menu.style.top=Math.max(6,Math.min(r.bottom+gap,innerHeight-menu.offsetHeight-6))+'px';
}
btn.onclick=e=>{e.stopPropagation();if(!ready)return;docbox.classList.toggle('open');if(docbox.classList.contains('open'))requestAnimationFrame(placeDocMenu);};
addEventListener('resize',()=>{if(docbox.classList.contains('open'))placeDocMenu();});
document.querySelector('.menu').addEventListener('scroll',()=>{if(docbox.classList.contains('open'))placeDocMenu();},{passive:true});
function pageList(raw){
  const set=new Set();
  for(const bit of raw.split(',')){
    const s=bit.trim();if(!s)continue;
    const m=s.match(/^(\\d+)(?:\\s*-\\s*(\\d+))?$/);if(!m)throw Error('페이지는 1-3, 5처럼 입력해 주세요.');
    let a=+m[1],b=+(m[2]||m[1]);if(a>b){const t=a;a=b;b=t;}
    if(a<1||b>PAGE_COUNT)throw Error('페이지는 1부터 '+PAGE_COUNT+' 사이로 입력해 주세요.');
    for(let n=a;n<=b;n++)set.add(n-1);
  }
  if(!set.size)throw Error('문서화할 페이지를 입력해 주세요.');
  return [...set].sort((a,b)=>a-b);
}
// 문서화 규칙(오브젝트 이미지·표 모양): 앱 설정 파일에 저장해 다음에도 그대로 쓴다
let RULES={objectImages:true,tables:true,blankLines:true,scanTables:false};
const ruleBoxes=[...document.querySelectorAll('[data-rule]')];
function showRules(){ruleBoxes.forEach(x=>{x.checked=!!RULES[x.dataset.rule];});}
fetch('/api/settings',{cache:'no-store'}).then(r=>r.json()).then(s=>{if(s&&s.pdfRules)RULES={...RULES,...s.pdfRules};showRules();}).catch(showRules);
// 표 인식 모델을 실행할 수 없는 컴퓨터(인텔 맥 등)에서는 스캔본 표 인식을 끄고 막는다
fetch('/api/pp-structure',{cache:'no-store'}).then(r=>r.json()).then(st=>{if(st.supported)return;const box=document.querySelector('[data-rule="scanTables"]');if(!box)return;box.checked=false;box.disabled=true;box.closest('label').title='이 컴퓨터에서는 레이아웃 분석 모델을 실행할 수 없습니다(인텔 맥 등).';RULES.scanTables=false;}).catch(()=>{});
function saveRules(){fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pdfRules:RULES})}).catch(()=>toast('문서화 규칙을 저장하지 못했습니다.'));}
// 스캔본 표 인식: 모델이 없으면 켤 때 내려받는다(받는 동안 진행률, 실패하면 다시 끈다)
async function installScanTables(box){
  box.disabled=true;
  try{
    let st=await (await fetch('/api/pp-structure',{method:'POST'})).json();
    while(!st.installed&&st.running){toast('레이아웃 분석 모델을 내려받는 중… '+(st.total?Math.floor(st.done/st.total*100):0)+'%');await new Promise(r=>setTimeout(r,800));st=await (await fetch('/api/pp-structure',{cache:'no-store'})).json();}
    if(!st.installed)throw Error(st.error||'레이아웃 분석 모델을 내려받지 못했습니다.');
    toast('레이아웃 분석 모델을 설치했습니다.');return true;
  }catch(err){toast(String(err.message||err));return false;}
  finally{box.disabled=false;}
}
ruleBoxes.forEach(x=>x.addEventListener('change',async()=>{
  if(x.dataset.rule==='scanTables'&&x.checked&&!(await installScanTables(x))){x.checked=false;return;}
  RULES={...RULES,[x.dataset.rule]:x.checked};saveRules();
}));
// 진행 표시: "글자 읽기 23/96", 레이아웃 분석은 남은 시간도(지금까지 속도로 어림)
function progressText(p,eta){
  if(!p)return '';
  const n=p.total?' '+p.done+'/'+p.total+(p.phase==='레이아웃 분석'?'쪽':''):'';
  let left='';
  if(eta&&p.total&&p.done>eta.done0){const per=(Date.now()-eta.t0)/(p.done-eta.done0),sec=Math.round(per*(p.total-p.done)/1000);if(sec>=5)left=' · 약 '+(sec>=90?Math.round(sec/60)+'분':sec+'초')+' 남음';}
  return p.phase+n+left;
}
async function documentize(pages,useRules){
  docbox.classList.remove('open');btn.disabled=true;btn.textContent='문서화 중…';busy('문서화 중…');
  const slow=setTimeout(()=>{if(!(useRules&&RULES.scanTables))toast('사진·스캔 속 글자를 읽고 있어 시간이 조금 걸립니다.');},1500);
  const flag=v=>useRules&&v?'1':'0';
  // 서버가 알려 주는 진행(레이아웃 분석 몇 쪽째)을 단추에 보여 준다 — 긴 PDF 에서 멈춘 것처럼 보이지 않게
  let eta=null,watching=true;
  (async()=>{while(watching){try{const st=await (await fetch('/pdf/'+ID+'/status')).json();if(watching&&st.progress){if(!eta||eta.phase!==st.progress.phase)eta={phase:st.progress.phase,t0:Date.now(),done0:st.progress.done};busy('문서화 중… '+progressText(st.progress,eta));}}catch{}await new Promise(r=>setTimeout(r,700));}})();
  try{
    const r=await fetch('/pdf/'+ID+'/content?pages='+pages.join(',')+'&images='+flag(RULES.objectImages)+'&tables='+flag(RULES.tables)+'&blanks='+flag(RULES.blankLines)+'&scan='+flag(RULES.scanTables));const data=await r.json();
    if(!r.ok)throw Error(data.error||'본문을 만들지 못했습니다.');
    watching=false;btn.textContent='문서화 중…';busy('문서에 넣는 중…');
    parent.postMessage({type:'ogolgye:documentize',id:ID,text:data.text,html:data.html,pages:data.pages},location.origin);
  }catch(err){btn.disabled=false;btn.textContent='문서화 ▾';busy('');toast(String(err.message||err));}
  finally{clearTimeout(slow);watching=false;}
}
function currentPage(){
  const top=document.querySelector('.menu').getBoundingClientRect().bottom,target=top+(innerHeight-top)/2;
  let best=0,dist=Infinity;document.querySelectorAll('.pg').forEach((pg,i)=>{const r=pg.getBoundingClientRect(),d=Math.abs((r.top+r.bottom)/2-target);if(d<dist){dist=d;best=i;}});return best;
}
docbox.querySelector('.docmenu').onclick=async e=>{
  const all=e.target.closest('[data-all]');if(all){documentize(Array.from({length:PAGE_COUNT},(_,i)=>i),all.dataset.rules==='1');return;}
  const item=e.target.closest('[data-partial]');if(!item)return;
  const useRules=document.getElementById('partial-rules').checked;
  let pages=[];
  if(item.dataset.partial==='even')pages=Array.from({length:PAGE_COUNT},(_,i)=>i).filter(i=>(i+1)%2===0);
  else if(item.dataset.partial==='odd')pages=Array.from({length:PAGE_COUNT},(_,i)=>i).filter(i=>(i+1)%2===1);
  else if(item.dataset.partial==='current')pages=[currentPage()];
  else{docbox.classList.remove('open');pages=await askText('페이지 지정','문서화할 페이지를 입력하세요. 예: 1-3, 5, 8-10','1-'+PAGE_COUNT,'문서화',pageList);if(!pages)return;}
  if(!pages.length){toast('해당하는 페이지가 없습니다.');return;}documentize(pages,useRules);
};
document.addEventListener('click',e=>{if(!docbox.contains(e.target))docbox.classList.remove('open');});
// PDF 보기 iframe 위에 새 PDF를 놓아도 바깥 앱이 새 파일을 열 수 있게 전달한다.
document.addEventListener('dragover',e=>{if(e.dataTransfer&&e.dataTransfer.types.includes('Files'))e.preventDefault();},true);
document.addEventListener('drop',async e=>{
  const file=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0];if(!file||!/.pdf$/i.test(file.name))return;
  e.preventDefault();e.stopImmediatePropagation();const bytes=await file.arrayBuffer();
  parent.postMessage({type:'ogolgye:subview-drop',file:{name:file.name,path:file.path||null,bytes:bytes}},location.origin,[bytes]);
},true);
// 오른쪽 클릭 메뉴: 글자를 선택했으면 북마크·형광펜·메모, 형광펜 위면 지우기
const ctx=document.getElementById('ctx');let ctxActions=[];
function highlightAt(x,y){const sheet=viewSheet(currentPageAt(y));if(!sheet)return null;for(const el of sheet.querySelectorAll('.ann-hl')){const r=el.getBoundingClientRect();if(x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom)return ANN.highlights.find(h=>h.id===el.dataset.ann);}return null;}
function currentPageAt(y){let best=0;document.querySelectorAll('.pg').forEach((pg,i)=>{const r=pg.getBoundingClientRect();if(y>=r.top&&y<=r.bottom)best=i;});return best;}
function openCtx(items,x,y){
  ctxActions=items;ctx.innerHTML=items.map((it,i)=>it==='-'?'<div class="ctx-sep"></div>':'<div class="ctx-item'+(it.dim?' dim':'')+'" data-i="'+i+'"><i class="ph '+it.icon+'"></i>'+annEsc(it.label)+(it.dot?'<span class="dot" style="background:'+it.dot+'"></span>':'')+'</div>').join('');
  ctx.classList.add('open');ctx.style.left=Math.min(x,innerWidth-ctx.offsetWidth-6)+'px';ctx.style.top=Math.min(y,innerHeight-ctx.offsetHeight-6)+'px';
}
document.addEventListener('contextmenu',e=>{
  ctx.classList.remove('open');
  if(e.target.closest('.sticky,.menu,.ann-panel,.ogdlg'))return;
  const items=[];
  if(hasPdfSelection()&&e.target.closest('.pg')){
    items.push({icon:'ph-bookmark',label:'북마크',run:bookmarkSelection},{icon:'ph-pencil-simple-line',label:'형광펜',dot:hlColor,run:addHighlight},{icon:'ph-note',label:'메모',run:noteSelection});
  }else{
    const h=e.target.closest('.pg')&&highlightAt(e.clientX,e.clientY);
    if(h)items.push({icon:'ph-eraser',label:'형광펜 지우기',run:()=>removeAnnotation('highlight',h.id)});
  }
  if(!items.length)return;
  e.preventDefault();openCtx(items,e.clientX,e.clientY);
});
ctx.addEventListener('mousedown',e=>e.preventDefault());
ctx.onclick=e=>{const it=ctxActions[+e.target.closest('.ctx-item')?.dataset.i];if(!it||it.dim)return;ctx.classList.remove('open');it.run();};
addEventListener('mousedown',e=>{if(!ctx.contains(e.target))ctx.classList.remove('open');});
addEventListener('scroll',()=>ctx.classList.remove('open'),{passive:true});
// 그림 글자에서 시작한 드래그 선택이 DOM 순서상 이웃한 광고·본문으로 번지지 않게 한다.
// 그림 글자는 재구성된 문단 단위로, OCR 글자는 읽은 영역 단위로 끝점을 고정한다.
let gSelect=null,gSelectFixing=false,gSelectAfter=true;
function visibleEdgeText(root,last){
  const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.data&&n.parentElement&&n.parentElement.getClientRects().length?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT});
  let n,edge=null;while(n=w.nextNode()){edge=n;if(!last)return n;}return edge;
}
function finishGSelect(){gSelect=null;}
document.addEventListener('mousedown',e=>{
  if(e.button!==0)return;
  const g=e.target.closest('.sheet .gtext');
  const unit=g&&!g.classList.contains('ocr')&&e.target.closest('.opara');
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
// 줄 폭 맞추기(회전·축소와 무관한 배치 폭으로 잰다)
function fitTextLayer(root){root.querySelectorAll('.tl').forEach(el=>{el.style.transform='';const want=parseFloat(el.dataset.w)*96/72;const got=el.offsetWidth;if(got>0)el.style.transform='scaleX('+(want/got)+')';});}
function fit(){
  const side=B.classList.contains('thumbs-open')?thumbsEl.offsetWidth:0,avail=document.documentElement.clientWidth-side;   // 쪽 목록이 열려 있으면 그 옆 공간에 맞춘다. 세로 스크롤 막대는 뺀 폭(innerWidth 로 재면 막대만큼 넘쳐 가로 스크롤이 생겼다)
  document.documentElement.style.setProperty('--menu-h',document.querySelector('.menu').offsetHeight+'px');
  document.querySelectorAll('.pg').forEach(pg=>{pg.style.transform='';pg.style.margin='';const w=pg.offsetWidth,h=pg.offsetHeight;const k=Math.min(1,(avail-20)/w);pg.style.transform='scale('+k+')';pg.style.setProperty('--inv',1/k);pg.style.marginBottom=(14-h*(1-k))+'px';pg.style.marginLeft=side+Math.max(10,(avail-w*k)/2)+'px';});
}
addEventListener('resize',fit);
// ── 쪽 이동: 위 메뉴의 현재 쪽 / 전체 쪽, 쪽 번호 입력, 쪽 목록
const thumbsEl=document.getElementById('thumbs'),thumbsList=document.getElementById('thumbs-list'),thumbsBtn=document.getElementById('thumbs-btn');
const pageInput=document.getElementById('page-input'),prevBtn=document.getElementById('page-prev'),nextBtn=document.getElementById('page-next');
let shownPage=-1;
function goPage(n){
  n=Math.max(0,Math.min(PAGE_COUNT-1,n));
  const pg=document.querySelector('.pg[data-n="'+n+'"]');if(!pg)return;
  const top=document.querySelector('.menu').getBoundingClientRect().bottom;
  scrollTo({top:scrollY+pg.getBoundingClientRect().top-top-8});
  showPage(n);
}
function showPage(n){
  if(n===shownPage)return;shownPage=n;
  if(document.activeElement!==pageInput)pageInput.value=n+1;
  prevBtn.disabled=n<=0;nextBtn.disabled=n>=PAGE_COUNT-1;
  thumbsList.querySelector('.thumb.on')?.classList.remove('on');
  const t=thumbsList.querySelector('.thumb[data-n="'+n+'"]');
  if(t){t.classList.add('on');if(B.classList.contains('thumbs-open')){const lr=thumbsList.getBoundingClientRect(),tr=t.getBoundingClientRect();if(tr.top<lr.top||tr.bottom>lr.bottom)thumbsList.scrollTop+=tr.top-lr.top-(lr.height-tr.height)/2;}}
}
let pageTick=0;
// 끝까지 내리면 마지막 쪽(짧은 마지막 쪽은 화면 가운데까지 올라오지 못한다)
const pageNow=()=>scrollY>0&&scrollY+innerHeight>=document.documentElement.scrollHeight-2?PAGE_COUNT-1:currentPage();
addEventListener('scroll',()=>{if(pageTick)return;pageTick=requestAnimationFrame(()=>{pageTick=0;showPage(pageNow());});},{passive:true});
pageInput.addEventListener('keydown',e=>{
  if(e.key==='Enter'){e.preventDefault();const n=parseInt(pageInput.value,10);
    if(!Number.isFinite(n)||n<1||n>PAGE_COUNT){toast('쪽 번호는 1부터 '+PAGE_COUNT+' 사이로 입력해 주세요.');pageInput.select();return;}
    pageInput.blur();goPage(n-1);}
  else if(e.key==='Escape'){pageInput.value=shownPage+1;pageInput.blur();}
});
pageInput.addEventListener('focus',()=>pageInput.select());
pageInput.addEventListener('blur',()=>{pageInput.value=shownPage+1;});
prevBtn.onclick=()=>goPage(shownPage-1);nextBtn.onclick=()=>goPage(shownPage+1);
// 쪽 목록: 작은 그림은 목록에서 보이는 것만 불러온다
thumbsList.innerHTML=Array.from({length:PAGE_COUNT},(_,i)=>{const pg=document.querySelector('.pg[data-n="'+i+'"]'),w=parseFloat(pg.style.getPropertyValue('--w'))||595,h=parseFloat(pg.style.getPropertyValue('--h'))||842;return '<div class="thumb" data-n="'+i+'"><div class="pic" style="aspect-ratio:'+w+'/'+h+'"></div>'+(i+1)+'</div>';}).join('');
const thumbIo=new IntersectionObserver(es=>es.forEach(e=>{if(!e.isIntersecting)return;const pic=e.target.querySelector('.pic');pic.style.backgroundImage='url(/pdf/'+ID+'/thumb/'+e.target.dataset.n+'.jpg)';thumbIo.unobserve(e.target);}),{root:thumbsList,rootMargin:'400px 0px'});
thumbsList.querySelectorAll('.thumb').forEach(t=>thumbIo.observe(t));
thumbsList.onclick=e=>{const t=e.target.closest('.thumb');if(t)goPage(+t.dataset.n);};
function setThumbs(open){
  B.classList.toggle('thumbs-open',open);thumbsBtn.classList.toggle('on',open);thumbsBtn.title=open?'쪽 목록 닫기':'쪽 목록';
  try{localStorage.setItem('ogolgye-pdf-thumbs',open?'1':'0');}catch{}
  const keep=shownPage;fit();if(keep>=0)goPage(keep);
  if(open){shownPage=-1;showPage(keep<0?0:keep);}
}
thumbsBtn.onclick=()=>setThumbs(!B.classList.contains('thumbs-open'));
try{if(localStorage.getItem('ogolgye-pdf-thumbs')==='1')B.classList.add('thumbs-open'),thumbsBtn.classList.add('on');}catch{}
// 복사: 같은 문단의 원본 줄들을 판정된 이음새대로 합친다.
document.addEventListener('copy',e=>{
  const sel=getSelection();if(!sel.rangeCount)return;
  const r=sel.getRangeAt(0);const root=r.commonAncestorContainer.nodeType===1?r.commonAncestorContainer:r.commonAncestorContainer.parentElement;
  const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:n=>r.intersectsNode(n)?1:2});
  let out='',last=null,n;
  while(n=w.nextNode()){
    const blk=n.parentElement.closest('.tl');if(!blk||!blk.closest('.sheet'))continue;
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
fit();showPage(currentPage());loadAnnotations();poll();
</script></body></html>`;
}
