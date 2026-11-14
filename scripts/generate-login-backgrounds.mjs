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
