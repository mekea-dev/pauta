// Avisos com o app fechado: inscreve este aparelho no serviço de lembretes (worker/lembretes.js, guia em docs/LEMBRETES.md)
// e manda para ele a lista dos próximos avisos. O serviço recebe só ids e horários: os títulos das tarefas NUNCA saem do aparelho.

/** Chave pública do serviço (base64 "de URL") -> bytes, no formato que o navegador pede para se inscrever. */
export function urlBase64ToUint8Array(text) {
  const padded = `${text}${'='.repeat((4 - (text.length % 4)) % 4)}`.replaceAll('-', '+').replaceAll('_', '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

const toBase64Url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

function sameBytes(a, b) {
  if (!a || !b) return false;
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/** A "senha" deste aparelho junto ao serviço: a chave `auth` da inscrição (só o aparelho e o serviço de aviso a conhecem). */
function authOf(sub) {
  const json = typeof sub.toJSON === 'function' ? sub.toJSON() : {};
  if (json.keys?.auth) return json.keys.auth;
  const raw = typeof sub.getKey === 'function' ? sub.getKey('auth') : null;
  return raw ? toBase64Url(raw) : '';
}

const describeError = (e) => String(e?.message ?? e);

export function createPush({ workerUrl, env = globalThis, fetchImpl } = {}) {
  const base = String(workerUrl ?? '').trim().replace(/\/+$/, '');
  const doFetch = fetchImpl ?? ((...args) => env.fetch(...args));
  const nav = env.navigator;
  let keyPromise = null;

  const configured = () => /^https:\/\/[^/]+/.test(base);
  const hasNotifications = () => 'Notification' in env;
  const hasPush = () => Boolean(nav?.serviceWorker) && 'PushManager' in env && hasNotifications();

  /** Só manda o cabeçalho de conteúdo quando há corpo (um GET simples não precisa de "preflight" do navegador). */
  const call = (method, path, body) => doFetch(`${base}${path}`, body === undefined
    ? { method }
    : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  function vapidKey() {
    keyPromise ??= (async () => {
      const res = await call('GET', '/vapid');
      if (!res.ok) throw new Error(`serviço de lembretes: HTTP ${res.status}`);
      const { publicKey } = await res.json();
      if (typeof publicKey !== 'string' || publicKey.length < 80) throw new Error('chave do serviço inválida');
      return publicKey;
    })().catch((e) => {
      keyPromise = null; // tenta de novo na próxima vez
      throw e;
    });
    return keyPromise;
  }

  async function registration() {
    let timer;
    const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('o app ainda não está pronto para avisos (service worker)')), 6000); });
    try {
      return await Promise.race([nav.serviceWorker.ready, limit]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function subscription() {
    if (!hasPush()) return null;
    try {
      return await (await registration()).pushManager.getSubscription();
    } catch {
      return null;
    }
  }

  return {
    /** O que este aparelho/navegador consegue: `push` = avisos com o app fechado. */
    info() {
      return { configured: configured(), notifications: hasNotifications(), push: hasPush(), permission: hasNotifications() ? env.Notification.permission : 'unsupported' };
    },

    /** Busca a chave do serviço antes da pessoa tocar em "Ativar" (o pedido de permissão precisa vir logo do toque). */
    prefetch() {
      if (configured()) vapidKey().catch(() => {});
    },

    subscription,

    /** Pede a permissão e inscreve o aparelho. Chamar direto do toque num botão (o iPhone só aceita assim). */
    async enable() {
      if (!hasNotifications()) return { ok: false, reason: 'unsupported', permission: 'unsupported' };
      const permission = await env.Notification.requestPermission();
      if (permission !== 'granted') return { ok: false, reason: permission === 'denied' ? 'denied' : 'dismissed', permission };
      if (!hasPush()) return { ok: false, reason: 'unsupported-push', permission };
      if (!configured()) return { ok: false, reason: 'unconfigured', permission };
      try {
        const reg = await registration();
        const key = urlBase64ToUint8Array(await vapidKey());
        let sub = await reg.pushManager.getSubscription();
        if (sub && !sameBytes(sub.options?.applicationServerKey, key)) { // inscrito com outra chave (serviço refeito): começa de novo
          await sub.unsubscribe();
          sub = null;
        }
        sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        const res = await call('POST', '/subscribe', { endpoint: sub.endpoint, auth: authOf(sub) });
        if (!res.ok) throw new Error(`serviço de lembretes: HTTP ${res.status}`);
        return { ok: true, permission };
      } catch (e) {
        return { ok: false, reason: 'push', permission, detail: describeError(e) };
      }
    },

    /** Troca a lista de avisos deste aparelho no serviço. `reminders`: [{ id, at }]. Nunca lança erro. */
    async syncList(reminders) {
      try {
        const sub = await subscription();
        if (!sub) return { ok: false, reason: 'no-subscription' };
        const body = { endpoint: sub.endpoint, auth: authOf(sub), reminders };
        let res = await call('PUT', '/reminders', body);
        if (res.status === 403) { // o serviço não conhece este aparelho (banco novo): registra de novo e repete
          const again = await call('POST', '/subscribe', { endpoint: sub.endpoint, auth: authOf(sub) });
          if (again.ok) res = await call('PUT', '/reminders', body);
        }
        return { ok: res.ok, status: res.status };
      } catch (e) {
        return { ok: false, reason: 'network', detail: describeError(e) };
      }
    },

    /** Cancela a inscrição (no serviço e no navegador). */
    async disable() {
      try {
        const sub = await subscription();
        if (!sub) return;
        try {
          await call('DELETE', '/subscription', { endpoint: sub.endpoint, auth: authOf(sub) });
        } catch { /* sem rede: o serviço apaga sozinho quando o endereço deixar de valer */ }
        await sub.unsubscribe();
      } catch { /* nada a desfazer */ }
    },
  };
}
