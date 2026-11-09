// Motor dos lembretes: quando mostrar, o que anotar, o que mandar para o serviço e como ligar e desligar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PUSH_COUNT, PUSH_EVERY_MS, createAlarmState } from '../js/alarm.js';
import { createAlerts, createMirror } from '../js/alerts.js';
import { createTask } from '../js/model.js';
import { notificationEntry, upcoming } from '../js/reminders.js';

const at = (s) => new Date(s); // "2026-11-10T15:45:00" = hora local
const mk = (partial) => createTask({ title: 'Reunião', ...partial });
const settle = () => new Promise((resolve) => setTimeout(resolve, 15)); // deixa terminar o que o motor faz "em segundo plano"

/** Tudo de mentira: tarefas, espelho, serviço, tela e preferência. `clock.now` é o relógio do teste. */
function setup({ tasks = [], permission = 'granted', pushState = 'on', fireOk = true, pref = null, now = '2026-11-10T15:00:00', hidden = false } = {}) {
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
  const alarmNotes = []; // notificações do sistema para alarmes (aba escondida)
  const closed = []; // alarmes cujas notificações foram tiradas da tela
  const notify = {
    async fire(r) { if (!fireOk) return false; shown.push(r.id); return true; },
    async alarm(e) { alarmNotes.push(e.id); return true; },
    async closeAlarm(id) { closed.push(id); },
  };
  const rings = []; // o que a tela do alarme recebeu a cada conferência: os ids dos alarmes que estão tocando
  const ring = { update(list) { rings.push(list.map((e) => e.id)); } };
  const alarmState = createAlarmState({ now: () => clock.now.getTime() });
  let prefValue = pref;
  const prefs = { get: () => prefValue, set: (v) => { prefValue = v; } };
  const env = hidden ? { document: { visibilityState: 'hidden' } } : {};
  const alerts = createAlerts({ store, mirror, push, notify, prefs, now: () => clock.now, intervalMs: 3600e3, env, alarmState, ring });
  return { alerts, clock, store, data, mirror, push, sent, shown, pushLog, prefs, notify, alarmNotes, closed, rings, ring, alarmState };
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

test('aviso de teste antigo (dos botões de teste, que foram retirados) que ficou no espelho não toca nem entra na lista', async () => {
  const s = setup({ now: '2026-11-10T15:00:30' });
  const quando = at('2026-11-10T15:01:00').getTime();
  s.data.set('teste', { id: `teste|${quando}`, taskId: null, title: 'Teste do Pauta', at: quando, dueAt: quando, date: null, time: null, remind: 0, body: 'Aviso de teste com o app fechado. Funcionou!', day: 'Teste' });
  await s.alerts.start();
  assert.deepEqual(await s.mirror.read('avisos'), [], 'o espelho só tem avisos de tarefas');
  assert.deepEqual(s.sent.at(-1), [], 'o serviço de lembretes também não recebe o teste');
  s.clock.now = at('2026-11-10T15:01:30');
  assert.equal(await s.alerts.tick(), 0);
  assert.equal(s.shown.length, 0);
  s.alerts.stop();
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

// ---------- alarme: toca até a pessoa parar ou adiar ----------
const alarme = (over = {}) => mk({ date: '2026-11-10', time: '16:00', remind: 0, alarm: true, ...over });
const meuAlarme = async (s) => (await s.mirror.read('avisos')).find((e) => e.alarm);

test('alarme: não passa pelo aviso comum e vai para a tela do alarme na hora, até o tempo máximo', async () => {
  const s = setup({ tasks: [alarme()], now: '2026-11-10T15:59:30' });
  assert.equal(await s.alerts.tick(), 0);
  assert.deepEqual(s.rings.at(-1), [], 'ainda não é hora');
  s.clock.now = at('2026-11-10T16:00:02');
  assert.equal(await s.alerts.tick(), 0, 'o aviso comum não toca para alarme');
  assert.equal(s.shown.length, 0);
  assert.equal(await s.mirror.read('mostrados'), null, 'alarme não entra na lista de avisos já mostrados (toca de novo a cada toque)');
  assert.equal(s.rings.at(-1).length, 1, 'a tela do alarme recebe o alarme');
  s.clock.now = at('2026-11-10T16:29:59');
  await s.alerts.tick();
  assert.equal(s.rings.at(-1).length, 1, 'continua tocando até o tempo máximo');
  s.clock.now = at('2026-11-10T16:30:01');
  await s.alerts.tick();
  assert.deepEqual(s.rings.at(-1), [], 'ninguém mexeu: para sozinho');
});

test('alarme: o espelho leva o alarme com o texto pronto e o serviço recebe um toque por minuto (só ids e horários)', async () => {
  const comum = mk({ title: 'Reunião', date: '2026-11-10', time: '17:00', remind: 15 });
  const s = setup({ tasks: [alarme({ title: 'Acordar' }), comum] });
  await s.alerts.refresh();
  await s.alerts.sync();
  const espelho = await s.mirror.read('avisos');
  assert.equal(espelho.length, 2);
  const a = espelho.find((e) => e.alarm);
  assert.equal(a.title, 'Acordar');
  assert.equal(a.body, 'Alarme · Hoje às 16:00. Toque para parar ou adiar.');
  const lista = s.sent[0];
  assert.equal(lista.length, PUSH_COUNT + 1);
  assert.ok(lista.every((x) => Object.keys(x).sort().join() === 'at,id'), 'nada de título saindo do aparelho');
  const toques = lista.filter((x) => x.id === a.id || x.id.startsWith(`${a.id}~`)).map((x) => x.at);
  assert.deepEqual(toques, Array.from({ length: PUSH_COUNT }, (_, k) => a.at + k * PUSH_EVERY_MS));
  assert.deepEqual(lista.map((x) => x.at), lista.map((x) => x.at).sort((x, y) => x - y), 'em ordem de horário');
});

test('alarme: com muitos alarmes, a lista do serviço fica em 100 e guarda os horários mais próximos', async () => {
  const tasks = Array.from({ length: 15 }, (_, i) => alarme({ date: '2026-11-11', time: `${String(8 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}` }));
  const s = setup({ tasks });
  await s.alerts.refresh();
  await s.alerts.sync();
  const ats = s.sent[0].map((x) => x.at);
  assert.equal(ats.length, 100);
  assert.deepEqual(ats, [...ats].sort((x, y) => x - y));
  assert.equal(ats[0], at('2026-11-11T08:00:00').getTime());
});

test('alarme: parar tira a tela e a notificação, corta os toques que faltam e deixa o aviso comum', async () => {
  const comum = mk({ date: '2026-11-10', time: '17:00', remind: 15 });
  const s = setup({ tasks: [alarme(), comum], now: '2026-11-10T16:00:30' });
  await s.alerts.refresh();
  await s.alerts.sync();
  const a = await meuAlarme(s);
  assert.equal(s.sent[0].filter((x) => x.id === a.id || x.id.startsWith(`${a.id}~`)).length, PUSH_COUNT);
  s.clock.now = at('2026-11-10T16:02:10');
  await s.alerts.stopAlarm(a.id);
  await settle();
  assert.deepEqual(s.closed, [a.id]);
  assert.deepEqual(s.rings.at(-1), []);
  assert.equal(await meuAlarme(s), undefined, 'sai do espelho: o service worker não mostra mais');
  const ultima = s.sent.at(-1);
  assert.ok(ultima.every((x) => !x.id.startsWith(a.id)), 'nenhum toque do alarme parado');
  assert.equal(ultima.length, 1, 'o aviso comum das 16:45 continua');
  s.clock.now = at('2026-11-10T16:03:00');
  await s.alerts.tick();
  assert.deepEqual(s.rings.at(-1), [], 'parado não volta');
});

test('alarme: adiar some a tela e volta a tocar no próximo minuto cheio, com toques novos', async () => {
  const s = setup({ tasks: [alarme()], now: '2026-11-10T16:00:30' });
  await s.alerts.refresh();
  await s.alerts.sync();
  const a = await meuAlarme(s);
  s.clock.now = at('2026-11-10T16:02:10');
  const r = await s.alerts.snoozeAlarm(a.id, 5);
  await settle();
  assert.equal(r.until, at('2026-11-10T16:08:00').getTime());
  assert.deepEqual(s.rings.at(-1), []);
  assert.deepEqual(s.closed, [a.id]);
  const adiado = await meuAlarme(s);
  assert.deepEqual([adiado.at, adiado.snoozed, adiado.id], [r.until, true, a.id]);
  assert.deepEqual(s.sent.at(-1).map((x) => x.at), Array.from({ length: PUSH_COUNT }, (_, k) => r.until + k * PUSH_EVERY_MS));
  s.clock.now = at('2026-11-10T16:08:01');
  await s.alerts.tick();
  assert.deepEqual(s.rings.at(-1), [a.id], 'tocando de novo');
  await s.alerts.stopAlarm(a.id);
  assert.deepEqual(s.rings.at(-1), []);
});

test('alarme: avisos desligados neste aparelho não tocam o alarme', async () => {
  const mudo = setup({ tasks: [alarme()], now: '2026-11-10T16:00:10', pref: 'off' });
  await mudo.alerts.tick();
  assert.deepEqual(mudo.rings.at(-1), []);
  const ligado = setup({ tasks: [alarme()], now: '2026-11-10T16:00:10' });
  await ligado.alerts.tick();
  assert.equal(ligado.rings.at(-1).length, 1);
});

test('alarme: com a aba escondida sai uma notificação do sistema por toque; o adiado tocando de novo é outro toque', async () => {
  const s = setup({ tasks: [alarme()], now: '2026-11-10T16:00:05', hidden: true });
  await s.alerts.tick();
  await s.alerts.tick();
  const id = s.rings.at(-1)[0];
  assert.deepEqual(s.alarmNotes, [id], 'uma vez só');
  await s.alerts.snoozeAlarm(id, 5);
  s.clock.now = at('2026-11-10T16:08:01');
  await s.alerts.tick();
  assert.deepEqual(s.alarmNotes, [id, id], 'adiado e tocando de novo: outra notificação');
  const visivel = setup({ tasks: [alarme()], now: '2026-11-10T16:00:05' });
  await visivel.alerts.tick();
  assert.deepEqual(visivel.alarmNotes, [], 'aba à vista: só a tela do alarme');
});

test('alarme: outra aba parou o alarme: a tela some sozinha', async () => {
  const s = setup({ tasks: [alarme()], now: '2026-11-10T16:00:05' });
  await s.alerts.start();
  try {
    const id = s.rings.at(-1)[0];
    assert.ok(id, 'tocando');
    s.alarmState.stop(id, s.clock.now.getTime());
    assert.deepEqual(s.rings.at(-1), []);
  } finally {
    s.alerts.stop();
  }
});
