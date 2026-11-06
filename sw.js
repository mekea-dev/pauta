// Service worker do Pauta: deixa o app abrir sem internet.
// Estratégia: rede primeiro (quando há internet você sempre recebe a versão mais nova, que é
// revalidada a cada abertura) e, sem rede, a cópia guardada. Os dados das tarefas NÃO passam por aqui:
// ficam no localStorage da página.
const VERSION = '1.0.0'; // manter igual a APP_VERSION em js/config.js (há um teste que confere)
const CACHE = `pauta-${VERSION}`;

// Todo arquivo novo do app precisa entrar nesta lista (o teste tests/sw.test.js avisa se faltar).
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/theme-init.js',
  './js/main.js',
  './js/config.js',
  './js/text.js',
  './js/dates.js',
  './js/recurrence.js',
  './js/parser.js',
  './js/model.js',
  './js/store.js',
  './js/persist.js',
  './js/query.js',
  './js/io.js',
  './js/sync/merge.js',
  './js/cloud/config.js',
  './js/cloud/firebase.js',
  './js/cloud/sync.js',
  './js/cloud/account.js',
  './js/ui/dom.js',
  './js/ui/icons.js',
  './js/ui/overlay.js',
  './js/ui/account.js',
  './js/ui/actions.js',
  './js/ui/taskrow.js',
  './js/ui/composer.js',
  './js/ui/views.js',
  './js/ui/calendar.js',
  './js/ui/sidebar.js',
  './js/ui/topbar.js',
  './js/ui/editor.js',
  './js/ui/settings.js',
  './js/ui/shortcuts.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // um arquivo que falhe não pode impedir a instalação dos outros
    await Promise.allSettled(ASSETS.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('pauta-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(req));
});

const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    // "no-cache": revalida com o servidor (resposta 304 é rápida), em vez de usar a cópia do navegador por minutos
    const res = await withTimeout(fetch(req, { cache: 'no-cache' }), 4000);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return Response.error();
  }
}
