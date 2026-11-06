// Motor dos lembretes: quando mostrar, o que anotar, o que mandar para o serviço e como ligar e desligar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAlerts, createMirror } from '../js/alerts.js';
import { createTask } from '../js/model.js';
import { notificationEntry, upcoming } from '../js/reminders.js';

const at = (s) => new Date(s); // "2026-11-10T15:45:00" = hora local
const mk = (partial) => createTask({ title: 'Reunião', ...partial });
const settle = () => new Promise((resolve) => setTimeout(resolve, 15)); // deixa terminar o que o motor faz "em segundo plano"

/** Tudo de mentira: tarefas, espelho, serviço, tela e preferência. `clock.now` é o relógio do teste. */
function setup({ tasks = [], permission = 'granted', pushState = 'on', fireOk = true, pref = null, now = '2026-11-10T15:00:00' } = {}) {
  const clock = { now: at(now) };
  const store = { state: { tasks }, subs: [], subscribe(fn) { store.subs.push(fn); return () => {}; } };
  const data = new Map();
  const mirror = { async read(k, fb = null) { return data.has(k) ? structuredClone(data.get(k)) : fb; }, async write(k, v) { data.set(k, structuredClone(v)); return true; } };
  const sent = [];
  const pushLog = { enables: 0, disables: 0 };
  const push = {
    sub: pushState === 'on',
    info: () => ({ configured: pushState !== 'unconfigured', notifications: permission !== 'unsupported', push: pushState !== 'unsupported' && pushState !== 'unconfigured', permission }),
    prefetch() {},
    async subscription() { return push.sub ? {} : null; },
    async enable() { pushLog.enables += 1; push.sub = true; permission = 'granted'; return { ok: true, permission: 'granted' }; },
    async disable() { pushLog.disables += 1; push.sub = false; },
    async syncList(list) { sent.push(list); return push.next ?? { ok: true, status: 200 }; },
  };
  const shown = [];
  const notify = {
    async fire(r) { if (!fireOk) return false; shown.push(r.id); return true; },
    async system(r) { shown.push(`sistema:${r.id}`); return true; },
    inApp(r) { shown.push(`tela:${r.id}`); },
  };
  let prefValue = pref;
  const prefs = { get: () => prefValue, set: (v) => { prefValue = v; } };
  const alerts = createAlerts({ store, mirror, push, notify, prefs, now: () => clock.now, intervalMs: 3600e3, env: {} });
  return { alerts, clock, store, data, mirror, push, sent, shown, pushLog, prefs, notify };
}

test('tick: mostra o aviso na hora e só uma vez', async () => {
  const t = mk({ date: '2026-11-10', time: '16:00', remind: 15 }); // aviso 15:45
  const s = setup({ tasks: [t] });
  assert.equal(await s.alerts.tick(), 0, 'ainda não é hora');
  s.clock.now = at('2026-11-10T15:45:20');
  assert.equal(await s.alerts.tick(), 1);
  assert.equal(s.shown.length, 1);
  assert.equal(await s.alerts.tick(), 0, 'não repete');
  assert.equal(s.shown.length, 1);
  assert.deepEqual(Object.keys(await s.mirror.read('mostrados')), s.shown, 'fica anotado no espelho (o service worker lê o mesmo)');
});

test('tick: aviso que passou com o app fechado aparece ao abrir; muito atrasado, não', async () => {
  const t = mk({ date: '2026-11-10', time: '16:00', remind: 15 });
  const s = setup({ tasks: [t], now: '2026-11-10T16:10:00' });
  assert.equal(await s.alerts.tick(), 1);
  const tarde = setup({ tasks: [t], now: '2026-11-10T18:00:00' });
  assert.equal(await tarde.alerts.tick(), 0, 'a tarefa venceu há 2 horas: não incomoda');
});

test('tick: não anota como mostrado o que não apareceu (aba escondida e sem permissão): tenta de novo', async () => {
  const t = mk({ date: '2026-11-10', time: '16:00', remind: 15 });
  const s = setup({ tasks: [t], now: '2026-11-10T15:46:00', fireOk: false });
  assert.equal(await s.alerts.tick(), 0);
  assert.equal(await s.mirror.read('mostrados'), null);
  s.notify.fire = async (r) => { s.shown.push(r.id); return true; };
  assert.equal(await s.alerts.tick(), 1);
});

test('tick: o que o service worker já mostrou (com o app fechado) não aparece de novo na tela', async () => {
  const t = mk({ date: '2026-11-10', time: '16:00', remind: 15 });
  const s = setup({ tasks: [t], now: '2026-11-10T15:50:00' });
  const [aviso] = upcoming([t], at('2026-11-10T08:00:00'));
  await s.mirror.write('mostrados', { [aviso.id]: at('2026-11-10T15:45:30').getTime() });
  assert.equal(await s.alerts.tick(), 0);
});

test('tick: avisos desligados neste aparelho não tocam; tarefa concluída também não', async () => {
  const t = mk({ date: '2026-11-10', time: '16:00', remind: 15 });
  const off = setup({ tasks: [t], now: '2026-11-10T15:50:00', pref: 'off' });
  assert.equal(await off.alerts.tick(), 0);
  const feita = setup({ tasks: [{ ...t, done: true }], now: '2026-11-10T15:50:00' });
  assert.equal(await feita.alerts.tick(), 0);
});

test('tick: dois avisos juntos aparecem os dois; chamadas ao mesmo tempo não duplicam', async () => {
  const a = mk({ date: '2026-11-10', time: '16:00', remind: 15 });
  const b = mk({ date: '2026-11-10', time: '15:55', remind: 10 });
  const s = setup({ tasks: [a, b], now: '2026-11-10T15:50:00' });
  const [x, y] = await Promise.all([s.alerts.tick(), s.alerts.tick()]);
  assert.equal(x + y, 2, 'um dos ciclos fez o trabalho, o outro não repetiu');
  assert.equal(s.shown.length, 2);
});

test('sync: o espelho leva os avisos com texto pronto; o serviço só recebe id e horário', async () => {
  const t = mk({ date: '2026-11-10', time: '16:00', remind: 15 });
  const sem = mk({ date: '2026-11-10', time: '17:00' }); // sem lembrete: fora
  const s = setup({ tasks: [t, sem] });
  await s.alerts.refresh();
  await s.alerts.sync();
  const espelho = await s.mirror.read('avisos');
  assert.equal(espelho.length, 1);
  assert.equal(espelho[0].title, 'Reunião');
  assert.equal(espelho[0].body, 'Hoje às 16:00 · em 15 minutos');
  assert.equal(espelho[0].day, 'Hoje às 16:00');
  assert.equal(espelho[0].taskId, t.id);
  assert.equal(s.sent.length, 1);
  assert.deepEqual(Object.keys(s.sent[0][0]).sort(), ['at', 'id'], 'nada de título saindo do aparelho');
  assert.equal(s.sent[0][0].at, at('2026-11-10T15:45:00').getTime());
});

test('sync: não reenvia a mesma lista; muda a lista, envia; force reenvia', async () => {
  const t = mk({ date: '2026-11-10', time: '16:00', remind: 15 });
  const s = setup({ tasks: [t] });
  await s.alerts.refresh();
  await s.alerts.sync();
  await s.alerts.sync();
  assert.equal(s.sent.length, 1);
  s.store.state.tasks = [t, mk({ date: '2026-11-11', time: '09:00', remind: 60 })];
  await s.alerts.sync();
  assert.equal(s.sent.length, 2);
  assert.equal(s.sent[1].length, 2);
  await s.alerts.sync(true);
  assert.equal(s.sent.length, 3);
});

test('sync: sem inscrição no serviço só atualiza o espelho (o service worker não precisa de rede)', async () => {
  const s = setup({ tasks: [mk({ date: '2026-11-10', time: '16:00', remind: 15 })], pushState: 'off' });
  await s.alerts.refresh();
  await s.alerts.sync();
  assert.equal((await s.mirror.read('avisos')).length, 1);
  assert.equal(s.sent.length, 0);
});

test('sync: aviso que acabou de vencer fica no espelho (o "toque" chega alguns segundos depois), mas o já mostrado sai da lista do serviço', async () => {
  const t = mk({ date: '2026-11-10', time: '16:00', remind: 15 });
  const s = setup({ tasks: [t], now: '2026-11-10T15:45:20' });
  await s.alerts.refresh();
  await s.alerts.sync();
  assert.equal((await s.mirror.read('avisos')).length, 1, 'no espelho');
  assert.equal(s.sent.at(-1).length, 1, 'ainda pendente: o serviço vai tocar');
  await s.alerts.tick(); // a página mostrou
  await settle();
  assert.deepEqual(s.sent.at(-1), [], 'agora o serviço pode largar');
  assert.equal((await s.mirror.read('avisos')).length, 1, 'o espelho continua com ele');
});

test('sync: falha do serviço vira "detail" e a mesma lista é tentada de novo depois', async () => {
  const t = mk({ date: '2026-11-10', time: '16:00', remind: 15 });
  const s = setup({ tasks: [t] });
  await s.alerts.refresh();
  s.push.next = { ok: false, reason: 'network' };
  await s.alerts.sync();
  assert.match(s.alerts.status().detail, /sem conexão/);
  s.push.next = { ok: true, status: 200 };
  await s.alerts.sync();
  assert.equal(s.alerts.status().detail, '');
  assert.equal(s.sent.length, 2, 'não deu por enviada a lista que falhou');
});

test('enable e disable: guardam a escolha, inscrevem e atualizam o estado', async () => {
  const s = setup({ tasks: [mk({ date: '2026-11-10', time: '16:00', remind: 15 })], permission: 'default', pushState: 'off' });
  await s.alerts.refresh();
  assert.deepEqual([s.alerts.status().permission, s.alerts.status().push], ['default', 'off']);
  const changes = [];
  s.alerts.onChange((st) => changes.push(`${st.permission}/${st.push}`));
  const r = await s.alerts.enable();
  assert.equal(r.ok, true);
  assert.equal(s.prefs.get(), 'on');
  assert.deepEqual([s.alerts.status().permission, s.alerts.status().push], ['granted', 'on']);
  assert.equal(s.sent.length, 1, 'já manda a lista');
  assert.ok(changes.includes('granted/on'));
  await s.alerts.disable();
  assert.equal(s.prefs.get(), 'off');
  assert.equal(s.alerts.status().muted, true);
  assert.equal(s.alerts.status().push, 'off');
  assert.equal(s.pushLog.disables, 1);
});

test('start: refaz a inscrição que sumiu (permissão já dada), mostra o que está na hora e liga o relógio', async () => {
  const t = mk({ date: '2026-11-10', time: '16:00', remind: 15 });
  const s = setup({ tasks: [t], now: '2026-11-10T15:50:00', pushState: 'off' });
  await s.alerts.start();
  assert.equal(s.pushLog.enables, 1, 'reinscreveu sem perguntar');
  assert.equal(s.alerts.status().push, 'on');
  assert.equal(s.shown.length, 1, 'e já mostrou o aviso que estava na hora');
  assert.equal(s.store.subs.length, 1, 'passa a acompanhar as mudanças nas tarefas');
  s.alerts.stop();
});

test('start: com os avisos desligados pela pessoa, não reinscreve nem toca', async () => {
  const s = setup({ tasks: [mk({ date: '2026-11-10', time: '16:00', remind: 15 })], now: '2026-11-10T15:50:00', pushState: 'off', pref: 'off' });
  await s.alerts.start();
  assert.equal(s.pushLog.enables, 0);
  assert.equal(s.shown.length, 0);
  s.alerts.stop();
});

test('start: ao voltar para a frente o app confere na hora', async () => {
  const t = mk({ date: '2026-11-10', time: '16:00', remind: 15 });
  const listeners = {};
  const env = { document: { visibilityState: 'visible', addEventListener: (type, fn) => { listeners[type] = fn; } }, addEventListener: (type, fn) => { listeners[type] = fn; } };
  const s = setup({ tasks: [t], now: '2026-11-10T15:00:00' });
  const alerts = createAlerts({ store: s.store, mirror: s.mirror, push: s.push, notify: s.notify, prefs: s.prefs, now: () => s.clock.now, intervalMs: 3600e3, env });
  await alerts.start();
  assert.equal(s.shown.length, 0);
  s.clock.now = at('2026-11-10T15:46:00');
  listeners.visibilitychange();
  await settle();
  assert.equal(s.shown.length, 1);
  // aba escondida: não confere (quem avisa é o service worker); ao voltar para a frente, confere
  s.store.state.tasks = [t, mk({ date: '2026-11-10', time: '16:05', remind: 0 })];
  s.clock.now = at('2026-11-10T16:06:00');
  env.document.visibilityState = 'hidden';
  listeners.visibilitychange();
  await settle();
  assert.equal(s.shown.length, 1);
  env.document.visibilityState = 'visible';
  listeners.visibilitychange();
  await settle();
  assert.equal(s.shown.length, 2);
  alerts.stop();
});

test('teste "daqui a 1 minuto": entra no espelho e na lista do serviço, e toca na hora marcada', async () => {
  const s = setup({ now: '2026-11-10T15:00:00' });
  await s.alerts.refresh();
  const r = await s.alerts.test({ later: true });
  assert.equal(r.later, true);
  assert.equal(r.push, true);
  const espelho = await s.mirror.read('avisos');
  assert.equal(espelho.length, 1);
  assert.equal(espelho[0].body, 'Aviso de teste com o app fechado. Funcionou!');
  assert.equal(espelho[0].taskId, null);
  assert.equal(s.sent.at(-1).length, 1);
  // outras mudanças nas tarefas não derrubam o teste da lista
  await s.alerts.sync();
  assert.equal((await s.mirror.read('avisos')).length, 1);
  assert.equal(await s.alerts.tick(), 0, 'ainda não passou 1 minuto');
  s.clock.now = at('2026-11-10T15:01:05');
  assert.equal(await s.alerts.tick(), 1);
  // o teste sobrevive a recarregar a página
  const depois = setup({ now: '2026-11-10T15:00:30' });
  depois.data.set('teste', await s.mirror.read('teste'));
  await depois.alerts.start();
  assert.equal((await depois.mirror.read('avisos')).length, 1);
  depois.alerts.stop();
});

test('teste "agora": usa a notificação do sistema; sem permissão, mostra na tela', async () => {
  const s = setup({ permission: 'granted' });
  await s.alerts.refresh();
  assert.deepEqual(await s.alerts.test(), { later: false, system: true });
  assert.ok(s.shown.some((x) => x.startsWith('sistema:')));
  const sem = setup({ permission: 'default', pushState: 'off' });
  await sem.alerts.refresh();
  const r = await sem.alerts.test();
  assert.equal(r.system, false);
  assert.ok(sem.shown.some((x) => x.startsWith('tela:')));
});

test('estado: sem serviço configurado ou sem suporte a push, os avisos com o app aberto seguem valendo', async () => {
  const a = setup({ pushState: 'unconfigured' });
  await a.alerts.refresh();
  assert.equal(a.alerts.status().push, 'unconfigured');
  const b = setup({ pushState: 'unsupported' });
  await b.alerts.refresh();
  assert.equal(b.alerts.status().push, 'unsupported');
  const c = setup({ permission: 'denied', pushState: 'off' });
  await c.alerts.refresh();
  assert.equal(c.alerts.status().permission, 'denied');
});

// ---------- o espelho (cache compartilhado com o service worker) ----------
function fakeCaches() {
  const stores = new Map();
  return {
    stores,
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const files = stores.get(name);
      return {
        async match(url) { const text = files.get(typeof url === 'string' ? url : url.url); return text === undefined ? undefined : new Response(text); },
        async put(url, response) { files.set(typeof url === 'string' ? url : url.url, await response.text()); },
      };
    },
  };
}

test('espelho: grava e lê JSON num cache com nome fixo (o service worker usa o mesmo)', async () => {
  const caches = fakeCaches();
  const m = createMirror({ cacheStorage: caches, base: 'https://usuario.github.io/pauta/#/dia/2026-11-10' });
  assert.equal(await m.read('avisos', 'vazio'), 'vazio');
  assert.equal(await m.write('avisos', [{ id: 'a' }]), true);
  assert.deepEqual(await m.read('avisos'), [{ id: 'a' }]);
  assert.deepEqual([...caches.stores.keys()], ['avisos-v1']);
  assert.deepEqual([...caches.stores.get('avisos-v1').keys()], ['https://usuario.github.io/pauta/__avisos.json']);
});

test('espelho: se o cache falhar (modo privado, sem espaço), devolve o padrão e segue', async () => {
  const quebrado = createMirror({ cacheStorage: { open: async () => { throw new Error('bloqueado'); } }, base: 'https://x.test/' });
  assert.equal(await quebrado.read('avisos', 7), 7);
  assert.equal(await quebrado.write('avisos', []), false);
  const semCache = createMirror({ cacheStorage: undefined, base: 'https://x.test/' });
  assert.equal(await semCache.read('avisos', 'padrão'), 'padrão');
});

test('notificationEntry: o texto vale para a hora do aviso', () => {
  const [r] = upcoming([mk({ date: '2026-11-10', time: '16:00', remind: 15 })], at('2026-11-10T08:00:00'));
  const n = notificationEntry(r);
  assert.equal(n.body, 'Hoje às 16:00 · em 15 minutos');
  assert.equal(n.day, 'Hoje às 16:00');
});
