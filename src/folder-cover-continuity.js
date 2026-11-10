/* v3.1.74: Reuse decoded folder covers after their listing nodes are rebuilt.
   No authenticated image bytes or tokens are persisted between browser sessions. */
(() => {
 'use strict';
 if(window.__vlDecodedFolderCovers)return;
 window.__vlDecodedFolderCovers=true;
 const list=document.getElementById('folderList');
 if(!list)return;
 const cache=new Map(), MAX=160, ID=/^[A-Za-z0-9_-]{10,180}$/;
 const scope=()=>window.vlShareScope ?
  'share:'+window.vlShareScope.root+':'+String(window.vlShareScope.ready?.()):
  'user:'+(localStorage.getItem('vinhloc_authenticated_email')||'');
 let activeScope=scope();
 const folderId=img=>{
  if(!(img instanceof HTMLImageElement))return '';
  for(const cls of img.classList)if(cls.startsWith('item-cover-img-')){
   const id=cls.slice('item-cover-img-'.length);
   if(ID.test(id))return id;
  }
  return '';
 };
 function coverSource(url){
  if(!url)return '';
  try{
   const u=new URL(url,location.href);
   const id=u.searchParams.get('fileId')||u.searchParams.get('id')||
    u.pathname.match(/\/file\/d\/([\w-]+)/)?.[1];
   return ID.test(id||'')?id:'';
  }catch(_){return '';}
 }
 function folderImages(node){
  if(node.nodeType!==1)return [];
  const hit=node.matches?.('img[class*="item-cover-img-"]')?[node]:[];
  return hit.concat([...node.querySelectorAll?.('img[class*="item-cover-img-"]')||[]]);
 }
 function remember(node){
  for(const img of folderImages(node)){
   if(img.isConnected||!img.complete||img.naturalWidth<1)continue;
   const id=folderId(img);if(!id)continue;
   cache.delete(id);
   cache.set(id,{img,source:coverSource(img.currentSrc||img.getAttribute('src'))});
   if(cache.size>MAX)cache.delete(cache.keys().next().value);
  }
 }
 function recover(node){
  for(const img of folderImages(node)){
   if(!img.isConnected)continue;
   const id=folderId(img),entry=cache.get(id);
   if(!id||!entry||entry.img.isConnected||!entry.img.complete||entry.img.naturalWidth<1)continue;
   const next=coverSource(img.getAttribute('src')||'');
   if(next&&entry.source&&next!==entry.source)continue;
   cache.delete(id);
   entry.img.className=img.className;
   entry.img.classList.remove('hidden');
   entry.img.alt=img.alt||entry.img.alt;
   img.replaceWith(entry.img);
  }
 }
 new MutationObserver(records=>{
  const next=scope();
  if(next!==activeScope){cache.clear();activeScope=next;return;}
  for(const r of records)for(const n of r.removedNodes)remember(n);
  for(const r of records)for(const n of r.addedNodes)recover(n);
 }).observe(list,{childList:true,subtree:true});
 for(const evt of ['vl:media-authorized','vl:share-member-ready'])
  window.addEventListener(evt,()=>{cache.clear();activeScope=scope();});
 window.addEventListener('storage',evt=>{
  if(evt.key==='vinhloc_authenticated_email'){cache.clear();activeScope=scope();}
 });
})();
