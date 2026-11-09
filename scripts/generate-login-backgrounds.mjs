// Source of truth for all login backgrounds. New/changed photos are
// detected by their content hash, so every device fetches the new version.
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { listLoginPhotos, photoDirectory } from './login-photo-assets.mjs';

const photos=await listLoginPhotos();
const manifest={
  version:2,
  title:'QL Ảnh — login background collection',
  images:photos.map(({src,alt})=>({src,alt}))
};
await writeFile(resolve(photoDirectory,'backgrounds.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('[login] prepared '+photos.length+' photo URLs with content fingerprints');
