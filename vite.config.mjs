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
    };
    if(document.getElementById('auth-overlay'))apply();
    else document.addEventListener('DOMContentLoaded', apply, {once:true});
  };
  highres.src=selected;
})();
`
    .replace('__PHOTOS__',JSON.stringify(sources))
    .replace('__PREVIEWS__',JSON.stringify(previews));
  return '<script id="vl-login-random-first">\n'+code+'\n</script>';
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
        const embedded=await makeInlineBootstrap();
        return html.slice(0,start)+START+'\n'+embedded+'\n'+END+
          html.slice(end+END.length);
      }
    },
    async closeBundle(){
      if(!isBuild)return;
      const html=await readFile(resolve(process.cwd(),buildFolder,'index.html'),'utf8');
      const previewCount=(html.match(/data:image\/png;base64,/g)||[]).length;
      if(previewCount<1 ||
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
