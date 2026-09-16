// 5golgyeo_word adapter. Upstream Kiwi core/binding are unchanged.
import {KiwiBuilder} from './upstream/kiwi-builder.js';
let kiwiPromise;
const compact=s=>s.replace(/\s/gu,'');
// Protect only contiguous notation spans; Korean text is still analyzed by Kiwi.
export function protectNotation(original,restored){
  if(compact(original)!==compact(restored))throw new Error('원문의 문자 변화가 감지되어 복원 결과를 적용하지 않았습니다.');
  const pattern=/https?:\/\/[^\s<>"'\uAC00-\uD7A3]+|(?:\d+\/)?\d+[dD]\d+(?:[+\-]\d+)?|[A-Za-z]+(?:['’\-][A-Za-z]+)*|\d+(?:[.,]\d+)*(?:[%]|(?:[+\-/]\d+)+)?/gu;
  const protectedBoundaries=new Set();
  for(const match of original.matchAll(pattern)){
    const start=compact(original.slice(0,match.index)).length;
    for(let i=1;i<compact(match[0]).length;i++)protectedBoundaries.add(start+i);
  }
  let offset=0,out='';
  for(const char of restored){
    if(/\s/u.test(char)){if(!protectedBoundaries.has(offset))out+=char;}
    else{out+=char;offset+=char.length;}
  }
  return out;
}
async function initialize(id){
  const start=performance.now();
  const builder=await KiwiBuilder.create(new URL('./upstream/kiwi-wasm.wasm',import.meta.url).href);
  const response=await fetch(new URL('./model_manifest.json',import.meta.url));
  if(!response.ok)throw new Error('모델 목록을 불러오지 못했습니다.');
  const manifest=await response.json(),modelFiles={};
  let completed=0;let cache=null;
  try{cache=await caches.open('5golgyeo_word_kiwi_models_v0_23_2');}catch{}
  await Promise.all(manifest.map(async file=>{
    let data=await cache?.match(file.url);
    if(!data){
      data=await fetch(file.url,{credentials:'omit',referrerPolicy:'no-referrer'});
      if(!data.ok)throw new Error(`공식 모델 다운로드 실패: ${file.name}`);
    }
    const bytes=new Uint8Array(await data.arrayBuffer());
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    if(bytes.length!==file.bytes||hash!==file.sha256){await cache?.delete(file.url);throw new Error(`공식 모델 무결성 확인 실패: ${file.name}`);}
    try{await cache?.put(file.url,new Response(bytes));}catch{}
    modelFiles[file.name]=bytes;completed++;
    self.postMessage({id,type:'status',message:`한국어 텍스트 복원기를 준비하는 중… 모델 ${completed}/${manifest.length}`});
  }));
  // TRPG-specific vocabulary Kiwi's shipped dictionary doesn't know (e.g. it
  // otherwise always splits "핸드아웃"/"암전" mid-word) goes in this plain
  // user dictionary instead of touching the upstream engine or model files.
  try{
    const dictResponse=await fetch(new URL('./user_dict.txt',import.meta.url));
    if(dictResponse.ok)modelFiles['user.dict']=new Uint8Array(await dictResponse.arrayBuffer());
  }catch{}
  const kiwi=await builder.build({modelFiles,modelType:'cong',loadTypoDict:false,userDicts:modelFiles['user.dict']?['user.dict']:undefined});
  return {kiwi,version:builder.version(),initMs:performance.now()-start};
}
// A literal '#' (item/handout numbering like "#1", "#7:") makes the upstream
// Kiwi WASM tokenizer give up on spacing for the rest of that line entirely -
// confirmed directly: "가나다#1라마바" comes back completely untouched, while
// "가나다1라마바" (same text, no '#') restores correctly. Swapping '#' for the
// full-width '＃' before calling space() and back afterward sidesteps this
// without touching Kiwi itself; a real '#' never survives a round trip
// through space() unmodified, so this substitution is otherwise invisible.
const HASH_PLACEHOLDER='＃';
function spaceSafe(kiwi,line){
  const safe=line.replace(/#/gu,HASH_PLACEHOLDER);
  return kiwi.space(safe,false).replace(new RegExp(HASH_PLACEHOLDER,'gu'),'#');
}
self.onmessage=async({data})=>{
  const {id,text}=data;
  try{
    if(typeof text!=='string'||text.length>30000)throw new Error('한 번에 30,000자 이하를 선택해 주세요.');
    if(!kiwiPromise)kiwiPromise=initialize(id).catch(error=>{kiwiPromise=null;throw error;});
    const state=await kiwiPromise,start=performance.now();
    // Stage 1 deliberately preserves all explicit line/paragraph boundaries.
    const result=text.split(/(\r\n|\r|\n)/u).map(line=>/^[\r\n]+$/u.test(line)||!line.trim()?line:protectNotation(line,spaceSafe(state.kiwi,line))).join('');
    self.postMessage({id,type:'result',text:result,version:state.version,initMs:state.initMs,spaceMs:performance.now()-start});
  }catch(error){self.postMessage({id,type:'error',message:error.message||'로컬 복원에 실패했습니다.'});}
};
