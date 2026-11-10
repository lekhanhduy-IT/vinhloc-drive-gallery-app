/* v3.1.78: Keep decoded thumbnails and aspect ratios when returning to a folder.
   Key by authenticated account + parent folder + Drive item + media revision.
   Never cache a whole card (menu/selection/permissions must be freshly rendered).
   No blob data, token, or private image bytes enter Redis/localStorage. */
(() => {
 'use strict';
 if(window.__vlReturnThumbnailContinuity)return;
 window.__vlReturnThumbnailContinuity=true;
 const folderList=document.getElementById('folderList');
 const fileList=document.getElementById('fileList');
 if(!folderList||!fileList)return;
 const ID=/^[A-Za-z0-9_-]{10,180}$/;
 const MAX_IMAGES=96, MAX_AGE=8*60*1000;
 const images=new Map();
 const ratios=new Map();
 const RATIO_STORAGE='vl-preview-dimensions-v1:';
 let scope='',ratioSaveTimer=null;
 function accountScope(){
   let email='';
   try{email=(localStorage.getItem('vinhloc_authenticated_email')||'').toLowerCase();}catch(_){}
   const shared=window.vlShareScope;
   return (shared?'share:'+String(shared.root||'')+':'+String(shared.viewerEmail||''):'member')+':'+email;
 }
 function currentFolder(){
   try{
     const id=typeof currentFolderId!=='undefined'?currentFolderId:window.currentFolderId;
     return ID.test(String(id||''))?String(id):'';
   }catch(_){return String(window.currentFolderId||'');}
 }
 function cacheKey(kind,folderId,id){
   return scope+'|'+folderId+'|'+kind+'|'+id;
 }
 function resetScope(){
   const next=accountScope();
   if(next===scope)return;
   images.clear();ratios.clear();scope=next;
   try{
     const stored=JSON.parse(sessionStorage.getItem(RATIO_STORAGE+scope)||'{}');
     for(const [id,rect] of Object.entries(stored)){
       if(ID.test(id)&&Number.isInteger(rect?.w)&&Number.isInteger(rect?.h)&&
          rect.w>0&&rect.h>0)ratios.set(id,rect);
     }
   }catch(_){}
 }
 function persistRatios(){
   if(ratioSaveTimer!==null)return;
   ratioSaveTimer=setTimeout(()=>{
     ratioSaveTimer=null;
     try{sessionStorage.setItem(RATIO_STORAGE+scope,JSON.stringify(
       Object.fromEntries([...ratios].slice(-400))
     ));}catch(_){}
   },200);
 }
 function imageItemId(img,kind,context){
   if(kind==='folder'){
     for(const c of img.classList){
       if(c.startsWith('item-cover-img-')){
         const id=c.slice('item-cover-img-'.length);
         if(ID.test(id))return id;
       }
     }
     return '';
   }
   for(let node=img;node;node=node.parentElement){
     const marker=node.querySelector?.('[id^="menu-"]');
     if(marker){
       const id=marker.id.slice(5);
       if(ID.test(id))return id;
     }
     if(node===fileList)break;
   }
   for(let node=context;node;node=node.parentElement){
     const marker=node.querySelector?.('[id^="menu-"]');
     if(marker&&ID.test(marker.id.slice(5)))return marker.id.slice(5);
     if(node===fileList)break;
   }
   return '';
 }
 function sourceIdentity(img){
   const raw=img.getAttribute('src')||img.getAttribute('data-url')||'';
   if(!raw)return '';
   if(raw.startsWith('blob:')||raw.startsWith('data:'))return raw.slice(0,25);
   try{
     const u=new URL(raw,location.href);
     return u.searchParams.get('fileId')||u.searchParams.get('id')||
       u.pathname.match(/\/file\/d\/([\w-]+)/)?.[1]||'';
   }catch(_){return '';}
 }
 function revision(folderId,id,kind){
   if(kind==='folder'){
     try{
       const value=JSON.parse(localStorage.getItem('vl_folder_covers_v2')||'{}');
       return String(value[id]?.imageId||'');
     }catch(_){return '';}
   }
   try{
     const data=typeof folderDataCache!=='undefined'?folderDataCache:window.folderDataCache;
     const item=data?.[folderId]?.find?.(x=>x.id===id);
     if(!item || item.isPending || item.isGhostPaste)return '';
     return [item.modifiedTime||'',item.md5Checksum||'',item.size||'',
       item.thumbnailVersion||''].join('|');
   }catch(_){return '';}
 }
 function selectors(node,kind){
   if(node?.nodeType!==1)return [];
   const selector=kind==='folder'?'img[class*="item-cover-img-"]':'img.drive-img-item';
   const hits=node.matches?.(selector)?[node]:[];
   return hits.concat([...node.querySelectorAll?.(selector)||[]]);
 }
 function saveRatio(id,img){
   if(!ID.test(id)||!img.naturalWidth||!img.naturalHeight)return;
   const w=img.naturalWidth,h=img.naturalHeight,previous=ratios.get(id);
   if(previous?.w===w&&previous?.h===h)return;
   ratios.delete(id);ratios.set(id,{w,h});persistRatios();
 }
 function capture(node,kind,folderId,context){
   if(!ID.test(folderId))return;
   for(const img of selectors(node,kind)){
     if(!img.complete||img.naturalWidth<1||!img.getAttribute('src'))continue;
     const id=imageItemId(img,kind,context);
     if(!ID.test(id))continue;
     if(kind==='file')saveRatio(id,img);
     const key=cacheKey(kind,folderId,id);
     images.delete(key);
     images.set(key,{img,at:Date.now(),media:sourceIdentity(img),
       revision:revision(folderId,id,kind)});
     while(images.size>MAX_IMAGES)images.delete(images.keys().next().value);
   }
 }
 function markPreview(img,id){
   if(!ID.test(id))return;
   const frame=img.parentElement;
   if(!frame?.classList?.contains('h-32'))return;
   const ratio=ratios.get(id);
   if(ratio){
     if(img.getAttribute('width')!==String(ratio.w))img.setAttribute('width',ratio.w);
     if(img.getAttribute('height')!==String(ratio.h))img.setAttribute('height',ratio.h);
   }
   if(img.complete&&img.naturalWidth>0){
     saveRatio(id,img);
     frame.removeAttribute('data-vl-preview-pending');
     frame.style.removeProperty('--vl-preview-ratio');
     return;
   }
   if(img.getAttribute('src')?.startsWith('blob:'))return;
   frame.dataset.vlPreviewPending='1';
   if(ratio)frame.style.setProperty('--vl-preview-ratio',ratio.w+' / '+ratio.h);
   else frame.style.removeProperty('--vl-preview-ratio');
   if(img.dataset.vlRatioWatch==='1')return;
   img.dataset.vlRatioWatch='1';
   img.addEventListener('load',()=>{
     if(img.naturalWidth<1)return;
     saveRatio(id,img);
     frame.removeAttribute('data-vl-preview-pending');
     frame.style.removeProperty('--vl-preview-ratio');
   });
 }
 function restore(node,kind,folderId,context){
   if(!ID.test(folderId))return;
   for(const incoming of selectors(node,kind)){
     const id=imageItemId(incoming,kind,context);
     if(!ID.test(id))continue;
     if(kind==='file')markPreview(incoming,id);
     if(incoming.complete&&incoming.naturalWidth>0)continue;
     const key=cacheKey(kind,folderId,id),saved=images.get(key);
     if(!saved || saved.img===incoming || saved.img.isConnected ||
         !saved.img.complete || saved.img.naturalWidth<1 ||
         Date.now()-saved.at>MAX_AGE)continue;
     const previous=revision(folderId,id,kind);
     if(previous&&saved.revision&&previous!==saved.revision)continue;
     const incomingSource=sourceIdentity(incoming);
     if(incomingSource&&saved.media&&incomingSource!==saved.media)continue;
     images.delete(key);
     // Only preserve the decoded IMG. New cards, action menus, and
     // permission/selection state always come from the current renderer.
     const decoded=saved.img;
     decoded.className=incoming.className;
     decoded.alt=incoming.alt||decoded.alt;
     decoded.classList.remove('hidden');
     decoded.style.visibility='';
     decoded.style.opacity='';
     if(kind==='file'){
       if(decoded.parentElement?.classList?.contains('h-32')){
         decoded.parentElement.removeAttribute('data-vl-preview-pending');
         decoded.parentElement.style.removeProperty('--vl-preview-ratio');
       }
       incoming.replaceWith(decoded);
       saveRatio(id,decoded);
       const frame=decoded.parentElement;
       frame?.removeAttribute('data-vl-preview-pending');
       frame?.style?.removeProperty('--vl-preview-ratio');
     }else{
       incoming.replaceWith(decoded);
       const icons=folderList.querySelectorAll('.item-cover-icon-'+CSS.escape(id));
       for(const icon of icons)icon.classList.add('hidden');
     }
   }
 }
 let trackedFolder=currentFolder();
 resetScope();
 function observe(list,kind){
   new MutationObserver(records=>{
     if(accountScope()!==scope){resetScope();trackedFolder=currentFolder();return;}
     const previous=trackedFolder||currentFolder(),next=currentFolder()||previous;
     // Mutation records retain detached card descendants. Capture all old
     // decoded images BEFORE matching them to newly created placeholders.
     for(const record of records){
       for(const node of record.removedNodes)capture(node,kind,previous,record.target);
     }
     trackedFolder=next;
     for(const record of records){
       for(const node of record.addedNodes)restore(node,kind,next,record.target);
     }
   }).observe(list,{childList:true,subtree:true});
 }
 observe(folderList,'folder');
 observe(fileList,'file');
 // Remember live decoded nodes before navigation; no reparenting, no paint.
 function rememberVisible(){
   const id=currentFolder();
   if(!ID.test(id))return;
   resetScope();
   for(const node of folderList.children)capture(node,'folder',id,folderList);
   for(const node of fileList.children)capture(node,'file',id,fileList);
   trackedFolder=id;
 }
 document.addEventListener('click',event=>{
   if(event.target?.closest?.('#btnBack,.subfolder-row,.mega-row,.mega-header,[onclick*="loadFolder"]'))
     rememberVisible();
 },true);
 window.addEventListener('pagehide',()=>{
   // Do not persist decoded private pixels; only dimensions are session-scoped.
   images.clear();
 });
 window.addEventListener('storage',event=>{
   if(event.key==='vinhloc_authenticated_email')resetScope();
 });
 document.addEventListener('vl:delete-start',()=>images.clear());
 window.vlReturnThumbnailContinuity={
   status:()=>({decodedCached:images.size,ratios:ratios.size,folder:currentFolder()})
 };
 const style=document.createElement('style');
 style.id='vl-return-thumbnail-stability';
 style.textContent=[
  '@media(max-width:767px){',
  ' #fileList.vl-pinterest:not(.list-view)>div>.h-32[data-vl-preview-pending="1"]{',
  '   position:relative!important;display:block!important;width:100%!important;',
  '   height:auto!important;min-height:0!important;',
  '   aspect-ratio:var(--vl-preview-ratio,4 / 5)!important;overflow:hidden!important;',
  ' }',
  ' #fileList.vl-pinterest:not(.list-view)>div>.h-32[data-vl-preview-pending="1"]>img.drive-img-item{',
  '   position:absolute!important;inset:0!important;display:block!important;',
  '   width:100%!important;height:100%!important;object-fit:contain!important;',
  ' }',
  ' #fileList.vl-pinterest:not(.list-view)>div:not(:has(> .h-32)):has([id^="menu-"])::before{',
  '   content:"";display:block;aspect-ratio:4 / 5;width:100%;',
  '   background:#f1f5f9;border-radius:9px;margin-bottom:8px;pointer-events:none;',
  ' }',
  '}'
 ].join('\n');
 document.head.appendChild(style);
})();
