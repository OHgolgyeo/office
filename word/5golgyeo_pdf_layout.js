/* PDF-only layout inference. Adobe's character sequence is authoritative. */
(() => {
  'use strict';
  const compact=s=>String(s).replace(/\s/gu,'');
  const median=a=>{a=a.filter(Number.isFinite).sort((x,y)=>x-y);return a.length?a[Math.floor(a.length/2)]:0;};
  const modes=Object.freeze({JOIN_NO_SPACE:'JOIN_NO_SPACE',JOIN_SPACE:'JOIN_SPACE',PARAGRAPH_BREAK:'PARAGRAPH_BREAK',PRESERVE:'PRESERVE'});
  function extractPage(page,pageNumber){
    if(typeof page.toStructuredText!=='function')throw Error('PDF text layout API unavailable');
    const structured=page.toStructuredText('preserve-whitespace,preserve-spans,inhibit-spaces');
    const lines=[];let block=-1,line,blockBBox;
    try{
      if(typeof structured.walk!=='function')throw Error('PDF character layout API unavailable');
      structured.walk({
        beginTextBlock(bbox){block++;blockBBox=Array.from(bbox);},
        beginLine(bbox,wmode,direction){line={page:pageNumber,block,blockBBox,bbox:Array.from(bbox),wmode,direction:Array.from(direction),chars:[]};lines.push(line);},
        onChar(c,origin,font,size,quad){
          if(!line)return;
          line.chars.push({c,origin:Array.from(origin),size,quad:Array.from(quad),font:typeof font?.getName==='function'?font.getName():''});
        }
      });
      return {page:pageNumber,bounds:Array.from(page.getBounds()),lines:lines.filter(l=>l.chars.some(c=>compact(c.c)))};
    }finally{structured.destroy();}
  }
  function relation(a,b,group){
    const evidence=[];
    const size=median([...a.chars,...b.chars].map(c=>c.size))||1;
    if(a.page!==b.page)return {type:modes.PRESERVE,confidence:0,evidence:['page-transition-unresolved']};
    if(a.wmode||b.wmode||Math.abs(a.direction[1])>.05||Math.abs(b.direction[1])>.05||a.direction[0]<.9||b.direction[0]<.9)
      return {type:modes.PRESERVE,confidence:0,evidence:['non-horizontal-or-rotated']};
    const body=group.filter(l=>l.page===a.page&&Math.abs((median(l.chars.map(c=>c.size))||size)/size-1)<.2);
    const left=median(body.map(l=>l.bbox[0])),right=Math.max(...body.map(l=>l.bbox[2]));
    const advances=[];
    for(let i=1;i<body.length;i++){
      const p=body[i-1],q=body[i],dy=q.bbox[1]-p.bbox[1];
      if(p.block===q.block&&dy>.5*size&&dy<2.2*size&&Math.abs(p.bbox[0]-q.bbox[0])<2*size)advances.push(dy);
    }
    const baseline=median(advances)||size*1.2,dy=b.bbox[1]-a.bbox[1];
    if(dy<=size*.25)return {type:modes.PRESERVE,confidence:0,evidence:['same-row-or-reading-order-uncertain']};
    if(Math.abs(b.bbox[0]-a.bbox[0])>Math.max(size*4,(right-left)*.35))return {type:modes.PRESERVE,confidence:0,evidence:['column-or-layout-shift']};
    const newBlock=a.block!==b.block,largeGap=dy>baseline*1.5;
    const short=a.bbox[2]<right-Math.max(size*2,(right-left)*.16);
    const filled=a.bbox[2]>=right-Math.max(size,(right-left)*.04);
    const indent=b.bbox[0]>left+size*.7,aligned=Math.abs(a.bbox[0]-b.bbox[0])<size*.35;
    const aSize=median(a.chars.map(c=>c.size)),bSize=median(b.chars.map(c=>c.size));
    const fontChange=Math.abs(aSize/bSize-1)>.15||a.chars[0]?.font!==b.chars[0]?.font;
    const bullet=l=>/^\s*(?:[•●▪■\-–]|\(?\d+[.)]|[A-Za-z][.)])\s/u.test(l.chars.map(c=>c.c).join(''));
    if(newBlock)evidence.push('different-block');if(largeGap)evidence.push('relative-vertical-gap');
    if(short)evidence.push('short-previous-line');if(indent)evidence.push('next-line-indent');if(fontChange)evidence.push('font-change');
    if(bullet(b))evidence.push('list-start');
    if((largeGap&&(newBlock||short||indent))||(indent&&(short||newBlock)&&!bullet(a))||(fontChange&&(newBlock||largeGap))||(bullet(b)&&(newBlock||short||aligned)))
      return {type:modes.PARAGRAPH_BREAK,confidence:.85,evidence};
    // Hanging lists, page transitions and sparse evidence are deliberately not joined.
    if(!newBlock&&!fontChange&&!bullet(a)&&!bullet(b)&&filled&&aligned&&dy>baseline*.7&&dy<baseline*1.3&&advances.length>=2)
      return {type:'JOIN_CANDIDATE',confidence:.85,evidence:['same-block','matching-baseline','full-previous-line','normal-relative-line-spacing']};
    return {type:modes.PRESERVE,confidence:.25,evidence:[...evidence,'insufficient-evidence']};
  }
  async function reconstruct(raw,pages,join){
    const fallback=reason=>({text:raw,boundaries:[],hints:[],status:reason});
    const input=compact(raw);if(!input)return fallback('empty');
    const lines=pages.flatMap(p=>p.lines),stream=[];let all='';
    for(const l of lines)for(const ch of l.chars)for(const c of ch.c){if(!/\s/u.test(c)){stream.push({c,line:l,char:ch,offset:all.length});all+=c;}}
    const start=all.indexOf(input);
    if(start<0||all.indexOf(input,start+1)>=0)return fallback('selection-not-uniquely-aligned');
    const selected=stream.filter(c=>c.offset>=start&&c.offset<start+input.length);
    const originals=[...raw.matchAll(/\S/gu)],separators=new Map(),boundaries=[],hints=[];
    if(selected.length!==originals.length)return fallback('character-alignment-mismatch');
    const between=i=>raw.slice(originals[i].index+originals[i][0].length,originals[i+1].index);
    for(let i=0;i<selected.length-1;i++){
      const a=selected[i],b=selected[i+1],old=between(i);
      if(a.line===b.line)continue;
      let verdict=relation(a.line,b.line,lines);
      if(/(?:\r\n|\r|\n)[\t ]*(?:\r\n|\r|\n)/u.test(old))verdict={type:modes.PRESERVE,confidence:1,evidence:['explicit-paragraph-gap']};
      if(verdict.type===modes.PARAGRAPH_BREAK)separators.set(i,'\n\n');
      if(verdict.type==='JOIN_CANDIDATE'){
        const tail=a.line.chars.map(c=>c.c).join(''),head=b.line.chars.map(c=>c.c).join('');
        // Do not split or fuse ambiguous Latin/numeric tokens across a boundary.
        const protectedSeam=/[A-Za-z0-9/:+._-]$/u.test(tail.trim())&&/^[A-Za-z0-9/:+._-]/u.test(head.trim());
        const sep=protectedSeam?null:await join(tail.trimEnd(),head.trimStart());
        verdict.type=sep===''?modes.JOIN_NO_SPACE:sep===' '?modes.JOIN_SPACE:modes.PRESERVE;
        if(sep!=null)separators.set(i,sep);
      }
      boundaries.push({at:originals[i+1].index,...verdict});
    }
    // Gap outliers are hints only, limited to Hangul pairs. Uniform tracking is not a word boundary.
    for(const l of new Set(selected.map(s=>s.line))){
      if(l.wmode||Math.abs(l.direction[1])>.05||l.direction[0]<.9)continue;
      const candidates=[];
      for(let i=0;i<selected.length-1;i++){
        const a=selected[i],b=selected[i+1];if(a.line!==l||b.line!==l||a.char===b.char)continue;
        const size=(a.char.size+b.char.size)/2;
        const width=Math.abs(a.char.quad[2]-a.char.quad[0]);
        const gap=(b.char.origin[0]-a.char.origin[0]-width)/size;
        if(Number.isFinite(gap))candidates.push({i,gap});
      }
      if(candidates.length<8)continue;
      const mid=median(candidates.map(x=>x.gap)),mad=median(candidates.map(x=>Math.abs(x.gap-mid)));
      for(const {i,gap} of candidates){
        if(!/^[가-힣]$/u.test(selected[i].c)||!/^[가-힣]$/u.test(selected[i+1].c)||between(i)!=='')continue;
        if(gap>mid+Math.max(.3,mad*4)&&gap>Math.max(.4,mid*2.5)){
          separators.set(i,' ');hints.push({at:originals[i+1].index,relativeGap:gap,median:mid});
        }
      }
    }
    let text=raw.slice(0,originals[0].index);
    originals.forEach((m,i)=>{text+=m[0]+(i<originals.length-1?(separators.has(i)?separators.get(i):between(i)):raw.slice(m.index+m[0].length));});
    if(compact(text)!==input)return fallback('safety-mismatch');
    return {text,boundaries,hints,status:'aligned'};
  }
  window.PdfLayout=Object.freeze({extractPage,reconstruct,modes});
})();
