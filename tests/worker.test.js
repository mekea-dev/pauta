// O serviço de lembretes (worker/lembretes.js): pedidos do app, assinatura VAPID e o "relógio" que toca nos aparelhos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanReminders, createMemoryRepo, getVapid, handleRequest, isPushEndpoint, runScheduled, sha256Hex, vapidAuthorization } from '../worker/lembretes.js';

const ORIGIN = 'https://mekea-dev.github.io';
const ENV = { ALLOWED_ORIGINS: ORIGIN, VAPID_SUBJECT: 'https://exemplo.test/pauta/' };
const FCM = 'https://fcm.googleapis.com/fcm/send/aparelho-1';
const APPLE = 'https://web.push.apple.com/aparelho-2';
const NOW = Date.parse('2026-11-10T15:00:00Z');
const AUTH = 'segredo-do-aparelho-12345';
const fromB64u = (s) => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));

// O navegador não deixa um script definir o cabeçalho "Origin" (só o Node deixa), então o pedido é uma versão mínima
// com o que o serviço realmente usa: método, endereço, cabeçalhos e corpo.
const call = (repo, method, path, body, { origin = ORIGIN, now = NOW } = {}) => handleRequest(
  {
    method,
    url: `https://lembretes.test${path}`,
    headers: { get: (name) => (name.toLowerCase() === 'origin' ? origin ?? null : null) },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  },
  ENV, { repo, now },
);
const subscribe = (repo, endpoint = FCM, auth = AUTH) => call(repo, 'POST', '/subscribe', { endpoint, keys: { auth, p256dh: 'x' } });
const setReminders = (repo, reminders, endpoint = FCM, auth = AUTH) => call(repo, 'PUT', '/reminders', { endpoint, auth, reminders });
const lembrete = (id, min) => ({ id, at: NOW + min * 60000 });

/** Um "serviço de aviso" de mentira: guarda o que recebeu e responde com o status pedido. */
function fakePushService(status = 201) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, headers: init.headers, method: init.method });
    return new Response(null, { status: typeof status === 'function' ? status(url) : status });
  };
  return { calls, fetchImpl };
}

test('só aceita endereços de aviso de serviços conhecidos, por https', () => {
  for (const ok of [FCM, APPLE, 'https://updates.push.services.mozilla.com/wpush/v2/abc', 'https://wns2-par02p.notify.windows.com/w/?token=x']) assert.equal(isPushEndpoint(ok), true, ok);
  for (const ruim of [
    'http://fcm.googleapis.com/fcm/send/x', 'https://exemplo.com/x', 'https://fcm.googleapis.com.evil.com/x', 'https://evilfcm.googleapis.com/x',
    'https://user:senha@fcm.googleapis.com/x', 'fcm.googleapis.com/x', '', null, 42, `https://fcm.googleapis.com/${'a'.repeat(3000)}`,
  ]) assert.equal(isPushEndpoint(ruim), false, String(ruim).slice(0, 60));
});

test('lista de avisos: só o que é válido, sem repetidos, dentro do prazo e do limite', () => {
  const lista = [
    lembrete('a', 10), lembrete('a', 20), // repetido: vale o primeiro
    { id: 'b', at: NOW - 30 * 60000 }, // venceu há 30 min: ainda toca
    { id: 'c', at: NOW - 2 * 3600e3 }, // venceu há 2 h: descartado
    { id: 'd', at: NOW + 90 * 86400e3 }, // longe demais
    { id: '', at: NOW + 1000 }, { id: 'x'.repeat(81), at: NOW + 1000 }, { id: 'e', at: 'amanhã' }, { at: NOW + 1000 }, null, 'texto',
    { id: 'f', at: String(NOW + 5000.9) },
  ];
  assert.deepEqual(cleanReminders(lista, NOW).map((r) => r.id), ['a', 'b', 'f']);
  assert.equal(cleanReminders(lista, NOW)[0].at, NOW + 10 * 60000);
  assert.equal(cleanReminders(Array.from({ length: 300 }, (_, i) => lembrete(`t${i}`, i + 1)), NOW).length, 100);
  assert.deepEqual(cleanReminders('nada', NOW), []);
});

test('chaves VAPID: criadas uma vez, estáveis, e a assinatura confere com a chave pública', async () => {
  const repo = createMemoryRepo();
  const a = await getVapid(repo);
  const b = await getVapid(repo);
  assert.deepEqual(a, b, 'a mesma chave nas próximas vezes');
  const pub = fromB64u(a.publicKey);
  assert.equal(pub.length, 65);
  assert.equal(pub[0], 4, 'formato não comprimido');
  assert.ok(a.privateJwk.d, 'a chave privada fica guardada no serviço');

  const header = await vapidAuthorization(a, FCM, { now: NOW, subject: ENV.VAPID_SUBJECT });
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
  assert.ok(m, header);
  assert.equal(m[4], a.publicKey);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(fromB64u(m[1]))), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(new TextDecoder().decode(fromB64u(m[2])));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, ENV.VAPID_SUBJECT);
  assert.equal(claims.exp, Math.floor(NOW / 1000) + 12 * 3600, 'vale por 12 h (o limite dos serviços é 24 h)');
  const publicKey = await crypto.subtle.importKey('raw', pub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, fromB64u(m[3]), new TextEncoder().encode(`${m[1]}.${m[2]}`));
  assert.equal(ok, true, 'a assinatura tem que fechar com a chave pública');
  assert.equal(fromB64u(m[3]).length, 64, 'assinatura no formato do JWT (r + s)');
});

test('pedidos do app: /vapid devolve só a chave pública e o CORS vale só para o site', async () => {
  const repo = createMemoryRepo();
  const r = await call(repo, 'GET', '/vapid');
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(Object.keys(body), ['publicKey']);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const outro = await call(repo, 'GET', '/vapid', undefined, { origin: 'https://site-malvado.example' });
  assert.equal(outro.headers.get('Access-Control-Allow-Origin'), null);
  const pre = await call(repo, 'OPTIONS', '/reminders');
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('Access-Control-Allow-Methods'), /PUT/);
  assert.match(pre.headers.get('Access-Control-Allow-Headers'), /Content-Type/);
  assert.equal((await call(repo, 'GET', '/nada')).status, 404);
});

test('inscrever o aparelho: endereço de serviço conhecido, e ninguém toma o lugar de outro aparelho', async () => {
  const repo = createMemoryRepo();
  assert.equal((await call(repo, 'POST', '/subscribe', { endpoint: 'https://exemplo.com/x', auth: AUTH })).status, 400);
  assert.equal((await call(repo, 'POST', '/subscribe', { endpoint: FCM })).status, 400, 'sem a chave auth');
  assert.equal((await call(repo, 'POST', '/subscribe', { endpoint: FCM, auth: 'curta' })).status, 400);
  assert.equal((await subscribe(repo)).status, 200);
  assert.equal((await subscribe(repo)).status, 200, 'repetir é inofensivo');
  assert.equal((await subscribe(repo, FCM, 'outra-chave-qualquer')).status, 403, 'outra pessoa não assume o aparelho');
  const guardado = await repo.getSub(FCM);
  assert.equal(guardado.authHash, await sha256Hex(AUTH), 'a chave auth não é guardada em claro');
  assert.ok(!JSON.stringify([...repo.subs]).includes(AUTH));
});

test('lista de avisos: troca a lista do aparelho, exige a chave e limpa o que não presta', async () => {
  const repo = createMemoryRepo();
  await subscribe(repo);
  assert.equal((await setReminders(repo, [lembrete('a', 10)], FCM, 'chave-errada-1234')).status, 403);
  assert.equal((await setReminders(repo, [lembrete('a', 10)], APPLE)).status, 403, 'aparelho que nunca se inscreveu');
  assert.equal((await call(repo, 'PUT', '/reminders', { endpoint: 'https://exemplo.com/x', auth: AUTH, reminders: [] })).status, 400);
  const r = await setReminders(repo, [lembrete('a', 10), lembrete('b', 20), { id: 'lixo', at: 'x' }]);
  assert.deepEqual(await r.json(), { ok: true, avisos: 2 });
  await setReminders(repo, [lembrete('c', 5)]);
  assert.deepEqual(repo.reminders.map((x) => x.id), ['c'], 'a lista nova substitui a antiga');
  await subscribe(repo, APPLE, 'segredo-do-iphone-98765');
  await setReminders(repo, [lembrete('d', 5)], APPLE, 'segredo-do-iphone-98765');
  assert.deepEqual(repo.reminders.map((x) => `${x.endpoint === FCM ? 'fcm' : 'apple'}:${x.id}`).sort(), ['apple:d', 'fcm:c'], 'cada aparelho tem a sua lista');
  await setReminders(repo, []);
  assert.deepEqual(repo.reminders.map((x) => x.id), ['d'], 'lista vazia limpa só o aparelho dele');
});

test('cancelar: o aparelho sai e leva os avisos junto; sem a chave certa não cancela', async () => {
  const repo = createMemoryRepo();
  await subscribe(repo);
  await setReminders(repo, [lembrete('a', 10)]);
  assert.equal((await call(repo, 'DELETE', '/subscription', { endpoint: FCM, auth: 'chave-errada-1234' })).status, 403);
  assert.equal(repo.reminders.length, 1);
  assert.equal((await call(repo, 'DELETE', '/subscription', { endpoint: FCM, auth: AUTH })).status, 200);
  assert.equal(repo.reminders.length, 0);
  assert.equal(await repo.getSub(FCM), null);
});

test('pedido malformado ou grande demais não derruba o serviço', async () => {
  const repo = createMemoryRepo();
  const ruim = await handleRequest(new Request('https://lembretes.test/subscribe', { method: 'POST', body: 'isto não é json' }), ENV, { repo, now: NOW });
  assert.equal(ruim.status, 400);
  const grande = await handleRequest(new Request('https://lembretes.test/subscribe', { method: 'POST', body: JSON.stringify({ x: 'a'.repeat(70000) }) }), ENV, { repo, now: NOW });
  assert.equal(grande.status, 413);
});

test('relógio: avisa quem tem aviso vencido, uma vez por aparelho, com assinatura válida e sem conteúdo', async () => {
  const repo = createMemoryRepo();
  await subscribe(repo);
  await setReminders(repo, [lembrete('a', 5), lembrete('b', 5), lembrete('longe', 120)]);
  const push = fakePushService(201);
  // ainda não venceu nada
  let r = await runScheduled(ENV, { now: NOW, repo, fetchImpl: push.fetchImpl });
  assert.deepEqual(r, { sent: [], gone: [], retry: [] });
  assert.equal(push.calls.length, 0);
  // 6 minutos depois: dois avisos vencidos do mesmo aparelho = um toque só
  r = await runScheduled(ENV, { now: NOW + 6 * 60000, repo, fetchImpl: push.fetchImpl });
  assert.deepEqual(r.sent, [FCM]);
  assert.equal(push.calls.length, 1);
  const c = push.calls[0];
  assert.equal(c.url, FCM);
  assert.equal(c.method, 'POST');
  assert.equal(c.headers.TTL, '3600');
  assert.equal(c.headers.Urgency, 'high');
  assert.match(c.headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
  assert.deepEqual(repo.reminders.map((x) => x.id), ['longe'], 'os entregues somem; o que ainda não venceu fica');
  // no minuto seguinte não toca de novo
  r = await runScheduled(ENV, { now: NOW + 7 * 60000, repo, fetchImpl: push.fetchImpl });
  assert.equal(push.calls.length, 1);
});

test('relógio: serviços diferentes usam a assinatura certa para cada um (aud)', async () => {
  const repo = createMemoryRepo();
  await subscribe(repo, FCM);
  await subscribe(repo, APPLE, 'segredo-do-iphone-98765');
  await setReminders(repo, [lembrete('a', 1)], FCM);
  await setReminders(repo, [lembrete('b', 1)], APPLE, 'segredo-do-iphone-98765');
  const push = fakePushService(201);
  await runScheduled(ENV, { now: NOW + 2 * 60000, repo, fetchImpl: push.fetchImpl });
  assert.equal(push.calls.length, 2);
  const aud = (call) => JSON.parse(new TextDecoder().decode(fromB64u(/t=[\w-]+\.([\w-]+)\./.exec(call.headers.Authorization)[1]))).aud;
  assert.deepEqual(push.calls.map((x) => [x.url, aud(x)]).sort(), [[FCM, 'https://fcm.googleapis.com'], [APPLE, 'https://web.push.apple.com']]);
});

test('relógio: aparelho que cancelou (404/410) é esquecido; erro temporário tenta de novo e depois desiste', async () => {
  const repo = createMemoryRepo();
  await subscribe(repo, FCM);
  await subscribe(repo, APPLE, 'segredo-do-iphone-98765');
  await setReminders(repo, [lembrete('a', 1)], FCM);
  await setReminders(repo, [lembrete('b', 1)], APPLE, 'segredo-do-iphone-98765');
  const push = fakePushService((url) => (url === FCM ? 410 : 503));
  let t = NOW + 2 * 60000;
  let r = await runScheduled(ENV, { now: t, repo, fetchImpl: push.fetchImpl });
  assert.deepEqual(r, { sent: [], gone: [FCM], retry: [APPLE] });
  assert.equal(await repo.getSub(FCM), null, 'inscrição morta é apagada');
  assert.deepEqual(repo.reminders.map((x) => x.id), ['b'], 'o aviso do outro continua esperando');
  // insiste até o limite de tentativas e então desiste
  for (let i = 0; i < 8; i++) { t += 60000; await runScheduled(ENV, { now: t, repo, fetchImpl: push.fetchImpl }); }
  const antes = push.calls.length;
  await runScheduled(ENV, { now: t + 60000, repo, fetchImpl: push.fetchImpl });
  assert.equal(push.calls.length, antes, 'depois de 6 tentativas não insiste mais');
  // falha de rede também conta como "tentar de novo"
  const repo2 = createMemoryRepo();
  await subscribe(repo2, FCM);
  await setReminders(repo2, [lembrete('a', 1)], FCM);
  const r2 = await runScheduled(ENV, { now: NOW + 2 * 60000, repo: repo2, fetchImpl: async () => { throw new TypeError('sem rede'); } });
  assert.deepEqual(r2.retry, [FCM]);
});

test('relógio: no máximo 40 aparelhos por minuto (o resto fica para o minuto seguinte)', async () => {
  const repo = createMemoryRepo();
  for (let i = 0; i < 45; i++) {
    const endpoint = `https://fcm.googleapis.com/fcm/send/muitos-${i}`;
    await subscribe(repo, endpoint, `segredo-numero-${i}-xxxxx`);
    await setReminders(repo, [lembrete('a', 1)], endpoint, `segredo-numero-${i}-xxxxx`);
  }
  const push = fakePushService(201);
  await runScheduled(ENV, { now: NOW + 2 * 60000, repo, fetchImpl: push.fetchImpl });
  assert.equal(push.calls.length, 40);
  await runScheduled(ENV, { now: NOW + 3 * 60000, repo, fetchImpl: push.fetchImpl });
  assert.equal(push.calls.length, 45, 'os cinco que sobraram são avisados no minuto seguinte');
});

test('faxina: avisos muito velhos somem (uma vez por hora)', async () => {
  const repo = createMemoryRepo();
  await subscribe(repo);
  await repo.replaceReminders(FCM, [{ id: 'velho', at: NOW - 3 * 86400e3 }, { id: 'novo', at: NOW + 3600e3 }]);
  await runScheduled(ENV, { now: Date.parse('2026-11-10T15:00:00Z'), repo, fetchImpl: fakePushService().fetchImpl }); // minuto 0: faz a faxina
  assert.deepEqual(repo.reminders.map((x) => x.id), ['novo']);
});

test('privacidade: o serviço não recebe nem guarda títulos', async () => {
  const repo = createMemoryRepo();
  await subscribe(repo);
  await setReminders(repo, [{ id: 'tarefa-1|2026-11-10T15:45:00.000Z', at: NOW + 60000, title: 'Consulta com o médico', notes: 'segredo' }]);
  assert.ok(!JSON.stringify(repo.reminders).includes('médico'));
  assert.deepEqual(Object.keys(repo.reminders[0]).sort(), ['at', 'endpoint', 'id', 'tries']);
});
