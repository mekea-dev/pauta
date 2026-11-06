// Serviço de lembretes do Pauta: um Cloudflare Worker (grátis) com banco D1 e um "relógio" (Cron) que roda a cada minuto.
//
// Por que existe: o iPhone (e o navegador) não agenda notificação sozinho; alguém precisa mandar o aviso na hora certa
// com o app fechado. O site no GitHub Pages não executa nada, então este pequeno serviço faz só isso.
//
// O que ele guarda (e o que NÃO guarda):
//   - guarda: o "endereço de aviso" do aparelho (o que o navegador entrega ao se inscrever) e os HORÁRIOS dos avisos;
//   - NÃO guarda: títulos, anotações, e-mail, conta, nada das suas tarefas. O aviso chega vazio: quem mostra o título
//     é o próprio aparelho, olhando as tarefas que ele já tem.
//
// Como funciona: o app manda a lista dos próximos avisos (PUT /reminders). Todo minuto o Cron procura os avisos que
// já venceram e dá um "toque" (Web Push sem conteúdo, assinado com VAPID) no aparelho, que então mostra a notificação.
//
// Instalação: docs/LEMBRETES.md. Sem dependências: só o que o Cloudflare Workers já traz.

// ---------- configuração ----------
const DEFAULT_ORIGINS = 'https://mekea-dev.github.io';
const DEFAULT_SUBJECT = 'https://mekea-dev.github.io/pauta/';
const PUSH_HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
const LIMITS = {
  body: 64 * 1024, // bytes de um pedido
  reminders: 100, // avisos por aparelho
  pastMs: 3600e3, // aceita avisos que venceram há até 1 h (o Cron ainda toca)
  futureMs: 60 * 86400e3, // e até 60 dias à frente
  perRun: 40, // aparelhos avisados por minuto (o plano grátis permite 50 chamadas por execução)
  totalReminders: 50000, // teto do banco inteiro
  maxTries: 6, // tentativas antes de desistir de um aviso
  keepMs: 2 * 86400e3, // avisos vencidos há mais que isso são apagados
  vapidTtlSec: 12 * 3600,
};

// ---------- utilidades ----------
const enc = new TextEncoder();
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const fromB64u = (s) => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compara textos sem pressa que revele onde diferem. */
function sameText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Só endereços de aviso dos serviços conhecidos (senão o Worker poderia ser usado para chamar qualquer site). */
export function isPushEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

/** Lista de avisos vinda do aparelho -> só o que é válido, sem repetidos, dentro dos limites. */
export function cleanReminders(list, now) {
  const seen = new Set();
  const out = [];
  for (const r of Array.isArray(list) ? list : []) {
    if (!r || typeof r.id !== 'string' || r.id.length < 1 || r.id.length > 80 || seen.has(r.id)) continue;
    const at = Math.trunc(Number(r.at));
    if (!Number.isFinite(at) || at < now - LIMITS.pastMs || at > now + LIMITS.futureMs) continue;
    seen.add(r.id);
    out.push({ id: r.id, at });
    if (out.length >= LIMITS.reminders) break;
  }
  return out;
}

// ---------- chaves VAPID (identificam este serviço perante o Apple, o Google e o Mozilla) ----------
/** As chaves são criadas na primeira vez que alguém pede e ficam no banco. A chave privada nunca sai daqui. */
export async function getVapid(repo) {
  const saved = await repo.getConfig('vapid');
  if (saved) return JSON.parse(saved);
  const pair = /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']));
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicKey = b64u(await crypto.subtle.exportKey('raw', pair.publicKey)); // 65 bytes, formato "não comprimido"
  // se dois pedidos criarem ao mesmo tempo, vale o primeiro que gravou
  return JSON.parse(await repo.setConfigIfAbsent('vapid', JSON.stringify({ publicKey, privateJwk })));
}

/** Cabeçalho `Authorization: vapid t=<JWT>, k=<chave pública>` para um endereço de aviso. */
export async function vapidAuthorization(vapid, endpoint, { now = Date.now(), subject = DEFAULT_SUBJECT, signingKey = null } = {}) {
  const key = signingKey ?? await crypto.subtle.importKey('jwk', vapid.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + LIMITS.vapidTtlSec, sub: subject })));
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${vapid.publicKey}`;
}

// ---------- armazenamento ----------
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS subs (endpoint TEXT PRIMARY KEY, auth_hash TEXT NOT NULL, created_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS reminders (endpoint TEXT NOT NULL, id TEXT NOT NULL, fire_at INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (endpoint, id))',
  'CREATE INDEX IF NOT EXISTS reminders_due ON reminders (fire_at)',
];
let schemaReady = null;

/** O mesmo contrato do banco real (D1), para o serviço e para os testes. */
export function createRepo(db) {
  const run = (sql, ...args) => db.prepare(sql).bind(...args);
  return {
    async ready() {
      schemaReady ??= db.batch(SCHEMA.map((sql) => db.prepare(sql))).catch((e) => { schemaReady = null; throw e; });
      await schemaReady;
    },
    async getConfig(key) {
      return (await run('SELECT value FROM config WHERE key = ?1', key).first())?.value ?? null;
    },
    async setConfigIfAbsent(key, value) {
      await run('INSERT OR IGNORE INTO config (key, value) VALUES (?1, ?2)', key, value).run();
      return (await run('SELECT value FROM config WHERE key = ?1', key).first()).value;
    },
    async getSub(endpoint) {
      const row = await run('SELECT auth_hash FROM subs WHERE endpoint = ?1', endpoint).first();
      return row ? { endpoint, authHash: row.auth_hash } : null;
    },
    async putSub(endpoint, authHash, now) {
      await run('INSERT OR REPLACE INTO subs (endpoint, auth_hash, created_at) VALUES (?1, ?2, ?3)', endpoint, authHash, now).run();
    },
    async deleteSub(endpoint) {
      await db.batch([run('DELETE FROM reminders WHERE endpoint = ?1', endpoint), run('DELETE FROM subs WHERE endpoint = ?1', endpoint)]);
    },
    async replaceReminders(endpoint, list) {
      await db.batch([
        run('DELETE FROM reminders WHERE endpoint = ?1', endpoint),
        ...list.map((r) => run('INSERT INTO reminders (endpoint, id, fire_at, tries) VALUES (?1, ?2, ?3, 0)', endpoint, r.id, r.at)),
      ]);
    },
    async countReminders() {
      return (await run('SELECT COUNT(*) AS n FROM reminders').first()).n;
    },
    async dueEndpoints(now, limit) {
      const { results } = await run('SELECT endpoint FROM reminders WHERE fire_at <= ?1 AND tries < ?2 GROUP BY endpoint ORDER BY MIN(fire_at) LIMIT ?3', now, LIMITS.maxTries, limit).all();
      return results.map((r) => r.endpoint);
    },
    /** Uma ida só ao banco: avisos entregues somem, endereços mortos saem, falhas ganham uma tentativa. */
    async applyResults({ sent, gone, retry }, now) {
      const statements = [
        ...sent.map((e) => run('DELETE FROM reminders WHERE endpoint = ?1 AND fire_at <= ?2', e, now)),
        ...gone.flatMap((e) => [run('DELETE FROM reminders WHERE endpoint = ?1', e), run('DELETE FROM subs WHERE endpoint = ?1', e)]),
        ...retry.map((e) => run('UPDATE reminders SET tries = tries + 1 WHERE endpoint = ?1 AND fire_at <= ?2', e, now)),
      ];
      if (statements.length) await db.batch(statements);
    },
    async purge(now) {
      await db.batch([
        run('DELETE FROM reminders WHERE fire_at < ?1 OR tries >= ?2', now - LIMITS.keepMs, LIMITS.maxTries),
        run('DELETE FROM subs WHERE endpoint NOT IN (SELECT endpoint FROM reminders) AND created_at < ?1', now - 90 * 86400e3),
      ]);
    },
  };
}

/** Banco em memória com o mesmo contrato (usado nos testes). */
export function createMemoryRepo() {
  const config = new Map();
  const subs = new Map();
  let reminders = []; // { endpoint, id, at, tries }
  return {
    subs, get reminders() { return reminders; },
    async ready() {},
    async getConfig(key) { return config.get(key) ?? null; },
    async setConfigIfAbsent(key, value) { if (!config.has(key)) config.set(key, value); return config.get(key); },
    async getSub(endpoint) { return subs.get(endpoint) ?? null; },
    async putSub(endpoint, authHash, now) { subs.set(endpoint, { endpoint, authHash, createdAt: now }); },
    async deleteSub(endpoint) { subs.delete(endpoint); reminders = reminders.filter((r) => r.endpoint !== endpoint); },
    async replaceReminders(endpoint, list) {
      reminders = [...reminders.filter((r) => r.endpoint !== endpoint), ...list.map((r) => ({ endpoint, id: r.id, at: r.at, tries: 0 }))];
    },
    async countReminders() { return reminders.length; },
    async dueEndpoints(now, limit) {
      const byEndpoint = new Map();
      for (const r of reminders) if (r.at <= now && r.tries < LIMITS.maxTries) byEndpoint.set(r.endpoint, Math.min(byEndpoint.get(r.endpoint) ?? Infinity, r.at));
      return [...byEndpoint].sort((a, b) => a[1] - b[1]).slice(0, limit).map(([e]) => e);
    },
    async applyResults({ sent, gone, retry }, now) {
      for (const e of sent) reminders = reminders.filter((r) => !(r.endpoint === e && r.at <= now));
      for (const e of gone) { subs.delete(e); reminders = reminders.filter((r) => r.endpoint !== e); }
      for (const e of retry) for (const r of reminders) if (r.endpoint === e && r.at <= now) r.tries += 1;
    },
    async purge(now) { reminders = reminders.filter((r) => r.at >= now - LIMITS.keepMs && r.tries < LIMITS.maxTries); },
  };
}

// ---------- o "relógio": todo minuto, toca nos aparelhos com aviso vencido ----------
/**
 * @returns {Promise<{sent: string[], gone: string[], retry: string[]}>} o que aconteceu com cada aparelho
 */
export async function runScheduled(env, { now = Date.now(), repo = createRepo(env.DB), fetchImpl = fetch } = {}) {
  await repo.ready();
  const endpoints = await repo.dueEndpoints(now, LIMITS.perRun);
  const result = { sent: [], gone: [], retry: [] };
  if (endpoints.length) {
    const vapid = await getVapid(repo);
    const subject = env.VAPID_SUBJECT || DEFAULT_SUBJECT;
    const signingKey = await crypto.subtle.importKey('jwk', vapid.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const byOrigin = new Map(); // a assinatura vale por 12 h para o mesmo serviço: assina uma vez por minuto, não uma por aparelho
    const authorization = async (endpoint) => {
      const origin = new URL(endpoint).origin;
      if (!byOrigin.has(origin)) byOrigin.set(origin, vapidAuthorization(vapid, endpoint, { now, subject, signingKey }));
      return byOrigin.get(origin);
    };
    await Promise.all(endpoints.map(async (endpoint) => {
      let status = 0;
      try {
        // "toque" sem conteúdo: o aparelho decide o que mostrar
        const res = await fetchImpl(endpoint, { method: 'POST', headers: { Authorization: await authorization(endpoint), TTL: '3600', Urgency: 'high' } });
        status = res.status;
      } catch {
        status = 0;
      }
      if (status >= 200 && status < 300) result.sent.push(endpoint);
      else if (status === 404 || status === 410) result.gone.push(endpoint); // o aparelho cancelou a inscrição
      else {
        // sem isso ninguém descobre por que um aviso não chegou: aparece no painel da Cloudflare, em Observability > Logs (só o servidor e o código, nada do aparelho)
        console.warn(`push recusado: ${new URL(endpoint).host} respondeu ${status || 'nada (erro de rede)'}`);
        result.retry.push(endpoint);
      }
    }));
    await repo.applyResults(result, now);
  }
  if (new Date(now).getUTCMinutes() === 0) await repo.purge(now); // uma faxina por hora
  return result;
}

// ---------- pedidos do app ----------
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = String(env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(',').map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' };
}

const reply = (status, body, cors) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...cors } });

async function readJson(request) {
  const text = await request.text();
  if (text.length > LIMITS.body) throw Object.assign(new Error('grande demais'), { status: 413 });
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object') throw new Error('json');
    return value;
  } catch {
    throw Object.assign(new Error('JSON inválido'), { status: 400 });
  }
}

/** Confere endereço + "senha" do aparelho (a chave `auth` que só ele e o serviço de aviso conhecem). */
async function authenticate(repo, body) {
  if (!isPushEndpoint(body.endpoint) || typeof body.auth !== 'string' || body.auth.length < 8 || body.auth.length > 200) throw Object.assign(new Error('pedido inválido'), { status: 400 });
  const sub = await repo.getSub(body.endpoint);
  if (!sub || !sameText(sub.authHash, await sha256Hex(body.auth))) throw Object.assign(new Error('aparelho não reconhecido'), { status: 403 });
  return sub;
}

export async function handleRequest(request, env, { now = Date.now(), repo = createRepo(env.DB) } = {}) {
  const cors = corsHeaders(request, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const { pathname } = new URL(request.url);
  try {
    await repo.ready();
    if (request.method === 'GET' && pathname === '/vapid') return reply(200, { publicKey: (await getVapid(repo)).publicKey }, cors);
    if (request.method === 'GET' && (pathname === '/' || pathname === '/health')) return reply(200, { ok: true, servico: 'lembretes do Pauta', agora: now }, cors);

    if (request.method === 'POST' && pathname === '/subscribe') {
      const body = await readJson(request);
      const auth = body.auth ?? body.keys?.auth;
      if (!isPushEndpoint(body.endpoint) || typeof auth !== 'string' || auth.length < 8 || auth.length > 200) return reply(400, { error: 'endereço de aviso inválido' }, cors);
      const hash = await sha256Hex(auth);
      const existing = await repo.getSub(body.endpoint);
      if (existing && !sameText(existing.authHash, hash)) return reply(403, { error: 'este aparelho já está registrado com outra chave' }, cors);
      if (!existing) await repo.putSub(body.endpoint, hash, now);
      return reply(200, { ok: true }, cors);
    }

    if (request.method === 'PUT' && pathname === '/reminders') {
      const body = await readJson(request);
      await authenticate(repo, body);
      const list = cleanReminders(body.reminders, now);
      if (list.length && (await repo.countReminders()) > LIMITS.totalReminders) return reply(503, { error: 'serviço cheio' }, cors);
      await repo.replaceReminders(body.endpoint, list);
      return reply(200, { ok: true, avisos: list.length }, cors);
    }

    if (request.method === 'DELETE' && pathname === '/subscription') {
      const body = await readJson(request);
      await authenticate(repo, body);
      await repo.deleteSub(body.endpoint);
      return reply(200, { ok: true }, cors);
    }
    return reply(404, { error: 'não encontrado' }, cors);
  } catch (e) {
    return reply(e.status ?? 500, { error: e.status ? e.message : 'erro interno' }, cors);
  }
}

export default {
  fetch: (request, env) => handleRequest(request, env),
  scheduled: (event, env, ctx) => { ctx.waitUntil(runScheduled(env)); },
};
