// Entender a fala com IA (js/ai.js): o pedido ao serviço, o que fazer quando ele falha e como a resposta da IA é conferida.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAi, describeAiFailure, reconcile } from '../js/ai.js';
import { interpretSpoken } from '../js/voice.js';

const T = '2026-11-06'; // sexta-feira
const NOW = new Date(2026, 10, 6, 9, 0);
const WORKER = 'https://lembretes.exemplo.workers.dev';
const opts = { today: T, now: NOW, weekStart: 1 };

const reply = (status, body) => new Response(JSON.stringify(body), { status });
const store = (value = 'on') => ({ value, get() { return this.value; }, set(v) { this.value = v; } });

/** Um app com tudo certo; cada teste troca só o que quer testar. */
function setup({ answer = () => reply(200, { texto: 'Pagar boleto dia 10', duvidas: [] }), prefs = store(), ...extra } = {}) {
  const calls = [];
  const fetchImpl = (url, init) => {
    calls.push({ url, init });
    return answer(url, init);
  };
  const ai = createAi({
    workerUrl: WORKER, getToken: async () => 'token-do-login', isLoggedIn: () => true, prefs, env: { navigator: { onLine: true } }, fetchImpl, ...extra,
  });
  return { ai, calls, prefs };
}

test('pede à IA com o token do login e só o necessário: a frase, o dia de hoje e a hora de agora', async () => {
  const { ai, calls } = setup();
  const r = await ai.rewrite('crie uma tarefa pagar boleto dia dez', { today: T, now: NOW });
  assert.deepEqual(r, { ok: true, texto: 'Pagar boleto dia 10', duvidas: [] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${WORKER}/interpretar`);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer token-do-login');
  assert.deepEqual(JSON.parse(calls[0].init.body), { fala: 'crie uma tarefa pagar boleto dia dez', hoje: T, agora: '09:00' });
  assert.deepEqual(Object.keys(JSON.parse(calls[0].init.body)).sort(), ['agora', 'fala', 'hoje'], 'nada além disso sai do aparelho');
});

test('frase muito longa é cortada em 400 caracteres antes de sair', async () => {
  const { ai, calls } = setup();
  await ai.rewrite('a'.repeat(900), { today: T, now: NOW });
  assert.equal(JSON.parse(calls[0].init.body).fala.length, 400);
});

test('desligada (o padrão), sem serviço, sem login ou sem internet: nem tenta, e diz por quê', async () => {
  const off = setup({ prefs: store('off') });
  assert.deepEqual(await off.ai.rewrite('pagar boleto', { today: T }), { ok: false, reason: 'off' });
  assert.equal(setup({ prefs: store(null) }).ai.available(), false, 'sem escolha feita = desligada');
  assert.equal(off.calls.length, 0);

  const semServico = setup({ workerUrl: '' });
  assert.deepEqual(await semServico.ai.rewrite('x', { today: T }), { ok: false, reason: 'config' });
  const http = setup({ workerUrl: 'http://inseguro.exemplo' });
  assert.equal(http.ai.status().configured, false, 'só https');

  const semLogin = setup({ isLoggedIn: () => false });
  assert.deepEqual(await semLogin.ai.rewrite('x', { today: T }), { ok: false, reason: 'login' });

  const semRede = setup({ env: { navigator: { onLine: false } } });
  assert.deepEqual(await semRede.ai.rewrite('x', { today: T }), { ok: false, reason: 'offline' });
  for (const s of [semServico, http, semLogin, semRede]) assert.equal(s.calls.length, 0);
});

test('available() só é verdadeiro com tudo junto; setOn guarda a escolha neste aparelho', () => {
  const prefs = store('off');
  const { ai } = setup({ prefs });
  assert.equal(ai.on, false);
  assert.equal(ai.available(), false);
  ai.setOn(true);
  assert.equal(prefs.value, 'on');
  assert.equal(ai.on, true);
  assert.equal(ai.available(), true);
  assert.deepEqual(ai.status(), { on: true, configured: true, loggedIn: true, online: true });
  ai.setOn(false);
  assert.equal(prefs.value, 'off');
});

test('cada falha do serviço vira um motivo claro (login, limite, indisponível, erro) e nunca lança', async () => {
  const motivo = async (answer, extra = {}) => (await setup({ answer, ...extra }).ai.rewrite('x', { today: T, now: NOW })).reason;
  assert.equal(await motivo(() => reply(401, { error: 'login inválido' })), 'login');
  assert.equal(await motivo(() => reply(429, { error: 'muitos pedidos' })), 'limit');
  assert.equal(await motivo(() => reply(503, { error: 'ia_indisponivel' })), 'unavailable');
  assert.equal(await motivo(() => reply(502, { error: 'resposta da ia inválida' })), 'error');
  assert.equal(await motivo(() => reply(500, {})), 'error');
  assert.equal(await motivo(() => reply(200, { semTexto: true })), 'error');
  assert.equal(await motivo(() => reply(200, { texto: 'a', duvidas: 'não é lista' })), 'error');
  assert.equal(await motivo(() => new Response('isto não é json', { status: 200 })), 'error');
  assert.equal(await motivo(() => { throw new TypeError('Failed to fetch'); }), 'offline');
  assert.equal(await motivo(() => reply(200, { texto: 'a', duvidas: [] }), { getToken: async () => { throw Object.assign(new Error('x'), { code: 'session' }); } }), 'login');
  assert.equal(await motivo(() => reply(200, { texto: 'a', duvidas: [] }), { getToken: async () => { throw Object.assign(new Error('x'), { code: 'network' }); } }), 'offline');
});

test('demora demais: desiste no tempo combinado e o app segue com as regras', async () => {
  const hang = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const { ai } = setup({ answer: hang, timeoutMs: 30 });
  const t0 = Date.now();
  assert.deepEqual(await ai.rewrite('x', { today: T, now: NOW }), { ok: false, reason: 'timeout' });
  assert.ok(Date.now() - t0 < 1000);
});

test('as dúvidas da IA vêm limpas (só texto, no máximo 3)', async () => {
  const { ai } = setup({ answer: () => reply(200, { texto: 'dia 12', duvidas: ['Qual é a tarefa?', '', 7, 'Qual hora?', 'três', 'quatro'] }) });
  const r = await ai.rewrite('x', { today: T, now: NOW });
  assert.deepEqual(r.duvidas, ['Qual é a tarefa?', 'Qual hora?', 'três']);
});

test('todo motivo tem uma mensagem em português simples', () => {
  for (const reason of ['off', 'config', 'login', 'offline', 'limit', 'unavailable', 'timeout', 'error']) assert.match(describeAiFailure(reason), /\S{3}/, reason);
  assert.equal(describeAiFailure('algo novo'), describeAiFailure('error'));
});

// ---------- juntar a resposta da IA com o que a fala dizia ----------
const juntar = (heard, aiText) => reconcile(aiText, heard, interpretSpoken(heard, opts), opts);
const lido = (linha) => { const r = interpretSpoken(linha, opts); return { title: r.title, date: r.date, time: r.time, remind: r.remind, priority: r.priority, labels: r.labels, rep: r.recurrence?.freq ?? null }; };
const SEM = { date: null, time: null, remind: null, priority: null, labels: [], rep: null };

test('reconcile: quando a IA e a fala concordam, a linha da IA fica como está', () => {
  const linha = juntar('então cria aí uma tarefa pagar o boleto da faculdade dia dez às quatro da tarde', 'Pagar o boleto da faculdade dia 10 às 16:00');
  assert.equal(linha, 'Pagar o boleto da faculdade dia 10 às 16:00');
  assert.deepEqual(lido(linha), { ...SEM, title: 'Pagar o boleto da faculdade', date: '2026-11-10', time: '16:00' });
});

test('reconcile: o que a IA inventou, sem sinal nenhum na fala, sai da linha', () => {
  assert.equal(juntar('comprar pão', 'Comprar pão amanhã'), 'Comprar pão');
  assert.equal(juntar('ligar para o João', 'Ligar para o João às 15:00'), 'Ligar para o João');
  assert.equal(juntar('ligar para o João', 'Ligar para o João !urgente'), 'Ligar para o João');
  assert.equal(juntar('ligar para o João', 'Ligar para o João toda segunda'), 'Ligar para o João');
  assert.equal(juntar('ligar para o João', 'Ligar para o João me avise 15 minutos antes'), 'Ligar para o João');
  assert.equal(juntar('ligar para o João', 'Ligar para o João #trabalho'), 'Ligar para o João');
  const tudo = juntar('ligar para o João', 'Ligar para o João amanhã às 15:00 !alta #trabalho toda segunda me avise 15 minutos antes');
  assert.deepEqual(lido(tudo), { ...SEM, title: 'Ligar para o João' });
});

test('reconcile: com sinal na fala, o que a IA entendeu fica (até com número por extenso e período do dia)', () => {
  assert.deepEqual(lido(juntar('reunião amanhã às três da tarde', 'Reunião amanhã às 15:00')), { ...SEM, title: 'Reunião', date: '2026-11-07', time: '15:00' });
  assert.deepEqual(lido(juntar('estudar inglês toda segunda e quarta às sete da noite etiqueta estudos', 'Estudar inglês toda segunda e quarta às 19:00 #estudos')),
    { ...SEM, title: 'Estudar inglês', date: '2026-11-09', time: '19:00', labels: ['estudos'], rep: 'week' });
  assert.deepEqual(lido(juntar('pagar a luz com prioridade urgente', 'Pagar a luz !urgente')), { ...SEM, title: 'Pagar a luz', priority: 4 });
  assert.equal(lido(juntar('tirar o bolo do forno daqui a vinte minutos', 'Tirar o bolo do forno daqui a 20 minutos')).time, '09:20', 'hora relativa continua valendo');
});

test('reconcile: o que a fala tinha e a IA deixou cair volta para a linha', () => {
  const hora = juntar('pagar boleto dia dez às dezesseis horas', 'Pagar boleto dia 10');
  assert.deepEqual(lido(hora), { ...SEM, title: 'Pagar boleto', date: '2026-11-10', time: '16:00' });
  const etiqueta = juntar('comprar pão com a etiqueta casa', 'Comprar pão');
  assert.deepEqual(lido(etiqueta), { ...SEM, title: 'Comprar pão', labels: ['casa'] });
  const lembrete = juntar('reunião amanhã às 14h me avise quinze minutos antes', 'Reunião amanhã às 14:00');
  assert.deepEqual(lido(lembrete), { ...SEM, title: 'Reunião', date: '2026-11-07', time: '14:00', remind: 15 });
  const prioridade = juntar('revisar o contrato com prioridade alta amanhã', 'Revisar o contrato amanhã');
  assert.equal(lido(prioridade).priority, 3);
});

test('reconcile: se os dois entenderam coisas diferentes, vale a IA (sem acrescentar uma segunda data)', () => {
  const linha = juntar('reunião sexta, ou melhor, na segunda', 'Reunião segunda');
  assert.equal(lido(linha).date, '2026-11-09');
  assert.equal((linha.match(/segunda|sexta/g) ?? []).length, 1);
});

test('reconcile: a IA devolveu só o dia (não achou a tarefa): sobra a linha sem título, com o dia e a hora que a fala tinha', () => {
  const linha = juntar('crie uma tarefa para dia doze às 16 horas', 'dia 12');
  const r = interpretSpoken(linha, opts);
  assert.equal(r.title, '');
  assert.equal(r.date, '2026-11-12');
  assert.equal(r.time, '16:00');
  assert.deepEqual(r.issues.map((i) => i.code), ['no-title']);
  const vazia = juntar('crie uma tarefa para dia doze', '');
  assert.equal(interpretSpoken(vazia, opts).date, '2026-11-12');
});

test('reconcile: lixo da IA (HTML, texto enorme) vira só texto de título, nunca algo executável', () => {
  const linha = juntar('pagar boleto', '<img src=x onerror=alert(1)> Pagar boleto');
  const r = interpretSpoken(linha, opts);
  assert.equal(typeof r.title, 'string');
  assert.ok(r.title.includes('Pagar boleto'));
});
