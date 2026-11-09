// Regenerate the static login photo manifest before Vite's dev/build commands.
// New images added to public/login-backgrounds are automatically included at the next deploy.
import { readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(root, 'public/login-backgrounds');
const files = await readdir(directory, { withFileTypes: true });
const photos = files
  .filter(entry => entry.isFile() && /\.(png|jpe?g|webp|avif)$/i.test(entry.name))
  .map(entry => entry.name)
  .sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
const manifest = {
  version: 1,
  title: 'QL Ảnh — login background collection',
  description: 'Auto-rotating login backgrounds; regenerated from the images in this directory during build.',
  images: photos.map(name => ({
    src: '/login-backgrounds/' + encodeURIComponent(name),
    alt: name.replace(/\.[^.]+$/, '')
  }))
};
await writeFile(resolve(directory, 'backgrounds.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log('[login backgrounds] ' + photos.length + ' image(s) registered.');

const sourceStart='<!-- VL_LOGIN_RANDOM_SOURCE_START -->',sourceEnd='<!-- VL_LOGIN_RANDOM_SOURCE_END -->';
const indexPath=resolve(root,'index.html');
const {readFile}=await import('node:fs/promises');
let html=await readFile(indexPath,'utf8');
const a=html.indexOf(sourceStart),b=html.indexOf(sourceEnd,a+sourceStart.length);
if(a<0||b<a)throw Error('Random first-photo markers missing in index.html');
let section=html.slice(a,b);
if(!/const photos = \[[^\n]*\];/.test(section))throw Error('Random source list missing');
section=section.replace(/const photos = \[[^\n]*\];/,
  'const photos = '+JSON.stringify(manifest.images.map(image=>image.src))+';');
html=html.slice(0,a)+section+html.slice(b);
await writeFile(indexPath,html,'utf8');
