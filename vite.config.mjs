// Always embed the login image previews before Vite reads index.html.
// Works even when Vercel invokes "vite build" directly instead of npm scripts.
import { defineConfig } from 'vite';
import { spawnSync } from 'node:child_process';

function prepareLoginPhotos() {
  const done=spawnSync(process.execPath,['scripts/generate-login-backgrounds.mjs'],{
    cwd:process.cwd(),stdio:'inherit',env:process.env
  });
  if(done.error || done.status!==0){
    throw new Error('Login photo bootstrap build failed: '+
      (done.error?.message || 'exit '+done.status));
  }
}

export default defineConfig({
  plugins:[{
    name:'vinhloc-inline-login-first-paint',
    enforce:'pre',
    buildStart(){prepareLoginPhotos();},
    configureServer(){prepareLoginPhotos();}
  }]
});
