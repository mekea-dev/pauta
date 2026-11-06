// Inscrição no serviço de lembretes: navegador e serviço de mentira, para conferir o que o app pede e o que manda.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPush, urlBase64ToUint8Array } from '../js/push.js';

const WORKER = 'https://pauta-lembretes.exemplo.workers.dev';
const KEY_BYTES = Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : (i * 7) % 256)); // ponto P-256 "de mentira" com 65 bytes
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const KEY = b64u(KEY_BYTES);
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123';

function makeSub({ endpoint = ENDPOINT, key = KEY_BYTES, auth = 'AUTH-SECRET-123' } = {}) {
  const sub = {
    endpoint,
    options: { applicationServerKey: key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) },
    toJSON: () => ({ endpoint, keys: { p256dh: 'p256dh-x', auth } }),
    unsubscribed: false,
    async unsubscribe() { sub.unsubscribed = true; return true; },
  };
  return sub;
}

/** Navegador + serviço. `routes`: respostas por "METODO /caminho". */
function setup({ permission = 'default', answer = 'granted', existing = null, push = true, routes = {}, withNotification = true } = {}) {
  const calls = [];
  const reg = {
    pushManager: {
      subscribeArgs: null,
      async getSubscription() { return reg.sub ?? null; },
      async subscribe(args) { reg.pushManager.subscribeArgs = args; reg.sub = makeSub({ key: args.applicationServerKey }); return reg.sub; },
    },
    sub: existing,
  };
  const fetchImpl = async (url, init = {}) => {
    const path = url.replace(WORKER, '');
    calls.push({ method: init.method ?? 'GET', path, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    let route = routes[`${init.method} ${path}`];
    if (Array.isArray(route)) route = route.length > 1 ? route.shift() : route[0]; // uma lista = respostas em sequência
    if (route instanceof Error) throw route;
    const { status = 200, json = {} } = route ?? (path === '/vapid' ? { json: { publicKey: KEY } } : {});
    return { ok: status >= 200 && status < 300, status, json: async () => json };
  };
  const env = { navigator: push ? { serviceWorker: { ready: Promise.resolve(reg) } } : {}, ...(push ? { PushManager: class {} } : {}) };
  if (withNotification) env.Notification = { permission, requestPermission: async () => { env.Notification.permission = answer; return answer; } };
  return { push: createPush({ workerUrl: WORKER, env, fetchImpl }), calls, reg, env };
}

test('a chave do serviço vira bytes (base64 de URL, sem preenchimento)', () => {
  assert.deepEqual([...urlBase64ToUint8Array(KEY)], [...KEY_BYTES]);
  assert.deepEqual([...urlBase64ToUint8Array('AQID')], [1, 2, 3]);
  assert.deepEqual([...urlBase64ToUint8Array('-_8')], [251, 255]);
});

test('info: o que o aparelho consegue', () => {
  assert.deepEqual(setup().push.info(), { configured: true, notifications: true, push: true, permission: 'default' });
  assert.equal(setup({ push: false }).push.info().push, false, 'sem push (aba comum do iPhone)');
  assert.equal(setup({ withNotification: false, push: false }).push.info().permission, 'unsupported');
  assert.equal(createPush({ workerUrl: '', env: {} }).info().configured, false);
  assert.equal(createPush({ workerUrl: 'http://inseguro.exemplo', env: {} }).info().configured, false, 'só https');
});

test('enable: pede a permissão, inscreve com a chave do serviço e registra o aparelho', async () => {
  const { push, calls, reg } = setup();
  const r = await push.enable();
  assert.deepEqual(r, { ok: true, permission: 'granted' });
  assert.equal(reg.pushManager.subscribeArgs.userVisibleOnly, true);
  assert.deepEqual([...reg.pushManager.subscribeArgs.applicationServerKey], [...KEY_BYTES]);
  const post = calls.find((c) => c.method === 'POST');
  assert.equal(post.path, '/subscribe');
  assert.deepEqual(post.body, { endpoint: ENDPOINT, auth: 'AUTH-SECRET-123' });
  const get = calls.find((c) => c.path === '/vapid');
  assert.equal(get.headers, undefined, 'um GET simples não manda cabeçalho de conteúdo (evita o "preflight")');
});

test('enable: permissão negada ou ignorada não chama a rede', async () => {
  const negada = setup({ answer: 'denied' });
  assert.deepEqual(await negada.push.enable(), { ok: false, reason: 'denied', permission: 'denied' });
  const ignorada = setup({ answer: 'default' });
  assert.equal((await ignorada.push.enable()).reason, 'dismissed');
  assert.deepEqual(negada.calls, []);
  assert.equal(negada.reg.pushManager.subscribeArgs, null);
});

test('enable: sem push no navegador a permissão fica valendo para os avisos com o app aberto', async () => {
  const r = await setup({ push: false }).push.enable();
  assert.deepEqual(r, { ok: false, reason: 'unsupported-push', permission: 'granted' });
  assert.equal((await setup({ withNotification: false, push: false }).push.enable()).reason, 'unsupported');
  const semServico = createPush({ workerUrl: '', env: { navigator: { serviceWorker: { ready: Promise.resolve({}) } }, PushManager: class {}, Notification: { requestPermission: async () => 'granted', permission: 'default' } } });
  assert.equal((await semServico.enable()).reason, 'unconfigured');
});

test('enable: serviço fora do ar vira erro explicado (a permissão continua valendo)', async () => {
  const { push } = setup({ routes: { 'GET /vapid': { status: 500 } } });
  const r = await push.enable();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'push');
  assert.equal(r.permission, 'granted');
  assert.match(r.detail, /HTTP 500/);
  const recusa = setup({ routes: { 'POST /subscribe': { status: 403 } } });
  assert.match((await recusa.push.enable()).detail, /HTTP 403/);
  const semRede = setup({ routes: { 'GET /vapid': new Error('Failed to fetch') } });
  assert.match((await semRede.push.enable()).detail, /Failed to fetch/);
});

test('enable: inscrição feita com outra chave é desfeita e refeita; com a mesma chave, é aproveitada', async () => {
  const outra = makeSub({ key: Uint8Array.from({ length: 65 }, () => 9) });
  const a = setup({ existing: outra });
  assert.equal((await a.push.enable()).ok, true);
  assert.equal(outra.unsubscribed, true);
  assert.notEqual(a.reg.sub, outra);

  const igual = makeSub();
  const b = setup({ existing: igual });
  assert.equal((await b.push.enable()).ok, true);
  assert.equal(igual.unsubscribed, false);
  assert.equal(b.reg.pushManager.subscribeArgs, null, 'não inscreveu de novo');
  assert.equal(b.calls.find((c) => c.method === 'POST').body.endpoint, ENDPOINT, 'mas registrou no serviço (ele pode ter perdido o aparelho)');
});

test('syncList: troca a lista do aparelho com endereço e "senha" (auth) no mesmo nível', async () => {
  const { push, calls } = setup({ permission: 'granted', existing: makeSub() });
  const list = [{ id: 'a|2026-11-10T18:45:00.000Z', at: 1700000000000 }];
  assert.deepEqual(await push.syncList(list), { ok: true, status: 200 });
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.path, '/reminders');
  assert.deepEqual(put.body, { endpoint: ENDPOINT, auth: 'AUTH-SECRET-123', reminders: list });
  assert.equal(put.headers['Content-Type'], 'application/json');
});

test('syncList: serviço sem o aparelho (403) -> registra de novo e repete', async () => {
  const sequencia = setup({ permission: 'granted', existing: makeSub(), routes: { 'PUT /reminders': [{ status: 403 }, { status: 200 }] } });
  assert.deepEqual(await sequencia.push.syncList([]), { ok: true, status: 200 });
  assert.deepEqual(sequencia.calls.map((c) => `${c.method} ${c.path}`), ['PUT /reminders', 'POST /subscribe', 'PUT /reminders']);

  const insiste = setup({ permission: 'granted', existing: makeSub(), routes: { 'PUT /reminders': { status: 403 } } });
  assert.deepEqual(await insiste.push.syncList([]), { ok: false, status: 403 });
  assert.equal(insiste.calls.length, 3, 'tenta uma vez de novo e para');
});

test('syncList: sem inscrição ou sem rede, devolve o motivo (nunca lança erro)', async () => {
  assert.deepEqual(await setup({ permission: 'granted' }).push.syncList([]), { ok: false, reason: 'no-subscription' });
  const { push } = setup({ permission: 'granted', existing: makeSub(), routes: { 'PUT /reminders': new Error('offline') } });
  const r = await push.syncList([]);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'network');
});

test('disable: cancela no serviço e no navegador, mesmo sem rede', async () => {
  const sub = makeSub();
  const { push, calls } = setup({ permission: 'granted', existing: sub });
  await push.disable();
  assert.equal(sub.unsubscribed, true);
  const del = calls.find((c) => c.method === 'DELETE');
  assert.equal(del.path, '/subscription');
  assert.deepEqual(del.body, { endpoint: ENDPOINT, auth: 'AUTH-SECRET-123' });

  const offline = makeSub();
  await setup({ permission: 'granted', existing: offline, routes: { 'DELETE /subscription': new Error('offline') } }).push.disable();
  assert.equal(offline.unsubscribed, true);
  await setup({ permission: 'granted' }).push.disable(); // sem inscrição: nada a fazer, sem erro
});
