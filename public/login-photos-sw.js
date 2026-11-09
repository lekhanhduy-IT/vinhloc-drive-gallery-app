/* Dedicated image-only Cache Storage service worker.
 * Never intercept HTML, auth, APIs, Google sign-in, or application assets. */
const CACHE='vl-login-background-images-v1';
function isPhoto(url) {
  return url.origin===self.location.origin &&
    url.pathname.startsWith('/login-backgrounds/') &&
    /\.(?:png|jpe?g|webp|avif)$/i.test(url.pathname);
}
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET'||!isPhoto(new URL(req.url)))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const hit=await cache.match(req);
    if(hit)return hit;
    const response=await fetch(req);
    if(response.ok)event.waitUntil(cache.put(req,response.clone()).catch(()=>{}));
    return response;
  })());
});
async function warmAll(list) {
  const urls=[...new Set(list)].filter(value=>{
    if(typeof value!=='string'||!value.startsWith('/login-backgrounds/'))return false;
    try{return isPhoto(new URL(value,self.location.origin));}catch{return false;}
  }).slice(0,100);
  if(!urls.length)return;
  const cache=await caches.open(CACHE);
  let position=0;
  async function runner(){
    while(position<urls.length){
      const path=urls[position++];
      const req=new Request(new URL(path,self.location.origin),{credentials:'same-origin'});
      try{
        if(await cache.match(req))continue;
        const response=await fetch(req);
        if(response.ok)await cache.put(req,response);
      }catch{} // Browser may be offline or evict the cache.
    }
  }
  await Promise.all([runner(),runner()]);
  // On a new deployment, remove stale content-hash variants, but only
  // after trying to cache the new collection.
  const keep=new Set(urls.map(url=>new URL(url,self.location.origin).href));
  for(const req of await cache.keys())if(!keep.has(req.url))await cache.delete(req);
}
self.addEventListener('message',event=>{
  if(event.data?.type==='VL_WARM_LOGIN_PHOTOS'&&Array.isArray(event.data.photos)){
    event.waitUntil(warmAll(event.data.photos));
  }
});
