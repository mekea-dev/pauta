// Service worker (sw.js): o que acontece quando chega um "toque" do serviço de lembretes e quando alguém toca na notificação.
// O sw.js é um script comum (sem import): aqui ele roda dentro de uma função, com um "self" e um "caches" de mentira.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ALARM_VIBRATION, PUSH_WINDOW_MS, alarmTag } from '../js/alarm.js';
import { createMirror } from '../js/alerts.js';
import { alarmNotificationOptions } from '../js/ui/notify.js';

const isNode = typeof process !== 'undefined' && !!process.versions?.node;
const rootUrl = (rel) => new URL(`../${rel}`, import.meta.url);

async function readText(rel) {
  if (isNode) {
    const { readFile } = await import('node:fs/promises');
    return readFile(rootUrl(rel), 'utf8');
  }
  const res = await fetch(rootUrl(rel));
  if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}`);
  return res.text();
}

const BASE = 'https://usuario.github.io/pauta/';
const at = (s) => new Date(s).getTime();

function fakeCaches() {
  const stores = new Map();
  return {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const files = stores.get(name);
      return {
        async match(url) { const text = files.get(typeof url === 'string' ? url : url.url); return text === undefined ? undefined : new Response(text); },
        async put(url, response) { files.set(typeof url === 'string' ? url : url.url, await response.text()); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
}

/** Carrega o sw.js com um navegador de mentira. `mirror` escreve do mesmo jeito que a página (js/alerts.js). */
async function loadSw() {
  const source = await readText('sw.js');
  const handlers = {};
  const notifications = [];
  const windows = [];
  const opened = [];
  const caches = fakeCaches();
  const self = {
    location: { href: `${BASE}sw.js` },
    registration: { scope: BASE, showNotification: async (title, options) => { notifications.push({ title, ...options }); } },
    clients: { matchAll: async () => windows, openWindow: async (url) => { opened.push(url); }, claim: async () => {} },
    skipWaiting: async () => {},
    addEventListener: (type, fn) => { handlers[type] = fn; },
  };
  new Function('self', 'caches', source)(self, caches);
  const mirror = createMirror({ cacheStorage: caches, base: BASE });
  const dispatch = async (type, event) => {
    const waits = [];
    handlers[type]({ ...event, waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  };
  return { handlers, notifications, windows, opened, mirror, dispatch };
}

const entry = (over = {}) => ({
  id: 'tarefa1|2026-11-10T18:45:00.000Z', taskId: 'tarefa1', title: 'Reunião', at: at('2026-11-10T15:45:00'), dueAt: at('2026-11-10T16:00:00'),
  date: '2026-11-10', time: '16:00', remind: 15, body: 'Hoje às 16:00 · em 15 minutos', day: 'Hoje às 16:00', ...over,
});

/** Faz de conta que "agora" é `iso` (o sw.js usa Date.now()). */
async function withClock(iso, fn) {
  const real = Date.now;
  Date.now = () => at(iso);
  try {
    return await fn();
  } finally {
    Date.now = real;
  }
}

test('sw.js registra os tratadores de aviso (push e toque na notificação)', async () => {
  const { handlers } = await loadSw();
  for (const tipo of ['install', 'activate', 'fetch', 'push', 'notificationclick']) assert.equal(typeof handlers[tipo], 'function', tipo);
});

test('toque do serviço: mostra a notificação do aviso que está na hora, com o texto guardado no aparelho', async () => {
  const sw = await loadSw();
  await sw.mirror.write('avisos', [entry()]);
  await withClock('2026-11-10T15:45:40', () => sw.dispatch('push', {}));
  assert.equal(sw.notifications.length, 1);
  const n = sw.notifications[0];
  assert.equal(n.title, 'Reunião');
  assert.equal(n.body, 'Hoje às 16:00 · em 15 minutos');
  assert.equal(n.tag, 'tarefa1|2026-11-10T18:45:00.000Z');
  assert.deepEqual(n.data, { taskId: 'tarefa1' });
  assert.equal(n.icon, './icons/icon-192.png');
  assert.equal(n.timestamp, at('2026-11-10T16:00:00'));
  const mostrados = await sw.mirror.read('mostrados');
  assert.deepEqual(Object.keys(mostrados), [n.tag], 'fica anotado: a página não mostra de novo');
});

test('toque do serviço: chegou atrasado (mais de 5 min), o texto não diz "em 15 minutos"', async () => {
  const sw = await loadSw();
  await sw.mirror.write('avisos', [entry()]);
  await withClock('2026-11-10T15:58:00', () => sw.dispatch('push', {}));
  assert.equal(sw.notifications[0].body, 'Hoje às 16:00');
});

test('toque do serviço: dois avisos na hora viram duas notificações, na ordem', async () => {
  const sw = await loadSw();
  await sw.mirror.write('avisos', [
    entry({ id: 'b|x', taskId: 'b', title: 'Segundo', at: at('2026-11-10T15:50:00'), dueAt: at('2026-11-10T16:05:00') }),
    entry({ id: 'a|x', taskId: 'a', title: 'Primeiro' }),
    entry({ id: 'c|x', taskId: 'c', title: 'Futuro', at: at('2026-11-10T17:00:00'), dueAt: at('2026-11-10T17:15:00') }),
  ]);
  await withClock('2026-11-10T15:51:00', () => sw.dispatch('push', {}));
  assert.deepEqual(sw.notifications.map((n) => n.title), ['Primeiro', 'Segundo']);
});

test('toque do serviço: aviso já mostrado pela página é mostrado de novo com a MESMA marca (o iPhone exige uma notificação por toque)', async () => {
  const sw = await loadSw();
  const e = entry();
  await sw.mirror.write('avisos', [e]);
  await sw.mirror.write('mostrados', { [e.id]: at('2026-11-10T15:45:05') });
  await withClock('2026-11-10T15:45:40', () => sw.dispatch('push', {}));
  assert.equal(sw.notifications.length, 1);
  assert.equal(sw.notifications[0].tag, e.id, 'mesma marca: o sistema troca a notificação em vez de empilhar');
});

test('toque do serviço: sem nenhum aviso na hora, mostra um aviso genérico (nunca deixa o toque sem notificação)', async () => {
  const sw = await loadSw();
  await withClock('2026-11-10T15:45:40', () => sw.dispatch('push', {}));
  assert.equal(sw.notifications.length, 1);
  assert.equal(sw.notifications[0].title, 'Pauta');
  assert.match(sw.notifications[0].body, /lembrete/);
  // aviso muito antigo (a tarefa venceu há mais de 30 min) também cai no genérico
  const velho = await loadSw();
  await velho.mirror.write('avisos', [entry()]);
  await withClock('2026-11-10T17:00:00', () => velho.dispatch('push', {}));
  assert.equal(velho.notifications[0].title, 'Pauta');
});

test('toque do serviço: espelho ilegível não derruba o service worker', async () => {
  const sw = await loadSw();
  await sw.mirror.write('avisos', { nao: 'é uma lista' });
  await sw.mirror.write('mostrados', ['também não']);
  await withClock('2026-11-10T15:45:40', () => sw.dispatch('push', {}));
  assert.equal(sw.notifications[0].title, 'Pauta');
});

test('tocar na notificação: abre o app na tarefa; se ele já está aberto, foca e manda a tarefa', async () => {
  const fechado = await loadSw();
  let fechou = 0;
  await fechado.dispatch('notificationclick', { notification: { close: () => { fechou += 1; }, data: { taskId: 'a/b c' } } });
  assert.equal(fechou, 1);
  assert.deepEqual(fechado.opened, [`${BASE}#/tarefa/a%2Fb%20c`]);

  const aberto = await loadSw();
  const log = [];
  aberto.windows.push({ url: `${BASE}#/dia/2026-11-10`, focus: async () => { log.push('focus'); }, postMessage: (m) => log.push(m) });
  await aberto.dispatch('notificationclick', { notification: { close() {}, data: { taskId: 'tarefa1' } } });
  assert.deepEqual(log, ['focus', { type: 'abrir-tarefa', id: 'tarefa1' }]);
  assert.deepEqual(aberto.opened, []);

  const generico = await loadSw();
  await generico.dispatch('notificationclick', { notification: { close() {}, data: null } });
  assert.deepEqual(generico.opened, [BASE]);
});

test('o espelho do sw.js e o da página são o mesmo (nome do cache e endereço dos arquivos)', async () => {
  const source = await readText('sw.js');
  const alerts = await readText('js/alerts.js');
  const nome = /const MIRROR = '([^']+)'/.exec(source)?.[1];
  assert.ok(nome);
  assert.equal(nome, /const MIRROR_CACHE = '([^']+)'/.exec(alerts)?.[1]);
  assert.ok(!nome.startsWith('pauta-'), 'o activate do sw.js apaga os caches "pauta-*" antigos: o espelho não pode ter esse prefixo');
});

// ---------- alarme: um toque por minuto, e cada toque mostra a notificação do alarme de novo ----------
const alarme = (over = {}) => ({
  id: 'tarefa1|2026-11-11T09:00:00.000Z', taskId: 'tarefa1', title: 'Acordar', at: at('2026-11-11T06:00:00'), dueAt: at('2026-11-11T06:00:00'),
  date: '2026-11-11', time: '06:00', remind: 0, alarm: true, body: 'Alarme · Hoje às 06:00. Toque para parar ou adiar.', day: 'Hoje às 06:00', ...over,
});

test('alarme: cada toque do serviço mostra a notificação do alarme, com a mesma marca e o pedido de chamar a atenção', async () => {
  const sw = await loadSw();
  const a = alarme();
  await sw.mirror.write('avisos', [a]);
  await withClock('2026-11-11T06:00:05', () => sw.dispatch('push', {}));
  await withClock('2026-11-11T06:04:05', () => sw.dispatch('push', {}));
  await withClock('2026-11-11T06:09:05', () => sw.dispatch('push', {}));
  assert.equal(sw.notifications.length, 3, 'um por toque');
  for (const n of sw.notifications) {
    assert.equal(n.title, 'Acordar');
    assert.equal(n.body, 'Alarme · Hoje às 06:00. Toque para parar ou adiar.');
    assert.equal(n.tag, alarmTag(a.id));
    assert.equal(n.renotify, true, 'a nova notificação chama a atenção de novo');
    assert.equal(n.requireInteraction, true);
    assert.deepEqual(n.vibrate, ALARM_VIBRATION);
    assert.deepEqual(n.data, { taskId: 'tarefa1', alarm: true, id: a.id });
    assert.equal(n.timestamp, a.dueAt);
  }
  assert.equal(await sw.mirror.read('mostrados'), null, 'alarme não entra na lista de avisos já mostrados');
});

test('alarme: as opções da notificação são as mesmas da página (js/ui/notify.js) e as do service worker', async () => {
  const sw = await loadSw();
  const a = alarme();
  await sw.mirror.write('avisos', [a]);
  await withClock('2026-11-11T06:00:05', () => sw.dispatch('push', {}));
  const { title, ...doSw } = sw.notifications[0];
  assert.equal(title, a.title);
  assert.deepEqual(doSw, alarmNotificationOptions(a));
});

test('alarme: o relógio do aparelho alguns segundos atrasado ainda toca; passou da janela de toques, vira aviso comum', async () => {
  const cedo = await loadSw();
  await cedo.mirror.write('avisos', [alarme()]);
  await withClock('2026-11-11T05:59:55', () => cedo.dispatch('push', {}));
  assert.equal(cedo.notifications[0].renotify, true, 'dentro da tolerância');

  const tarde = await loadSw();
  const a = alarme();
  await tarde.mirror.write('avisos', [a]);
  await withClock('2026-11-11T06:12:00', () => tarde.dispatch('push', {}));
  assert.equal(tarde.notifications.length, 1);
  const n = tarde.notifications[0];
  assert.equal(n.tag, a.id, 'sem a marca de alarme');
  assert.equal(n.renotify, undefined);
  assert.equal(n.body, 'Hoje às 06:00', 'atrasado: só o dia e a hora');
  assert.deepEqual(n.data, { taskId: 'tarefa1' });

  const longe = await loadSw();
  await longe.mirror.write('avisos', [alarme()]);
  await withClock('2026-11-11T07:00:00', () => longe.dispatch('push', {}));
  assert.equal(longe.notifications[0].title, 'Pauta', 'uma hora depois nem aviso comum faz sentido: genérico, mas sempre uma notificação');
});

test('alarme: alarme e aviso comum no mesmo toque saem juntos; a página tirou o alarme parado e o toque cai no aviso genérico', async () => {
  const sw = await loadSw();
  await sw.mirror.write('avisos', [alarme(), entry({ id: 'b|x', taskId: 'b', title: 'Reunião', at: at('2026-11-11T05:55:00'), dueAt: at('2026-11-11T06:05:00') })]);
  await withClock('2026-11-11T06:00:30', () => sw.dispatch('push', {}));
  assert.deepEqual(sw.notifications.map((n) => n.title), ['Acordar', 'Reunião']);
  assert.deepEqual(sw.notifications.map((n) => Boolean(n.renotify)), [true, false]);

  const parado = await loadSw();
  await parado.mirror.write('avisos', []); // a página tirou o alarme da lista ao parar
  await withClock('2026-11-11T06:03:05', () => parado.dispatch('push', {}));
  assert.equal(parado.notifications.length, 1);
  assert.equal(parado.notifications[0].title, 'Pauta');
});

test('tocar na notificação do alarme: abre o app, ou foca e pede a tela do alarme (sem abrir o editor da tarefa)', async () => {
  const dados = { taskId: 'tarefa1', alarm: true, id: 'tarefa1|x' };
  const fechado = await loadSw();
  await fechado.dispatch('notificationclick', { notification: { close() {}, data: dados } });
  assert.deepEqual(fechado.opened, [BASE], 'a página, ao abrir, confere se algum alarme ainda toca');

  const aberto = await loadSw();
  const log = [];
  aberto.windows.push({ url: `${BASE}#/dia/2026-11-11`, focus: async () => { log.push('focus'); }, postMessage: (m) => log.push(m) });
  await aberto.dispatch('notificationclick', { notification: { close() {}, data: dados } });
  assert.deepEqual(log, ['focus', { type: 'abrir-alarme' }]);
  assert.deepEqual(aberto.opened, []);
});

test('sw.js e js/alarm.js combinam: janela de toques, vibração e a marca da notificação do alarme', async () => {
  const source = await readText('sw.js');
  const janela = /const ALARM_PUSH_MS = ([^;]+);/.exec(source)?.[1];
  assert.ok(janela);
  assert.equal(new Function(`return ${janela}`)(), PUSH_WINDOW_MS + 30000, 'a janela do sw.js é a de js/alarm.js mais 30 s de folga');
  const vibracao = /const ALARM_VIBRATION = (\[[^\]]+\])/.exec(source)?.[1];
  assert.deepEqual(JSON.parse(vibracao), ALARM_VIBRATION);
  assert.ok(source.includes('tag: `alarme-${r.id}`'), 'a marca é a mesma de alarmTag');
  assert.equal(alarmTag('x'), 'alarme-x');
});
