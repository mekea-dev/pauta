// Alarme: o lembrete que toca como despertador (js/alarm.js, js/alarm-sound.js) e como ele se liga à tarefa, às frases e à IA.
import test from 'node:test';
import assert from 'node:assert/strict';
import { beepSamples, createAlarmSound } from '../js/alarm-sound.js';
import {
  ALARM_STATE_KEY, ALARM_VIBRATION, PUSH_COUNT, PUSH_EVERY_MS, PUSH_WINDOW_MS, RING_MS, alarmEntries, alarmTag, cleanAlarmState, createAlarmState,
  isRinging, nextEdge, pushTimes, snoozeUntil,
} from '../js/alarm.js';
import { reconcile } from '../js/ai.js';
import { createTask, sanitizeTask } from '../js/model.js';
import { parseQuickAdd } from '../js/parser.js';
import { due, reminderEntries, remindBrief, remindDescribe, upcoming } from '../js/reminders.js';
import { createStore } from '../js/store.js';
import { interpretSpoken } from '../js/voice.js';

const at = (s) => new Date(s); // "2026-11-10T06:00:00" = hora local
const mk = (partial) => createTask({ title: 'Acordar', ...partial });
const alarmTask = (over = {}) => mk({ date: '2026-11-10', time: '06:00', remind: 0, alarm: true, ...over });

// ---------- a tarefa ----------

test('alarme só existe junto com um lembrete (senão vira falso) e só o valor true vale', () => {
  const base = { title: 'Acordar', date: '2026-11-10', time: '06:00' };
  assert.equal(createTask({ ...base, remind: 0, alarm: true }).alarm, true);
  assert.equal(createTask({ ...base, remind: 15, alarm: true }).alarm, true, 'também com antecedência');
  assert.equal(createTask({ ...base, alarm: true }).alarm, false, 'sem lembrete');
  assert.equal(createTask({ title: 'X', remind: 0, alarm: true }).alarm, false, 'sem data e hora');
  assert.equal(createTask({ ...base, remind: 0, alarm: 'sim' }).alarm, false);
  assert.equal(createTask({ ...base, remind: 15 }).alarm, false, 'lembrete comum');
  assert.equal(sanitizeTask({ id: 'a', ...base, remind: 5, alarm: true }).alarm, true, 'vindo de fora (nuvem, backup)');
  assert.equal(sanitizeTask({ id: 'a', ...base, remind: null, alarm: true }).alarm, false);
  assert.equal(sanitizeTask({ id: 'a', ...base, time: 'xx', remind: 5, alarm: true }).alarm, false);
});

test('alarme acompanha a tarefa: editar mantém, tirar o lembrete tira o alarme, a próxima ocorrência e a cópia herdam', () => {
  const store = createStore({ tasks: [], labels: [], settings: {} }, { clock: () => new Date('2026-11-06T10:00:00') });
  const t = store.addTask({ title: 'Acordar', date: '2026-11-10', time: '06:00', remind: 0, alarm: true, recurrence: { freq: 'day', interval: 1 } });
  assert.equal(store.find(t.id).alarm, true);
  store.updateTask(t.id, { alarm: false });
  assert.equal(store.find(t.id).alarm, false);
  store.updateTask(t.id, { alarm: true, remind: 15 });
  assert.deepEqual([store.find(t.id).alarm, store.find(t.id).remind], [true, 15]);
  store.updateTask(t.id, { remind: null });
  assert.equal(store.find(t.id).alarm, false, 'sem lembrete não há alarme');
  store.updateTask(t.id, { remind: 0, alarm: true });
  assert.equal(store.duplicateTask(t.id).alarm, true);
  assert.equal(store.toggleDone(t.id).spawned.alarm, true, 'a próxima ocorrência herda o alarme');
});

// ---------- lembretes comuns e alarmes ----------

test('upcoming e due só trazem os lembretes comuns; reminderEntries traz os dois, com alarm: true só no alarme', () => {
  const comum = mk({ title: 'Reunião', date: '2026-11-10', time: '16:00', remind: 15 }); // aviso 15:45
  const alarme = alarmTask({ time: '16:05' }); // toca 16:05
  assert.deepEqual(upcoming([comum, alarme], at('2026-11-10T08:00:00')).map((x) => x.taskId), [comum.id]);
  assert.deepEqual(due([comum, alarme], at('2026-11-10T16:10:00')).map((x) => x.taskId), [comum.id], 'o alarme tem o motor dele');
  const todos = reminderEntries([alarme, comum]);
  assert.deepEqual(todos.map((e) => e.taskId), [comum.id, alarme.id], 'em ordem de horário');
  assert.deepEqual(todos.map((e) => e.alarm ?? false), [false, true]);
  assert.equal(Object.hasOwn(todos[0], 'alarm'), false, 'o aviso comum não ganha o campo');
});

test('rótulos do alarme: por extenso e curtos', () => {
  assert.equal(remindDescribe(0, true), 'Alarme na hora');
  assert.equal(remindDescribe(15, true), 'Alarme 15 minutos antes');
  assert.equal(remindDescribe(60, true), 'Alarme 1 hora antes');
  assert.equal(remindDescribe(15), '15 minutos antes');
  assert.equal(remindDescribe(0), 'Na hora');
  assert.equal(remindBrief(0, true), 'alarme');
  assert.equal(remindBrief(15, true), 'alarme 15 min');
  assert.equal(remindBrief(60, true), 'alarme 1 h');
  assert.equal(remindBrief(15), '15 min');
  assert.equal(remindBrief(0), 'na hora');
});

// ---------- js/alarm.js ----------

test('alarmEntries: só alarmes de tarefas abertas, na hora marcada, com o texto da notificação pronto', () => {
  const a = alarmTask({ title: 'Acordar' });
  const comum = mk({ date: '2026-11-10', time: '07:00', remind: 15 });
  const feita = { ...alarmTask(), done: true };
  const lista = alarmEntries([comum, a, feita]);
  assert.equal(lista.length, 1);
  const e = lista[0];
  assert.equal(e.taskId, a.id);
  assert.equal(e.alarm, true);
  assert.equal(e.at, at('2026-11-10T06:00:00').getTime());
  assert.equal(e.day, 'Hoje às 06:00');
  assert.equal(e.body, 'Alarme · Hoje às 06:00. Toque para parar ou adiar.');
  // com antecedência: toca antes da tarefa, e o texto diz o dia em que ele toca
  const antes = alarmEntries([alarmTask({ remind: 1440 })])[0];
  assert.equal(antes.at, at('2026-11-09T06:00:00').getTime());
  assert.equal(antes.day, 'Amanhã às 06:00');
});

test('alarmEntries: parado some; adiado toca no horário novo, mantém o id e diz que foi adiado', () => {
  const a = alarmTask();
  const [e] = alarmEntries([a]);
  assert.deepEqual(alarmEntries([a], { [e.id]: { stop: 1 } }), []);
  const until = at('2026-11-10T06:05:00').getTime();
  const [s] = alarmEntries([a], { [e.id]: { until, at: until - 300000 } });
  assert.equal(s.at, until);
  assert.equal(s.firstAt, e.at);
  assert.equal(s.snoozed, true);
  assert.equal(s.id, e.id, 'parar depois ainda vale para o mesmo alarme');
  assert.equal(s.body, 'Alarme adiado · Hoje às 06:00. Toque para parar ou adiar.');
  assert.deepEqual(alarmEntries([a], { outro: { stop: 1 } }).map((x) => x.id), [e.id], 'estado de outro alarme não mexe neste');
});

test('o id do alarme muda com a hora (um alarme remarcado toca de novo, mesmo que o anterior tenha sido parado)', () => {
  const a = alarmTask();
  const [e] = alarmEntries([a]);
  const [remarcado] = alarmEntries([{ ...a, time: '06:30' }], { [e.id]: { stop: 1 } });
  assert.ok(remarcado, 'o alarme das 06:30 não herda o "parado" do das 06:00');
  assert.notEqual(remarcado.id, e.id);
});

test('isRinging: toca da hora até RING_MS; antes e depois, não', () => {
  const e = { at: 1_000_000 };
  assert.equal(isRinging(e, 999_999), false);
  assert.equal(isRinging(e, 1_000_000), true);
  assert.equal(isRinging(e, 1_000_000 + RING_MS - 1), true);
  assert.equal(isRinging(e, 1_000_000 + RING_MS), false);
});

test('nextEdge: o próximo começo ou fim de toque, ou null', () => {
  const lista = [{ at: 100 }, { at: 100 + 5000 }];
  assert.equal(nextEdge(lista, 0), 100);
  assert.equal(nextEdge(lista, 100), 5100, 'o primeiro já tocando: vem o começo do segundo');
  assert.equal(nextEdge(lista, 5100), 100 + RING_MS, 'depois, o fim do primeiro');
  assert.equal(nextEdge(lista, 5100 + RING_MS + 1), null);
  assert.equal(nextEdge([], 0), null);
});

test('snoozeUntil: daqui a N minutos, no próximo minuto cheio', () => {
  assert.equal(snoozeUntil(at('2026-11-10T06:00:20').getTime(), 5), at('2026-11-10T06:06:00').getTime());
  assert.equal(snoozeUntil(at('2026-11-10T06:00:00').getTime(), 5), at('2026-11-10T06:05:00').getTime(), 'já no minuto cheio: não anda mais');
  assert.equal(snoozeUntil(at('2026-11-10T06:00:59').getTime(), 10), at('2026-11-10T06:11:00').getTime());
});

test('pushTimes: um toque por minuto, PUSH_COUNT vezes, ids sem repetição e dentro do limite do serviço', () => {
  const [e] = alarmEntries([alarmTask()]);
  const toques = pushTimes(e);
  assert.equal(PUSH_WINDOW_MS, PUSH_COUNT * PUSH_EVERY_MS);
  assert.equal(toques.length, PUSH_COUNT);
  assert.equal(toques[0].id, e.id);
  assert.equal(toques[1].id, `${e.id}~1`);
  assert.deepEqual(toques.map((x) => x.at), Array.from({ length: PUSH_COUNT }, (_, k) => e.at + k * PUSH_EVERY_MS));
  assert.equal(new Set(toques.map((x) => x.id)).size, PUSH_COUNT);
  assert.ok(toques.every((x) => x.id.length <= 80), 'o serviço descarta ids com mais de 80 caracteres');
  assert.deepEqual(Object.keys(toques[0]).sort(), ['at', 'id'], 'nada de título saindo do aparelho');
  assert.equal(pushTimes(e, { from: e.at + 3 * PUSH_EVERY_MS }).length, PUSH_COUNT - 3, 'os que já passaram ficam de fora');
  assert.equal(alarmTag(e.id), `alarme-${e.id}`);
});

test('cleanAlarmState: descarta o velho e o estragado', () => {
  const now = at('2026-11-10T12:00:00').getTime();
  const limpo = cleanAlarmState({
    ok1: { stop: now - 1000 },
    ok2: { until: now + 60000, at: now },
    velho: { stop: now - 3 * 86400000 },
    velhoAdiado: { until: now - 3 * 86400000, at: now - 3 * 86400000 },
    lixo: 'x',
    vazio: {},
    nan: { stop: Number.NaN },
    [`${'a'.repeat(200)}`]: { stop: now },
  }, now);
  assert.deepEqual(Object.keys(limpo).sort(), ['ok1', 'ok2']);
  assert.deepEqual(limpo.ok2, { until: now + 60000, at: now });
  for (const ruim of [null, undefined, 'texto', 7, [], [{ stop: now }]]) assert.deepEqual(cleanAlarmState(ruim, now), {});
});

test('createAlarmState: guarda no armazenamento, avisa quem assinou e relê quando outra aba mexe', () => {
  const dados = new Map();
  const storage = { getItem: (k) => dados.get(k) ?? null, setItem: (k, v) => { dados.set(k, v); } };
  const clock = at('2026-11-10T06:00:00').getTime();
  const s = createAlarmState({ storage, now: () => clock });
  const avisos = [];
  s.subscribe((d) => avisos.push(Object.keys(d).sort()));
  s.stop('a', clock);
  assert.deepEqual(s.get().a, { stop: clock });
  s.snooze('b', clock + 300000, clock);
  assert.deepEqual(avisos, [['a'], ['a', 'b']]);
  assert.deepEqual(Object.keys(JSON.parse(dados.get(ALARM_STATE_KEY))).sort(), ['a', 'b']);
  const outra = createAlarmState({ storage, now: () => clock }); // outra aba: lê o mesmo
  assert.deepEqual(outra.get(), s.get());
  outra.stop('c', clock);
  s.reload();
  assert.ok(s.get().c, 'a aba relê o que a outra gravou');
  assert.equal(avisos.length, 3, 'e avisa quem assinou');
  const ruim = createAlarmState({ storage: { getItem() { throw new Error('x'); }, setItem() { throw new Error('y'); } }, now: () => clock });
  ruim.stop('z', clock);
  assert.ok(ruim.get().z, 'armazenamento que falha não derruba: vale só nesta sessão');
  assert.deepEqual(createAlarmState({ now: () => clock }).get(), {}, 'sem armazenamento nenhum');
});

// ---------- o que a pessoa escreve ou fala ----------

const T = '2026-11-06'; // sexta-feira
const NOW = new Date(2026, 10, 6, 9, 0);
const opts = { today: T, now: NOW, weekStart: 1 };
const p = (text, extra = {}) => parseQuickAdd(text, { today: T, ...extra });

test('texto: "alarme" e "despertador" ligam o alarme; "me avise" não', () => {
  const a = p('Reunião amanhã 15h alarme 15 minutos antes');
  assert.deepEqual([a.remind, a.alarm, a.title, a.time], [15, true, 'Reunião', '15:00']);
  const b = p('Reunião amanhã 15h me avise 15 minutos antes');
  assert.deepEqual([b.remind, b.alarm], [15, false]);
  const c = p('Acordar amanhã 6h com alarme');
  assert.deepEqual([c.remind, c.alarm, c.title, c.time], [0, true, 'Acordar', '06:00']);
  const d = p('Acordar amanhã 6h despertador na hora');
  assert.deepEqual([d.remind, d.alarm, d.title], [0, true, 'Acordar']);
  const e = p('Acordar amanhã 6h com um despertador');
  assert.deepEqual([e.remind, e.alarm, e.title], [0, true, 'Acordar']);
  const f = p('Reunião amanhã 15h lembrete 1 hora antes');
  assert.deepEqual([f.remind, f.alarm], [60, false]);
});

test('texto: o título que é só "alarme" (com hora) pede um alarme na hora', () => {
  for (const [texto, titulo] of [
    ['Alarme às 7h', 'Alarme'],
    ['alarme amanhã 7h', 'Alarme'],
    ['Um alarme amanhã às 7', 'Alarme'],
    ['Coloca um alarme às 6 da manhã', 'Alarme'],
    ['Despertador às 6h', 'Alarme'],
    ['Coloca um alarme para acordar amanhã às 6h', 'acordar'],
    ['Alarme para tomar o remédio às 8h', 'tomar o remédio'],
  ]) {
    const r = p(texto);
    assert.equal(r.alarm, true, texto);
    assert.equal(r.remind, 0, texto);
    assert.equal(r.title, titulo, texto);
    assert.ok(r.time, texto);
  }
});

test('texto: "alarme" dentro de um título comum, sem hora, ou ignorado pela pessoa continua sendo só título', () => {
  for (const texto of ['Alarme de incêndio instalar às 10h', 'Trocar a bateria do alarme às 10h', 'Testar o alarme da casa amanhã 9h']) {
    const r = p(texto);
    assert.deepEqual([r.alarm, r.remind], [false, null], texto);
  }
  assert.equal(p('Alarme').alarm, false, 'sem hora é só um título');
  assert.equal(p('Alarme amanhã').alarm, false);
  const ignorado = p('Alarme às 7h', { ignore: { remind: true } });
  assert.deepEqual([ignorado.alarm, ignorado.remind, ignorado.title], [false, null, 'Alarme']);
  assert.equal(p('Acordar amanhã 6h com alarme', { ignore: { remind: true } }).alarm, false);
});

test('fala: "coloca um alarme amanhã às 6 da manhã" vira a tarefa "Alarme" com alarme na hora, sem dúvida', () => {
  const r = interpretSpoken('coloca um alarme amanhã às 6 da manhã', opts);
  assert.deepEqual([r.alarm, r.remind, r.title, r.time, r.date], [true, 0, 'Alarme', '06:00', '2026-11-07']);
  assert.deepEqual(r.issues, []);
  const sem = interpretSpoken('reunião amanhã com alarme', opts);
  assert.equal(sem.alarm, true);
  assert.ok(sem.issues.some((i) => i.code === 'remind-needs-time'), 'alarme sem hora: avisa que falta a hora');
});

const juntar = (heard, aiText) => reconcile(aiText, heard, interpretSpoken(heard, opts), opts);

test('IA: o pedido de alarme que ela deixou cair volta; alarme que a fala não pediu sai', () => {
  const dito = 'coloca um alarme para acordar amanhã às 6';
  const r = interpretSpoken(juntar(dito, 'Acordar amanhã às 06:00'), opts);
  assert.deepEqual([r.alarm, r.remind, r.title, r.time], [true, 0, 'Acordar', '06:00']);
  // a IA escreveu "alarme" por conta própria; a fala só dizia "me avise"
  const inventado = interpretSpoken(juntar('reunião amanhã às 15 me avise 15 minutos antes', 'Reunião amanhã às 15:00 alarme 15 minutos antes'), opts);
  assert.deepEqual([inventado.alarm, inventado.remind], [false, 15]);
  // a fala pediu alarme e a IA entendeu: fica
  const certo = interpretSpoken(juntar('reunião amanhã às 15 alarme 10 minutos antes', 'Reunião amanhã às 15:00 alarme 10 minutos antes'), opts);
  assert.deepEqual([certo.alarm, certo.remind], [true, 10]);
});

// ---------- o som ----------

test('beepSamples: quatro bipes e uma pausa, sem passar de 1, começando em silêncio', () => {
  const rate = 8000;
  const s = beepSamples(rate);
  assert.equal(s.length, 2 * rate);
  const pico = s.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  assert.ok(pico > 0.5 && pico <= 1, `pico ${pico}`);
  assert.equal(s[0], 0, 'começa em silêncio (sem estalo)');
  const rms = (de, ate) => {
    const [i, j] = [Math.round(de * rate), Math.round(ate * rate)];
    let soma = 0;
    for (let k = i; k < j; k++) soma += s[k] ** 2;
    return Math.sqrt(soma / (j - i));
  };
  for (let k = 0; k < 4; k++) {
    assert.ok(rms(k * 0.25 + 0.03, k * 0.25 + 0.11) > 0.2, `bipe ${k}`);
    assert.ok(rms(k * 0.25 + 0.15, k * 0.25 + 0.24) < 0.001, `pausa ${k}`);
  }
  assert.ok(rms(1, 2) < 0.001, 'a pausa do fim é silêncio');
});

/** Um Web Audio de mentira. `config.resumeWorks = false`: o resume() fica pendurado, como num navegador que ainda não liberou o som. */
function fakeAudio(config = { resumeWorks: true }) {
  const log = [];
  class FakeCtx {
    constructor() { this.state = 'suspended'; this.sampleRate = 8000; this.destination = {}; log.push('novo'); }
    addEventListener() {}
    resume() {
      log.push('resume');
      if (!config.resumeWorks) return new Promise(() => {});
      this.state = 'running';
      return Promise.resolve();
    }
    createBuffer(canais, tamanho) { return { getChannelData: () => new Float32Array(tamanho) }; }
    createBufferSource() {
      return { loop: false, buffer: null, connect() { log.push('liga'); }, start() { log.push('toca'); }, stop() { log.push('para'); }, disconnect() {} };
    }
  }
  return { FakeCtx, log, config };
}
const waitMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('som do alarme: toca em volta, vibra, e para tudo ao parar', async () => {
  const audio = fakeAudio();
  const vibracoes = [];
  const env = { AudioContext: audio.FakeCtx, navigator: { vibrate: (padrao) => { vibracoes.push(padrao); return true; } }, document: { addEventListener() {}, removeEventListener() {} } };
  const som = createAlarmSound({ env });
  const r = await som.start();
  assert.equal(r.sound, true);
  assert.deepEqual([som.playing, som.blocked], [true, false]);
  assert.deepEqual(audio.log.filter((x) => ['novo', 'toca'].includes(x)), ['novo', 'toca']);
  assert.deepEqual(vibracoes[0], ALARM_VIBRATION);
  await som.start();
  assert.equal(audio.log.filter((x) => x === 'toca').length, 1, 'pedir de novo não liga um segundo som por cima');
  som.stop();
  assert.deepEqual([som.playing, som.blocked], [false, false]);
  assert.ok(audio.log.includes('para'));
  assert.equal(vibracoes.at(-1), 0, 'vibrar(0) cancela a vibração');
  await som.start(); // pode tocar de novo depois de parar, reaproveitando o mesmo Web Audio
  assert.equal(audio.log.filter((x) => x === 'novo').length, 1);
  assert.equal(audio.log.filter((x) => x === 'toca').length, 2);
  som.stop();
});

test('som do alarme: navegador que não libera o som fica "blocked" até o primeiro toque na tela', async () => {
  const audio = fakeAudio({ resumeWorks: false });
  const toques = {};
  const doc = { addEventListener: (tipo, fn) => { toques[tipo] = fn; }, removeEventListener() {} };
  const som = createAlarmSound({ env: { AudioContext: audio.FakeCtx, navigator: {}, document: doc }, resumeWaitMs: 20 });
  const mudancas = [];
  som.onChange((e) => mudancas.push(e.blocked));
  som.prepare();
  som.prepare(); // chamar de novo não registra tudo outra vez
  assert.deepEqual(Object.keys(toques).sort(), ['click', 'keydown', 'pointerdown', 'touchend']);
  const r = await som.start();
  assert.equal(r.sound, false);
  assert.equal(som.blocked, true, 'pediram para tocar, o som não saiu');
  audio.config.resumeWorks = true;
  toques.pointerdown(); // a pessoa toca na tela
  await waitMs(40);
  assert.equal(som.blocked, false);
  assert.ok(audio.log.includes('toca'));
  assert.equal(mudancas.at(-1), false, 'quem assinou (a tela do alarme) é avisado e esconde o pedido de toque');
  som.stop();
});

test('som do alarme: sem Web Audio no navegador, não quebra (e ainda vibra)', async () => {
  const vibracoes = [];
  const som = createAlarmSound({ env: { navigator: { vibrate: (p) => { vibracoes.push(p); } }, document: { addEventListener() {}, removeEventListener() {} } } });
  const r = await som.start();
  assert.equal(r.sound, false);
  assert.equal(vibracoes.length, 1);
  som.stop();
  som.prepare(); // sem document.addEventListener de verdade: também não quebra
});

test('som do alarme: quem não tem alarme não ganha um Web Audio ligado só por tocar na tela', async () => {
  const audio = fakeAudio();
  const toques = {};
  let temAlarme = false;
  const doc = { addEventListener: (tipo, fn) => { toques[tipo] = fn; }, removeEventListener() {} };
  const som = createAlarmSound({ env: { AudioContext: audio.FakeCtx, navigator: {}, document: doc }, wantsUnlock: () => temAlarme });
  som.prepare();
  toques.click();
  assert.equal(audio.log.filter((x) => x === 'novo').length, 0, 'sem alarme, nada é criado');
  temAlarme = true;
  toques.click();
  assert.equal(audio.log.filter((x) => x === 'novo').length, 1, 'com alarme, o toque libera o som');
  assert.ok(audio.log.includes('resume'));
  toques.click();
  assert.equal(audio.log.filter((x) => x === 'novo').length, 1, 'e não cria outro a cada toque');
});

test('som do alarme: o Chrome só deixa vibrar depois do primeiro toque na página: antes disso, nem tenta', async () => {
  const vibracoes = [];
  const navigator = { vibrate: (p) => { vibracoes.push(p); }, userActivation: { hasBeenActive: false } };
  const som = createAlarmSound({ env: { navigator, document: { addEventListener() {}, removeEventListener() {} } } });
  await som.start();
  assert.deepEqual(vibracoes, [], 'sem toque ainda: não vibra');
  som.stop();
  navigator.userActivation.hasBeenActive = true;
  await som.start();
  assert.equal(vibracoes.filter((v) => Array.isArray(v)).length, 1, 'depois do toque, vibra');
  som.stop();
});
