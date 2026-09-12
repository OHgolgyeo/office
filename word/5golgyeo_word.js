/* 5golgyeo_word · CKEditor 5 rebuild
 * Build: 20260912-kiwi-1
 *
 * Editor engine: CKEditor 5 GPL (bundled self-hosted distribution)
 * Export engines: docx.js, hwpxjs, Paged.js
 */

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
/* Tabler Icons 3.34.1 · MIT · see Tabler_Icons_LICENSE.txt.
   App icons are rendered only from this shared dictionary. CKEditor owns its icons. */
const APP_ICONS = {
  "file-text": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M14 3v4a1 1 0 0 0 1 1h4\" />\n  <path d=\"M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z\" />\n  <path d=\"M9 9l1 0\" />\n  <path d=\"M9 13l6 0\" />\n  <path d=\"M9 17l6 0\" />",
  "file-plus": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M14 3v4a1 1 0 0 0 1 1h4\" />\n  <path d=\"M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z\" />\n  <path d=\"M12 11l0 6\" />\n  <path d=\"M9 14l6 0\" />",
  "folder-open": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M5 19l2.757 -7.351a1 1 0 0 1 .936 -.649h12.307a1 1 0 0 1 .986 1.164l-.996 5.211a2 2 0 0 1 -1.964 1.625h-14.026a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v2\" />",
  "device-floppy": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M6 4h10l4 4v10a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2\" />\n  <path d=\"M12 14m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0\" />\n  <path d=\"M14 4l0 4l-6 0l0 -4\" />",
  "file-export": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M14 3v4a1 1 0 0 0 1 1h4\" />\n  <path d=\"M11.5 21h-4.5a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v5m-5 6h7m-3 -3l3 3l-3 3\" />",
  "download": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2\" />\n  <path d=\"M7 11l5 5l5 -5\" />\n  <path d=\"M12 4l0 12\" />",
  "settings": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z\" />\n  <path d=\"M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0\" />",
  "chevron-left": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M15 6l-6 6l6 6\" />",
  "chevron-right": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M9 6l6 6l-6 6\" />",
  "zoom-in": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0\" />\n  <path d=\"M7 10l6 0\" />\n  <path d=\"M10 7l0 6\" />\n  <path d=\"M21 21l-6 -6\" />",
  "zoom-out": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0\" />\n  <path d=\"M7 10l6 0\" />\n  <path d=\"M21 21l-6 -6\" />",
  "arrows-maximize": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M16 4l4 0l0 4\" />\n  <path d=\"M14 10l6 -6\" />\n  <path d=\"M8 20l-4 0l0 -4\" />\n  <path d=\"M4 20l6 -6\" />\n  <path d=\"M16 20l4 0l0 -4\" />\n  <path d=\"M14 14l6 6\" />\n  <path d=\"M8 4l-4 0l0 4\" />\n  <path d=\"M4 4l6 6\" />",
  "x": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M18 6l-12 12\" />\n  <path d=\"M6 6l12 12\" />",
  "photo-scan": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M15 8h.01\" />\n  <path d=\"M6 13l2.644 -2.644a1.21 1.21 0 0 1 1.712 0l3.644 3.644\" />\n  <path d=\"M13 13l1.644 -1.644a1.21 1.21 0 0 1 1.712 0l1.644 1.644\" />\n  <path d=\"M4 8v-2a2 2 0 0 1 2 -2h2\" />\n  <path d=\"M4 16v2a2 2 0 0 0 2 2h2\" />\n  <path d=\"M16 4h2a2 2 0 0 1 2 2v2\" />\n  <path d=\"M16 20h2a2 2 0 0 0 2 -2v-2\" />",
  "arrow-up": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M12 5l0 14\" />\n  <path d=\"M18 11l-6 -6\" />\n  <path d=\"M6 11l6 -6\" />",
  "arrow-down": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M12 5l0 14\" />\n  <path d=\"M18 13l-6 6\" />\n  <path d=\"M6 13l6 6\" />",
  "sparkles": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6z\" />",
  "copy": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M7 7m0 2.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667z\" />\n  <path d=\"M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1\" />",
  "check": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M5 12l5 5l10 -10\" />",
  "plus": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M12 5l0 14\" />\n  <path d=\"M5 12l14 0\" />",
  "refresh": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4\" />\n  <path d=\"M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4\" />",
  "list-tree": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M9 6h11\" />\n  <path d=\"M12 12h8\" />\n  <path d=\"M15 18h5\" />\n  <path d=\"M5 6v.01\" />\n  <path d=\"M8 12v.01\" />\n  <path d=\"M11 18v.01\" />",
  "arrow-back-up": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M9 14l-4 -4l4 -4\" />\n  <path d=\"M5 10h11a4 4 0 1 1 0 8h-1\" />",
  "arrow-forward-up": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M15 14l4 -4l-4 -4\" />\n  <path d=\"M19 10h-11a4 4 0 1 0 0 8h1\" />",
  "search": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0\" />\n  <path d=\"M21 21l-6 -6\" />",
  "layout-sidebar-right": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z\" />\n  <path d=\"M15 4l0 16\" />",
  "code": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M7 8l-4 4l4 4\" />\n  <path d=\"M17 8l4 4l-4 4\" />\n  <path d=\"M14 4l-4 16\" />",
  "separator": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M3 12l0 .01\" />\n  <path d=\"M7 12l10 0\" />\n  <path d=\"M21 12l0 .01\" />",
  "table": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14z\" />\n  <path d=\"M3 10h18\" />\n  <path d=\"M10 3v18\" />",
  "edit": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M7 7h-1a2 2 0 0 0 -2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2 -2v-1\" />\n  <path d=\"M20.385 6.585a2.1 2.1 0 0 0 -2.97 -2.97l-8.415 8.385v3h3l8.385 -8.415z\" />\n  <path d=\"M16 5l3 3\" />",
  "eye": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0\" />\n  <path d=\"M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6\" />",
  "tool": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M7 10h3v-3l-3.5 -3.5a6 6 0 0 1 8 8l6 6a2 2 0 0 1 -3 3l-6 -6a6 6 0 0 1 -8 -8l3.5 3.5\" />",
  "trash": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M4 7l16 0\" />\n  <path d=\"M10 11l0 6\" />\n  <path d=\"M14 11l0 6\" />\n  <path d=\"M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12\" />\n  <path d=\"M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3\" />"
};
function renderAppIcons(){
  const actionIcons={new:'file-plus',open:'folder-open',savejson:'device-floppy',saveas:'file-export',settings:'settings',find:'search',toggleReview:'layout-sidebar-right',source:'code',pagebreak:'separator',zoomIn:'zoom-in',zoomOut:'zoom-out',zoomReset:'arrows-maximize'};
  document.querySelectorAll('[data-action], [data-export], [data-cmd]').forEach(el=>{
    if(!el.dataset.icon)el.dataset.icon=actionIcons[el.dataset.action]||(el.dataset.export?'download':({undo:'arrow-back-up',redo:'arrow-forward-up',selectAll:'file-text'})[el.dataset.cmd])||'file-text';
  });
  document.querySelectorAll('[data-icon]').forEach(el=>{
    if(el.querySelector('.app-svg'))return;
    const body=APP_ICONS[el.dataset.icon];if(!body)return;
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    const attrs={viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false',class:'app-svg'};
    Object.entries(attrs).forEach(([k,v])=>svg.setAttribute(k,v));svg.innerHTML=body;el.prepend(svg);
  });
}
renderAppIcons();
const BUILD = '20260912-kiwi-1';
window.__5GOLGYEO_BUILD = BUILD;
console.info(`[5golgyeo_word] build ${BUILD}`);

function toast(message){
  const el = $('#toast');
  if(!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(()=>el.classList.remove('show'), 2400);
}
function setStatus(message){ if($('#status')) $('#status').textContent = message; }
function downloadBlob(blob, name){
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),2500);
}
function safeName(s){ return String(s||'문서').replace(/[\\/:*?"<>|]/g,'_').trim() || '문서'; }
function baseName(){ return safeName(documents[activeDocId]?.title || '문서'); }
function xmlEsc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
function htmlToPlainText(html){
  const d=new DOMParser().parseFromString(html||'', 'text/html');
  return (d.body.innerText||d.body.textContent||'').replace(/\u00a0/g,' ');
}
function plainText(){ return htmlToPlainText(wordEditor?.getData?.() || ''); }
function updateCount(){
  const t=plainText();
  const w=t.trim()?t.trim().split(/\s+/).length:0;
  if($('#count')) $('#count').textContent=`${t.length.toLocaleString()}자 · ${w.toLocaleString()}단어`;
}

/* --------------------------------------------------------------------------
   CKEditor loader
   -------------------------------------------------------------------------- */
async function loadCKEditorModule(){
  // The GPL configuration requires the self-hosted distribution, not Cloud CDN.
  return import('./vendor/ckeditor5/ckeditor5.js?v=48.4.0');
}

setStatus('편집기 불러오는 중…');
let CK;
try{
  CK=await loadCKEditorModule();
}catch(error){
  console.error(error);
  setStatus('CKEditor 로드 실패');
  alert('CKEditor 5를 불러오지 못했습니다.\n\nvendor/ckeditor5 설치 여부 또는 인터넷 연결을 확인해 주세요.');
  throw error;
}

const {
  ClassicEditor, Essentials, Paragraph, Heading,
  Bold, Italic, Underline, Strikethrough,
  FontFamily, FontSize, FontColor, FontBackgroundColor,
  Alignment, Indent, IndentBlock,
  List, TodoList,
  Table, TableToolbar, TableProperties, TableCellProperties, TableColumnResize,
  Image, ImageToolbar, ImageCaption, ImageStyle, ImageResize, ImageInsert, ImageBlock,
  Link, AutoLink, LinkImage,
  BlockQuote, PageBreak, RemoveFormat,
  SpecialCharacters, SpecialCharactersEssentials,
  PasteFromOffice, WordCount, SourceEditing, FindAndReplace, GeneralHtmlSupport,
  Autosave, Plugin, Command, ButtonView, Base64UploadAdapter
} = CK;

/* Semantic defaults live here. Inline CKEditor formatting takes precedence.
   Custom style editing is reserved for phase 2; content stores model semantics. */
const PARAGRAPH_STYLES={
  paragraph:{label:'일반 텍스트',selector:'p',css:{fontFamily:'"Malgun Gothic",sans-serif',fontSize:'11pt',fontWeight:'400',lineHeight:'1.15',marginTop:'0pt',marginBottom:'6pt'}},
  documentTitle:{label:'문서 제목',selector:'p.document-title',className:'document-title',css:{fontSize:'28pt',fontWeight:'700',lineHeight:'1.2',marginTop:'18pt',marginBottom:'12pt'}},
  subtitle:{label:'부제목',selector:'p.document-subtitle',className:'document-subtitle',css:{fontSize:'16pt',fontWeight:'400',lineHeight:'1.3',marginBottom:'12pt'}},
  heading1:{label:'제목 1',selector:'h1',css:{fontSize:'22pt',fontWeight:'700',lineHeight:'1.25',marginTop:'18pt',marginBottom:'10pt'}},
  heading2:{label:'제목 2',selector:'h2',css:{fontSize:'18pt',fontWeight:'700',lineHeight:'1.25',marginTop:'16pt',marginBottom:'8pt'}},
  heading3:{label:'제목 3',selector:'h3',css:{fontSize:'16pt',fontWeight:'700',lineHeight:'1.25',marginTop:'14pt',marginBottom:'6pt'}},
  heading4:{label:'제목 4',selector:'h4',css:{fontSize:'14pt',fontWeight:'700',lineHeight:'1.3',marginTop:'12pt',marginBottom:'6pt'}},
  heading5:{label:'제목 5',selector:'h5',css:{fontSize:'12pt',fontWeight:'700',lineHeight:'1.3',marginTop:'10pt',marginBottom:'6pt'}},
  heading6:{label:'제목 6',selector:'h6',css:{fontSize:'11pt',fontWeight:'700',lineHeight:'1.3',marginTop:'8pt',marginBottom:'6pt'}},
  quoteParagraph:{label:'인용',selector:'p.quote',className:'quote',css:{fontStyle:'italic',marginLeft:'18pt'}},
  blockQuote:{label:'블록 인용',selector:'blockquote',css:{marginLeft:'18pt',borderLeft:'3px solid #aaa',paddingLeft:'12pt'}},
  caption:{label:'캡션',selector:'p.caption',className:'caption',css:{fontSize:'9pt',color:'#666666',marginBottom:'4pt'}},
  codeParagraph:{label:'코드',selector:'p.code-paragraph',className:'code-paragraph',css:{fontFamily:'Consolas,monospace',fontSize:'10pt',whiteSpace:'pre-wrap',backgroundColor:'#f4f4f4'}}
};
function paragraphStyleOptions(){
  return Object.entries(PARAGRAPH_STYLES).filter(([name])=>name!=='blockQuote').map(([model,s])=>({
    model,title:s.label,class:'ck-heading_'+model,
    ...(model==='paragraph'?{}:{view:s.className?{name:'p',classes:s.className}:s.selector,converterPriority:'high'})
  }));
}
function blockStyleName(block){
  return block?.parent?.name==='blockQuote'?'blockQuote':PARAGRAPH_STYLES[block?.name]?block.name:'paragraph';
}
class ParagraphStyleCommand extends Command{
  refresh(){
    const blocks=[...this.editor.model.document.selection.getSelectedBlocks()];
    const names=new Set(blocks.map(blockStyleName));
    this.value=names.size===1?[...names][0]:'mixed';
    this.isEnabled=blocks.length>0&&this.editor.commands.get('heading').isEnabled;
  }
  execute({value}){
    if(!PARAGRAPH_STYLES[value])return;
    const editor=this.editor;
    editor.model.change(()=>{
      if(value==='blockQuote')editor.execute('blockQuote',{forceValue:true});
      else{
        if(editor.commands.get('blockQuote').isEnabled)editor.execute('blockQuote',{forceValue:false});
        editor.execute('heading',{value});
      }
    });
  }
}
class ParagraphStyles extends Plugin{
  static get requires(){return [Heading,BlockQuote];}
  init(){
    const editor=this.editor,command=new ParagraphStyleCommand(editor);
    editor.commands.add('paragraphStyle',command);
    editor.ui.componentFactory.add('paragraphStyle',locale=>{
      const dropdown=CK.createDropdown(locale),items=new CK.Collection();
      for(const [value,style] of Object.entries(PARAGRAPH_STYLES)){
        const model=new CK.ViewModel({label:style.label,withText:true,value});
        model.bind('isOn').to(command,'value',current=>current===value);
        items.add({type:'button',model});
      }
      CK.addListToDropdown(dropdown,items);
      dropdown.buttonView.set({withText:true,tooltip:'문단 스타일'});
      dropdown.buttonView.bind('label').to(command,'value',value=>PARAGRAPH_STYLES[value]?.label||'혼합');
      dropdown.bind('isEnabled').to(command,'isEnabled');
      dropdown.on('execute',event=>{editor.execute('paragraphStyle',{value:event.source.value});editor.editing.view.focus();});
      return dropdown;
    });
  }
}
function semanticStyleCss(prefix='.ck-content '){
  return Object.values(PARAGRAPH_STYLES).map(s=>{
    const css={...PARAGRAPH_STYLES.paragraph.css,...s.css};
    return `${prefix}${s.selector}{${Object.entries(css).map(([k,v])=>k.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())+':'+v).join(';')}}`;
  }).join('\n');
}
function installSemanticStyles(){
  const style=document.createElement('style');style.dataset.paragraphStyles='true';
  style.textContent=semanticStyleCss('.ck-content.ck-editor__editable ');document.head.append(style);
}
// Flatten defaults only for export. Stored editor HTML retains separate semantics
// and direct formatting, so defaults cannot turn into permanent inline overrides.
function styledExportHtml(){
  const dom=new DOMParser().parseFromString(currentHtml(),'text/html');
  for(const el of dom.body.querySelectorAll('p,h1,h2,h3,h4,h5,h6,blockquote')){
    const definition=Object.values(PARAGRAPH_STYLES).findLast(s=>el.matches(s.selector));
    const defaults={...PARAGRAPH_STYLES.paragraph.css,...definition?.css};
    for(const [key,value] of Object.entries(defaults))if(!el.style[key])el.style[key]=value;
  }
  return dom.body.innerHTML;
}

class BlockSpacingCommand extends Command {
  refresh(){
    const firstBlock=this.editor.model.document.selection.getFirstPosition()?.parent;
    this.value=firstBlock ? {
      lineHeight:firstBlock.getAttribute('lineHeight') || null,
      spaceBefore:firstBlock.getAttribute('spaceBefore') || null,
      spaceAfter:firstBlock.getAttribute('spaceAfter') || null,
      firstLineIndent:firstBlock.getAttribute('firstLineIndent')||null,
      rightIndent:firstBlock.getAttribute('rightIndent')||null,
      leftIndent:firstBlock.getAttribute('blockIndent')||null
    } : {};
    this.isEnabled=!!firstBlock;
  }
  execute(options={}){
    const model=this.editor.model;
    const selection=model.document.selection;
    model.change(writer=>{
      const blocks=[...selection.getSelectedBlocks()];
      if(!blocks.length){
        const p=selection.getFirstPosition()?.parent;
        if(p) blocks.push(p);
      }
      for(const block of blocks){
        if(!model.schema.isBlock(block))continue;
        for(const [option,key] of [['firstLineIndent','firstLineIndent'],['rightIndent','rightIndent'],['leftIndent','blockIndent']]){
          if(options[option]!==undefined&&model.schema.checkAttribute(block,key)){
            if(options[option]===null||options[option]==='')writer.removeAttribute(key,block);
            else writer.setAttribute(key,String(options[option]),block);
          }
        }
        if(options.lineHeight!==undefined){
          options.lineHeight===null || options.lineHeight==='' ? writer.removeAttribute('lineHeight',block) : writer.setAttribute('lineHeight',String(options.lineHeight),block);
        }
        if(options.spaceBefore!==undefined){
          options.spaceBefore===null || options.spaceBefore==='' ? writer.removeAttribute('spaceBefore',block) : writer.setAttribute('spaceBefore',String(options.spaceBefore),block);
        }
        if(options.spaceAfter!==undefined){
          options.spaceAfter===null || options.spaceAfter==='' ? writer.removeAttribute('spaceAfter',block) : writer.setAttribute('spaceAfter',String(options.spaceAfter),block);
        }
      }
    });
  }
}

class BlockSpacing extends Plugin {
  init(){
    const editor=this.editor;
    editor.model.schema.extend('$block',{allowAttributes:['lineHeight','spaceBefore','spaceAfter','firstLineIndent','rightIndent']});

    const downcastStyle=(modelKey,cssKey)=>{
      editor.conversion.for('downcast').attributeToAttribute({
        model:modelKey,
        view:value=>({key:'style',value:{[cssKey]:String(value)}})
      });
      // Read exported CSS back into the command's model attributes. Two downcast
      // converters for the same attribute cannot both consume the same event.
      editor.conversion.for('upcast').add(dispatcher=>{
        dispatcher.on('element',(event,data,api)=>{
          const value=data.viewItem.getStyle(cssKey);
          if(!value||!data.modelRange)return;
          for(const item of data.modelRange.getItems({shallow:true})){
            if(api.schema.checkAttribute(item,modelKey))api.writer.setAttribute(modelKey,value,item);
          }
        },{priority:'low'});
      });
    };
    downcastStyle('lineHeight','line-height');
    downcastStyle('spaceBefore','margin-top');
    downcastStyle('spaceAfter','margin-bottom');
    downcastStyle('firstLineIndent','text-indent');
    downcastStyle('rightIndent','margin-right');

    /* Round-trip markers: keep paragraph spacing as real CKEditor model attributes
       even after save -> setData(), while the CSS styles remain exporter-friendly. */
    const roundTrip=(modelKey,dataKey)=>{
      editor.conversion.for('downcast').attributeToAttribute({model:modelKey,view:dataKey});
      editor.conversion.for('upcast').attributeToAttribute({view:dataKey,model:modelKey});
    };
    roundTrip('lineHeight','data-line-height');
    roundTrip('spaceBefore','data-space-before');
    roundTrip('spaceAfter','data-space-after');
    roundTrip('firstLineIndent','data-first-line-indent');
    roundTrip('rightIndent','data-right-indent');

    editor.commands.add('blockSpacing',new BlockSpacingCommand(editor));
    editor.ui.componentFactory.add('blockSpacing',locale=>{
      const button=new ButtonView(locale);
      button.set({label:'줄·문단 간격',withText:true,tooltip:true});
      button.bind('isEnabled').to(editor.commands.get('blockSpacing'),'isEnabled');
      button.on('execute',()=>openSpacingDialog());
      return button;
    });
  }
}


let activeDocId='blank';
let documents={
  blank:{id:'blank',title:'빈 종이',html:'<p></p>',parentId:null}
};
let wordEditor=null;
let autosaveTimer=null;
let zoom=1;
let loadingDocument=false;

const fontOptions=[
  ['맑은 고딕','Malgun Gothic, 맑은 고딕, sans-serif'],
  ['Noto Sans KR','Noto Sans KR, Malgun Gothic, sans-serif'],
  ['리디바탕','Ridibatang, Batang, serif'],
  ['본명조 / Source Han Serif','BonmyeongjoSourceHanSerif, Noto Serif KR, Batang, serif'],
  ['Arial','Arial, sans-serif'],['Georgia','Georgia, serif'],
  ['Times New Roman','Times New Roman, serif'],['바탕','Batang, 바탕, serif'],['굴림','Gulim, 굴림, sans-serif']
].map(([title,model])=>({title,model,view:{name:'span',styles:{'font-family':model}}}));
const sizeOptions=[9,10,11,12,14,16,18,24,30].map(pt=>({title:String(pt),model:`${pt}pt`,view:{name:'span',styles:{'font-size':`${pt}pt`}}}));

async function createEditor(){
  /* The editor must still start if a host omitted the optional Korean
     translation file while uploading an update. */
  let ko=null;
  try{
    ({default:ko}=await import('./vendor/ckeditor5/ko.js?v=48.4.0'));
  }catch(error){
    console.warn('[5golgyeo_word] Korean CKEditor translation unavailable; using the built-in UI language.',error);
    setStatus('한국어 편집기 번역 파일을 찾지 못해 기본 메뉴로 시작합니다.');
  }
  wordEditor=await ClassicEditor.create($('#editor'),{
    licenseKey:'GPL',
    language:ko?'ko':'en',
    ...(ko?{translations:[ko]}:{}),
    plugins:[
      Essentials, Paragraph, Heading,
      Bold, Italic, Underline, Strikethrough,
      FontFamily, FontSize, FontColor, FontBackgroundColor,
      Alignment, Indent, IndentBlock,
      List, TodoList,
      Table, TableToolbar, TableProperties, TableCellProperties, TableColumnResize,
      Image, ImageBlock, ImageToolbar, ImageCaption, ImageStyle, ImageResize, ImageInsert,
      Link, AutoLink, LinkImage,
      BlockQuote, PageBreak, RemoveFormat,
      SpecialCharacters, SpecialCharactersEssentials,
      PasteFromOffice, WordCount, SourceEditing, FindAndReplace, GeneralHtmlSupport,
      Autosave, BlockSpacing, ParagraphStyles, Base64UploadAdapter
    ],
    toolbar:{items:['undo','redo','|','paragraphStyle','fontFamily','fontSize','|','bold','italic','underline','strikethrough','fontColor','fontBackgroundColor','|','alignment','bulletedList','numberedList','outdent','indent','blockSpacing','|','insertTable','insertImage','link','removeFormat'],shouldNotGroupWhenFull:false},
    heading:{options:paragraphStyleOptions()},
    fontFamily:{options:fontOptions,supportAllValues:true},
    fontSize:{options:sizeOptions},
    image:{
      toolbar:['imageTextAlternative','toggleImageCaption','imageStyle:inline','imageStyle:alignLeft','imageStyle:alignCenter','imageStyle:alignRight','resizeImage'],
      resizeOptions:[
        {name:'resizeImage:original',value:null,label:'원본'},
        {name:'resizeImage:25',value:'25',label:'25%'},
        {name:'resizeImage:50',value:'50',label:'50%'},
        {name:'resizeImage:75',value:'75',label:'75%'}
      ]
    },
    table:{contentToolbar:['tableColumn','tableRow','mergeTableCells','tableProperties','tableCellProperties']},
    htmlSupport:{allow:[{name:/.*/,attributes:true,classes:true,styles:true}]},
    autosave:{waitingTime:800,save:async()=>saveAuto()}
  });

  window.__5golgyeoWordEditor=wordEditor;
  $('#ckeditorToolbar').appendChild(wordEditor.ui.view.toolbar.element);
  wordEditor.ui.focusTracker.add($('#ckeditorToolbar')); 
  const editable=wordEditor.ui.getEditableElement();
  installSemanticStyles();
  editable.lang='ko';
  editable.spellcheck=true;
  editable.dataset.editorEngine='ckeditor5';
  wordEditor.on('change:isReadOnly',()=>{
    if(wordEditor.isReadOnly)setStatus('편집기가 읽기 전용 상태입니다.');
  });
  if(wordEditor.isReadOnly || editable.getAttribute('contenteditable')!=='true'){
    throw new Error('CKEditor editable initialization failed: read-only root');
  }

  wordEditor.model.document.on('change:data',()=>{
    if(loadingDocument)return;
    saveActiveDocState();
    updateCount();
    scheduleOutline();
    if(reviewModeActive && reviewRangeSnapshot) resetReviewSelection();
  });

  restoreAuto();
  bindEditorToolbar();
  bindAppUi();
  installPdfImageBridge();
  updateCount();
  updateOutline();
  setZoom(1);
  setStatus('준비 · CKEditor 5');
}

function currentHtml(){ return wordEditor?.getData?.() || ''; }
function saveActiveDocState(){
  if(!wordEditor || loadingDocument)return;
  if(documents[activeDocId]) documents[activeDocId].html=currentHtml();
}
function saveAuto(){
  if(!wordEditor)return Promise.resolve();
  saveActiveDocState();
  localStorage.setItem('5golgyeo_word.autosave.v2',JSON.stringify({version:2,documents,activeDocId,time:Date.now()}));
  setStatus('자동 저장됨');
  return Promise.resolve();
}
function removeLegacyPdfPlaceholder(){
  const legacy=documents.pdf;
  if(!legacy||legacy.title!=='PDF 파일')return;
  const dom=new DOMParser().parseFromString(legacy.html||'','text/html');
  const hasContent=dom.body.textContent.trim()||dom.querySelector('img,table,hr,video,audio,iframe')||Object.values(documents).some(d=>d.parentId==='pdf');
  if(hasContent){legacy.title='이전 문서';return;}
  delete documents.pdf;
  if(activeDocId==='pdf')activeDocId=Object.keys(documents)[0];
}
function restoreAuto(){
  let data=null;
  try{data=JSON.parse(localStorage.getItem('5golgyeo_word.autosave.v2')||'null');}catch{}
  if(!data){
    try{
      const legacy=JSON.parse(localStorage.getItem('pdfEditor.autosave')||'null');
      if(legacy?.documents) data={version:1,documents:legacy.documents,activeDocId:legacy.activeDocId};
    }catch{}
  }
  if(data?.documents){
    documents={...documents,...data.documents};
    activeDocId=documents[data.activeDocId]?data.activeDocId:'blank';
  }
  removeLegacyPdfPlaceholder();
  renderTabs();
  loadDocState(activeDocId,{saveCurrent:false});
}
function loadDocState(id,{saveCurrent=true}={}){
  if(!documents[id] || !wordEditor)return;
  if(saveCurrent) saveActiveDocState();
  activeDocId=id;
  loadingDocument=true;
  wordEditor.setData(documents[id].html||'<p></p>');
  loadingDocument=false;
  renderPageSettings();
  updateOutline();
  renderTabs();
  updateCount();
  resetReviewSelection({keepStatus:true});
  setStatus(`${documents[id].title} 편집 중`);
}
function setActiveDocTitle(title){
  if(!documents[activeDocId])return;
  documents[activeDocId].title=String(title||'문서').trim()||'문서';
  renderTabs();
  saveAuto();
}

function renderTabs(){
  const strip=$('#docTabStrip');
  if(!strip)return;
  strip.replaceChildren();
  const roots=Object.values(documents).filter(d=>!d.parentId);
  for(const doc of roots){
    const b=document.createElement('button');
    b.className='doc-tab'+(doc.id===activeDocId?' active':'');
    b.dataset.doc=doc.id;
    b.innerHTML=`<span>${xmlEsc(doc.title)}</span>`;
    b.onclick=()=>loadDocState(doc.id);
    b.oncontextmenu=e=>{e.preventDefault();openTabPopover(doc.id,e.clientX,e.clientY);};
    strip.appendChild(b);
  }
  renderOutlineTabs();
}
function newTab(parentId=null){
  const id='doc_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,6);
  documents[id]={id,title:parentId?'새 하위 탭':'새 탭',html:'<p></p>',parentId};
  renderTabs();
  loadDocState(id);
  openTabNameModal(id,parentId?'하위 탭 이름':'탭 이름');
}
let tabNameTargetId=null;
function openTabNameModal(id,title='탭 이름'){
  tabNameTargetId=id;
  $('#tabNameModalTitle').textContent=title;
  $('#tabNameInput').value=documents[id]?.title||'';
  $('#tabNameModal').classList.add('show');
  setTimeout(()=>$('#tabNameInput').select(),30);
}
function closeTabNameModal(){ $('#tabNameModal').classList.remove('show');tabNameTargetId=null; }
function openTabPopover(id,x,y){
  const p=$('#tabPopover');
  p.dataset.doc=id;
  p.style.left=x+'px';p.style.top=y+'px';p.classList.add('show');
}

let outlineTimer=null,outlineSignature='',activeHeadingEntries=[];
const outlineCache=new Map(),collapsedOutlineTabs=new Set();
function collectModelHeadings(root){
  const entries=[];
  const visit=node=>{
    if(/^heading[1-6]$/.test(node.name||'')){
      const textOf=n=>n.is?.('$text')||n.is?.('$textProxy')?n.data:[...(n.getChildren?.()||[])].map(textOf).join('');
      entries.push({level:Number(node.name.slice(-1)),text:textOf(node)||'(빈 제목)',path:[...node.getPath()]});
    }
    for(const child of node.getChildren?.()||[])if(child.is?.('element'))visit(child);
  };
  visit(root);return entries;
}
function headingsForTab(doc){
  if(doc.id===activeDocId)return activeHeadingEntries;
  const cached=outlineCache.get(doc.id);if(cached?.html===doc.html)return cached.entries;
  const fragment=wordEditor.data.toModel(wordEditor.data.processor.toView(doc.html||'<p></p>'));
  const entries=collectModelHeadings(fragment);outlineCache.set(doc.id,{html:doc.html,entries});return entries;
}
function appendHeadingTree(box,entries,docId,baseDepth=0){
  const stack=[];
  for(const entry of entries){
    while(stack.length&&stack.at(-1)>=entry.level)stack.pop();
    const button=document.createElement('button');button.className='outline-heading';
    button.textContent=entry.text;button.dataset.headingPath=JSON.stringify(entry.path);button.dataset.doc=docId;
    button.style.paddingLeft=(12+(baseDepth+stack.length)*14)+'px';
    button.setAttribute('aria-label',`${PARAGRAPH_STYLES['heading'+entry.level].label}: ${entry.text}`);
    button.onclick=()=>navigateHeading(docId,entry.path);box.append(button);stack.push(entry.level);
  }
}
function navigateHeading(docId,path){
  if(activeDocId!==docId)loadDocState(docId);
  const model=wordEditor.model,root=model.document.getRoot();
  let heading=root;
  try{for(const offset of path)heading=heading.getChild(heading.offsetToIndex(offset));}catch{return;}
  if(!/^heading[1-6]$/.test(heading?.name||''))return;
  wordEditor.editing.view.focus();
  model.change(writer=>writer.setSelection(heading,0));
  wordEditor.editing.view.forceRender();
  const view=wordEditor.editing.mapper.toViewElement(heading);
  const dom=view&&wordEditor.editing.view.domConverter.mapViewToDom(view);
  dom?.scrollIntoView({block:'center',behavior:'auto'});
}
function scheduleOutline(){clearTimeout(outlineTimer);outlineTimer=setTimeout(updateOutline,180);}
function updateOutline(){
  clearTimeout(outlineTimer);
  if(!wordEditor)return;
  activeHeadingEntries=collectModelHeadings(wordEditor.model.document.getRoot());
  outlineCache.set(activeDocId,{html:documents[activeDocId]?.html,entries:activeHeadingEntries});
  const signature=JSON.stringify([activeDocId,activeHeadingEntries]);
  if(signature===outlineSignature)return;
  outlineSignature=signature;
  const box=$('#outlineHeadings');box.replaceChildren();
  if(activeHeadingEntries.length)appendHeadingTree(box,activeHeadingEntries,activeDocId);
  else{const empty=document.createElement('div');empty.className='outline-empty';empty.textContent='제목 스타일을 적용한 문장이 여기에 표시됩니다.';box.append(empty);}
  renderOutlineTabs();
}
function renderOutlineTabs(){
  const box=$('#outlineTabs');if(!box||!wordEditor)return;box.replaceChildren();
  const visited=new Set();
  const make=(doc,depth=0)=>{
    if(visited.has(doc.id))return;visited.add(doc.id);
    const row=document.createElement('div');row.className='outline-tab-row';
    row.style.paddingLeft=(depth*14)+'px';
    const toggle=document.createElement('button'),button=document.createElement('button');
    const expanded=!collapsedOutlineTabs.has(doc.id);
    toggle.className='outline-tab-toggle';toggle.textContent=expanded?'▾':'▸';toggle.setAttribute('aria-expanded',String(expanded));toggle.setAttribute('aria-label',doc.title+' 목차 펼치기/접기');
    toggle.onclick=()=>{expanded?collapsedOutlineTabs.add(doc.id):collapsedOutlineTabs.delete(doc.id);renderOutlineTabs();};
    button.className='outline-tab-item'+(doc.id===activeDocId?' active':'');button.textContent=doc.title;button.dataset.doc=doc.id;
    button.onclick=()=>{collapsedOutlineTabs.delete(doc.id);if(activeDocId!==doc.id)loadDocState(doc.id);else renderOutlineTabs();};
    button.oncontextmenu=e=>{e.preventDefault();openTabPopover(doc.id,e.clientX,e.clientY);};
    row.append(toggle,button);box.append(row);
    if(expanded)appendHeadingTree(box,headingsForTab(doc),doc.id,depth+1);
    Object.values(documents).filter(d=>d.parentId===doc.id).forEach(child=>make(child,depth+1));
  };
  Object.values(documents).filter(d=>!d.parentId||!documents[d.parentId]).forEach(d=>make(d));
  Object.values(documents).filter(d=>!visited.has(d.id)).forEach(d=>make(d));
}


/* --------------------------------------------------------------------------
   Toolbar -> CKEditor commands
   -------------------------------------------------------------------------- */
const commandMap={
  undo:['undo'],redo:['redo'],bold:['bold'],italic:['italic'],underline:['underline'],strikeThrough:['strikethrough'],
  insertUnorderedList:['bulletedList'],insertOrderedList:['numberedList'],outdent:['outdent'],indent:['indent']
};
function exec(name,...args){
  if(!wordEditor)return;
  try{wordEditor.execute(name,...args);wordEditor.editing.view.focus();}catch(e){console.warn(`[CKEditor command ${name}]`,e);toast('이 서식은 현재 위치에서 사용할 수 없습니다.');}
}
function bindEditorToolbar(){
  $$('[data-cmd]').forEach(btn=>{
    btn.onclick=()=>{
      const legacy=btn.dataset.cmd;
      if(legacy==='selectAll'){
        const root=wordEditor.model.document.getRoot();
        wordEditor.model.change(writer=>writer.setSelection(writer.createRangeIn(root)));
        wordEditor.editing.view.focus();return;
      }
      if(legacy==='justifyLeft') return exec('alignment',{value:'left'});
      if(legacy==='justifyCenter') return exec('alignment',{value:'center'});
      if(legacy==='justifyRight') return exec('alignment',{value:'right'});
      if(legacy==='justifyFull') return exec('alignment',{value:'justify'});
      const mapped=commandMap[legacy]?.[0];
      if(mapped) exec(mapped);
    };
  });
  $('#insertTableMenuBtn').onclick=()=>{
    const button=wordEditor.ui.view.toolbar.element.querySelector('.ck-insert-table-dropdown button');
    if(button)button.click();else exec('insertTable',{rows:2,columns:2});
  };
  bindSpacingUi();
}
let spacingReturnFocus=null;
function openSpacingDialog(){
  const value=wordEditor.commands.get('blockSpacing').value||{};
  spacingReturnFocus=document.activeElement;
  $('#customLineHeight').value=parseFloat(value.lineHeight)||parseFloat(PARAGRAPH_STYLES[blockStyleName(wordEditor.model.document.selection.getFirstPosition()?.parent)]?.css.lineHeight)||1.15;
  $('#customSpaceBefore').value=parseFloat(value.spaceBefore)||0;
  $('#customSpaceAfter').value=parseFloat(value.spaceAfter)||0;
  for(const key of ['FirstLine','Left','Right'])document.getElementById(`custom${key}Indent`).value=cssNumber(value[key==='FirstLine'?'firstLineIndent':key.toLowerCase()+'Indent'])||0;
  $('#spacingPreset').value=['1','1.15','1.5','2'].includes(String(value.lineHeight))?String(value.lineHeight):'';
  $('#lineSpacingModal').classList.add('show');$('#lineSpacingModal').classList.remove('hidden');
  $('#customLineHeight').focus();
}
function bindSpacingUi(){
  const modal=$('#lineSpacingModal');
  const close=()=>{modal.classList.remove('show');modal.classList.add('hidden');spacingReturnFocus?.focus();};
  $('#closeLineSpacingModal').onclick=close;
  $('#spacingPreset').onchange=e=>{if(e.target.value)$('#customLineHeight').value=e.target.value;};
  $('#customLineHeight').oninput=()=>{$('#spacingPreset').value='';};
  modal.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();close();}
    if(e.key==='Tab'){
      const focusables=[...modal.querySelectorAll('button,input,select')];
      const first=focusables[0],last=focusables.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
  });
  $('#applyLineSpacingCustom').onclick=()=>{
    const lh=Math.max(.5,Math.min(5,parseFloat($('#customLineHeight').value)||1.15));
    const before=Math.max(0,Math.min(200,parseFloat($('#customSpaceBefore').value)||0));
    const after=Math.max(0,Math.min(200,parseFloat($('#customSpaceAfter').value)||0));
    const indents={};for(const key of ['FirstLine','Left','Right'])indents[key==='FirstLine'?'firstLineIndent':key.toLowerCase()+'Indent']=Math.max(-200,Math.min(200,parseFloat(document.getElementById(`custom${key}Indent`).value)||0))+'pt';
    close();exec('blockSpacing',{lineHeight:String(lh),spaceBefore:before+'pt',spaceAfter:after+'pt',...indents});
  };
}

/* --------------------------------------------------------------------------
   Project save / open and exporters
   -------------------------------------------------------------------------- */
function projectObject(){
  saveActiveDocState();
  for(const doc of Object.values(documents))doc.pageSettings=normalizePageSettings(doc.pageSettings);
  return {format:'5golgyeo-word-project',version:2,engine:'ckeditor5',createdWith:BUILD,activeDocId,documents,savedAt:new Date().toISOString()};
}
function saveProject(name=baseName()){
  const blob=new Blob([JSON.stringify(projectObject(),null,2)],{type:'application/json;charset=utf-8'});
  downloadBlob(blob,safeName(name)+'.5gw.json');
  setStatus('작업 파일 저장 완료');
}
function saveProjectAs(){
  const name=prompt('저장할 파일 이름',baseName());
  if(name===null)return;
  saveProject(name.replace(/\.5gw\.json$/i,''));
}
function htmlDocument(){
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${xmlEsc(baseName())}</title><style>body{font-family:"Malgun Gothic",sans-serif;max-width:210mm;margin:auto;padding:20mm}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px}</style></head><body data-5golgyeo-document>${styledExportHtml()}</body></html>`;
}
function textToMarkdown(){
  const dom=new DOMParser().parseFromString(currentHtml(),'text/html');
  const walk=node=>{
    if(node.nodeType===Node.TEXT_NODE)return node.nodeValue;
    if(node.nodeType!==Node.ELEMENT_NODE)return '';
    const inner=[...node.childNodes].map(walk).join('');
    switch(node.tagName){
      case 'H4':return `#### ${inner}\n\n`;case 'H5':return `##### ${inner}\n\n`;case 'H6':return `###### ${inner}\n\n`;case 'H1':return `# ${inner}\n\n`;case 'H2':return `## ${inner}\n\n`;case 'H3':return `### ${inner}\n\n`;
      case 'STRONG':case 'B':return `**${inner}**`;case 'EM':case 'I':return `*${inner}*`;
      case 'BR':return '\n';case 'P':return `${inner}\n\n`;case 'LI':return `- ${inner}\n`;case 'BLOCKQUOTE':return `> ${inner}\n\n`;
      default:return inner;
    }
  };
  return walk(dom.body).trimEnd();
}
async function importOptional(localUrl,cdnUrl){
  try{return await import(localUrl);}catch{return import(cdnUrl);}
}
async function exportHwpx(){
  setStatus('HWPX 변환 중…');
  const mod=await import('https://cdn.jsdelivr.net/npm/@ssabrojs/hwpxjs@0.4.0/dist/browser/hwpxjs.browser.mjs');
  if(typeof mod.htmlToHwpx!=='function')throw new Error('hwpxjs의 htmlToHwpx를 찾지 못했습니다.');
  const bytes=await mod.htmlToHwpx(styledExportHtml(),{title:baseName(),creator:'5golgyeo_word'});
  downloadBlob(new Blob([bytes],{type:'application/hwp+zip'}),baseName()+'.hwpx');
}
function cssNumber(styleValue){
  if(!styleValue)return null;
  const n=parseFloat(styleValue);if(!Number.isFinite(n))return null;
  if(String(styleValue).includes('px'))return n*.75;
  return n;
}
function dataUriBytes(src){
  const m=String(src||'').match(/^data:([^;,]+)?(?:;base64)?,(.*)$/s);if(!m)return null;
  if(src.includes(';base64,')){const bin=atob(m[2]);return Uint8Array.from(bin,c=>c.charCodeAt(0));}
  return new TextEncoder().encode(decodeURIComponent(m[2]));
}
function docxColor(value){
  if(!value)return undefined;
  const hex=String(value).match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if(hex)return hex[1].length===3?[...hex[1]].map(c=>c+c).join(''):hex[1];
  const rgb=String(value).match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  return rgb?rgb.slice(1,4).map(n=>Math.max(0,Math.min(255,Number(n))).toString(16).padStart(2,'0')).join(''):undefined;
}
async function exportDocx(){
  setStatus('DOCX 변환 중…');
  const D=await import('https://cdn.jsdelivr.net/npm/docx@9.7.1/+esm');
  const {Document,Packer,Paragraph,TextRun,Table:DocxTable,TableRow,TableCell,ImageRun,PageBreak,AlignmentType,UnderlineType,WidthType}=D;
  const dom=new DOMParser().parseFromString(styledExportHtml(),'text/html');

  const inheritedStyle=(el)=>{
    const style={};let p=el;
    while(p&&p!==dom.body){
      if(p.style){for(const k of ['fontFamily','fontSize','color','backgroundColor','fontWeight','fontStyle','textDecoration','lineHeight','marginTop','marginBottom','marginLeft','marginRight','textIndent','textAlign'])if(!style[k]&&p.style[k])style[k]=p.style[k];}
      p=p.parentElement;
    }
    return style;
  };
  const inlineRuns=node=>{
    const out=[];
    const walk=n=>{
      if(n.nodeType===Node.TEXT_NODE){
        if(!n.nodeValue)return;
        const st=inheritedStyle(n.parentElement);
        const sizePt=cssNumber(st.fontSize);
        out.push(new TextRun({text:n.nodeValue,bold:/bold|[6-9]00/.test(st.fontWeight||'')||!!n.parentElement.closest('strong,b'),italics:st.fontStyle==='italic'||!!n.parentElement.closest('em,i'),strike:!!n.parentElement.closest('s,strike'),underline:n.parentElement.closest('u')?{type:UnderlineType.SINGLE}:undefined,color:docxColor(st.color),shading:docxColor(st.backgroundColor)?{fill:docxColor(st.backgroundColor)}:undefined,font:(st.fontFamily||'Malgun Gothic').split(',')[0].replace(/["']/g,'').trim(),size:sizePt?Math.round(sizePt*2):22}));
        return;
      }
      if(n.nodeType!==Node.ELEMENT_NODE)return;
      if(n.tagName==='BR'){out.push(new TextRun({break:1}));return;}
      if(n.tagName==='IMG')return;
      [...n.childNodes].forEach(walk);
    };walk(node);return out;
  };
  const paragraphFrom=el=>{
    const st=inheritedStyle(el);
    const map={left:AlignmentType.LEFT,center:AlignmentType.CENTER,right:AlignmentType.RIGHT,justify:AlignmentType.JUSTIFIED};
    const lh=parseFloat(st.lineHeight);const before=cssNumber(st.marginTop);const after=cssNumber(st.marginBottom);
    const children=inlineRuns(el);
    if(!children.length)children.push(new TextRun(''));
    return new Paragraph({children,heading:/^H[1-6]$/.test(el.tagName)?D.HeadingLevel['HEADING_'+el.tagName[1]]:el.classList.contains('document-title')?D.HeadingLevel.TITLE:undefined,style:el.classList.contains('document-subtitle')?'Subtitle':undefined,alignment:map[st.textAlign]||undefined,spacing:{before:before?Math.round(before*20):undefined,after:after?Math.round(after*20):undefined,line:Number.isFinite(lh)?Math.round(lh*240):undefined,lineRule:Number.isFinite(lh)?'auto':undefined}});
  };
  const blocks=[];
  for(const el of [...dom.body.children]){
    if(/^H[1-6]$/.test(el.tagName)||['P','DIV','BLOCKQUOTE','PRE'].includes(el.tagName)) blocks.push(paragraphFrom(el));
    else if(el.tagName==='UL'||el.tagName==='OL'){
      [...el.querySelectorAll(':scope > li')].forEach(li=>blocks.push(new Paragraph({children:inlineRuns(li),bullet:el.tagName==='UL'?{level:0}:undefined,numbering:el.tagName==='OL'?{reference:'num',level:0}:undefined})));
    }else if(el.tagName==='TABLE'){
      const rows=[...el.rows].map(tr=>new TableRow({children:[...tr.cells].map(td=>new TableCell({children:[paragraphFrom(td)]}))}));
      blocks.push(new DocxTable({rows,width:{size:100,type:WidthType.PERCENTAGE}}));
    }else if(el.tagName==='FIGURE' && el.querySelector('img')){
      const img=el.querySelector('img');const bytes=dataUriBytes(img.src);
      if(bytes){const w=parseInt(img.getAttribute('width')||img.style.width)||480;const h=parseInt(img.getAttribute('height')||img.style.height)||320;blocks.push(new Paragraph({children:[new ImageRun({data:bytes,transformation:{width:Math.min(w,600),height:Math.min(h,800)}})]}));}
    }else if(el.classList.contains('page-break')) blocks.push(new Paragraph({children:[new PageBreak()]}));
  }
  if(!blocks.length)blocks.push(new Paragraph({children:[new TextRun(plainText())]}));
  const doc=new Document({numbering:{config:[{reference:'num',levels:[{level:0,format:'decimal',text:'%1.',alignment:AlignmentType.LEFT}]}]},sections:[{properties:{},children:blocks}]});
  const blob=await Packer.toBlob(doc);downloadBlob(blob,baseName()+'.docx');
}
async function exportOdt(){
  if(!window.JSZip)throw new Error('JSZip을 불러오지 못했습니다.');
  const z=new JSZip();const ps=plainText().split(/\n/);
  z.file('mimetype','application/vnd.oasis.opendocument.text',{compression:'STORE'});
  z.folder('META-INF').file('manifest.xml',`<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`);
  z.file('content.xml',`<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2"><office:body><office:text>${ps.map(p=>`<text:p>${xmlEsc(p)}</text:p>`).join('')}</office:text></office:body></office:document-content>`);
  downloadBlob(await z.generateAsync({type:'blob',mimeType:'application/vnd.oasis.opendocument.text'}),baseName()+'.odt');
  toast('ODT는 현재 호환 내보내기입니다. 서식 보존은 추후 강화합니다.');
}
function rtfEsc(s){return String(s).replace(/\\/g,'\\\\').replace(/[{}]/g,m=>'\\'+m).replace(/[^\x00-\x7F]/g,ch=>'\\u'+ch.charCodeAt(0)+'?').replace(/\n/g,'\\par\n');}
async function exportPdf(){
  const html=htmlDocument();
  const w=window.open('','_blank');if(!w)throw new Error('팝업이 차단되었습니다.');
  w.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${xmlEsc(baseName())}</title><style>@page{size:A4;margin:18mm}body{font-family:"Malgun Gothic",sans-serif}img{max-width:100%}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px}</style><script src="https://unpkg.com/pagedjs/dist/paged.polyfill.js"><\/script></head><body>${styledExportHtml()}<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),900));<\/script></body></html>`);
  w.document.close();
}
async function doExport(type){
  try{
    if(type==='txt')downloadBlob(new Blob([plainText()],{type:'text/plain;charset=utf-8'}),baseName()+'.txt');
    else if(type==='html')downloadBlob(new Blob([htmlDocument()],{type:'text/html;charset=utf-8'}),baseName()+'.html');
    else if(type==='md')downloadBlob(new Blob([textToMarkdown()],{type:'text/markdown;charset=utf-8'}),baseName()+'.md');
    else if(type==='json')saveProject();
    else if(type==='rtf')downloadBlob(new Blob([`{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Malgun Gothic;}}\\f0\\fs22 ${rtfEsc(plainText())}}`],{type:'application/rtf'}),baseName()+'.rtf');
    else if(type==='pdf')await exportPdf();
    else if(type==='docx')await exportDocx();
    else if(type==='odt')await exportOdt();
    else if(type==='hwpx')await exportHwpx();
    setStatus(`${type.toUpperCase()} 내보내기 완료`);
  }catch(e){console.error(e);setStatus('내보내기 실패');alert(`내보내기 실패\n\n${e.message}`);}
}

async function openFile(file){
  if(!file)return;
  const ext=file.name.split('.').pop().toLowerCase();
  try{
    let html='';
    if(ext==='json'){
      const data=JSON.parse(await file.text());
      if(data.format==='5golgyeo-word-project' && data.documents){documents=data.documents;activeDocId=data.activeDocId&&documents[data.activeDocId]?data.activeDocId:Object.keys(documents)[0];removeLegacyPdfPlaceholder();renderTabs();loadDocState(activeDocId,{saveCurrent:false});toast('작업 파일을 열었습니다.');return;}
      html=data.html||'<p></p>';
    }else if(ext==='html'||ext==='htm'){
      const d=new DOMParser().parseFromString(await file.text(),'text/html');html=d.querySelector('[data-5golgyeo-document],[data-pdf-editor-document]')?.innerHTML||d.body.innerHTML;
    }else if(ext==='hwpx'){
      const mod=await import('https://cdn.jsdelivr.net/npm/@ssabrojs/hwpxjs@0.4.0/dist/browser/hwpxjs.browser.mjs');
      const reader=new mod.default();await reader.loadFromArrayBuffer(await file.arrayBuffer());html=await reader.extractHtml({embedImages:true,renderStyles:true,renderTables:true,renderImages:true});
    }else if(ext==='hwp'){
      const mod=await import('https://cdn.jsdelivr.net/npm/@ssabrojs/hwpxjs@0.4.0/dist/browser/hwpxjs.browser.mjs');
      const text=await mod.hwpToText(new Uint8Array(await file.arrayBuffer()));html='<p>'+xmlEsc(text).replace(/\n/g,'<br>')+'</p>';
    }else{
      const text=await file.text();html='<p>'+xmlEsc(text).replace(/\n/g,'<br>')+'</p>';
    }
    loadingDocument=true;await wordEditor.setData(html||'<p></p>');loadingDocument=false;documents[activeDocId].html=currentHtml();setActiveDocTitle(file.name.replace(/\.[^.]+$/,''));updateCount();toast('문서를 열었습니다.');
  }catch(e){console.error(e);alert(`파일 열기 실패\n\n${e.message}`);}
}

/* --------------------------------------------------------------------------
   Local text tools
   -------------------------------------------------------------------------- */
let reviewModeActive=false;
let reviewSourceMode='editor'; // 'editor' | 'pdf'
let reviewResultMode='editor'; // 실제로 이번 검수 결과가 어느 모드에서 온 것인지 (모드를 중간에 바꿔도 안전하게)
let reviewRangeSnapshot=null;
let reviewSourceText='';
let reviewAbortController=null;
let reviewRequestSerial=0;
let currentReview=null;
let currentBaseCleaned='';
let currentCleaned='';
let selectedSuggestionIndexes=new Set();
let currentSuggestionRanges=[];

// Selection capture and request execution are deliberately separate.
let pendingReviewSelection=null;
let reviewInFlight=null;
let reviewPanelMessage='검수할 텍스트를 선택하세요.';

// App integration only. Kiwi's upstream spacing algorithm runs in a lazy worker.
let kiwiWorker=null,kiwiCall=null,kiwiSerial=0,kiwiSelectionVersion=0;
let kiwiBusy=false,kiwiResult=null,kiwiMessage='텍스트를 선택한 뒤 검수를 눌러 주세요.';
const kiwiWorkerUrl=new URL('vendor/kiwi/5golgyeo_word_kiwi_worker.js?v=20260912-kiwi-1',import.meta.url);
function resetKiwiSelection(){
  kiwiSelectionVersion++;kiwiResult=null;
  kiwiMessage=kiwiBusy?'이전 선택 영역의 처리를 마치는 중…':'텍스트를 선택한 뒤 검수를 눌러 주세요.';
}
function updateKiwiUi(){
  const panel=$('#kiwiPanel');if(!panel)return;
  panel.classList.remove('hidden');
  $('#kiwiInsertBtn').hidden=reviewSourceMode!=='pdf';
  const usable=reviewModeActive&&!!pendingReviewSelection?.text.trim();
  $('#kiwiRestoreBtn').disabled=!usable||kiwiBusy||!!reviewInFlight;
  $('#kiwiApplyBtn').disabled=!usable||!kiwiResult||kiwiResult.applied||kiwiBusy||!!reviewInFlight;
  $('#kiwiInsertBtn').disabled=!usable||!kiwiResult||kiwiBusy||!!reviewInFlight;
  $('#kiwiStatus').textContent=kiwiMessage;
  $('#kiwiResultBox').classList.toggle('hidden',!kiwiResult);
  $('#kiwiOriginal').textContent=kiwiResult?.original||'';
  $('#kiwiResult').textContent=kiwiResult?.text||'';
}
function requestKiwi(text){
  if(!kiwiWorker){
    kiwiWorker=new Worker(kiwiWorkerUrl,{type:'module'});
    kiwiWorker.onmessage=({data})=>{
      if(!kiwiCall||data.id!==kiwiCall.id)return;
      if(data.type==='status'){
        if(kiwiCall.version===kiwiSelectionVersion){kiwiMessage=data.message;updateKiwiUi();}
        return;
      }
      const call=kiwiCall;kiwiCall=null;clearTimeout(call.timer);
      if(data.type==='error')call.reject(new Error(data.message));else call.resolve(data);
    };
    kiwiWorker.onerror=()=>{
      const call=kiwiCall;kiwiCall=null;kiwiWorker?.terminate();kiwiWorker=null;
      if(call){clearTimeout(call.timer);call.reject(new Error('복원기를 불러오지 못했습니다. 다시 시도해 주세요.'));}
    };
  }
  return new Promise((resolve,reject)=>{
    const id=++kiwiSerial;
    const timer=setTimeout(()=>{
      kiwiWorker?.terminate();kiwiWorker=null;kiwiCall=null;
      reject(new Error('복원기 준비 시간이 초과되었습니다. 연결을 확인하고 다시 시도해 주세요.'));
    },180000);
    kiwiCall={id,resolve,reject,timer,version:kiwiSelectionVersion};
    kiwiWorker.postMessage({id,type:'space',text});
  });
}
// Local engines return data; rendering and explicit application are separate.
// Future spelling engine can be added here without changing the Kiwi worker.
const localReviewEngines={kiwi:async text=>{
  const result=await requestKiwi(text);
  if(nonWhitespace(text)!==nonWhitespace(result.text))throw new Error('원문의 글자 변경이 감지되어 결과를 적용하지 않았습니다.');
  if(JSON.stringify(text.match(/\r\n|\r|\n/g)||[])!==JSON.stringify(result.text.match(/\r\n|\r|\n/g)||[]))throw new Error('줄 경계 변경이 감지되었습니다.');
  return {engine:'kiwi',original:text,text:result.text};
}};
function presentLocalReview(result,selection){
  kiwiResult={...result,selection,applied:false};
  kiwiMessage='띄어쓰기 복원이 끝났습니다. 원문과 비교한 뒤 복원 적용을 눌러 주세요.';
  updateKiwiUi();
}
async function runLocalReview(){
  if(kiwiBusy)return toast('현재 검수가 끝난 뒤 다시 실행해 주세요.');
  const selection=pendingReviewSelection,version=kiwiSelectionVersion;
  if(!selection?.text.trim())return toast('검수할 텍스트를 먼저 선택해 주세요. PDF는 검수 패널의 PDF 모드에서 선택해 주세요.');
  kiwiBusy=true;kiwiResult=null;kiwiMessage='한국어 텍스트 복원기를 준비하는 중…';updateKiwiUi();
  try{
    const result=selection.blocks?await reviewKiwiBlocks(selection.blocks):await localReviewEngines.kiwi(selection.text);
    if(version!==kiwiSelectionVersion||selection!==pendingReviewSelection||selection.docId!==activeDocId)return;
    presentLocalReview(result,selection);
  }catch(error){if(version===kiwiSelectionVersion)kiwiMessage=`로컬 복원 오류: ${error.message}`;}
  finally{kiwiBusy=false;updateKiwiUi();}
}
function enterLocalReview(){
  const text=selectionText(),snapshot=snapshotSelection();
  if(!reviewModeActive)toggleReview(true);
  if(text.trim()&&snapshot){setReviewMode('editor');captureReviewSelection(text,snapshot);collapseVisibleReviewSelection(snapshot);}
  return runLocalReview();
}
function applyKiwiResult(){
  const result=kiwiResult,selection=pendingReviewSelection;
  if(!result||result.applied||kiwiBusy||result.selection!==selection||selection.docId!==activeDocId)return;
  if(selection.mode==='pdf'){
    // PDF bytes are immutable here; apply to the selected text in the panel.
    pendingReviewSelection={...selection,text:result.text};
    kiwiResult={...result,selection:pendingReviewSelection,applied:true};
    kiwiMessage='복원된 문장을 선택 텍스트에 적용했습니다. PDF 원본은 유지됩니다.';
    updateReviewRequestUi();return;
  }
  if(!selection.snapshot||selection.documentHtml!==currentHtml()){
    resetReviewSelection();return toast('문서가 변경되었습니다. 텍스트를 다시 선택해 검수해 주세요.');
  }
  try{
    if(!selection.blocks||!result.blockResults)throw new Error('문단 선택 정보가 없습니다.');
    applyKiwiWhitespace(selection.blocks,result.blockResults);
    resetReviewSelection();toast('선택 영역에 띄어쓰기 복원 결과를 적용했습니다.');
  }catch{resetReviewSelection();toast('선택 영역을 적용할 수 없습니다. 다시 선택해 주세요.');}
}
function setupKiwiUi(){
  $('#reviewBtn').addEventListener('pointerdown',e=>e.preventDefault());
  $('#reviewBtn').addEventListener('click',enterLocalReview);
  $('#kiwiRestoreBtn').addEventListener('click',runLocalReview);
  $('#kiwiApplyBtn').addEventListener('click',applyKiwiResult);
  $('#kiwiInsertBtn').addEventListener('click',()=>{
    if(!kiwiResult||kiwiBusy||pendingReviewSelection?.mode!=='pdf'||!wordEditor)return;
    try{
      insertPdfPlainText(kiwiResult.text);
      toast('복원된 문장을 커서 위치에 붙여넣었습니다.');
    }catch{toast('본문에 커서를 두고 다시 시도해 주세요.');}
  });
}

function updateReviewRequestUi(){
  updateKiwiUi();
  $('#reviewRequestStatus').textContent=reviewPanelMessage;
  $('#reviewSourceTitle').textContent=reviewSourceMode==='pdf'?(kiwiResult?.applied?'검수할 PDF 텍스트 · 복원 적용됨':'선택된 PDF 원문'):'선택된 본문 원문';
  $('#reviewSelectedSource').textContent=pendingReviewSelection?.text||'아직 선택된 텍스트가 없습니다.';
}
function captureReviewSelection(text,snapshot){
  if(!text?.trim())return;
  if(pendingReviewSelection?.text===text&&pendingReviewSelection.mode===reviewSourceMode&&
     JSON.stringify(pendingReviewSelection.snapshot)===JSON.stringify(snapshot))return;
  // Invalidate previous results and abort their request before accepting a new selection.
  resetReviewSelection({keepStatus:true});
  const blocks=reviewSourceMode==='editor'?captureKiwiBlocks(snapshot):null;
  if(blocks)text=blocks.map(b=>b.map(l=>l.text).join('\n')).join('\n\n');
  pendingReviewSelection={text,snapshot,blocks,mode:reviewSourceMode,docId:activeDocId,documentHtml:currentHtml()};
  reviewRangeSnapshot=snapshot;
  reviewPanelMessage='선택 영역을 저장했습니다. 검수를 눌러 띄어쓰기를 복원하세요.';
  $('#cleanPreview').textContent='PDF 모드의 로컬 복원을 사용하세요.';
  setStatus('선택 영역 저장됨');
  updateReviewRequestUi();
}
function reviewWaitingStatus(){
  return reviewSourceMode==='pdf' ? '검수 대기 · Adobe PDF에서 검수할 텍스트를 드래그하세요.' : '검수 대기 · 본문에서 영역을 드래그하세요.';
}
function reviewWaitingPreview(){
  return reviewSourceMode==='pdf' ? 'Adobe PDF에서 검수할 텍스트를 드래그해 선택하세요.' : '본문에서 검수할 영역을 드래그해 선택하세요.';
}
function setReviewMode(mode){
  if(!['editor','pdf'].includes(mode)||mode===reviewSourceMode)return;
  reviewSourceMode=mode;
  resetReviewSelection({keepStatus:true});
  $('#reviewModeEditor')?.classList.toggle('active',mode==='editor');
  $('#reviewModePdf')?.classList.toggle('active',mode==='pdf');
  const applyLabel=$('#applyCleanLabel');if(applyLabel)applyLabel.textContent=mode==='pdf' ? '커서 위치에 붙여넣기' : '변경 적용';
  window.__5golgyeoSetPdfLineSelectMode?.(reviewModeActive&&mode==='pdf');
  if(reviewModeActive)setStatus(reviewWaitingStatus());
}

function snapshotSelection(){
  const sel=wordEditor.model.document.selection;
  if(sel.isCollapsed || !sel.getFirstRange())return null;
  const r=sel.getFirstRange();
  return {rootName:r.root.rootName,start:[...r.start.path],end:[...r.end.path]};
}
function selectionText(){
  const sel=window.getSelection();
  const editable=wordEditor.ui.getEditableElement();
  if(!sel||!sel.rangeCount||sel.isCollapsed)return '';
  const r=sel.getRangeAt(0);if(!editable.contains(r.commonAncestorContainer))return '';
  return sel.toString();
}

/* 사용자가 드래그한 범위는 reviewRangeSnapshot에 보관하고,
   화면의 파란 선택 표시만 즉시 해제한다. 이후 '변경 적용'을 눌러도
   저장된 모델 위치를 사용하므로 원래 선택했던 범위가 교체된다. */
function collapseVisibleReviewSelection(snapshot){
  if(!snapshot||!wordEditor)return;
  try{
    const root=wordEditor.model.document.getRoot(snapshot.rootName);
    if(!root)return;
    wordEditor.model.change(writer=>{
      const end=writer.createPositionFromPath(root,snapshot.end);
      writer.setSelection(end);
    });
    wordEditor.editing.view.focus();
  }catch(e){
    console.warn('[Text tools] 선택 표시 해제 실패',e);
  }
}
function resetReviewSelection({keepStatus=false}={}){
  resetKiwiSelection();
  reviewAbortController?.abort?.();reviewAbortController=null;reviewRequestSerial++;
  pendingReviewSelection=null;reviewPanelMessage='검수할 텍스트를 선택하세요.';
  reviewRangeSnapshot=null;reviewSourceText='';currentReview=null;currentBaseCleaned='';currentCleaned='';selectedSuggestionIndexes=new Set();currentSuggestionRanges=[];
  window.__5golgyeoClearPdfLineSelection?.();
  $('#applyClean').disabled=true;
  $('#cleanPreview').classList.remove('review-loading');
  $('#cleanPreview').textContent=reviewWaitingPreview();
  $('#suggestions').textContent='특이사항 없음';$('#safety').textContent='선택한 영역을 검수하면 결과를 확인합니다.';
  updateReviewRequestUi();
  if(!keepStatus && reviewModeActive)setStatus(reviewWaitingStatus());
}
function toggleReview(show){
  const panel=$('#reviewPanel'),workspace=$('#workspace');
  const shouldShow=show===true?true:show===false?false:panel.classList.contains('hidden');
  if(shouldShow){panel.classList.remove('hidden');workspace.classList.remove('panel-hidden');reviewModeActive=true;resetReviewSelection({keepStatus:true});setStatus(reviewWaitingStatus());}
  else{panel.classList.add('hidden');workspace.classList.add('panel-hidden');reviewModeActive=false;resetReviewSelection({keepStatus:true});setStatus('준비');}
  window.__5golgyeoSetPdfLineSelectMode?.(reviewModeActive&&reviewSourceMode==='pdf');
  window.__5golgyeoUpdateLayout?.();
}
function nonWhitespace(s){return String(s||'').replace(/\s+/g,'');}
function compactTextWithMap(text){let compact='';const map=[];for(let i=0;i<text.length;i++){if(/\s/.test(text[i]))continue;map.push(i);compact+=text[i];}return {compact,map};}
function findNthOccurrence(text,needle,nth){let from=0,pos=-1;for(let i=0;i<=nth;i++){pos=text.indexOf(needle,from);if(pos<0)return -1;from=pos+Math.max(needle.length,1);}return pos;}
function findSuggestionRange(base,original,nth=0){
  original=String(original||'');if(!original)return null;
  let start=findNthOccurrence(base,original,nth);if(start>=0)return {start,end:start+original.length};
  const trimmed=original.trim();start=findNthOccurrence(base,trimmed,nth);if(start>=0)return {start,end:start+trimmed.length};
  const bm=compactTextWithMap(base),nm=compactTextWithMap(trimmed||original);const cs=findNthOccurrence(bm.compact,nm.compact,nth);if(cs<0)return null;
  const first=bm.map[cs],last=bm.map[cs+nm.compact.length-1];return first==null||last==null?null:{start:first,end:last+1};
}
function buildSuggestionRanges(base,suggestions){const seen=new Map();return suggestions.map(s=>{const key=nonWhitespace(s.original),n=seen.get(key)||0;seen.set(key,n+1);return findSuggestionRange(base,s.original,n);});}
function renderReviewPreview(){
  const box=$('#cleanPreview');
  box.replaceChildren();
  const suggestions=currentReview?.suggestions||[];
  let cursor=0;
  let highlighted=0;

  const located=currentSuggestionRanges
    .map((range,index)=>({range,index}))
    .filter(x=>x.range)
    .sort((a,b)=>a.range.start-b.range.start||a.range.end-b.range.end);

  for(const {range:r,index} of located){
    if(r.start<cursor)continue;
    if(r.start>cursor)box.append(document.createTextNode(currentBaseCleaned.slice(cursor,r.start)));

    const mark=document.createElement('mark');
    mark.dataset.reviewHighlight='true';
    mark.dataset.index=String(index);
    mark.className='review-spelling-mark'+(selectedSuggestionIndexes.has(index)?' applied':'');
    mark.textContent=selectedSuggestionIndexes.has(index)
      ? String(suggestions[index]?.suggested||'')
      : currentBaseCleaned.slice(r.start,r.end);
    mark.title=suggestions[index]?.reason||'교정이 필요한 부분';
    box.append(mark);

    cursor=r.end;
    highlighted++;
  }

  if(cursor<currentBaseCleaned.length)box.append(document.createTextNode(currentBaseCleaned.slice(cursor)));

  if(suggestions.length && highlighted===0){
    const warn=document.createElement('div');
    warn.className='review-highlight-warning';
    warn.textContent=`교정 제안 ${suggestions.length}개가 있지만 본문에서 표시 위치를 찾지 못했습니다.`;
    box.append(warn);
  }
}
function updateSelectedCorrections(){
  const suggestions=currentReview?.suggestions||[];let text=currentBaseCleaned;
  const ops=currentSuggestionRanges.map((r,i)=>({r,i})).filter(x=>x.r&&selectedSuggestionIndexes.has(x.i)).sort((a,b)=>b.r.start-a.r.start);
  for(const {r,i} of ops)text=text.slice(0,r.start)+String(suggestions[i].suggested||'')+text.slice(r.end);
  currentCleaned=text;renderReviewPreview();
}
function renderReview(data){
  currentReview=data;currentBaseCleaned=String(data?.cleaned_text||reviewSourceText||'');currentCleaned=currentBaseCleaned;selectedSuggestionIndexes=new Set();const suggestions=Array.isArray(data?.suggestions)?data.suggestions:[];currentSuggestionRanges=buildSuggestionRanges(currentBaseCleaned,suggestions);renderReviewPreview();
  const box=$('#suggestions');box.replaceChildren();
  if(!suggestions.length)box.textContent='특이사항 없음';
  suggestions.forEach((s,i)=>{
    const item=document.createElement('div');item.className='suggestion';
    const label=document.createElement('label');label.className='suggestion-choice';
    const cb=document.createElement('input');cb.type='checkbox';
    cb.onchange=()=>{cb.checked?selectedSuggestionIndexes.add(i):selectedSuggestionIndexes.delete(i);updateSelectedCorrections();};
    const text=document.createElement('div');text.className='suggestion-text';
    const main=document.createElement('div');main.className='suggestion-main';
    const from=document.createElement('span');from.className='from';from.textContent=s.original;
    const to=document.createElement('span');to.className='to';to.textContent=s.suggested;
    main.append(from,' → ',to);
    text.append(main);
    if(s.reason){const reason=document.createElement('div');reason.className='reason';reason.textContent=s.reason;text.append(reason);}
    label.append(cb,text);item.append(label);box.append(item);
  });
  $('#safety').textContent=nonWhitespace(reviewSourceText)===nonWhitespace(currentBaseCleaned)?'줄바꿈 정제 안전 검사 통과 · 글자 내용은 유지됨':'주의: 줄바꿈 외의 문자 변경이 감지되었습니다. 적용 전에 확인하세요.';
  $('#applyClean').disabled=false;
}
function startReviewFromSelection(){
  if(!reviewModeActive||reviewSourceMode!=='editor')return;
  const text=selectionText();
  const snap=snapshotSelection();
  // A plain caret click must not discard the range already being reviewed.
  if(!text.trim()||!snap)return;

  /* 화면 선택은 즉시 풀고, 실제 적용 범위는 snap에 보관한다. */
  collapseVisibleReviewSelection(snap);
  captureReviewSelection(text,snap);
}
/* Adobe PDF 모듈(5golgyeo_word_pdf.js)이 선택된 텍스트를
   모을 때마다 이 콜백을 호출한다. PDF에서 가져온 텍스트는 문서 안의 특정 위치를
   대체하는 게 아니므로 스냅샷 없이 넘긴다. */
window.__5golgyeoPdfLineSelectionChanged=text=>{
  if(!reviewModeActive||reviewSourceMode!=='pdf')return;
  if(!text||!text.trim())return;
  captureReviewSelection(text,null);
};
// Insert final PDF plain text using the live CKEditor selection, not HTML upcasting.
function insertPdfPlainText(text){
  if(!wordEditor||wordEditor.isReadOnly)throw new Error('편집할 수 없는 문서입니다.');
  const model=wordEditor.model,selection=model.document.selection,schema=model.schema;
  const inline=[...selection.getAttributes()].filter(([key])=>schema.checkAttribute('$text',key));
  const firstBlock=[...selection.getSelectedBlocks()][0];
  let block=selection.getFirstPosition()?.parent;
  if(!block||!schema.isBlock(block)||!schema.checkChild(block,'$text'))block=firstBlock;
  const blockName=block&&schema.isBlock(block)&&schema.checkChild(block,'$text')?block.name:'paragraph';
  const blockKeys=['lineHeight','spaceBefore','spaceAfter','firstLineIndent','blockIndent','rightIndent','alignment'];
  const attrs=blockKeys.filter(key=>block?.hasAttribute(key)&&schema.checkAttribute(blockName,key)).map(key=>[key,block.getAttribute(key)]);
  // A blank line separates paragraphs; repeated blank paragraphs and soft breaks survive.
  const paragraphs=String(text).replace(/\r\n?/g,'\n').split('\n\n');
  model.change(writer=>{
    const fragment=writer.createDocumentFragment();
    for(const paragraphText of paragraphs){
      const paragraph=writer.createElement(blockName,attrs);writer.append(paragraph,fragment);
      const lines=paragraphText.split('\n');
      lines.forEach((line,index)=>{
        if(index)writer.appendElement('softBreak',paragraph);
        if(line)writer.appendText(line,inline,paragraph);
      });
    }
    model.insertContent(fragment,selection);
    // Preserve explicit current typing state, including disabled bold/italic.
    for(const key of [...selection.getAttributeKeys()])writer.removeSelectionAttribute(key);
    for(const [key,value] of inline)writer.setSelectionAttribute(key,value);
  });
  wordEditor.editing.view.focus();
}

function textAsEditorHtml(text){
  const paras=String(text).split(/\n{2,}/).map(p=>`<p>${xmlEsc(p).replace(/\n/g,'<br>')}</p>`);return paras.join('')||'<p></p>';
}
function applyReviewedText(){
  if(!currentCleaned)return;
  const model=wordEditor.model;
  if(reviewResultMode==='pdf'){
    try{
      insertPdfPlainText(currentCleaned);
      resetReviewSelection();toast('커서 위치에 붙여넣었습니다.');
    }catch(e){console.error(e);toast('붙여넣기에 실패했습니다. 본문에 커서를 두고 다시 시도해 주세요.');}
    return;
  }
  if(!reviewRangeSnapshot)return;
  try{
    const root=model.document.getRoot(reviewRangeSnapshot.rootName);
    model.change(writer=>{
      const start=writer.createPositionFromPath(root,reviewRangeSnapshot.start);const end=writer.createPositionFromPath(root,reviewRangeSnapshot.end);const range=writer.createRange(start,end);writer.remove(range);const viewFrag=wordEditor.data.processor.toView(textAsEditorHtml(currentCleaned));const modelFrag=wordEditor.data.toModel(viewFrag);model.insertContent(modelFrag,start);
    });resetReviewSelection();toast('선택 영역에 검수 결과를 적용했습니다.');
  }catch(e){console.error(e);toast('선택 영역이 변경되어 적용할 수 없습니다. 다시 선택해 주세요.');resetReviewSelection();}
}

/* --------------------------------------------------------------------------
   Settings / misc UI
   -------------------------------------------------------------------------- */
function activateApiTab(name){$$('.api-settings-tab').forEach(b=>b.classList.toggle('active',b.dataset.apiTab===name));$$('.api-settings-panel').forEach(p=>p.classList.toggle('active',p.dataset.apiPanel===name));}
function showSettings(tab='ocr'){
  $('#ocrApiKey').value=localStorage.getItem('pdfEditor.ocrGoogleVisionKey')||'';activateApiTab(tab);$('#settingsModal').classList.add('show');
}
function saveSettings(){
  localStorage.setItem('pdfEditor.ocrGoogleVisionKey',$('#ocrApiKey').value.trim());$('#settingsModal').classList.remove('show');toast('API 설정을 저장했습니다.');
}
function setZoom(value){zoom=Math.max(.6,Math.min(1.8,value));const editable=wordEditor?.ui.getEditableElement();if(editable)editable.style.zoom=zoom;if($('#zoomLabel'))$('#zoomLabel').textContent=Math.round(zoom*100)+'%';}
function newDoc(){if(plainText().trim()&&!confirm('현재 탭의 문서를 지우고 새 문서를 만들까요?'))return;wordEditor.setData('<p></p>');documents[activeDocId].html='<p></p>';setActiveDocTitle(activeDocId==='pdf'?'PDF 파일':'빈 종이');resetReviewSelection({keepStatus:true});}
function showFind(){
  $('#findbar').classList.add('show');$('#findText').focus();
}
function findNext(){
  const q=$('#findText').value;if(!q)return;try{exec('find',{searchText:q});}catch{window.find(q,false,false,true,false,false,false);}
}
function replaceAll(){
  const q=$('#findText').value,r=$('#replaceText').value;if(!q)return;
  const html=currentHtml();const text=plainText();const n=text.split(q).length-1;if(!n)return toast('찾는 내용이 없습니다.');
  if(/[<>]/.test(q)){toast('태그 문자는 찾기/바꾸기에서 사용할 수 없습니다.');return;}
  const dom=new DOMParser().parseFromString(html,'text/html');const walker=dom.createTreeWalker(dom.body,NodeFilter.SHOW_TEXT);let node,c=0;while((node=walker.nextNode())){if(node.nodeValue.includes(q)){c+=node.nodeValue.split(q).length-1;node.nodeValue=node.nodeValue.split(q).join(r);}}wordEditor.setData(dom.body.innerHTML);toast(`${c}곳을 바꿨습니다.`);
}
function bindAppUi(){
  $$('.menu>button').forEach(b=>b.onclick=e=>{const m=b.parentElement,w=m.classList.contains('open');$$('.menu').forEach(x=>x.classList.remove('open'));if(!w)m.classList.add('open');e.stopPropagation();});
  document.addEventListener('click',e=>{if(!e.target.closest('.menu'))$$('.menu').forEach(x=>x.classList.remove('open'));if(!e.target.closest('#tabPopover'))$('#tabPopover')?.classList.remove('show');});
  $$('[data-export]').forEach(b=>b.onclick=()=>{$$('.menu').forEach(x=>x.classList.remove('open'));doExport(b.dataset.export);});
  $$('[data-action]').forEach(b=>b.onclick=e=>{
    if(b.dataset.action==='exportmenu')e.stopPropagation();
    const a=b.dataset.action;if(a!=='exportmenu')$$('.menu').forEach(x=>x.classList.remove('open'));if(a==='new')newDoc();else if(a==='open')$('#fileInput').click();else if(a==='savejson')saveProject();else if(a==='saveas')saveProjectAs();else if(a==='exportmenu'){const menu=$('[data-export]').closest('.menu');menu.classList.add('open');menu.querySelector('[data-export]').focus();}else if(a==='find')showFind();else if(a==='toggleReview')toggleReview();else if(a==='source')exec('sourceEditing');else if(a==='pagebreak')exec('pageBreak');else if(a==='zoomIn')setZoom(zoom+.1);else if(a==='zoomOut')setZoom(zoom-.1);else if(a==='zoomReset')setZoom(1);else if(a==='settings')showSettings();
  });
  $('#fileInput').accept='.txt,.html,.htm,.json,.md,.rtf,.hwp,.hwpx';$('#fileInput').onchange=e=>{openFile(e.target.files[0]);e.target.value='';};
  $('#closeReview')?.addEventListener('click',()=>toggleReview(false));$('#copyAllBtn')?.addEventListener('click',()=>navigator.clipboard.writeText(plainText()).then(()=>toast('전체 텍스트를 복사했습니다.')));
  $('#applyClean')?.addEventListener('click',applyReviewedText);
  setupKiwiUi();
  wordEditor.ui.getEditableElement().addEventListener('keyup',e=>{
    if(reviewModeActive&&(e.key==='Shift'||e.shiftKey||(e.ctrlKey&&e.key.toLowerCase()==='a')))requestAnimationFrame(startReviewFromSelection);
  });
  // PDF lifecycle UI only invalidates review state; the Adobe/MuPDF module remains untouched.
  for(const [id,event] of [['pdfInput','change'],['clearPdfBtn','click'],['pdfAdobeSave','click']]){
    $('#'+id)?.addEventListener(event,()=>{if(reviewSourceMode==='pdf')resetReviewSelection({keepStatus:true});});
  }
  updateReviewRequestUi();
  $('#reviewModeEditor')?.addEventListener('click',()=>setReviewMode('editor'));
  $('#reviewModePdf')?.addEventListener('click',()=>setReviewMode('pdf'));
  wordEditor.ui.getEditableElement().addEventListener('pointerup',()=>{if(reviewModeActive)requestAnimationFrame(startReviewFromSelection);});
  $('#findNext').onclick=findNext;$('#replaceAll').onclick=replaceAll;$('#closeFind').onclick=()=>$('#findbar').classList.remove('show');
  $('#outlineToggle').onclick=()=>$('#outlinePanel').classList.toggle('show');$('#outlineClose').onclick=()=>$('#outlinePanel').classList.remove('show');$('#refreshOutlineBtn').onclick=updateOutline;
  $('#addMainTabBtn').onclick=()=>newTab(null);$('#addSubTabBtn').onclick=()=>newTab(activeDocId);
  $('#cancelTabName').onclick=closeTabNameModal;$('#saveTabName').onclick=()=>{if(tabNameTargetId&&documents[tabNameTargetId])documents[tabNameTargetId].title=$('#tabNameInput').value.trim()||documents[tabNameTargetId].title;renderTabs();saveAuto();closeTabNameModal();};
  $$('#emojiPicker button').forEach(b=>b.onclick=()=>{$('#tabNameInput').value+=b.textContent;$('#tabNameInput').focus();});
  $('#renameTabAction').onclick=()=>{const id=$('#tabPopover').dataset.doc;$('#tabPopover').classList.remove('show');if(id)openTabNameModal(id,'탭 이름 바꾸기');};
  $('#addChildTabAction').onclick=()=>{const id=$('#tabPopover').dataset.doc;$('#tabPopover').classList.remove('show');if(id)newTab(id);};
  $('#deleteTabAction').onclick=()=>{const id=$('#tabPopover').dataset.doc;$('#tabPopover').classList.remove('show');if(!id||id==='blank')return toast('기본 탭은 삭제할 수 없습니다.');if(!confirm('이 탭과 하위 탭을 삭제할까요?'))return;const remove=id=>{Object.values(documents).filter(d=>d.parentId===id).forEach(d=>remove(d.id));delete documents[id];};remove(id);if(!documents[activeDocId])activeDocId='blank';renderTabs();loadDocState(activeDocId,{saveCurrent:false});};
  $$('.api-settings-tab').forEach(b=>b.onclick=()=>activateApiTab(b.dataset.apiTab));$('#cancelSettings').onclick=()=>$('#settingsModal').classList.remove('show');$('#saveSettings').onclick=saveSettings;
  $('#exportApiSettings').onclick=()=>{const obj={ocrGoogleVisionKey:localStorage.getItem('pdfEditor.ocrGoogleVisionKey')||''};downloadBlob(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}),'5golgyeo_word_api_settings.json');};
  $('#importApiSettings').onclick=()=>$('#apiSettingsFile').click();$('#apiSettingsFile').onchange=async e=>{try{const d=JSON.parse(await e.target.files[0].text());if(d.ocrGoogleVisionKey!=null)localStorage.setItem('pdfEditor.ocrGoogleVisionKey',d.ocrGoogleVisionKey);showSettings();toast('API 설정을 불러왔습니다.');}catch{toast('설정 파일을 읽지 못했습니다.');}e.target.value='';};
  $('#appSwitch').onclick=()=>toast('문서 편집기');
  bindSplitter();
  setupReviewResize();
  setupPageSettings();
  document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key.toLowerCase()==='s'){e.preventDefault();e.shiftKey?saveProjectAs():saveProject();}if(e.ctrlKey&&e.key.toLowerCase()==='o'){e.preventDefault();$('#fileInput').click();}if(e.ctrlKey&&e.key.toLowerCase()==='n'){e.preventDefault();newDoc();}if(e.ctrlKey&&e.key.toLowerCase()==='h'){e.preventDefault();showFind();}});
  window.addEventListener('beforeunload',()=>saveAuto());
}
function bindSplitter(){
  const splitter=$('#mainSplitter'),workspace=$('#workspace');
  let ratio=.42,dragging=false;
  const layout=()=>{
    const width=workspace.clientWidth;
    const narrow=matchMedia('(max-width:950px)').matches;
    const reviewVisible=!workspace.classList.contains('panel-hidden');
    const overlay=width<1120;
    workspace.style.setProperty('--workspace-top',workspace.getBoundingClientRect().top+'px');
    workspace.classList.toggle('review-overlay',overlay);
    const panelWidth=reviewPanelWidth();
    workspace.style.setProperty('--review-width',panelWidth+'px');
    $('#reviewResize').setAttribute('aria-valuenow',String(Math.round(panelWidth)));
    $('#reviewResize').setAttribute('aria-valuemin',String(Math.min(260,panelWidth)));
    $('#reviewResize').setAttribute('aria-valuemax',String(Math.max(panelWidth,Math.min(640,width<1120?width-24:width-727))));
    if(narrow){workspace.style.removeProperty('grid-template-columns');return;}
    const reviewWidth=reviewVisible&&!overlay?panelWidth:0;
    const available=width-reviewWidth-7;
    const pdf=Math.round(Math.max(300,Math.min(available-420,available*ratio)));
    workspace.style.gridTemplateColumns=pdf+'px 7px minmax(420px,1fr)'+(reviewWidth?' '+reviewWidth+'px':'');
    splitter.setAttribute('aria-valuemin','300');splitter.setAttribute('aria-valuemax',String(available-420));splitter.setAttribute('aria-valuenow',String(pdf));
    wordEditor.ui.update();
  };
  const setPosition=x=>{
    const r=workspace.getBoundingClientRect();
    const reviewWidth=!workspace.classList.contains('panel-hidden')&&!workspace.classList.contains('review-overlay')?reviewPanelWidth():0;
    const available=r.width-reviewWidth-7;
    ratio=Math.max(300,Math.min(available-420,x-r.left))/available;layout();
  };
  const stop=()=>{dragging=false;document.body.classList.remove('is-resizing');};
  splitter.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();dragging=true;splitter.setPointerCapture(e.pointerId);document.body.classList.add('is-resizing');});
  splitter.addEventListener('pointermove',e=>{if(dragging)setPosition(e.clientX);});
  ['pointerup','pointercancel','lostpointercapture'].forEach(type=>splitter.addEventListener(type,stop));
  splitter.addEventListener('keydown',e=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
    e.preventDefault();const r=workspace.getBoundingClientRect();
    const current=Number(splitter.getAttribute('aria-valuenow'));
    const target=e.key==='Home'?300:e.key==='End'?Number(splitter.getAttribute('aria-valuemax')):current+(e.key==='ArrowLeft'?-1:1)*(e.shiftKey?50:16);
    setPosition(r.left+target);
  });
  new ResizeObserver(layout).observe(workspace);
  window.__5golgyeoUpdateLayout=layout;layout();
}

/* PDF image drag -> CKEditor image element */
function installPdfImageBridge(){
  window.__5golgyeoInsertPdfImage=(src,width,height,domRange=null,metadata={})=>{
    try{
      if(wordEditor.isReadOnly || !wordEditor.commands.get('insertImage')?.isEnabled)return false;
      let modelPosition=null;
      if(domRange){
        try{
          const viewPosition=wordEditor.editing.view.domConverter.domPositionToView(domRange.startContainer,domRange.startOffset);
          if(viewPosition)modelPosition=wordEditor.editing.mapper.toModelPosition(viewPosition);
        }catch(mapError){console.warn('[PDF image drop mapping]',mapError);}
      }
      if(domRange&&!modelPosition)return false;
      if(modelPosition)wordEditor.model.change(writer=>writer.setSelection(modelPosition));
      // Split the paragraph at the caret instead of placing a block image
      // before the entire paragraph via the optimal block insertion heuristic.
      wordEditor.execute('insertImage',{
        source:{src,alt:`PDF ${metadata.source==='crop'?'페이지 잘라오기':'원본 객체'}${metadata.pageNumber?' · '+metadata.pageNumber+'쪽':''}`},imageType:'imageBlock',breakBlock:true
      });
      const inserted=wordEditor.model.document.selection.getSelectedElement();
      if(!inserted||inserted.getAttribute('src')!==src)return false;
      wordEditor.editing.view.focus();return true;
    }catch(e){console.error('[PDF image -> CKEditor]',e);return false;}
  };
}

// Document data is independent of its screen rendering; future sections can reuse this shape.
const PAGE_SIZES={A4:[210,297],A3:[297,420],Letter:[215.9,279.4]};
function normalizePageSettings(input={}){
  input=input&&typeof input==='object'?input:{};
  const num=(v,f,min,max)=>Number.isFinite(Number(v))?Math.max(min,Math.min(max,Number(v))):f;
  const size=Object.hasOwn(PAGE_SIZES,input.size)?input.size:input.size==='Custom'?'Custom':'A4';
  const pair=PAGE_SIZES[size]||[num(input.width,210,80,600),num(input.height,297,80,600)];
  const orientation=input.orientation==='landscape'?'landscape':'portrait';
  const [width,height]=orientation==='landscape'?[Math.max(...pair),Math.min(...pair)]:[Math.min(...pair),Math.max(...pair)];
  const m=input.margins||{};
  return {mode:input.mode==='pageless'?'pageless':'pages',size,orientation,width,height,margins:{top:num(m.top,20,0,(height-20)/2),bottom:num(m.bottom,20,0,(height-20)/2),left:num(m.left,20,0,(width-20)/2),right:num(m.right,20,0,(width-20)/2)}};
}
function renderPageSettings(){
  if(!wordEditor||!documents[activeDocId])return;
  const page=documents[activeDocId].pageSettings=normalizePageSettings(documents[activeDocId].pageSettings);
  const wrap=wordEditor.ui.getEditableElement().closest('.editor-wrap');wrap.dataset.pageMode=page.mode;
  for(const [key,value] of Object.entries({width:page.width,height:page.height,...page.margins}))wrap.style.setProperty('--page-'+key,value+'mm');
  wordEditor.ui.update();
}
function setupPageSettings(){
  const modal=$('#pageSettingsDialog');
  $('#pageSettingsBtn').onclick=()=>{
    const p=normalizePageSettings(documents[activeDocId].pageSettings);
    for(const key of ['mode','size','orientation','width','height'])document.getElementById('page-'+key).value=p[key];
    for(const key of ['top','bottom','left','right'])document.getElementById('page-'+key).value=p.margins[key];
    sync();modal.showModal();
  };
  const sync=()=>{
    const page=normalizePageSettings({size:$('#page-size').value,orientation:$('#page-orientation').value,width:$('#page-width').value,height:$('#page-height').value});
    for(const key of ['width','height']){const field=document.getElementById('page-'+key);field.disabled=$('#page-size').value!=='Custom';field.value=page[key];}
  };
  $('#page-size').onchange=sync;$('#page-orientation').onchange=sync;
  $('#pageSettingsCancel').onclick=()=>modal.close();
  $('#pageSettingsForm').onsubmit=e=>{
    e.preventDefault();const get=key=>document.getElementById('page-'+key).value;
    documents[activeDocId].pageSettings=normalizePageSettings({mode:get('mode'),size:get('size'),orientation:get('orientation'),width:get('width'),height:get('height'),margins:Object.fromEntries(['top','bottom','left','right'].map(k=>[k,get(k)]))});
    renderPageSettings();saveAuto();modal.close();toast('이 문서의 페이지 설정을 저장했습니다.');
  };
}
const REVIEW_WIDTH_KEY='5golgyeo_word.reviewPanelWidth';
let preferredReviewWidth=330;
try{const saved=Number(localStorage.getItem(REVIEW_WIDTH_KEY));if(saved>=260)preferredReviewWidth=saved;}catch{}
function reviewPanelWidth(){
  const width=$('#workspace').clientWidth;
  const max=Math.max(180,Math.min(640,width<1120?width-24:width-727));
  return Math.max(Math.min(260,max),Math.min(max,preferredReviewWidth));
}
function setupReviewResize(){
  const handle=$('#reviewResize');let start=null;
  const set=value=>{preferredReviewWidth=value;preferredReviewWidth=reviewPanelWidth();try{localStorage.setItem(REVIEW_WIDTH_KEY,String(preferredReviewWidth));}catch{}window.__5golgyeoUpdateLayout?.();};
  handle.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();start={x:e.clientX,width:reviewPanelWidth()};handle.setPointerCapture(e.pointerId);});
  handle.addEventListener('pointermove',e=>{if(start)set(start.width+start.x-e.clientX);});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(event,()=>{start=null;});
  handle.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();set(e.key==='Home'?260:e.key==='End'?640:reviewPanelWidth()+(e.key==='ArrowLeft'?1:-1)*(e.shiftKey?40:16));});
}
// Capture text ranges separately for each real CKEditor block and soft-break line.
// Empty blocks and non-text objects remain in the model, never reconstructed from plain text.
function captureKiwiBlocks(snapshot){
  if(!snapshot)return null;
  const model=wordEditor.model,root=model.document.getRoot(snapshot.rootName);
  const range=model.createRange(model.createPositionFromPath(root,snapshot.start),model.createPositionFromPath(root,snapshot.end));
  const blocks=[];const visit=node=>{
    if(model.schema.isBlock(node)&&!model.schema.isObject(node)){
      const part=model.createRangeIn(node).getIntersection(range);
      if(part){
        const lines=[];let line={text:'',positions:[],attrs:[],end:part.start};
        const flush=()=>{lines.push(line);line={text:'',positions:[],attrs:[],end:part.end};};
        for(const item of part.getItems()){
          if(item.is('$textProxy')){
            for(let i=0;i<item.data.length;i++){line.text+=item.data[i];line.positions.push(model.createPositionAt(item.parent,item.startOffset+i));line.attrs.push([...item.getAttributes()]);}
            line.end=model.createPositionAt(item.parent,item.endOffset);
          }else if(item.is('element','softBreak')||model.schema.isObject(item))flush();
        }
        flush();blocks.push(lines);
      }
      return;
    }
    for(const child of node.getChildren?.()||[])if(child.is('element'))visit(child);
  };visit(root);return blocks;
}
async function reviewKiwiBlocks(blocks){
  const results=[];
  for(const lines of blocks){const row=[];for(const line of lines)row.push(line.text.trim()?await localReviewEngines.kiwi(line.text):{text:line.text,original:line.text});results.push(row);}
  return {engine:'kiwi',original:blocks.map(b=>b.map(l=>l.text).join('\n')).join('\n\n'),text:results.map(b=>b.map(r=>r.text).join('\n')).join('\n\n'),blockResults:results};
}
function applyKiwiWhitespace(blocks,results){
  const ops=[],model=wordEditor.model;
  blocks.forEach((lines,b)=>lines.forEach((line,l)=>{
    const restored=results[b][l].text;if(nonWhitespace(line.text)!==nonWhitespace(restored))throw Error('원문 문자 불일치');
    const oldChars=[...line.text.matchAll(/\S/gu)],newChars=[...restored.matchAll(/\S/gu)];
    let oldStart=0,newStart=0;
    for(let i=0;i<=oldChars.length;i++){
      const end=oldChars[i]?.index??line.text.length,newEnd=newChars[i]?.index??restored.length;
      const whitespace=restored.slice(newStart,newEnd);
      if(line.text.slice(oldStart,end)!==whitespace){ops.push({start:line.positions[oldStart]||line.end,end:line.positions[end]||line.end,text:whitespace,attrs:line.attrs[end]||line.attrs[Math.max(0,oldStart-1)]||[]});}
      oldStart=end+(oldChars[i]?.[0].length||0);newStart=newEnd+(newChars[i]?.[0].length||0);
    }
  }));
  ops.sort((a,b)=>a.start.isBefore(b.start)?1:a.start.isAfter(b.start)?-1:0);
  model.change(w=>{for(const op of ops){w.remove(model.createRange(op.start,op.end));if(op.text)w.insertText(op.text,op.attrs,op.start);}});
}

try{
  await createEditor();
}catch(error){
  console.error('[CKEditor initialization]',error);
  setStatus('편집기 초기화 실패 · vendor/ckeditor5 파일과 콘솔 오류를 확인하세요.');
  toast('편집기를 시작하지 못했습니다. 배포 ZIP의 vendor 폴더도 함께 설치해 주세요.');
}
