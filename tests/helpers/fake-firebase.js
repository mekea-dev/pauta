// "Firebase de mentira" para os testes: imita, em memória, o que o app usa (login por e-mail e senha, tokens que vencem,
// banco com regras: só o dono lê/grava o próprio nó e criar o nó exige o código de convite).
// Segue a documentação oficial da API REST. Fornece um `fetch` para injetar em createCloud().
// As regras do banco aqui são as mesmas de docs/regras-banco.json (um teste confere que o app só grava o que elas aceitam).
// `recent`: por quanto tempo um login conta como "recente"; o Firebase só exclui a conta nesse prazo (o prazo exato
// não é documentado; 5 minutos é o que se relata, e o app confirma a senha antes de excluir, então não depende disso).
export function createFakeFirebase({ ttl = 3600, convite = 'FAMILIA', now = () => Date.now(), key = 'KEY', recent = 5 * 60 * 1000 } = {}) {
  const users = new Map(); // e-mail (minúsculo) -> { uid, password, email }
  const tokens = new Map(); // idToken -> { uid, exp, authTime }
  const refreshTokens = new Map(); // refreshToken -> { uid, authTime }
  const data = new Map(); // caminho -> valor
  const sent = []; // e-mails de redefinição "enviados"
  const calls = [];
  const state = { online: true, expireNext: false, putGate: null };
  let n = 0;

  const reply = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fail = (message, status = 400) => reply(status, { error: { code: status, message } });

  function issue(uid, email) {
    const idToken = `id-${++n}`;
    const refreshToken = `rt-${++n}`;
    const authTime = now(); // quando a pessoa digitou a senha (renovar o token NÃO muda isso)
    tokens.set(idToken, { uid, exp: now() + ttl * 1000, authTime });
    refreshTokens.set(refreshToken, { uid, authTime });
    return { idToken, refreshToken, expiresIn: String(ttl), localId: uid, email };
  }

  // espelho do ".validate" de docs/regras-banco.json
  function validDoc(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (Object.keys(value).some((k) => !['v', 'updatedAt', 'sig', 'blob', 'convite'].includes(k))) return false;
    return typeof value.v === 'number'
      && typeof value.updatedAt === 'string' && value.updatedAt.length <= 40
      && typeof value.sig === 'string' && value.sig.length <= 100
      && typeof value.blob === 'string' && value.blob.length <= 1000000
      && (value.convite === undefined || (typeof value.convite === 'string' && value.convite.length <= 100));
  }

  function identity(u, init) {
    if (u.searchParams.get('key') !== key) return fail('API key not valid. Please pass a valid API key.');
    const op = u.pathname.split(':')[1];
    const body = JSON.parse(init.body ?? '{}');
    if (op === 'signUp') {
      if (!/^\S+@\S+\.\S+$/.test(body.email ?? '')) return fail('INVALID_EMAIL');
      if (users.has(body.email.toLowerCase())) return fail('EMAIL_EXISTS');
      if ((body.password ?? '').length < 6) return fail('WEAK_PASSWORD : Password should be at least 6 characters');
      const uid = `uid-${users.size + 1}`;
      users.set(body.email.toLowerCase(), { uid, password: body.password, email: body.email });
      return reply(200, issue(uid, body.email));
    }
    if (op === 'signInWithPassword') {
      const user = users.get((body.email ?? '').toLowerCase());
      if (!user || user.password !== body.password) return fail('INVALID_LOGIN_CREDENTIALS');
      return reply(200, { ...issue(user.uid, user.email), registered: true });
    }
    if (op === 'sendOobCode') {
      sent.push({ email: body.email, requestType: body.requestType, locale: init.headers?.['X-Firebase-Locale'] });
      return reply(200, { email: body.email });
    }
    if (op === 'delete') {
      const t = tokens.get(body.idToken);
      if (!t) return fail('INVALID_ID_TOKEN');
      if (now() - t.authTime > recent) return fail('CREDENTIAL_TOO_OLD_LOGIN_AGAIN');
      for (const [email, user] of users) if (user.uid === t.uid) users.delete(email);
      return reply(200, {});
    }
    return fail('OPERATION_NOT_ALLOWED');
  }

  function refreshEndpoint(u, init) {
    const form = new URLSearchParams(init.body ?? '');
    const entry = refreshTokens.get(form.get('refresh_token'));
    const uid = entry?.uid;
    if (form.get('grant_type') !== 'refresh_token' || !uid) return fail('INVALID_REFRESH_TOKEN');
    const user = [...users.values()].find((x) => x.uid === uid);
    if (!user) return fail('USER_NOT_FOUND');
    const idToken = `id-${++n}`;
    tokens.set(idToken, { uid, exp: now() + ttl * 1000, authTime: entry.authTime });
    return reply(200, { id_token: idToken, refresh_token: form.get('refresh_token'), expires_in: String(ttl), user_id: uid, token_type: 'Bearer', project_id: 'fake' });
  }

  async function database(u, init, method) {
    const path = /^\/db\/(.+)\.json$/.exec(u.pathname)[1];
    const token = tokens.get(u.searchParams.get('auth'));
    if (state.expireNext || !token || token.exp <= now()) {
      state.expireNext = false;
      return reply(401, { error: 'Auth token is expired' });
    }
    // regras: users/<uid> (e seus filhos, ex.: users/<uid>/updatedAt) só para o dono
    const parts = path.split('/');
    if (parts[0] !== 'users' || parts.length > 3 || parts[1] !== token.uid) return reply(401, { error: 'Permission denied' });
    if (method === 'GET') {
      const doc = data.get(`users/${parts[1]}`);
      return reply(200, parts.length === 3 ? (doc ? doc[parts[2]] ?? null : null) : (doc ?? null));
    }
    if (parts.length !== 2) return reply(401, { error: 'Permission denied' });
    if (method === 'PUT') {
      const value = JSON.parse(init.body);
      if (state.putGate) await state.putGate;
      // criar o nó exige o código (e nunca "vazio == vazio": o código tem que ser um texto igual ao do servidor)
      if (!data.has(path) && !(typeof value?.convite === 'string' && value.convite === convite)) return reply(401, { error: 'Permission denied' });
      if (!validDoc(value)) return reply(401, { error: 'Permission denied' }); // o ".validate" recusa a gravação (o banco responde igual)
      data.set(path, value);
      return reply(200, value);
    }
    if (method === 'DELETE') {
      data.delete(path);
      return reply(200, null);
    }
    return reply(405, { error: 'Method not allowed' });
  }

  async function fetchImpl(url, init = {}) {
    if (!state.online) throw new TypeError('Failed to fetch');
    const u = new URL(url);
    const method = init.method ?? 'GET';
    calls.push({ method, path: u.pathname, search: u.search });
    if (u.pathname.startsWith('/identity/v1/accounts:')) return identity(u, init);
    if (u.pathname === '/token/v1/token') return refreshEndpoint(u, init);
    if (u.pathname.startsWith('/db/')) return database(u, init, method);
    return reply(404, { error: 'not found' });
  }

  return {
    fetch: fetchImpl,
    users, tokens, data, sent, calls, state,
    expireAllTokens() { for (const t of tokens.values()) t.exp = 0; },
    remote(uid) {
      const doc = data.get(`users/${uid}`);
      return doc ? JSON.parse(doc.blob) : null;
    },
  };
}

export const FAKE_CONFIG = {
  apiKey: 'KEY',
  databaseUrl: 'http://fake/db',
  identityUrl: 'http://fake/identity/v1',
  tokenUrl: 'http://fake/token/v1',
  exigirConvite: true,
};
