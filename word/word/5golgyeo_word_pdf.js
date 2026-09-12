console.info('[5golgyeo_word_pdf] build 20260912-pdf-restore-1');
(() => {
  'use strict';
  // Optional skin default. A value saved in Adobe settings takes precedence.
  const ADOBE_CLIENT_ID = '';
  const CLIENT_ID_KEY = '5golgyeo.adobePdfClientId';
  const $pdf=id=>document.getElementById(id);
  const input=$pdf('pdfInput'),shell=$pdf('pdfOfficialShell'),empty=$pdf('pdfEmpty');
  const imagesBtn=$pdf('pdfImagesBtn'),imageTray=$pdf('pdfImageTray');
  const imageList=$pdf('pdfImageThumbnails'),imageStatus=$pdf('pdfImageStatus');
  const preview=$pdf('pdfImagePreview'),message=$pdf('pdfViewerMessage');
  let adobeHost=$pdf('adobePdfView'),adobeAPIs=null,sdkPromise=null;
  let pdfFile=null,pdfBytes=null,documentGeneration=0,currentPage=1;
  let imageRequest=0,imageMode=false,muPdfLib=null,muPdfInitPromise=null,muDocument=null;
  let previewPage=null,cropSession=null,analysisTimer=null;
  let lineSelectActive=false,selectionRequest=0,lastSelection='';
  const cropHistory=new Map();
  // Local PDF persistence is confined to IndexedDB. No PDF bytes go to localStorage.
  const RECENT_PDF_DB='5golgyeo-local-pdf';
  let recentDbPromise=null,recentQueue=Promise.resolve(),recentEpoch=0,recentSettingsRevision=0;
  let activeRecentId=null,autoRestoreGeneration=null,restoringPageGeneration=null;
  function recentNotice(text){$pdf('pdfRecentStatus').textContent=text;}
  function recentFailure(error){
    const text='최근 PDF를 저장하거나 복원하지 못했습니다. 브라우저 저장 공간·권한을 확인해 주세요. PDF 보기는 계속 사용할 수 있습니다.';
    recentNotice(text);status(text);console.warn('[Local PDF storage]',error?.name||'StorageError');
  }
  function openRecentDb(){
    if(recentDbPromise)return recentDbPromise;
    recentDbPromise=new Promise((resolve,reject)=>{
      const request=indexedDB.open(RECENT_PDF_DB,1);
      request.onupgradeneeded=()=>{
        if(!request.result.objectStoreNames.contains('state'))request.result.createObjectStore('state');
      };
      request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(new Error('IndexedDB blocked'));
      request.onsuccess=()=>{
        const db=request.result;
        db.onversionchange=()=>{db.close();recentDbPromise=null;};
        resolve(db);
      };
    }).catch(error=>{recentDbPromise=null;throw error;});
    return recentDbPromise;
  }
  function recentTransaction(mode,action){
    // Enqueue at the time of the user action, so late writes cannot resurrect a deleted PDF.
    const job=recentQueue.then(async()=>{
      const db=await openRecentDb();
      return new Promise((resolve,reject)=>{
        const tx=db.transaction('state',mode),store=tx.objectStore('state');let result;
        tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error||new Error('Storage transaction aborted'));
        tx.onerror=()=>{};
        try{action(store,value=>{result=value;});}catch(error){tx.abort();reject(error);}
      });
    });
    recentQueue=job.catch(()=>{});
    return job;
  }
  function patchRecent(id,patch){
    return recentTransaction('readwrite',store=>{
      const request=store.get('last');
      request.onsuccess=()=>{
        const record=request.result;
        if(record&&(!id||record.id===id))store.put({...record,...patch},'last');
      };
    });
  }
  function rememberLocalPdf(file){
    activeRecentId=crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`;
    const record={id:activeRecentId,name:file.name||'document.pdf',lastModified:file.lastModified||Date.now(),page:1,resume:true};
    const epoch=recentEpoch;
    recentTransaction('readwrite',store=>{store.put(file,'file');store.put(record,'last');}).then(()=>{
      if(epoch===recentEpoch)recentNotice('마지막 PDF를 이 브라우저에 저장했습니다.');
    }).catch(recentFailure);
  }
  function rememberPdfPage(page){
    if(!activeRecentId||restoringPageGeneration===documentGeneration)return;
    patchRecent(activeRecentId,{page}).catch(recentFailure);
  }
  function cancelPendingPdfRestore(){
    if(autoRestoreGeneration===documentGeneration){
      closePdf({preserveRecent:true});activeRecentId=null;
    }
  }
  $pdf('pdfRestoreLast').addEventListener('change',()=>{
    recentEpoch++;recentSettingsRevision++;
    const enabled=$pdf('pdfRestoreLast').checked;
    if(!enabled)cancelPendingPdfRestore();
    recentTransaction('readwrite',store=>store.put({enabled},'settings')).then(()=>{
      recentNotice(enabled?'다음 새로고침부터 마지막 PDF를 다시 엽니다.':'새로고침 후 PDF를 자동으로 열지 않습니다.');
    }).catch(recentFailure);
  });
  $pdf('pdfForgetRecent').addEventListener('click',()=>{
    recentEpoch++;cancelPendingPdfRestore();activeRecentId=null;
    recentTransaction('readwrite',store=>{store.delete('last');store.delete('file');}).then(()=>{
      recentNotice('저장된 최근 PDF와 페이지 위치를 지웠습니다. 현재 열린 PDF는 계속 볼 수 있습니다.');
    }).catch(recentFailure);
  });
  async function restoreRecentPdf(){
    const epoch=recentEpoch,settingsRevision=recentSettingsRevision;
    try{
      const saved=await recentTransaction('readonly',(store,done)=>{
        const settings=store.get('settings'),last=store.get('last');
        last.onsuccess=()=>{
          const result={settings:settings.result,last:last.result};
          if(result.settings?.enabled&&result.last?.resume){
            const blob=store.get('file');blob.onsuccess=()=>done({...result,blob:blob.result});
          }else done(result);
        };
      });
      if(settingsRevision===recentSettingsRevision)$pdf('pdfRestoreLast').checked=!!saved.settings?.enabled;
      if(epoch!==recentEpoch)return;
      const record=saved.last;
      recentNotice(record?'최근 PDF가 이 브라우저에 저장되어 있습니다.':'저장된 최근 PDF가 없습니다.');
      if(!saved.settings?.enabled||!record?.resume||!(saved.blob instanceof Blob))return;
      const file=new File([saved.blob],record.name||'document.pdf',{type:'application/pdf',lastModified:record.lastModified||Date.now()});
      await openPdfFile(file,{restoreRecord:record});
    }catch(error){recentFailure(error);}
  }

  function status(text){
    if(typeof window.setStatus==='function')window.setStatus(text);
    else if($pdf('status'))$pdf('status').textContent=text;
  }
  function showMessage(text){message.textContent=text;message.hidden=!text;}
  function clientId(){try{return localStorage.getItem(CLIENT_ID_KEY)||ADOBE_CLIENT_ID;}catch{return ADOBE_CLIENT_ID;}}
  function showSettings(){
    $pdf('pdfAdobeClientId').value=clientId();
    $pdf('pdfAdobeSettingsStatus').textContent='';
    $pdf('pdfAdobeSettings').showModal();
  }
  $pdf('pdfAdobeSettingsBtn').addEventListener('click',showSettings);
  $pdf('pdfAdobeSave').addEventListener('click',()=>{
    const id=$pdf('pdfAdobeClientId').value.trim();
    try{localStorage.setItem(CLIENT_ID_KEY,id);}catch{
      $pdf('pdfAdobeSettingsStatus').textContent='브라우저 저장소를 사용할 수 없습니다. 브라우저의 사이트 저장소 설정을 확인해 주세요.';return;
    }
    $pdf('pdfAdobeSettings').close();
    if(pdfFile)openPdfFile(pdfFile);
  });
  function ensureOfficialViewer(){
    if(window.AdobeDC?.View)return Promise.resolve();
    if(sdkPromise)return sdkPromise;
    sdkPromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      let timer;
      const cleanup=()=>{clearTimeout(timer);document.removeEventListener('adobe_dc_view_sdk.ready',ready);script.onerror=null;};
      const ready=()=>{cleanup();resolve();};
      const failed=()=>{cleanup();script.remove();reject(new Error('Adobe 뷰어를 불러오지 못했습니다. 인터넷 연결을 확인하고 PDF를 다시 열어 주세요.'));};
      document.addEventListener('adobe_dc_view_sdk.ready',ready,{once:true});
      script.src='https://acrobatservices.adobe.com/view-sdk/viewer.js';script.async=true;
      script.onerror=failed;timer=setTimeout(failed,30000);document.head.append(script);
    }).catch(error=>{sdkPromise=null;throw error;});
    return sdkPromise;
  }
  function clearLineSelection(){selectionRequest++;lastSelection='';}
  window.__5golgyeoClearPdfLineSelection=clearLineSelection;
  window.__5golgyeoSetPdfLineSelectMode=active=>{lineSelectActive=!!active;clearLineSelection();};
  async function forwardSelection(generation){
    if(!lineSelectActive||!adobeAPIs)return;
    const request=++selectionRequest,apis=adobeAPIs;
    try{
      const result=await apis.getSelectedContent();
      if(generation!==documentGeneration||request!==selectionRequest||!lineSelectActive)return;
      const text=typeof result?.data==='string'?result.data:'';
      if(text.trim()&&text!==lastSelection){lastSelection=text;window.__5golgyeoPdfLineSelectionChanged?.(text);}
    }catch(error){if(generation===documentGeneration)console.warn('[Adobe selection]',error);}
  }
  function changePage(number){
    const page=Number(number);
    if(!Number.isInteger(page)||page<1||page===currentPage)return;
    currentPage=page;clearLineSelection();rememberPdfPage(page);
    if(imageMode){
      imageRequest++;clearTimeout(analysisTimer);clearPreview();imageList.replaceChildren();
      imageStatus.textContent=`${page}쪽 이미지 준비 중…`;
      analysisTimer=setTimeout(()=>{if(imageMode)refreshImageThumbnails();},120);
    }
  }
  function closePdf({preserveRecent=false}={}){
    if(!preserveRecent){
      recentEpoch++;patchRecent(activeRecentId,{resume:false}).catch(recentFailure);activeRecentId=null;
      recentNotice('PDF를 닫았습니다. 새로고침해도 자동으로 다시 열지 않습니다.');
    }
    autoRestoreGeneration=null;restoringPageGeneration=null;
    documentGeneration++;clearLineSelection();setImageTrayOpen(false);cropHistory.clear();
    pdfFile=null;pdfBytes=null;adobeAPIs=null;currentPage=1;
    const host=document.createElement('div');host.id='adobePdfView';host.className='adobe-pdf-view';host.setAttribute('aria-label','Adobe PDF 뷰어');
    adobeHost.replaceWith(host);adobeHost=host;
    shell.hidden=true;empty.hidden=false;input.value='';showMessage('');
  }
  async function openPdfFile(file,{restoreRecord=null}={}){
    if(!file)return;
    recentEpoch++;
    closePdf({preserveRecent:true});const generation=documentGeneration;pdfFile=file;
    if(restoreRecord){
      activeRecentId=restoreRecord.id;autoRestoreGeneration=generation;restoringPageGeneration=generation;
    }else rememberLocalPdf(file);
    shell.hidden=false;empty.hidden=true;showMessage('PDF 불러오는 중…');
    if(!clientId()){showMessage('Adobe 설정에서 이 사이트 도메인의 Client ID를 입력해 주세요.');showSettings();return;}
    try{
      const bytes=await file.arrayBuffer();
      if(generation!==documentGeneration)return;
      pdfBytes=bytes;
      await ensureOfficialViewer();
      if(generation!==documentGeneration)return;
      // A unique mount prevents an obsolete asynchronous preview from targeting a newer file.
      adobeHost.id=`adobePdfView-${generation}`;
      const view=new window.AdobeDC.View({clientId:clientId(),divId:adobeHost.id,sendAutoPDFAnalytics:false});
      view.registerCallback(window.AdobeDC.View.Enum.CallbackType.EVENT_LISTENER,event=>{
        if(generation!==documentGeneration)return;
        if(event.type==='CURRENT_ACTIVE_PAGE'||event.type==='PAGE_VIEW')changePage(event.data?.pageNumber);
        if(event.type==='PREVIEW_SELECTION_END')forwardSelection(generation);
        if(event.type==='APP_RENDERING_DONE')showMessage('');
        if(event.type==='APP_RENDERING_FAILED')showMessage('PDF를 표시하지 못했습니다. Client ID·등록 도메인과 PDF 파일을 확인한 뒤 다시 열어 주세요.');
      },{enablePDFAnalytics:true,enableFilePreviewEvents:true,listenOn:['CURRENT_ACTIVE_PAGE','PAGE_VIEW','PREVIEW_SELECTION_END','APP_RENDERING_DONE','APP_RENDERING_FAILED']});
      // Do not cover Adobe's own authentication/password/error dialogs while it loads.
      showMessage('');
      const viewer=await view.previewFile({content:{promise:Promise.resolve(bytes.slice(0))},metaData:{fileName:file.name}},
        {embedMode:'FULL_WINDOW',defaultViewMode:'FIT_WIDTH',showAnnotationTools:true,enableFormFilling:true,showDownloadPDF:true,showPrintPDF:true});
      if(generation!==documentGeneration)return;
      const apis=await viewer.getAPIs();
      if(generation!==documentGeneration)return;
      adobeAPIs=apis;
      if(restoreRecord){
        const target=Number(restoreRecord.page);
        try{
          if(Number.isInteger(target)&&target>1)await apis.gotoLocation(target);
        }catch(error){
          if(generation===documentGeneration)recentNotice('PDF를 복원했지만 이전 페이지로 이동하지 못했습니다. Adobe 페이지 이동을 사용해 주세요.');
        }
        if(generation!==documentGeneration)return;
        restoringPageGeneration=null;autoRestoreGeneration=null;
      }
      try{const page=await apis.getCurrentPage();if(generation===documentGeneration)changePage(page);}catch{}
      if(generation===documentGeneration){rememberPdfPage(currentPage);status(`PDF 열림 · ${file.name}`);}
    }catch(error){
      if(generation!==documentGeneration)return;
      console.warn('[Adobe PDF]',error);
      showMessage('PDF를 표시하지 못했습니다. Adobe 설정의 Client ID·등록 도메인과 인터넷 연결을 확인하고 다시 열어 주세요.');
    }
  }
  async function ensureMuPdf(){
    if(muPdfLib)return muPdfLib;
    if(!muPdfInitPromise)muPdfInitPromise=import('https://cdn.jsdelivr.net/npm/mupdf@1.28.1/dist/mupdf.js')
      .then(mu=>{muPdfLib=mu;return mu;}).catch(error=>{muPdfInitPromise=null;throw error;});
    return muPdfInitPromise;
  }
  function pixmapToCanvas(pixmap){
    const width=pixmap.getWidth(),height=pixmap.getHeight();
    if(!width||!height)return null;
    const n=pixmap.getNumberOfComponents(),hasAlpha=!!pixmap.getAlpha();
    const raw=pixmap.getPixels();
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d'),out=ctx.createImageData(width,height),dst=out.data;
    const colorN=hasAlpha?n-1:n;
    for(let i=0,p=0,d=0;i<width*height;i++,p+=n,d+=4){
      if(colorN<=1){
        const v=raw[p];
        dst[d]=v;dst[d+1]=v;dst[d+2]=v;dst[d+3]=hasAlpha?raw[p+colorN]:255;
      }else{
        dst[d]=raw[p];dst[d+1]=raw[p+1];dst[d+2]=raw[p+2];dst[d+3]=hasAlpha?raw[p+3]:255;
      }
    }
    ctx.putImageData(out,0,0);
    return canvas;
  }

  /* placement.color가 있으면 스텐실 마스크(단색 도장 이미지) → 커버리지를 알파로,
     지정된 채우기 색을 RGB로 써서 칠한다. 없으면 일반 이미지 → DeviceRGB로 정규화 후 그린다. */
  function mupdfImagePayload(placement,pageNumber){
    const mu=muPdfLib;
    if(!mu||!placement?.image)return null;
    let pixmap=null,owned=null;
    try{
      pixmap=placement.image.toPixmap();
      if(placement.color){
        const width=pixmap.getWidth(),height=pixmap.getHeight();
        if(!width||!height)return null;
        const n=pixmap.getNumberOfComponents();
        const raw=pixmap.getPixels();
        const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
        const ctx=canvas.getContext('2d'),out=ctx.createImageData(width,height),dst=out.data;
        const [r,g,b]=placement.color.length>=3?placement.color.map(c=>Math.max(0,Math.min(255,Math.round(c*255)))):[0,0,0];
        for(let i=0,p=0,d=0;i<width*height;i++,p+=n,d+=4){
          dst[d]=r;dst[d+1]=g;dst[d+2]=b;dst[d+3]=raw[p];
        }
        ctx.putImageData(out,0,0);
        return {src:canvas.toDataURL('image/png'),width,height,source:'original',pageNumber};
      }
      try{
        owned=pixmap.convertToColorSpace(mu.ColorSpace.DeviceRGB,true);
        pixmap.destroy?.();pixmap=owned;owned=null;
      }catch(convErr){
        console.warn('[MuPDF colorspace convert]',convErr);
      }
      const canvas=pixmapToCanvas(pixmap);
      if(!canvas)return null;
      return {src:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height,source:'original',pageNumber};
    }catch(err){
      console.warn('[MuPDF image payload]',err);
      return null;
    }finally{
      pixmap?.destroy?.();
    }
  }

  function insertThumbnail(payload,button){
    const ok=window.__5golgyeoInsertPdfImage?.(payload.src,payload.width,payload.height,null,payload);
    if(ok){
      imageList.querySelectorAll('button').forEach(el=>el.setAttribute('aria-pressed',String(el===button)));
      status(`PDF 이미지 삽입 완료 · ${payload.width}×${payload.height}px`);
    }else status('이미지를 삽입하지 못했습니다. 본문 편집기가 준비되었는지 확인해 주세요.');
  }

  let nativeImagePointerDrag=null;

  function getEditorDropElement(){
    return document.querySelector(".ck-editor__editable") || document.getElementById("editor");
  }

  function removeNativeImageDragGhost(){
    nativeImagePointerDrag?.ghost?.remove?.();
    nativeImagePointerDrag=null;
    getEditorDropElement()?.classList.remove("pdf-image-drop-target");
  }

  function editorContainsPoint(clientX,clientY){
    const ed=getEditorDropElement();
    if(!ed)return false;
    const r=ed.getBoundingClientRect();
    return clientX>=r.left&&clientX<=r.right&&clientY>=r.top&&clientY<=r.bottom;
  }

  function startNativeImagePointerDrag(e,payload,hot,thumbnail=false){
    if(!payload?.src)return;
    e.preventDefault();
    e.stopPropagation();

    const ghost=document.createElement("img");
    ghost.src=payload.src;
    ghost.alt="";
    Object.assign(ghost.style,{
      position:"fixed",
      zIndex:"100000",
      left:(e.clientX+14)+"px",
      top:(e.clientY+14)+"px",
      width:"96px",
      height:"96px",
      objectFit:"contain",
      pointerEvents:"none",
      border:"1px solid rgba(47,102,232,.65)",
      borderRadius:"6px",
      background:"#fff",
      boxShadow:"0 6px 22px rgba(0,0,0,.24)",
      opacity:".92"
    });
    document.body.appendChild(ghost);

    nativeImagePointerDrag={
      pointerId:e.pointerId,
      payload,
      ghost,
      hot,thumbnail,startX:e.clientX,startY:e.clientY,moved:false
    };
    try{hot.setPointerCapture(e.pointerId);}catch{}
  }

  function moveNativeImagePointerDrag(e){
    const d=nativeImagePointerDrag;
    if(!d||d.pointerId!==e.pointerId)return;
    if(Math.hypot(e.clientX-d.startX,e.clientY-d.startY)>5)d.moved=true;
    d.ghost.style.left=(e.clientX+14)+"px";
    d.ghost.style.top=(e.clientY+14)+"px";
    getEditorDropElement()?.classList.toggle(
      "pdf-image-drop-target",
      editorContainsPoint(e.clientX,e.clientY)
    );
  }

  function finishNativeImagePointerDrag(e){
    const d=nativeImagePointerDrag;
    if(!d||d.pointerId!==e.pointerId)return;

    const overEditor=editorContainsPoint(e.clientX,e.clientY);
    const payload=d.payload;
    removeNativeImageDragGhost();

    if(d.thumbnail&&!d.moved){insertThumbnail(payload,d.hot);return;}

    if(!overEditor){
      status("이미지 드래그를 취소했습니다.");
      return;
    }

    const ed=getEditorDropElement();
    let range=null;
    if(document.caretRangeFromPoint){
      const r=document.caretRangeFromPoint(e.clientX,e.clientY);
      if(r&&ed?.contains(r.startContainer))range=r;
    }else if(document.caretPositionFromPoint){
      const p=document.caretPositionFromPoint(e.clientX,e.clientY);
      if(p&&ed?.contains(p.offsetNode)){
        range=document.createRange();
        range.setStart(p.offsetNode,p.offset);
        range.collapse(true);
      }
    }

    if(typeof window.__5golgyeoInsertPdfImage==="function"){
      const ok=window.__5golgyeoInsertPdfImage(payload.src,payload.width,payload.height,range,payload);
      status(ok
        ? `PDF 원본 이미지 삽입 완료 · ${payload.width}×${payload.height}px`
        : "PDF 이미지를 삽입하지 못했습니다.");
    }
  }

  function clearPreview(){
    cancelCrop();removeNativeImageDragGhost();
    preview.querySelectorAll('canvas').forEach(canvas=>{canvas.width=0;canvas.height=0;});
    preview.replaceChildren();previewPage=null;
    $pdf('pdfCropStart').disabled=true;
  }
  function setImageTrayOpen(open){
    if(open&&(!pdfBytes||!adobeAPIs)){status('Adobe에서 PDF를 먼저 열어 주세요.');return;}
    imageMode=!!open;imageRequest++;clearTimeout(analysisTimer);
    clearPreview();imageList.replaceChildren();
    imageTray.hidden=!open;$pdf('pdfPane').classList.toggle('images-open',open);
    imagesBtn.setAttribute('aria-expanded',String(open));
    if(!open){try{muDocument?.destroy();}catch{}muDocument=null;}
    else refreshImageThumbnails();
  }
  function currentRequest(request,generation){return imageMode&&request===imageRequest&&generation===documentGeneration;}
  function bindImageButton(button,payload){
    button.addEventListener('pointerdown',e=>{if(e.button===0&&imageMode)startNativeImagePointerDrag(e,payload,button,true);});
    button.addEventListener('pointermove',moveNativeImagePointerDrag);
    button.addEventListener('pointerup',finishNativeImagePointerDrag);
    button.addEventListener('pointercancel',removeNativeImageDragGhost);
    button.addEventListener('lostpointercapture',removeNativeImageDragGhost);
    button.addEventListener('click',e=>{if(e.detail===0&&imageMode)insertThumbnail(payload,button);});
  }
  function addThumbnail(payload,index){
    const button=document.createElement('button');button.type='button';button.className='pdf-image-thumbnail';
    button.setAttribute('aria-pressed','false');
    button.setAttribute('aria-label',`${payload.pageNumber}쪽 이미지 ${index+1}, ${payload.width}×${payload.height}, 본문에 삽입`);
    const img=document.createElement('img');img.src=payload.src;img.alt='';img.draggable=false;
    const label=document.createElement('span');label.textContent=`${payload.source==='crop'?'페이지 잘라오기':'원본 객체'} · ${payload.width}×${payload.height}`;
    button.dataset.source=payload.source;button.title=payload.detail||label.textContent;button.append(img,label);
    bindImageButton(button,payload);imageList.append(button);
  }
  function renderMuPage(page,maxScale=1.5){
    const bounds=page.getBounds(),width=bounds[2]-bounds[0],height=bounds[3]-bounds[1];
    if(!(width>0&&height>0))throw new Error('Invalid page size');
    const scale=Math.min(maxScale,Math.sqrt(12000000/(width*height)),8192/Math.max(width,height));
    // Translation handles nonzero crop-box origins; MuPDF already applies page rotation.
    const matrix=[scale,0,0,scale,-bounds[0]*scale,-bounds[1]*scale];
    const pixmap=page.toPixmap(matrix,muPdfLib.ColorSpace.DeviceRGB,false,false);
    try{return {canvas:pixmapToCanvas(pixmap),bounds,scale};}finally{pixmap.destroy();}
  }
  function addHotspot(layer,placement,bounds){
    if(!placement.payload)return;
    const [a,b,c,d,e,f]=placement.ctm;
    const points=[[e,f],[a+e,b+f],[c+e,d+f],[a+c+e,b+d+f]];
    const left=Math.max(bounds[0],Math.min(...points.map(p=>p[0]))),right=Math.min(bounds[2],Math.max(...points.map(p=>p[0])));
    const top=Math.max(bounds[1],Math.min(...points.map(p=>p[1]))),bottom=Math.min(bounds[3],Math.max(...points.map(p=>p[1])));
    if(right<=left||bottom<=top)return;
    const width=bounds[2]-bounds[0],height=bounds[3]-bounds[1];
    const hot=document.createElement('div');hot.className='pdf-native-image-hotspot';
    Object.assign(hot.style,{left:(left-bounds[0])/width*100+'%',top:(top-bounds[1])/height*100+'%',width:(right-left)/width*100+'%',height:(bottom-top)/height*100+'%'});
    const handle=document.createElement('button');handle.type='button';handle.className='pdf-native-image-hotspot-handle';
    handle.title='클릭하여 삽입하거나 본문으로 끌어오세요.';handle.setAttribute('aria-label','이 이미지를 본문에 삽입');
    bindImageButton(handle,placement.payload);hot.append(handle);layer.append(hot);
  }
  async function refreshImageThumbnails(){
    if(!imageMode||!pdfBytes||!adobeAPIs)return;
    const request=++imageRequest,generation=documentGeneration;
    clearPreview();imageList.replaceChildren();imageStatus.textContent='현재 페이지 이미지 준비 중…';
    try{
      const pageNumber=Number(await adobeAPIs.getCurrentPage());
      if(!currentRequest(request,generation))return;
      if(!Number.isInteger(pageNumber)||pageNumber<1)throw new Error('Current page unavailable');
      currentPage=pageNumber;
      const mu=await ensureMuPdf();
      if(!currentRequest(request,generation))return;
      if(!muDocument){
        const doc=mu.Document.openDocument(new Uint8Array(pdfBytes.slice(0)),'application/pdf');
        if(doc.needsPassword()){
          const password=window.prompt('이미지 가져오기에 사용할 PDF 암호를 입력해 주세요.');
          if(password===null||!doc.authenticatePassword(password)){doc.destroy();throw new Error('PDF 암호가 필요하거나 올바르지 않습니다.');}
        }
        muDocument=doc;
      }
      if(pageNumber>muDocument.countPages())throw new Error('Invalid page number');
      const page=muDocument.loadPage(pageNumber-1),placements=[];
      let rendered,device;
      try{
        rendered=renderMuPage(page);
        // Convert inside callbacks: the temporary native image handles never escape the Device call.
        device=new mu.Device({
          fillImage(image,ctm){placements.push({ctm:ctm.slice(),payload:mupdfImagePayload({image},pageNumber)});},
          fillImageMask(image,ctm,colorspace,color){
            placements.push({ctm:ctm.slice(),payload:mupdfImagePayload({image,color:color||[0,0,0]},pageNumber)});
          }
        });
        page.runPageContents(device,mu.Matrix.identity);
      }finally{try{device?.close();}finally{device?.destroy();page.destroy();}}
      if(!currentRequest(request,generation)){if(rendered?.canvas){rendered.canvas.width=0;rendered.canvas.height=0;}return;}
      preview.append(rendered.canvas);previewPage={pageNumber,generation,bounds:rendered.bounds};
      const layer=document.createElement('div');layer.className='pdf-image-hotspot-layer';preview.append(layer);
      placements.forEach(p=>addHotspot(layer,p,rendered.bounds));
      const unique=[...new Map(placements.filter(p=>p.payload).map(p=>[p.payload.src,p.payload])).values(),...(cropHistory.get(pageNumber)||[])];
      unique.forEach(addThumbnail);
      const failed=placements.filter(p=>!p.payload).length;
      imageStatus.textContent=`${pageNumber}쪽 · ${unique.length}개 이미지`+(failed?` · ${failed}개 추출 실패`:'');
      $pdf('pdfCropStart').disabled=false;
    }catch(error){
      if(!currentRequest(request,generation))return;
      clearPreview();console.warn('[PDF images]',error);
      imageStatus.textContent='이미지 준비 실패 · '+(error.message||'패널을 닫고 다시 열어 주세요.');
    }
  }
  function cancelCrop(){
    cropSession?.overlay?.remove();cropSession=null;
    $pdf('pdfCropControls').hidden=true;$pdf('pdfCropStart').disabled=!previewPage;
  }
  function cropPoint(e,overlay){
    const r=overlay.getBoundingClientRect();
    return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};
  }
  async function finishCrop(session,a,b){
    session.rendering=true;
    let canvas,crop,page;
    try{
      // Yield before expensive rendering so closing the panel cancels a queued crop.
      await new Promise(resolve=>setTimeout(resolve,0));
      if(cropSession!==session||!imageMode||session.generation!==documentGeneration||!muDocument)return;
      page=muDocument.loadPage(session.pageNumber-1);
      const rendered=renderMuPage(page,3);canvas=rendered.canvas;
      const x=Math.max(0,Math.floor(Math.min(a.x,b.x)*canvas.width)),y=Math.max(0,Math.floor(Math.min(a.y,b.y)*canvas.height));
      const right=Math.min(canvas.width,Math.ceil(Math.max(a.x,b.x)*canvas.width)),bottom=Math.min(canvas.height,Math.ceil(Math.max(a.y,b.y)*canvas.height));
      crop=document.createElement('canvas');crop.width=right-x;crop.height=bottom-y;
      if(!crop.width||!crop.height)return;
      crop.getContext('2d').drawImage(canvas,x,y,crop.width,crop.height,0,0,crop.width,crop.height);
      const payload={src:crop.toDataURL('image/png'),width:crop.width,height:crop.height,source:'crop',pageNumber:session.pageNumber,detail:`페이지 잘라오기 · ${Math.round(rendered.scale*72)} DPI`,rect:[x,y,right,bottom]};
      const history=cropHistory.get(session.pageNumber)||[];history.push(payload);cropHistory.set(session.pageNumber,history);
      cancelCrop();addThumbnail(payload,imageList.children.length);insertThumbnail(payload,null);
      imageStatus.textContent=`${session.pageNumber}쪽 · ${imageList.children.length}개 이미지`;
    }catch(error){if(cropSession===session){cancelCrop();status('영역을 가져오지 못했습니다. 다시 선택해 주세요.');console.warn('[PDF crop]',error);}}
    finally{page?.destroy();if(canvas){canvas.width=0;canvas.height=0;}if(crop){crop.width=0;crop.height=0;}}
  }
  function startCrop(){
    cancelCrop();
    if(!imageMode||!previewPage||!muDocument)return;
    const overlay=document.createElement('div');overlay.className='pdf-crop-overlay';
    const rectangle=document.createElement('div');rectangle.className='pdf-crop-rectangle';rectangle.hidden=true;overlay.append(rectangle);
    const session={pageNumber:previewPage.pageNumber,generation:documentGeneration,overlay,pointerId:null};
    cropSession=session;preview.append(overlay);$pdf('pdfCropControls').hidden=false;$pdf('pdfCropStart').disabled=true;
    preview.scrollIntoView({block:'nearest'});
    let a=null,b=null;
    overlay.addEventListener('pointerdown',e=>{
      if(e.button!==0||session.rendering||session.pointerId!==null)return;
      e.preventDefault();e.stopPropagation();session.pointerId=e.pointerId;overlay.setPointerCapture(e.pointerId);
      a=b=cropPoint(e,overlay);rectangle.hidden=false;rectangle.style.cssText=`left:${a.x*100}%;top:${a.y*100}%;width:0;height:0`;
    });
    overlay.addEventListener('pointermove',e=>{
      if(session.pointerId!==e.pointerId||!a)return;e.preventDefault();b=cropPoint(e,overlay);
      Object.assign(rectangle.style,{left:Math.min(a.x,b.x)*100+'%',top:Math.min(a.y,b.y)*100+'%',width:Math.abs(a.x-b.x)*100+'%',height:Math.abs(a.y-b.y)*100+'%'});
    });
    overlay.addEventListener('pointerup',e=>{
      if(session.pointerId!==e.pointerId||!a)return;e.preventDefault();e.stopPropagation();b=cropPoint(e,overlay);
      session.pointerId=null;const r=overlay.getBoundingClientRect();
      if(Math.abs(a.x-b.x)*r.width<4||Math.abs(a.y-b.y)*r.height<4){a=null;rectangle.hidden=true;status('조금 더 큰 영역을 선택해 주세요.');return;}
      finishCrop(session,a,b);a=null;
    });
    overlay.addEventListener('pointercancel',cancelCrop);
    overlay.addEventListener('lostpointercapture',()=>{if(session.pointerId!==null)cancelCrop();});
  }

  $pdf('pdfCropStart').addEventListener('click',startCrop);
  $pdf('pdfCropCancel').addEventListener('click',cancelCrop);
  $pdf('docTabStrip').addEventListener('click',cancelCrop);
  $pdf('addMainTabBtn').addEventListener('click',cancelCrop);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&cropSession){e.preventDefault();cancelCrop();}},true);
  $pdf('openPdfBtn').addEventListener('click',()=>input.click());
  input.addEventListener('change',()=>{const file=input.files?.[0];if(file)openPdfFile(file);});
  $pdf('clearPdfBtn').addEventListener('click',closePdf);
  imagesBtn.addEventListener('click',()=>setImageTrayOpen(imageTray.hidden));
  $pdf('pdfImagesClose').addEventListener('click',()=>setImageTrayOpen(false));
  window.__5golgyeoPdf={openPdfFile,closePdf,ensureOfficialViewer};
  restoreRecentPdf();
})();
