// Create independent login wallpaper manifests for mobile and desktop.
// Both directories are indexed automatically before every Vite dev/build.
import { readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function generate(folder) {
  const directory = resolve(root, 'public', folder);
  const files = await readdir(directory, { withFileTypes: true });
  const photos = files
    .filter(entry => entry.isFile() && /\.(png|jpe?g|webp|avif)$/i.test(entry.name))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
  const manifest = {
    version: 1,
    title: folder === 'login-backgrounds-desktop'
      ? 'QL Ảnh — desktop login backgrounds'
      : 'QL Ảnh — login background collection',
    description: 'Auto-rotating login backgrounds; regenerated during build.',
    images: photos.map(name => ({
      src: '/' + folder + '/' + encodeURIComponent(name),
      alt: name.replace(/\.[^.]+$/, '')
    }))
  };
  await writeFile(resolve(directory, 'backgrounds.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log('[login backgrounds] ' + folder + ': ' + photos.length + ' image(s) registered.');
}

await generate('login-backgrounds');
await generate('login-backgrounds-desktop');
