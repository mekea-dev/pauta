// Login e sincronização contra o "Firebase de mentira" (tests/helpers/fake-firebase.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { connect, disconnect, removeAccount } from '../js/cloud/account.js';
import { createCloud, mapAuthError } from '../js/cloud/firebase.js';
import { createSync } from '../js/cloud/sync.js';
import { defaultSettings, seedState } from '../js/model.js';
import { memoryStorage } from '../js/persist.js';
import { createStore } from '../js/store.js';
import { FAKE_CONFIG as CONFIG, createFakeFirebase } from './helpers/fake-firebase.js';

const clock = { t: Date.parse('2026-11-06T10:00:00.000Z') };
const tick = (ms = 60000) => { clock.t += ms; };
const now = () => clock.t;
const PASS = 'senha-segura';
const EMAIL = 'ana@exemplo.com';
const waitFor = async (cond, ms = 2000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timeout esperando a condição');
    await new Promise((r) => setTimeout(r, 0));
  }
};
const empty = (extra = {}) => ({ version: 1, tasks: [], labels: [], settings: defaultSettings(), ...extra });
const titles = (store) => store.state.tasks.map((t) => t.title).sort();

/** Um aparelho: estado, cliente da nuvem, motor de sincronização e um relógio de "timers" que só anota os agendamentos. */
function newDevice(fb, initial) {
  const storage = memoryStorage();
  const store = createStore(initial ?? empty(), { clock: () => new Date(clock.t) });
  const cloud = createCloud({ config: CONFIG, fetchImpl: fb.fetch, now, storage });
  const scheduled = [];
  const timers = { setTimeout: (fn, ms) => { scheduled.push({ fn, ms }); return scheduled.length; }, clearTimeout: () => {} };
  const sync = createSync({ store, cloud, config: CONFIG, clock: now, timers });
  return { store, cloud, sync, scheduled, storage };
}
async function signUpDevice(fb, email = EMAIL, initial) {
  const d = newDevice(fb, initial);
  const s = await d.cloud.signUp(email, PASS, 'FAMILIA');
  d.store.setOwner(s.uid);
  return d;
}
async function signInDevice(fb, email = EMAIL, initial) {
  const d = newDevice(fb, initial);
  const s = await d.cloud.signIn(email, PASS);
  d.store.setOwner(s.uid);
  return d;
}

// ---------- cliente: login e banco ----------

test('mensagens de erro do Firebase viram texto em português', () => {
  assert.equal(mapAuthError('EMAIL_EXISTS').code, 'exists');
  assert.match(mapAuthError('EMAIL_EXISTS').message, /Já existe uma conta/);
  assert.equal(mapAuthError('WEAK_PASSWORD : Password should be at least 6 characters').code, 'weak');
  assert.equal(mapAuthError('INVALID_LOGIN_CREDENTIALS').code, 'credentials');
  assert.equal(mapAuthError('INVALID_PASSWORD').code, 'credentials');
  assert.equal(mapAuthError('TOO_MANY_ATTEMPTS_TRY_LATER').code, 'rate');
  assert.equal(mapAuthError('OPERATION_NOT_ALLOWED').code, 'config');
  assert.equal(mapAuthError('API key not valid. Please pass a valid API key.').code, 'config');
  assert.equal(mapAuthError('INVALID_REFRESH_TOKEN').code, 'session');
  assert.equal(mapAuthError('ALGO_NOVO_DO_GOOGLE').code, 'unknown');
});

test('criar conta guarda a sessão, e ela sobrevive a recarregar a página', async () => {
  const fb = createFakeFirebase({ now });
  const storage = memoryStorage();
  const cloud = createCloud({ config: CONFIG, fetchImpl: fb.fetch, now, storage });
  const s = await cloud.signUp(EMAIL, PASS, 'FAMILIA');
  assert.equal(s.email, EMAIL);
  assert.ok(s.uid && s.idToken && s.refreshToken);
  const depois = createCloud({ config: CONFIG, fetchImpl: fb.fetch, now, storage });
  assert.equal(depois.session.uid, s.uid);
  depois.signOut();
  assert.equal(createCloud({ config: CONFIG, fetchImpl: fb.fetch, now, storage }).session, null);
});

test('cadastro e login recusados viram erros com código', async () => {
  const fb = createFakeFirebase({ now });
  const cloud = createCloud({ config: CONFIG, fetchImpl: fb.fetch, now, storage: memoryStorage() });
  await cloud.signUp(EMAIL, PASS);
  await assert.rejects(() => cloud.signUp(EMAIL, PASS), { code: 'exists' });
  await assert.rejects(() => cloud.signUp('outra@exemplo.com', '123'), { code: 'weak' });
  await assert.rejects(() => cloud.signUp('isto-nao-e-email', PASS), { code: 'invalid' });
  await assert.rejects(() => cloud.signIn(EMAIL, 'senha-errada'), { code: 'credentials' });
  await assert.rejects(() => cloud.signIn('ninguem@exemplo.com', PASS), { code: 'credentials' });
});

test('renova o token sozinho quando falta menos de 1 minuto para vencer', async () => {
  const fb = createFakeFirebase({ ttl: 120, now });
  const d = newDevice(fb);
  await d.cloud.signUp(EMAIL, PASS, 'FAMILIA');
  const primeiro = d.cloud.session.idToken;
  tick(70000);
  const novo = await d.cloud.token();
  assert.notEqual(novo, primeiro);
  assert.ok(fb.calls.some((c) => c.path === '/token/v1/token'));
});

test('token recusado como vencido no meio do pedido: renova e repete uma vez', async () => {
  const fb = createFakeFirebase({ now });
  const d = await signUpDevice(fb);
  fb.state.expireNext = true;
  assert.equal(await d.cloud.dbGet(`users/${d.cloud.session.uid}`), null);
  assert.equal(fb.calls.filter((c) => c.path === '/token/v1/token').length, 1);
});

test('refresh token recusado (conta apagada) encerra a sessão', async () => {
  const fb = createFakeFirebase({ now });
  const d = await signUpDevice(fb);
  fb.users.clear();
  fb.expireAllTokens();
  await assert.rejects(() => d.cloud.dbGet(`users/${d.cloud.session.uid}`), { code: 'session' });
  assert.equal(d.cloud.session, null);
});

test('sem internet: erro "network"', async () => {
  const fb = createFakeFirebase({ now });
  const d = newDevice(fb);
  fb.state.online = false;
  await assert.rejects(() => d.cloud.signIn(EMAIL, PASS), { code: 'network' });
});

test('o banco só deixa a pessoa acessar o próprio nó', async () => {
  const fb = createFakeFirebase({ now });
  const d = await signUpDevice(fb);
  await assert.rejects(() => d.cloud.dbGet('users/outra-pessoa'), { code: 'permission' });
  await assert.rejects(() => d.cloud.dbGet('convite'), { code: 'permission' }); // nem o código de convite dá para ler
});

test('esqueci a senha: pede o e-mail de redefinição em português', async () => {
  const fb = createFakeFirebase({ now });
  const d = await signUpDevice(fb);
  await d.cloud.sendReset(EMAIL);
  assert.deepEqual(fb.sent, [{ email: EMAIL, requestType: 'PASSWORD_RESET', locale: 'pt-BR' }]);
});

test('excluir a conta apaga o usuário no serviço', async () => {
  const fb = createFakeFirebase({ now });
  const d = await signUpDevice(fb);
  await d.cloud.deleteAccount();
  assert.equal(d.cloud.session, null);
  await assert.rejects(() => d.cloud.signIn(EMAIL, PASS), { code: 'credentials' });
});

test('o Firebase só exclui a conta de quem entrou há pouco: depois de um tempo é preciso confirmar a senha', async () => {
  const fb = createFakeFirebase({ now });
  const d = await signUpDevice(fb);
  tick(10 * 60 * 1000);
  // renovar o token não ajuda: o que conta é a hora em que a senha foi digitada
  await d.cloud.refresh();
  await assert.rejects(() => d.cloud.deleteAccount(), { code: 'session' });
  assert.ok(d.cloud.session);
  assert.equal(fb.users.size, 1);
  await assert.rejects(() => d.cloud.reauthenticate('senha-errada'), { code: 'credentials' });
  await d.cloud.reauthenticate(PASS);
  assert.equal(d.cloud.session.convite, 'FAMILIA'); // a sessão continua sendo a mesma
  await d.cloud.deleteAccount();
  assert.equal(d.cloud.session, null);
  assert.equal(fb.users.size, 0);
});

// ---------- sincronização ----------

test('o primeiro aparelho envia e o segundo recebe tudo', async () => {
  const fb = createFakeFirebase({ now });
  const a = await signUpDevice(fb);
  a.store.addTask({ title: 'Tarefa da Ana', priority: 3 });
  a.store.ensureLabels(['Casa']);
  assert.equal((await a.sync.syncNow()).ok, true);
  assert.equal(a.sync.status.state, 'idle');
  const b = await signInDevice(fb);
  assert.equal((await b.sync.syncNow()).ok, true);
  assert.deepEqual(titles(b.store), ['Tarefa da Ana']);
  assert.equal(b.store.state.labels[0].name, 'Casa');
  assert.equal(b.store.state.tasks[0].priority, 3);
});

test('mesma tarefa editada em dois aparelhos: vence a edição mais recente e os dois ficam iguais', async () => {
  const fb = createFakeFirebase({ now });
  const a = await signUpDevice(fb);
  const t = a.store.addTask({ title: 'Original' });
  await a.sync.syncNow();
  const b = await signInDevice(fb);
  await b.sync.syncNow();
  tick();
  a.store.updateTask(t.id, { title: 'Editada no aparelho A' });
  tick();
  b.store.updateTask(t.id, { title: 'Editada depois no aparelho B' });
  await a.sync.syncNow();
  await b.sync.syncNow();
  await a.sync.syncNow();
  assert.equal(a.store.find(t.id).title, 'Editada depois no aparelho B');
  assert.equal(b.store.find(t.id).title, 'Editada depois no aparelho B');
});

test('tarefas novas criadas ao mesmo tempo nos dois aparelhos aparecem nos dois', async () => {
  const fb = createFakeFirebase({ now });
  const a = await signUpDevice(fb);
  const b = await signInDevice(fb);
  a.store.addTask({ title: 'Do celular' });
  b.store.addTask({ title: 'Do notebook' });
  await a.sync.syncNow();
  await b.sync.syncNow();
  await a.sync.syncNow();
  assert.deepEqual(titles(a.store), ['Do celular', 'Do notebook']);
  assert.deepEqual(titles(b.store), ['Do celular', 'Do notebook']);
});

test('excluir em um aparelho some no outro, e a tarefa não ressuscita', async () => {
  const fb = createFakeFirebase({ now });
  const a = await signUpDevice(fb);
  const t = a.store.addTask({ title: 'Vai ser apagada' });
  await a.sync.syncNow();
  const b = await signInDevice(fb);
  await b.sync.syncNow();
  assert.equal(b.store.state.tasks.length, 1);
  tick();
  a.store.deleteTask(t.id);
  await a.sync.syncNow();
  await b.sync.syncNow();
  assert.equal(b.store.state.tasks.length, 0);
  await a.sync.syncNow();
  assert.equal(a.store.state.tasks.length, 0);
});

test('editar DEPOIS de a tarefa ter sido excluída em outro aparelho: a edição vence', async () => {
  const fb = createFakeFirebase({ now });
  const a = await signUpDevice(fb);
  const t = a.store.addTask({ title: 'Original' });
  await a.sync.syncNow();
  const b = await signInDevice(fb);
  await b.sync.syncNow();
  tick();
  a.store.deleteTask(t.id);
  tick();
  b.store.updateTask(t.id, { title: 'Editada depois da exclusão' });
  await a.sync.syncNow();
  await b.sync.syncNow();
  await a.sync.syncNow();
  assert.deepEqual(titles(a.store), ['Editada depois da exclusão']);
  assert.deepEqual(titles(b.store), ['Editada depois da exclusão']);
});

test('desfazer não é "desfeito" pela sincronização', async () => {
  const fb = createFakeFirebase({ now });
  const a = await signUpDevice(fb);
  const t = a.store.addTask({ title: 'Tarefa' });
  await a.sync.syncNow();
  tick();
  a.store.toggleDone(t.id);
  await a.sync.syncNow(); // concluída já está na nuvem
  tick();
  assert.ok(a.store.undo()); // reabre
  await a.sync.syncNow();
  assert.equal(a.store.find(t.id).done, false);
  const b = await signInDevice(fb);
  await b.sync.syncNow();
  assert.equal(b.store.find(t.id).done, false);
});

test('nada mudou em nenhum lado: só consulta a assinatura e NÃO baixa o documento inteiro', async () => {
  const fb = createFakeFirebase({ now });
  const a = await signUpDevice(fb);
  a.store.addTask({ title: 'Da Ana' });
  await a.sync.syncNow();
  const uid = a.cloud.session.uid;
  const baixouDocumento = () => fb.calls.filter((c) => c.method === 'GET' && c.path.endsWith(`/${uid}.json`)).length;
  const antes = baixouDocumento();
  await a.sync.syncNow();
  await a.sync.syncNow();
  assert.equal(baixouDocumento(), antes);
  assert.ok(fb.calls.some((c) => c.path.endsWith(`/${uid}/sig.json`)));
  // uma mudança em outro aparelho é percebida pela assinatura
  const b = await signInDevice(fb);
  await b.sync.syncNow();
  tick();
  b.store.addTask({ title: 'Do outro aparelho' });
  await b.sync.syncNow();
  await a.sync.syncNow();
  assert.deepEqual(titles(a.store), ['Da Ana', 'Do outro aparelho']);
  // e uma mudança local também derruba o atalho
  a.store.addTask({ title: 'Nova aqui' });
  await a.sync.syncNow();
  assert.equal(fb.remote(uid).tasks.length, 3);
});

test('dois aparelhos gravando no mesmo instante: um não esconde a gravação do outro', async () => {
  const fb = createFakeFirebase({ now });
  const a = await signUpDevice(fb);
  a.store.addTask({ title: 'Base' });
  await a.sync.syncNow();
  const b = await signInDevice(fb);
  await b.sync.syncNow();
  a.store.addTask({ title: 'Só da Ana' });
  b.store.addTask({ title: 'Só do outro aparelho' });
  const uid = a.cloud.session.uid;
  await a.sync.syncNow();
  const primeira = { ...fb.data.get(`users/${uid}`) };
  await b.sync.syncNow();
  const segunda = { ...fb.data.get(`users/${uid}`) };
  assert.equal(segunda.updatedAt, primeira.updatedAt, 'o relógio não andou: as duas gravações têm a mesma data');
  assert.notEqual(segunda.sig, primeira.sig);
  await a.sync.syncNow();
  assert.deepEqual(titles(a.store), ['Base', 'Só da Ana', 'Só do outro aparelho']);
});

test('o documento gravado na nuvem tem só os campos que as regras do banco aceitam', async () => {
  const fb = createFakeFirebase({ now });
  const a = await signUpDevice(fb);
  a.store.addTask({ title: 'Qualquer' });
  await a.sync.syncNow();
  const uid = a.cloud.session.uid;
  assert.deepEqual(Object.keys(fb.data.get(`users/${uid}`)).sort(), ['blob', 'convite', 'sig', 'updatedAt', 'v']);
  // um segundo aparelho entrou só com a senha (não conhece o código): regrava sem ele e o banco aceita, porque o nó já existe
  const b = await signInDevice(fb);
  await b.sync.syncNow();
  b.store.addTask({ title: 'Do outro aparelho' });
  assert.equal((await b.sync.syncNow()).ok, true);
  assert.deepEqual(Object.keys(fb.data.get(`users/${uid}`)).sort(), ['blob', 'sig', 'updatedAt', 'v']);
});

test('sem internet: fica "offline", agenda nova tentativa e envia tudo quando a internet volta', async () => {
  const fb = createFakeFirebase({ now });
  const a = await signUpDevice(fb);
  fb.state.online = false;
  a.store.addTask({ title: 'Feita no ônibus' });
  const r = await a.sync.syncNow();
  assert.equal(r.code, 'network');
  assert.equal(a.sync.status.state, 'offline');
  assert.ok(a.scheduled.length > 0);
  fb.state.online = true;
  assert.equal((await a.sync.syncNow()).ok, true);
  assert.equal(fb.remote(a.cloud.session.uid).tasks.length, 1);
  assert.equal(a.sync.status.state, 'idle');
});

test('mudança feita DURANTE o envio agenda outra rodada e acaba na nuvem', async () => {
  const fb = createFakeFirebase({ now });
  const a = await signUpDevice(fb);
  a.store.addTask({ title: 'Primeira' });
  let liberar;
  fb.state.putGate = new Promise((r) => { liberar = r; });
  const rodando = a.sync.syncNow();
  await waitFor(() => fb.calls.some((c) => c.method === 'PUT'));
  a.store.addTask({ title: 'Durante o envio' });
  fb.state.putGate = null;
  liberar();
  assert.equal((await rodando).ok, true);
  assert.ok(a.scheduled.length >= 1);
  await a.sync.syncNow();
  assert.deepEqual(fb.remote(a.cloud.session.uid).tasks.map((t) => t.title).sort(), ['Durante o envio', 'Primeira']);
});

test('código de convite errado: erro de permissão e NÃO fica tentando sozinho', async () => {
  const fb = createFakeFirebase({ now });
  const d = newDevice(fb);
  const s = await d.cloud.signUp(EMAIL, PASS, 'CODIGO-ERRADO');
  d.store.setOwner(s.uid);
  d.store.addTask({ title: 'X' });
  const r = await d.sync.syncNow();
  assert.equal(r.ok, false);
  assert.equal(r.code, 'permission');
  assert.equal(d.sync.status.state, 'error');
  assert.equal(d.scheduled.length, 0);
});

test('sessão que deixou de valer encerra a sincronização', async () => {
  const fb = createFakeFirebase({ now });
  const a = await signUpDevice(fb);
  a.store.addTask({ title: 'X' });
  await a.sync.syncNow();
  fb.users.clear();
  fb.expireAllTokens();
  const r = await a.sync.syncNow();
  assert.equal(r.code, 'session');
  assert.equal(a.sync.status.state, 'off');
  assert.equal(a.cloud.session, null);
});

test('sem sessão: a sincronização fica desligada', async () => {
  const d = newDevice(createFakeFirebase({ now }));
  assert.equal(d.sync.status.state, 'off');
  assert.equal((await d.sync.syncNow()).code, 'off');
});

// ---------- fluxos de conta ----------

test('conta nova: as tarefas deste aparelho (inclusive as de boas-vindas) sobem para a conta', async () => {
  const fb = createFakeFirebase({ now });
  const d = newDevice(fb, seedState('2026-11-06', new Date(clock.t).toISOString()));
  const r = await connect({ ...d, mode: 'signUp', email: EMAIL, password: PASS, convite: 'FAMILIA' });
  assert.equal(r.ok, true);
  assert.equal(d.store.state.owner, d.cloud.session.uid);
  assert.equal(fb.remote(d.cloud.session.uid).tasks.length, d.store.state.tasks.length);
  assert.ok(d.store.state.tasks.length >= 3);
});

test('conta que já tem dados + aparelho só com as boas-vindas: vale a conta (sem misturar os exemplos)', async () => {
  const fb = createFakeFirebase({ now });
  const a = await signUpDevice(fb);
  a.store.addTask({ title: 'Da conta' });
  await a.sync.syncNow();
  const d = newDevice(fb, seedState('2026-11-06', new Date(clock.t).toISOString()));
  await connect({ ...d, mode: 'signIn', email: EMAIL, password: PASS });
  assert.deepEqual(titles(d.store), ['Da conta']);
});

test('conta com dados + tarefas do próprio usuário no aparelho: pergunta e respeita a resposta', async () => {
  // cada cenário usa uma conta nova (mesclar grava na conta e sujaria o cenário seguinte)
  const cenario = async () => {
    const fb = createFakeFirebase({ now });
    const a = await signUpDevice(fb);
    a.store.addTask({ title: 'Da conta' });
    await a.sync.syncNow();
    const d = newDevice(fb);
    d.store.addTask({ title: 'Só deste aparelho' });
    return { fb, d };
  };

  const m = await cenario();
  const perguntas = [];
  await connect({ ...m.d, mode: 'signIn', email: EMAIL, password: PASS, askAdopt: async (i) => { perguntas.push(i.tasks); return 'merge'; } });
  assert.deepEqual(perguntas, [1]);
  assert.deepEqual(titles(m.d.store), ['Da conta', 'Só deste aparelho']);
  assert.equal(m.fb.remote('uid-1').tasks.length, 2);

  const x = await cenario();
  await connect({ ...x.d, mode: 'signIn', email: EMAIL, password: PASS, askAdopt: async () => 'discard' });
  assert.deepEqual(titles(x.d.store), ['Da conta']);
  assert.equal(x.fb.remote('uid-1').tasks.length, 1); // o descartado nem chega à conta

  const c = await cenario();
  const r = await connect({ ...c.d, mode: 'signIn', email: EMAIL, password: PASS, askAdopt: async () => null });
  assert.equal(r.cancelled, true);
  assert.equal(c.d.cloud.session, null);
  assert.deepEqual(titles(c.d.store), ['Só deste aparelho']);
  assert.equal(c.d.store.state.owner, null);
});

test('dados de OUTRA conta neste aparelho nunca são misturados', async () => {
  const fb = createFakeFirebase({ now });
  const a = await signUpDevice(fb);
  a.store.addTask({ title: 'Da conta' });
  await a.sync.syncNow();
  const d = newDevice(fb, empty({ owner: 'uid-de-outra-pessoa' }));
  d.store.addTask({ title: 'Segredo da outra pessoa' });
  await connect({ ...d, mode: 'signIn', email: EMAIL, password: PASS });
  assert.deepEqual(titles(d.store), ['Da conta']);
  assert.equal(fb.remote(a.cloud.session.uid).tasks.some((t) => t.title === 'Segredo da outra pessoa'), false);
});

test('convite errado ao criar a conta: a conta é desfeita e a mensagem é clara', async () => {
  const fb = createFakeFirebase({ now });
  const d = newDevice(fb);
  d.store.addTask({ title: 'Local' });
  await assert.rejects(() => connect({ ...d, mode: 'signUp', email: EMAIL, password: PASS, convite: 'ERRADO' }), { code: 'invite' });
  assert.equal(d.cloud.session, null);
  assert.equal(fb.users.size, 0);
  assert.equal(d.store.state.owner, null);
  assert.deepEqual(titles(d.store), ['Local']);
});

test('sair deste aparelho: envia o que falta, apaga as tarefas daqui e mantém tudo na conta', async () => {
  const fb = createFakeFirebase({ now });
  const a = await signUpDevice(fb);
  a.store.addTask({ title: 'Minha tarefa' });
  const r = await disconnect(a);
  assert.equal(r.ok, true);
  assert.equal(a.store.state.tasks.length, 0);
  assert.equal(a.cloud.session, null);
  assert.equal(a.store.state.owner, null);
  assert.equal(fb.remote('uid-1').tasks.length, 1);
});

test('sair sem internet não perde nada: avisa que há pendências e só sai se for forçado', async () => {
  const fb = createFakeFirebase({ now });
  const a = await signUpDevice(fb);
  a.store.addTask({ title: 'Ainda não enviada' });
  fb.state.online = false;
  const r = await disconnect(a);
  assert.equal(r.ok, false);
  assert.equal(r.pending, true);
  assert.equal(a.store.state.tasks.length, 1);
  assert.ok(a.cloud.session);
  const forcado = await disconnect({ ...a, force: true });
  assert.equal(forcado.ok, true);
  assert.equal(a.store.state.tasks.length, 0);
});

test('excluir a conta apaga a nuvem e deixa as tarefas neste aparelho, sem dono', async () => {
  const fb = createFakeFirebase({ now });
  const a = await signUpDevice(fb);
  a.store.addTask({ title: 'Fica aqui' });
  await a.sync.syncNow();
  tick(60 * 60 * 1000); // uma hora depois de entrar: o login já não é "recente"
  const r = await removeAccount({ ...a, password: PASS });
  assert.equal(r.ok, true);
  assert.equal(fb.data.size, 0);
  assert.equal(fb.users.size, 0);
  assert.equal(a.cloud.session, null);
  assert.equal(a.store.state.owner, null);
  assert.deepEqual(titles(a.store), ['Fica aqui']);
});

test('excluir a conta pede a senha: sem senha ou com senha errada NADA é apagado e a sincronização continua', async () => {
  const fb = createFakeFirebase({ now });
  const a = await signUpDevice(fb);
  a.store.addTask({ title: 'Continua na nuvem' });
  await a.sync.syncNow();
  await assert.rejects(() => removeAccount(a), { code: 'credentials' });
  await assert.rejects(() => removeAccount({ ...a, password: 'senha-errada' }), { code: 'credentials' });
  assert.equal(fb.data.size, 1);
  assert.equal(fb.users.size, 1);
  assert.ok(a.cloud.session);
  assert.equal(a.store.state.owner, a.cloud.session.uid);
  a.store.addTask({ title: 'Depois da tentativa' });
  assert.equal((await a.sync.syncNow()).ok, true);
  assert.equal(fb.remote(a.cloud.session.uid).tasks.length, 2);
});

test('excluir a conta espera a sincronização em andamento, para não deixar dados órfãos na nuvem', async () => {
  const fb = createFakeFirebase({ now });
  const a = await signUpDevice(fb);
  a.store.addTask({ title: 'Em trânsito' });
  let release;
  fb.state.putGate = new Promise((resolve) => { release = resolve; }); // segura o envio no meio do caminho
  const syncing = a.sync.syncNow();
  await waitFor(() => fb.calls.some((c) => c.method === 'PUT'));
  const removing = removeAccount({ ...a, password: PASS });
  await waitFor(() => fb.calls.some((c) => c.path.endsWith(':signInWithPassword')));
  await new Promise((r) => setTimeout(r, 25)); // dá tempo de uma implementação errada apagar ANTES do envio terminar
  release();
  await syncing;
  assert.equal((await removing).ok, true);
  assert.equal(fb.data.size, 0);
  assert.equal(fb.users.size, 0);
});
