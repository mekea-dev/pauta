// Cliente do Firebase por REST, sem biblioteca: login por e-mail e senha (Identity Toolkit) e banco (Realtime Database).
// Documentação: https://firebase.google.com/docs/reference/rest/auth e https://firebase.google.com/docs/database/rest/start
// Tudo que o app precisa da nuvem passa por aqui, e `fetch`/relógio/armazenamento entram por parâmetro (para testar).

export const SESSION_KEY = 'pauta:conta';

export class CloudError extends Error {
  /** code: network | credentials | exists | invalid | weak | rate | disabled | config | session | permission | invite | toolarge | data | server | unknown */
  constructor(code, message, status = 0) {
    super(message);
    this.name = 'CloudError';
    this.code = code;
    this.status = status;
  }
}

// código devolvido pelo Firebase -> [nosso código, mensagem para a pessoa]
const AUTH_ERRORS = {
  EMAIL_EXISTS: ['exists', 'Já existe uma conta com este e-mail. Use “Entrar”.'],
  INVALID_LOGIN_CREDENTIALS: ['credentials', 'E-mail ou senha incorretos.'],
  EMAIL_NOT_FOUND: ['credentials', 'E-mail ou senha incorretos.'],
  INVALID_PASSWORD: ['credentials', 'E-mail ou senha incorretos.'],
  INVALID_EMAIL: ['invalid', 'Esse e-mail não parece válido.'],
  MISSING_EMAIL: ['invalid', 'Digite o e-mail.'],
  MISSING_PASSWORD: ['invalid', 'Digite a senha.'],
  WEAK_PASSWORD: ['weak', 'Senha fraca: use pelo menos 6 caracteres (o ideal é 8 ou mais).'],
  USER_DISABLED: ['disabled', 'Esta conta foi desativada.'],
  TOO_MANY_ATTEMPTS_TRY_LATER: ['rate', 'Muitas tentativas. Espere alguns minutos e tente de novo.'],
  OPERATION_NOT_ALLOWED: ['config', 'O login por e-mail e senha não está ativado no Firebase (veja docs/NUVEM.md).'],
  ADMIN_ONLY_OPERATION: ['config', 'Novos cadastros estão desativados neste projeto.'],
  INVALID_REFRESH_TOKEN: ['session', 'Sua sessão expirou. Entre de novo.'],
  TOKEN_EXPIRED: ['session', 'Sua sessão expirou. Entre de novo.'],
  USER_NOT_FOUND: ['session', 'Sua conta não foi encontrada. Entre de novo.'],
  INVALID_ID_TOKEN: ['session', 'Sua sessão expirou. Entre de novo.'],
  CREDENTIAL_TOO_OLD_LOGIN_AGAIN: ['session', 'Por segurança, entre de novo para continuar.'],
};

export function mapAuthError(message) {
  const text = String(message ?? '');
  const key = text.split(/[\s:]/)[0]; // "WEAK_PASSWORD : Password should be..." -> WEAK_PASSWORD
  const hit = AUTH_ERRORS[key];
  if (hit) return new CloudError(hit[0], hit[1]);
  if (/API key|API_KEY|referer|referrer/i.test(text)) {
    return new CloudError('config', 'A chave de API do Firebase não é aceita para este endereço (veja docs/NUVEM.md).');
  }
  return new CloudError('unknown', `O serviço de contas recusou o pedido${text ? ` (${text})` : ''}.`);
}

/**
 * @param {{config: object, fetchImpl?: Function, now?: () => number, storage?: Storage}} opts
 */
export function createCloud({ config, fetchImpl, now = () => Date.now(), storage }) {
  const listeners = new Set();
  let session = readSession();

  function readSession() {
    try {
      const s = JSON.parse(storage?.getItem(SESSION_KEY) ?? 'null');
      return s && s.uid && s.refreshToken ? s : null;
    } catch {
      return null;
    }
  }

  function writeSession(next) {
    session = next;
    try {
      if (next) storage?.setItem(SESSION_KEY, JSON.stringify(next));
      else storage?.removeItem(SESSION_KEY);
    } catch { /* sem armazenamento: a sessão vale até fechar a página */ }
    for (const fn of [...listeners]) fn(session);
  }

  async function send(url, init) {
    try {
      return await (fetchImpl ?? globalThis.fetch)(url, init);
    } catch {
      throw new CloudError('network', 'Sem conexão com a internet.');
    }
  }

  async function identity(method, body, headers = {}) {
    const res = await send(`${config.identityUrl}/accounts:${method}?key=${encodeURIComponent(config.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw mapAuthError(data?.error?.message);
    return data;
  }

  function sessionFrom(data, convite) {
    return {
      uid: data.localId ?? data.user_id,
      email: data.email ?? session?.email ?? '',
      idToken: data.idToken ?? data.id_token,
      refreshToken: data.refreshToken ?? data.refresh_token,
      expiresAt: now() + Number(data.expiresIn ?? data.expires_in ?? 3600) * 1000,
      convite: convite ?? session?.convite ?? '',
    };
  }

  async function signUp(email, password, convite = '') {
    writeSession(sessionFrom(await identity('signUp', { email, password, returnSecureToken: true }), convite));
    return session;
  }

  async function signIn(email, password) {
    writeSession(sessionFrom(await identity('signInWithPassword', { email, password, returnSecureToken: true })));
    return session;
  }

  /**
   * Confirma a senha de quem já está conectado e renova o login. O Firebase só deixa excluir a conta de quem
   * entrou há pouco tempo, e renovar o token NÃO conta como entrar de novo; por isso a senha é pedida de novo.
   */
  async function reauthenticate(password) {
    if (!session) throw new CloudError('session', 'Você não está conectado.');
    const uid = session.uid;
    const data = await identity('signInWithPassword', { email: session.email, password, returnSecureToken: true });
    if ((data.localId ?? data.user_id) !== uid) throw new CloudError('session', 'Essa senha é de outra conta. Entre de novo.');
    writeSession(sessionFrom(data));
    return session;
  }

  /** Troca o refresh token por um token novo. Se a conta não vale mais, a sessão é encerrada. */
  async function refresh() {
    if (!session) throw new CloudError('session', 'Você não está conectado.');
    const res = await send(`${config.tokenUrl}/token?key=${encodeURIComponent(config.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(session.refreshToken)}`,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = mapAuthError(data?.error?.message);
      if (err.code === 'session' || err.code === 'disabled') writeSession(null);
      throw err;
    }
    writeSession(sessionFrom(data));
    return session;
  }

  async function token() {
    if (!session) throw new CloudError('session', 'Você não está conectado.');
    if (session.expiresAt - now() < 60000) await refresh(); // renova 1 minuto antes de vencer
    return session.idToken;
  }

  /** O Firebase manda o e-mail de redefinição de senha (em português). */
  async function sendReset(email) {
    await identity('sendOobCode', { requestType: 'PASSWORD_RESET', email }, { 'X-Firebase-Locale': 'pt-BR' });
  }

  async function deleteAccount() {
    await identity('delete', { idToken: await token() });
    writeSession(null);
  }

  function signOut() {
    writeSession(null);
  }

  // ---------- banco (Realtime Database) ----------

  async function db(method, path, body, retried = false) {
    const idToken = await token();
    const url = `${config.databaseUrl.replace(/\/+$/, '')}/${path}.json?auth=${encodeURIComponent(idToken)}`;
    // text/plain evita um pedido de verificação extra do navegador (CORS); o banco aceita o JSON do mesmo jeito
    const init = body === undefined ? { method } : { method, headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(body) };
    const res = await send(url, init);
    if (res.status === 401 || res.status === 403) {
      const data = await res.json().catch(() => ({}));
      if (!retried && /expired|could not parse|auth token/i.test(String(data?.error ?? ''))) {
        await refresh();
        return db(method, path, body, true);
      }
      throw new CloudError('permission', config.exigirConvite
        ? 'O servidor recusou o acesso (código de convite incorreto ou regras do banco).'
        : 'O servidor recusou o acesso (confira as regras do banco).', res.status);
    }
    if (res.status === 404) throw new CloudError('config', 'Não encontrei o banco de dados. Confira databaseUrl em js/cloud/config.js.', 404);
    if (!res.ok) throw new CloudError('server', `Erro do servidor (${res.status}).`, res.status);
    return res.json().catch(() => null);
  }

  /** Outra aba do mesmo navegador entrou ou saiu: relê a sessão guardada. */
  function reloadSession() {
    session = readSession();
    for (const fn of [...listeners]) fn(session);
  }

  return {
    get session() { return session; },
    reloadSession,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    signUp, signIn, signOut, sendReset, deleteAccount, reauthenticate, refresh, token,
    dbGet: (path) => db('GET', path),
    dbPut: (path, value) => db('PUT', path, value),
    dbDelete: (path) => db('DELETE', path),
  };
}
