// Entender a fala com IA (js/ai.js): o pedido ao serviço, o que fazer quando ele falha e como a resposta da IA é conferida.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAi, describeAiFailure, isLiteral, reconcile } from '../js/ai.js';
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

test('ligada por padrão; desligada pela pessoa, sem serviço, sem login ou sem internet: nem tenta, e diz por quê', async () => {
  const off = setup({ prefs: store('off') });
  assert.deepEqual(await off.ai.rewrite('pagar boleto', { today: T }), { ok: false, reason: 'off' });
  assert.equal(off.ai.available(), false);
  assert.equal(off.calls.length, 0);
  for (const semEscolha of [null, undefined, '', 'qualquer-coisa']) {
    const s = setup({ prefs: store(semEscolha) });
    assert.equal(s.ai.on, true, `sem escolha feita (${JSON.stringify(semEscolha)}) = ligada`);
    assert.equal(s.ai.available(), true);
  }
  assert.equal(createAi({ workerUrl: WORKER, getToken: async () => 't', env: { navigator: { onLine: true } } }).on, true, 'nem o armazenamento é preciso');

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

test('a escolha de desligar vale na hora e na sessão, mesmo que o aparelho não deixe guardar', () => {
  const semArmazenamento = { get: () => null, set() { throw new Error('bloqueado'); } };
  const { ai } = setup({ prefs: semArmazenamento });
  assert.equal(ai.on, true);
  ai.setOn(false); // o aparelho recusa guardar...
  assert.equal(ai.on, false, '...mas a escolha vale enquanto o app está aberto');
  assert.equal(ai.available(), false);
  const guarda = { value: null, get() { return this.value; }, set(v) { this.value = v; } };
  const b = setup({ prefs: guarda });
  b.ai.setOn(false);
  assert.equal(guarda.value, 'off');
  b.ai.setOn(true);
  assert.equal(guarda.value, 'on');
  assert.equal(b.ai.on, true);
});

test('aviso do primeiro uso: só quando a IA está ligada por padrão (ninguém escolheu), uma vez por aparelho', () => {
  const guardado = { value: false, get() { return this.value; }, set() { this.value = true; } };
  const { ai } = setup({ prefs: store(null), notice: guardado });
  assert.equal(ai.needsNotice(), true);
  ai.noticed();
  assert.equal(ai.needsNotice(), false);
  assert.equal(guardado.value, true, 'guardado no aparelho');
  assert.equal(setup({ prefs: store(null), notice: guardado }).ai.needsNotice(), false, 'o app foi aberto de novo: não repete');

  const naoGuarda = setup({ prefs: store(null), notice: { get: () => false, set() { throw new Error('bloqueado'); } } });
  naoGuarda.ai.noticed(); // o aparelho recusa guardar...
  assert.equal(naoGuarda.ai.needsNotice(), false, '...então sai uma vez por sessão');

  assert.equal(setup({ prefs: store('on'), notice: { get: () => false, set() {} } }).ai.needsNotice(), false, 'quem ligou por conta própria já sabe');
  assert.equal(setup({ prefs: store('off'), notice: { get: () => false, set() {} } }).ai.needsNotice(), false, 'desligada: não há o que avisar');
  const semNotice = setup({ prefs: store(null) });
  assert.equal(semNotice.ai.needsNotice(), true);
  semNotice.ai.noticed();
  assert.equal(semNotice.ai.needsNotice(), false);
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

test('o login (renovar o token) também tem prazo: se não responde, a IA desiste e o app segue com as regras', async () => {
  const { ai, calls } = setup({ getToken: () => new Promise(() => {}), timeoutMs: 30 });
  const t0 = Date.now();
  assert.deepEqual(await ai.rewrite('x', { today: T, now: NOW }), { ok: false, reason: 'timeout' });
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(calls.length, 0, 'nem chegou a fazer o pedido');
});

test('pular a IA abandona o pedido na hora (esperando o login, esperando a resposta ou antes de começar)', async () => {
  const hang = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const skipAfter = (ms, controller) => setTimeout(() => controller.abort(), ms);

  const esperandoResposta = setup({ answer: hang, timeoutMs: 5000 });
  const a = new AbortController();
  skipAfter(10, a);
  assert.deepEqual(await esperandoResposta.ai.rewrite('x', { today: T, now: NOW, signal: a.signal }), { ok: false, reason: 'skipped' });

  const esperandoLogin = setup({ getToken: () => new Promise(() => {}), timeoutMs: 5000 });
  const b = new AbortController();
  skipAfter(10, b);
  assert.deepEqual(await esperandoLogin.ai.rewrite('x', { today: T, now: NOW, signal: b.signal }), { ok: false, reason: 'skipped' });
  assert.equal(esperandoLogin.calls.length, 0);

  const jaPulada = new AbortController();
  jaPulada.abort();
  const antes = setup();
  assert.deepEqual(await antes.ai.rewrite('x', { today: T, now: NOW, signal: jaPulada.signal }), { ok: false, reason: 'skipped' });
  assert.equal(antes.calls.length, 0);

  // sem pular, o sinal não atrapalha
  const normal = setup();
  assert.equal((await normal.ai.rewrite('x', { today: T, now: NOW, signal: new AbortController().signal })).ok, true);
});

test('as dúvidas da IA vêm limpas (só texto, no máximo 3)', async () => {
  const { ai } = setup({ answer: () => reply(200, { texto: 'dia 12', duvidas: ['Qual é a tarefa?', '', 7, 'Qual hora?', 'três', 'quatro'] }) });
  const r = await ai.rewrite('x', { today: T, now: NOW });
  assert.deepEqual(r.duvidas, ['Qual é a tarefa?', 'Qual hora?', 'três']);
});

test('todo motivo tem uma mensagem em português simples', () => {
  for (const reason of ['off', 'config', 'login', 'offline', 'limit', 'unavailable', 'timeout', 'skipped', 'error']) assert.match(describeAiFailure(reason), /\S{3}/, reason);
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

// ---------- só o que a pessoa disse ("literal") ----------
test('isLiteral: o título só pode ter palavras que a pessoa disse (tirar palavras e trocar as de ligação pode; acrescentar, não)', () => {
  assert.equal(isLiteral('Pagar a luz', 'hum anota aí pra eu pagar a luz sexta às 16 não às 17'), true, 'tirou hesitação e pedido');
  assert.equal(isLiteral('Ligar para o João', 'lembra de ligar pro João'), true, 'pro -> para o');
  assert.equal(isLiteral('Ligar para o seu José do financeiro', 'lembra de ligar pro seu José, o do financeiro'), true, 'acento não conta');
  assert.equal(isLiteral('Marcar reunião', 'marcar reuniões com o cliente'), true, 'singular e plural: mesma palavra');
  assert.equal(isLiteral('Pagar', 'pagar o boleto da faculdade'), true, 'só tirar palavras vale');
  assert.equal(isLiteral('', 'qualquer coisa'), true);
  assert.equal(isLiteral('Marcar consulta no dentista', 'marcar dentista'), false, '"consulta" foi inventada');
  assert.equal(isLiteral('Pagar a conta de luz', 'pagar a luz'), false);
  assert.equal(isLiteral('Comprar pão importante', 'comprar pão'), false);
  assert.equal(isLiteral('Comprar leite', 'comprar pão'), false, 'trocar uma palavra por outra');
  assert.equal(isLiteral('Comprar 2 pães', 'comprar dois pães'), true, 'número por extenso na fala');
  assert.equal(isLiteral('Comprar dois pães', 'comprar 2 pães'), true);
  assert.equal(isLiteral('Comprar 2 pães', 'comprar pães'), false, 'número que ninguém disse');
});

test('reconcile: título da IA com palavras que a pessoa não disse -> vale o título das regras (o que foi dito), com o resto da IA', () => {
  const heard = 'marcar dentista amanhã às três da tarde';
  assert.deepEqual(lido(juntar(heard, 'Marcar consulta no dentista amanhã às 15:00')), { ...SEM, title: 'Marcar dentista', date: '2026-11-07', time: '15:00' });
  assert.equal(lido(juntar('comprar pão', 'Fazer as compras importantes de pão')).title, 'Comprar pão');
  assert.equal(lido(juntar('ligar para o João', 'Entrar em contato com o João')).title, 'Ligar para o João');
  // o dia e a hora da IA continuam valendo; só o título volta ao que foi dito
  assert.deepEqual(lido(juntar('pagar a luz sexta às cinco da tarde', 'Pagar a conta de energia elétrica sexta às 17:00')),
    { ...SEM, title: 'Pagar a luz', date: '2026-11-13', time: '17:00' }); // (hoje é sexta: "sexta" é a da semana que vem)
});

test('reconcile: título da IA fiel ao que foi dito fica como a IA escreveu (verbo no infinitivo, sem hesitação, sem o pedido)', () => {
  assert.equal(juntar('lembra de ligar pro seu José, o do financeiro, amanhã de manhã', 'Ligar para o seu José do financeiro amanhã de manhã'), 'Ligar para o seu José do financeiro amanhã de manhã');
  assert.equal(juntar('hum comprar pão e leite', 'Comprar pão e leite'), 'Comprar pão e leite');
  assert.equal(juntar('tenho que pagar o boleto da faculdade dia dez às quatro da tarde', 'Pagar o boleto da faculdade dia 10 às 16:00'), 'Pagar o boleto da faculdade dia 10 às 16:00');
});

test('reconcile: título da IA sem fundamento e fala sem título claro -> sobra o que as regras acharam (o app abre o rascunho em vez de chutar)', () => {
  const linha = juntar('crie uma tarefa para dia doze às 16 horas', 'Reunião importante dia 12 às 16:00');
  const r = interpretSpoken(linha, opts);
  assert.equal(r.title, '', 'a IA inventou "reunião importante": não entra');
  assert.equal(r.date, '2026-11-12');
  assert.equal(r.time, '16:00');
  assert.deepEqual(r.issues.map((i) => i.code), ['no-title']);
});

test('reconcile: lixo da IA (HTML, texto enorme) vira só texto de título, nunca algo executável', () => {
  const linha = juntar('pagar boleto', '<img src=x onerror=alert(1)> Pagar boleto');
  const r = interpretSpoken(linha, opts);
  assert.equal(typeof r.title, 'string');
  assert.ok(r.title.includes('Pagar boleto'));
});
