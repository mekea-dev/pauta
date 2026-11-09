// Service worker do Pauta: deixa o app abrir sem internet.
// Estratégia: rede primeiro (quando há internet você sempre recebe a versão mais nova, que é
// revalidada a cada abertura) e, sem rede, a cópia guardada. Os dados das tarefas NÃO passam por aqui:
// ficam no localStorage da página.
const VERSION = '1.9.0'; // manter igual a APP_VERSION em js/config.js (há um teste que confere)
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
  './js/voice.js',
  './js/speech.js',
  './js/ai.js',
  './js/match.js',
  './js/alarm.js',
  './js/alarm-sound.js',
  './js/reminders.js',
  './js/alerts.js',
  './js/push.js',
  './js/push-config.js',
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
  './js/ui/alarm.js',
  './js/ui/commands.js',
  './js/ui/taskrow.js',
  './js/ui/swipe.js',
  './js/ui/composer.js',
  './js/ui/timepick.js',
  './js/ui/notify.js',
  './js/ui/views.js',
  './js/ui/calendar.js',
  './js/ui/sidebar.js',
  './js/ui/topbar.js',
  './js/ui/editor.js',
  './js/ui/settings.js',
  './js/ui/install.js',
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

// ---------- avisos dos lembretes ----------
// Com o app fechado, o serviço de lembretes (worker/lembretes.js) manda um "toque" (push) SEM conteúdo na hora do aviso. Quem sabe o
// que mostrar é este service worker, lendo a cópia da lista de avisos que a página guardou no aparelho (cache "avisos-v1", escrito
// por js/alerts.js). Os títulos das tarefas nunca passam pelo serviço de lembretes.
// Regra do iPhone: TODO toque precisa virar uma notificação (senão o sistema cancela a inscrição); por isso o último aviso é mostrado
// de novo quando não há nenhum novo (mesmo "tag": a notificação é trocada, não duplicada).
const MIRROR = 'avisos-v1'; // o mesmo nome de js/alerts.js (um teste confere)
const LATE_MS = 30 * 60000; // 30 min depois do horário da tarefa o aviso já não faz sentido (igual a js/reminders.js)
const FRESH_MS = 5 * 60000; // aviso que chega com até 5 min de atraso mantém o texto "em 15 minutos"
const SHOWN_KEEP_MS = 3 * 86400000;
// ALARME: o serviço dá um toque por minuto, 10 vezes (PUSH_WINDOW_MS em js/alarm.js); cada toque mostra a notificação do alarme de novo
// (mesma marca + renotify: a nova troca a antiga e chama a atenção outra vez). Passou desse tempo, o alarme vira um aviso comum.
const ALARM_PUSH_MS = 10 * 60000 + 30000; // a janela de toques mais uma folga (um teste confere com js/alarm.js)
const ALARM_EARLY_MS = 10000; // o relógio do aparelho pode estar alguns segundos atrás do serviço
const ALARM_VIBRATION = [500, 250, 500, 250, 500]; // igual a ALARM_VIBRATION de js/alarm.js (um teste confere)

const mirrorUrl = (key) => new URL(`./__${key}.json`, self.location.href).href;

async function readMirror(key, fallback) {
  try {
    const hit = await (await caches.open(MIRROR)).match(mirrorUrl(key));
    return hit ? await hit.json() : fallback;
  } catch {
    return fallback;
  }
}

async function writeMirror(key, value) {
  try {
    await (await caches.open(MIRROR)).put(mirrorUrl(key), new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }));
  } catch { /* sem espaço: segue sem anotar */ }
}

/** Título e opções da notificação de um aviso (as mesmas de js/ui/notify.js). */
function notificationFor(r, now) {
  const body = now - r.at <= FRESH_MS ? r.body : r.day; // atrasado: o "em 15 minutos" estaria errado
  return [r.title, {
    body: body ?? '', tag: r.id, icon: './icons/icon-192.png', badge: './icons/icon-192.png', lang: 'pt-BR',
    data: { taskId: r.taskId ?? null }, ...(r.dueAt ? { timestamp: r.dueAt } : {}),
  }];
}

/** Título e opções da notificação de um ALARME (as mesmas de alarmNotificationOptions, js/ui/notify.js). */
function alarmNotificationFor(r) {
  return [r.title, {
    body: r.body ?? '', tag: `alarme-${r.id}`, renotify: true, requireInteraction: true, vibrate: ALARM_VIBRATION,
    icon: './icons/icon-192.png', badge: './icons/icon-192.png', lang: 'pt-BR',
    data: { taskId: r.taskId ?? null, alarm: true, id: r.id }, ...(r.dueAt ? { timestamp: r.dueAt } : {}),
  }];
}

async function showReminders() {
  const now = Date.now();
  const saved = await readMirror('avisos', []);
  const shown = await readMirror('mostrados', {});
  const seen = shown && typeof shown === 'object' && !Array.isArray(shown) ? shown : {};
  const list = (Array.isArray(saved) ? saved : []).filter((r) => r && typeof r.id === 'string');
  // alarmes que estão tocando agora: a página tira da lista o que foi parado ou adiado, então o que sobra aqui ainda deve tocar
  const ringing = list.filter((r) => r.alarm === true && r.at - ALARM_EARLY_MS <= now && now < r.at + ALARM_PUSH_MS).sort((a, b) => a.at - b.at);
  const ready = list
    .filter((r) => !ringing.includes(r) && r.at <= now && r.dueAt + LATE_MS >= now)
    .sort((a, b) => a.at - b.at);
  const fresh = ready.filter((r) => !seen[r.id]);
  const toShow = fresh.length ? fresh : (ringing.length ? [] : ready.slice(-1));
  if (!toShow.length && !ringing.length) {
    await self.registration.showNotification('Pauta', { body: 'Você tem um lembrete. Abra o app para ver.', tag: 'pauta-aviso', icon: './icons/icon-192.png', lang: 'pt-BR', data: { taskId: null } });
    return;
  }
  for (const r of ringing) await self.registration.showNotification(...alarmNotificationFor(r));
  for (const r of toShow) await self.registration.showNotification(...notificationFor(r, now));
  if (!fresh.length) return;
  for (const r of fresh) seen[r.id] = now;
  const kept = Object.fromEntries(Object.entries(seen).filter(([, at]) => at > now - SHOWN_KEEP_MS));
  await writeMirror('mostrados', kept);
}

self.addEventListener('push', (event) => {
  event.waitUntil(showReminders());
});

/**
 * Tocou na notificação: foca o app (e abre a tarefa) se ele já está aberto; senão abre. No alarme, o app abre na TELA DO ALARME
 * (a própria página confere, ao abrir, se algum alarme ainda toca): aí a pessoa para ou adia.
 */
async function openApp(taskId, alarm = false) {
  const scope = self.registration.scope;
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const open = windows.find((w) => w.url.startsWith(scope));
  if (open) {
    try { await open.focus(); } catch { /* o sistema pode recusar: a mensagem ainda abre a tarefa ou o alarme */ }
    open.postMessage(alarm ? { type: 'abrir-alarme' } : { type: 'abrir-tarefa', id: taskId ?? null });
    return;
  }
  await self.clients.openWindow(new URL(!alarm && taskId ? `#/tarefa/${encodeURIComponent(taskId)}` : '', scope).href);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data;
  event.waitUntil(openApp(data?.taskId ?? null, data?.alarm === true));
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
