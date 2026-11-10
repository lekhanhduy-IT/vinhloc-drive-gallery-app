/* v3.1.74: Reuse decoded file thumbnail IMG objects during same-folder revisits.
   Does not rewrite URLs, modify cards, or persist private images. */
(() => {
 'use strict';
 if(window.__vlDecodedFileThumbnails)return;
 window.__vlDecodedFileThumbnails=true;
 const list=document.getElementById('fileList');
 if(!list)return;
 const ID=/^[A-Za-z0-9_-]{10,180}$/;
 const MAX=150,MAX_AGE=5*60*1000,remembered=new Map();
 let scope='';
 function identity(){
  return window.vlShareScope ?
   'share:'+(window.vlShareScope.root||'')+':'+String(window.vlShareScope.ready?.()) :
   'user:'+(localStorage.getItem('vinhloc_authenticated_email')||'');
 }
 scope=identity();
 function getCard(img){
  let node=img;
  for(let i=0;node&&i<12;node=node.parentElement,i++){
   if(node.parentElement===list)return node;
   if(node.matches?.('[id^="menu-"]'))return null;
  }
  return null;
 }
 function getId(img){
  const card=getCard(img);
  const id=card?.querySelector('[id^="menu-"]')?.id?.slice(5)||'';
  return ID.test(id)?id:'';
 }
 function images(node){
  if(node.nodeType!==1)return [];
  return (node.matches?.('img.drive-img-item')?[node]:[])
   .concat([...node.querySelectorAll?.('img.drive-img-item')||[]]);
 }
 function mediaSource(img){
  try{
   const src=new URL(img.getAttribute('src')||'',location.href);
   const id=src.searchParams.get('fileId')||src.searchParams.get('id');
   return ID.test(id||'')?id:'';
  }catch(_){return '';}
 }
 function capture(node){
  for(const img of images(node)){
   if(img.isConnected||!img.complete||img.naturalWidth<=0)continue;
   const id=getId(img);
   if(!id)continue;
   remembered.delete(id);
   remembered.set(id,{img,media:mediaSource(img),time:Date.now()});
   if(remembered.size>MAX)remembered.delete(remembered.keys().next().value);
  }
 }
 function restore(node){
  for(const img of images(node)){
   if(!img.isConnected)continue;
   const id=getId(img),entry=remembered.get(id);
   if(!id||!entry||entry.img.isConnected||Date.now()-entry.time>MAX_AGE||
      !entry.img.complete||entry.img.naturalWidth<=0)continue;
   const targetMedia=mediaSource(img);
   if(targetMedia&&entry.media&&targetMedia!==entry.media)continue;
   remembered.delete(id);
   entry.img.className=img.className;
   entry.img.alt=img.alt||entry.img.alt;
   img.replaceWith(entry.img);
  }
 }
 new MutationObserver(records=>{
  const next=identity();
  if(next!==scope){scope=next;remembered.clear();return;}
  for(const record of records)for(const node of record.removedNodes)capture(node);
  for(const record of records)for(const node of record.addedNodes)restore(node);
 }).observe(list,{childList:true,subtree:true});
 window.addEventListener('vl:media-authorized',()=>{remembered.clear();scope=identity();});
 window.addEventListener('vl:share-member-ready',()=>{remembered.clear();scope=identity();});
 window.addEventListener('storage',e=>{
  if(e.key==='vinhloc_authenticated_email'){remembered.clear();scope=identity();}
 });
})();
