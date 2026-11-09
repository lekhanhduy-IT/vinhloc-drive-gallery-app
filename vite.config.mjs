import { defineConfig } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { makePreviewPNGDataURI } from './scripts/login-preview-png.mjs';
import { listLoginPhotos, appRoot } from './scripts/login-photo-assets.mjs';

const START='<!-- VL_LOGIN_RANDOM_SOURCE_START -->';
const END='<!-- VL_LOGIN_RANDOM_SOURCE_END -->';
const SLOTMOUNT='<div id="vl-login-backgrounds" aria-hidden="true"></div>';
let buildOut='dist';
let isBuild=false;

// This executes while Vite transforms the HTML, not after it snapshots the
// original document. Every preview is ACTUAL photographic pixel data.
async function injectFirstPaint(html){
  const photos=await listLoginPhotos();
  const sources=photos.map(photo=>photo.src);
  const previews={};
  for(const photo of photos) {
    if(!/\.png$/i.test(photo.name))
      throw Error('Login first-paint preview needs PNG: '+photo.name);
    const preview=makePreviewPNGDataURI(photo.bytes,144);
    if(!preview.startsWith('data:image/png;base64,') || preview.length<120)
      throw Error('Invalid embedded login photo: '+photo.name);
    previews[photo.src]=preview;
  }
  const firstPreview=previews[sources[0]];
  const headScript = `(function(){
    'use strict';
    const photos=__SOURCES__;
    const previews=__PREVIEWS__;
    let previous='';
    try{ previous=localStorage.getItem('vl-login-last-first-photo')||''; }catch(_){}
    const eligible=photos.length>1?photos.filter(src=>src!==previous):photos;
    const selected=eligible[Math.floor(Math.random()*eligible.length)];
    const preview=previews[selected];
    window.__vlLoginPhotoSetup={photos,selected,preview};
    // Chosen actual photo pixels are in the HTML already, even offline.
    // Paint on #auth-overlay ITSELF, rather than relying on a child image.
    document.documentElement.style.setProperty(
      '--vl-login-first-paint','url('+JSON.stringify(preview)+')');
    try{localStorage.setItem('vl-login-last-first-photo',selected)}catch(_){}
    // Request the ONE selected large image early, but never delay its
    // already-embedded preview or the login button.
    const preload=document.createElement('link');
    preload.rel='preload'; preload.as='image'; preload.href=selected;
    preload.setAttribute('fetchpriority','high');
    document.head.appendChild(preload);
  })();`.replace('__SOURCES__',JSON.stringify(sources))
                 .replace('__PREVIEWS__',JSON.stringify(previews));

  const css=String.raw`
  #auth-overlay {
    background-image:var(--vl-login-first-paint, __PHOTO_FALLBACK__)!important;
  }
  #auth-overlay #vl-login-base-photo {
    position:absolute!important;inset:0!important;
    width:100%!important;height:100%!important;
    display:block!important;object-fit:cover!important;
    object-position:center 25%!important;
    max-width:none!important;pointer-events:none!important;
    z-index:0!important;transform:none!important;
  }
  #auth-overlay #vl-login-backgrounds {z-index:1!important;}
  #auth-overlay .vl-login-panel {z-index:2!important;}
  `.replace('__PHOTO_FALLBACK__','url('+JSON.stringify(firstPreview)+')');

  const head=START+'\n<style id="vl-login-first-image-style">'+css+'</style>\n'+
    '<script id="vl-login-random-selection">'+headScript+'</script>\n'+END;
  const start=html.indexOf(START),end=html.indexOf(END,start+START.length);
  if(start<0||end<start)throw Error('Login image head markers missing');
  html=html.slice(0,start)+head+html.slice(end+END.length);

  // Keep the original 3.1.54 slideshow layer, but make a decoded,
  // embedded photo the base visual instead of an empty blue CSS background.
  if(!html.includes(SLOTMOUNT))throw Error('Login background host missing');
  const base='<img id="vl-login-base-photo" alt="" aria-hidden="true" draggable="false" '+
    'decoding="sync" src="'+firstPreview+'">';
  const select='<script id="vl-login-photo-mount">'+
    '(function(){var pic=document.getElementById("vl-login-base-photo");'+
    'var data=window.__vlLoginPhotoSetup;'+
    'if(pic&&data&&data.preview){pic.src=data.preview;}})();'+
    '</script>';
  return html.replace(SLOTMOUNT,base+'\n'+select+'\n'+SLOTMOUNT);
}

export default defineConfig({
  plugins:[{
    name:'vl-login-actual-photo-in-first-html-paint',
    enforce:'pre',
    configResolved(config){buildOut=config.build.outDir;isBuild=config.command==='build';},
    transformIndexHtml:{order:'pre',handler:injectFirstPaint},
    async closeBundle(){
      if(!isBuild)return;
      // Always ship the same fingerprinted list as the inlined first-paint
      // HTML, even if a hosting provider invokes vite build directly.
      const assets=await listLoginPhotos();
      await writeFile(resolve(appRoot,buildOut,'login-backgrounds/backgrounds.json'),
        JSON.stringify({version:2,title:'QL Ảnh — login background collection',
          images:assets.map(({src,alt})=>({src,alt}))},null,2)+'\n','utf8');
      const html=await readFile(resolve(appRoot,buildOut,'index.html'),'utf8');
      const imageCount=(html.match(/data:image\/png;base64,/g)||[]).length;
      const requiredBackground=/background-image:\s*var\(--vl-login-first-paint,\s*url\(["']?data:image\/png;base64,/;
      if(imageCount<13 || !requiredBackground.test(html) ||
          !html.includes("'--vl-login-first-paint'") ||
          !html.includes('id="vl-login-base-photo"') ||
          !html.includes('id="vl-login-photo-mount"') ||
          !html.includes('id="vl-login-first-image-style"') ||
          html.includes('data:image/png;base64,undefined')) {
        throw Error('STOP: built HTML does not embed real photographic thumbnails for the first paint');
      }
      console.log('[login] verified '+imageCount+' inline photo data URIs in final dist/index.html');
    }
  }]
});
