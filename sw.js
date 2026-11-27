const CACHE='cmubiotrage-v69', TILES='cmubiotrage-tiles';
const CORE=['assets/css/styles.css','assets/js/app.js','assets/data/data.json'];
const FILES=['./','index.html','guide/','qr/','assets/img/offline-text-qr.svg','manifest.json',...CORE,'assets/icons/icon.svg','assets/icons/logo-96.png','assets/icons/logo-192.png','assets/icons/logo-512.png','assets/icons/logo-maskable-512.png','assets/img/bg-scales.jpg','assets/img/bg-snake.jpg','assets/img/bg-python.jpg','assets/img/bg-hex.svg','assets/vendor/leaflet/leaflet.js','assets/vendor/leaflet/leaflet.css','assets/vendor/leaflet/images/marker-icon.png','assets/vendor/leaflet/images/marker-icon-2x.png','assets/vendor/leaflet/images/marker-shadow.png'];
const scopePath=path=>new URL(path,self.registration.scope).pathname;
const pages=new Map(['guide','qr'].flatMap(page=>[page,`${page}/`,`${page}/index.html`].map(alias=>[scopePath(alias),`${page}/`])));
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x.startsWith('cmubiotrage-')&&x!==CACHE&&x!==TILES).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('message',e=>{
 const type=e.data?.type;
 if(!['CHECK_OFFLINE_CACHE','CHECK_GUIDE_OFFLINE_CACHE'].includes(type)||!e.ports?.[0])return;
 e.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  const required=[type==='CHECK_GUIDE_OFFLINE_CACHE'?'guide/':'index.html',...CORE];
  const saved=(await Promise.all(required.map(path=>cache.match(new URL(path,self.registration.scope).href,{ignoreSearch:true})))).every(Boolean);
  e.ports[0].postMessage({saved});
 })().catch(()=>e.ports[0].postMessage({saved:false})));
});
self.addEventListener('fetch',e=>{
 const r=e.request; if(r.method!=='GET')return;
 const u=new URL(r.url);
 if(u.hostname==='tile.openstreetmap.org'){
  e.respondWith(caches.open(TILES).then(c=>c.match(r).then(hit=>hit||fetch(r).then(res=>{c.put(r,res.clone());return res}).catch(()=>Response.error()))));return;}
 if(u.origin!==location.origin||u.pathname.includes('/api/'))return;
 e.respondWith(
  new Promise((resolve,reject)=>{const t=setTimeout(reject,3000);fetch(r).then(res=>{clearTimeout(t);resolve(res)},err=>{clearTimeout(t);reject(err)})})
   .then(res=>{if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(r,copy))}return res})
   .catch(async()=>{
    const cache=await caches.open(CACHE);
    if(r.mode==='navigate'&&pages.has(u.pathname))return await cache.match(pages.get(u.pathname))||Response.error();
    return await cache.match(r,{ignoreSearch:true})||(r.mode==='navigate'&&await cache.match('index.html'))||Response.error();
   })
 );
});
