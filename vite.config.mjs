import { defineConfig } from 'vite';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { makePreviewPNGDataURI } from './scripts/login-preview-png.mjs';

// Build a tiny photographic version of every original wallpaper directly
// inside the HTML response. An uncached 1–2MB randomized PNG cannot paint
// immediately, but a 96px data URI can. Keep the existing cover layout and
// the established slideshow JS untouched.
const START='<!-- VL_LOGIN_RANDOM_SOURCE_START -->';
const END='<!-- VL_LOGIN_RANDOM_SOURCE_END -->';
let buildFolder='dist';
let isBuild=false;

async function makeInlineBootstrap() {
  const folder=resolve(process.cwd(),'public/login-backgrounds');
  const files=(await readdir(folder,{withFileTypes:true}))
    .filter(f=>f.isFile() && /\.(png|jpe?g|webp|avif)$/i.test(f.name))
    .map(f=>f.name)
    .sort((a,b)=>a.localeCompare(b,'vi',{numeric:true}));
  if(files.length<1)throw Error('Login photo folder has no images');
  const sources=files.map(file=>'/login-backgrounds/'+encodeURIComponent(file));
  const previews={};
  for(let i=0;i<files.length;i++) {
    // PNGs have embedded previews. Other supported formats remain in the
    // rotation; they can receive a first-paint preview when a converter is added.
    if(!/\.png$/i.test(files[i]))continue;
    previews[sources[i]]=makePreviewPNGDataURI(
      await readFile(resolve(folder,files[i])),96);
  }
  // Put a REAL image directly into the auth overlay's CSS fallback.
  // This is painted even if the runtime selector fails, arrives late,
  // localStorage is denied or a browser ignores the custom property.
  const firstPreview=previews[sources.find(src=>previews[src])];
  if(!firstPreview?.startsWith('data:image/png;base64,'))
    throw Error('Login needs a valid inline photographic fallback');
  const code=String.raw`
(() => {
  'use strict';
  const photos=__PHOTOS__;
  const previews=__PREVIEWS__;
  let previous='';
  try { previous=localStorage.getItem('vl-login-last-first-photo') || ''; } catch (_) {}
  const ready=photos.filter(src=>!!previews[src]);
  if(!ready.length)return;
  const choices=ready.length>1?ready.filter(src=>src!==previous):ready;
  const selected=choices[Math.floor(Math.random()*choices.length)];
  const preview=previews[selected];
  if(!preview || !preview.startsWith('data:image/png;base64,'))return;
  window.__vlInitialLoginPhoto=selected;
  window.__vlInitialLoginPreview=preview;
  document.documentElement.style.setProperty('--vl-login-start-photo',
    'url('+JSON.stringify(preview)+')');
  try { localStorage.setItem('vl-login-last-first-photo', selected); } catch (_) {}

  // Upgrade THIS SAME photo when the full PNG is decoded. Never replace
  // a later slideshow photo or alter the original 8.5-second scheduling.
  const highres=new Image();
  highres.onload=() => {
    const apply=() => {
      const overlay=document.getElementById('auth-overlay');
      if(!overlay)return;
      const current=overlay.style.backgroundImage.trim();
      if(!current.startsWith('var(--vl-login-start-photo'))return;
      overlay.style.backgroundImage='url('+JSON.stringify(selected)+')';
      document.getElementById('vl-login-first-frame')?.remove();
    };
    if(document.getElementById('auth-overlay'))apply();
    else document.addEventListener('DOMContentLoaded', apply, {once:true});
  };
  highres.src=selected;
})();
`
    .replace('__PHOTOS__',JSON.stringify(sources))
    .replace('__PREVIEWS__',JSON.stringify(previews));
  return {
    script:'<script id="vl-login-random-first">\n'+code+'\n</script>',
    fallback:'url('+JSON.stringify(firstPreview)+')',
    firstPreview
  };
}

export default defineConfig({
  plugins:[{
    name:'vl-verified-inline-first-login-photo',
    enforce:'pre',
    configResolved(config){
      buildFolder=config.build.outDir;
      isBuild=config.command==='build';
    },
    transformIndexHtml:{
      order:'pre',
      async handler(html){
        const start=html.indexOf(START);
        const end=html.indexOf(END,start+START.length);
        if(start<0 || end<start)throw Error('Missing login photo markers');
        const {script,fallback,firstPreview}=await makeInlineBootstrap();
        const out=html.slice(0,start)+START+'\n'+script+'\n'+END+
          html.slice(end+END.length);
        const fixedFallback="url('https://raw.githubusercontent.com/lekhanhduy-IT/vinhloc-drive-gallery-app/main/public/login-backgrounds/316e9496-bd61-457c-a431-37259a524b75.png')";
        const original='var(--vl-login-start-photo, '+fixedFallback+')';
        if(!out.includes(original))throw Error('Missing original login wallpaper style');
        const result=out.replace(original,'var(--vl-login-start-photo, '+fallback+')');
        const mount='<div id="vl-login-backgrounds" aria-hidden="true"></div>';
        if(!result.includes(mount))throw Error('Login photo host not found');
        // Paintable before any external JS or CSS resolves on iOS/desktop.
        const photo='<img id="vl-login-first-frame" src="'+firstPreview+'" '+
          'alt="" aria-hidden="true" decoding="sync" fetchpriority="high" '+
          'style="position:absolute;inset:0;display:block;width:100%;height:100%;'+
          'object-fit:cover;object-position:center 25%;z-index:0;'+
          'max-width:none;transform:none!important;pointer-events:none;">';
        const select='<script id="vl-login-first-frame-select">'+
          '(function(){var f=document.getElementById("vl-login-first-frame");'+
          'var p=window.__vlInitialLoginPreview;'+
          'if(f&&typeof p==="string"&&p.startsWith("data:image/png;base64,"))f.src=p;'+
          '})();'+'</script>';
        return result.replace(mount,photo+'\n'+select+'\n'+mount);
      }
    },
    async closeBundle(){
      if(!isBuild)return;
      const html=await readFile(resolve(process.cwd(),buildFolder,'index.html'),'utf8');
      const previewCount=(html.match(/data:image\/png;base64,/g)||[]).length;
      const pictureFallback=/background-image:\s*var\(--vl-login-start-photo,\s*url\((?:"|')data:image\/png;base64,/;
      const actualPhoto=/<img id="vl-login-first-frame"[^>]*src="data:image\/png;base64,/;
      if(previewCount<3 || !pictureFallback.test(html) ||
         !actualPhoto.test(html) ||
         !html.includes('id="vl-login-first-frame-select"') ||
         !html.includes('id="vl-login-random-first"') ||
         !html.includes('window.__vlInitialLoginPhoto=selected;') ||
         !html.includes('const previews=') ||
         html.includes('document.documentElement.style.setProperty(\'--vl-login-start-photo\', \'url(\' + JSON.stringify(selected) + \')\')')){
        throw Error('Blocked deployment: final HTML has no ready-to-paint photographic login previews');
      }
      console.log('[login] Verified '+previewCount+' embedded photo previews in FINAL HTML');
    }
  }]
});
