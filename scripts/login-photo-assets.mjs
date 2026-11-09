import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

export const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const photoDirectory = resolve(appRoot, 'public/login-backgrounds');

export async function listLoginPhotos() {
  const entries = (await readdir(photoDirectory, {withFileTypes:true}))
    .filter(entry=>entry.isFile() && /\.(png|jpe?g|webp|avif)$/i.test(entry.name))
    .map(entry=>entry.name).sort((a,b)=>a.localeCompare(b,'vi',{numeric:true}));
  const photos=[];
  for(const name of entries) {
    const bytes=await readFile(resolve(photoDirectory,name));
    const hash=createHash('sha256').update(bytes).digest('hex').slice(0,12);
    photos.push({name,bytes,hash,
      src:'/login-backgrounds/'+encodeURIComponent(name)+'?v='+hash,
      alt:name.replace(/\.[^.]+$/,'')});
  }
  if(!photos.length)throw Error('No images in public/login-backgrounds');
  return photos;
}
