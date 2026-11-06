// Motor de sincronização: puxa o que está na nuvem, MESCLA com o que está neste aparelho (sem perder nada
// de nenhum dos lados) e grava o resultado. Funciona offline: se não der, tenta de novo depois.
//
// Na nuvem cada pessoa tem um único documento: users/<uid> = { v, updatedAt, sig, blob, convite? },
// onde `blob` é o JSON de { tasks, labels, deleted } e `sig` é uma assinatura aleatória que muda a cada gravação
// (serve para saber, com uma consulta de poucos bytes, se algum outro aparelho gravou algo novo).
import { sanitizeSnapshot } from '../model.js';
import { canonical, emptySnapshot, mergeSnapshots } from '../sync/merge.js';
import { CloudError } from './firebase.js';

const MAX_BLOB = 900000; // as regras do banco recusam mais que ~1 MB

/** Assinatura aleatória de cada gravação: muda a cada envio, mesmo que dois aparelhos gravem no mesmo milissegundo. */
function newSig() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    /* sem crypto: cai no plano B */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function parseBlob(text) {
  try {
    return sanitizeSnapshot(JSON.parse(text));
  } catch {
    throw new CloudError('data', 'Os dados guardados na nuvem estão ilegíveis. Nada foi apagado; avise quem administra o serviço.');
  }
}

/**
 * @param {{store: object, cloud: object, config: object, clock?: () => number, timers?: object}} opts
 */
export function createSync({ store, cloud, config, clock = () => Date.now(), timers = { setTimeout: (...a) => setTimeout(...a), clearTimeout: (...a) => clearTimeout(...a) } }) {
  const status = { state: cloud.session ? 'idle' : 'off', lastSyncAt: null, error: null, errorCode: null };
  const listeners = new Set();
  let timer = 0;
  let running = null;
  let again = false;
  let failures = 0;
  let seen = { sig: null, rev: -1 }; // assinatura da última versão da nuvem que conhecemos + versão local já enviada

  const set = (patch) => {
    Object.assign(status, patch);
    for (const fn of [...listeners]) fn({ ...status });
  };
  const iso = () => new Date(clock()).toISOString();

  /** Uma rodada: puxar, mesclar, aplicar aqui e gravar na nuvem se a nuvem ficou diferente. */
  async function pass() {
    const { uid, convite } = cloud.session;
    const path = `users/${uid}`;
    // consulta barata: só a assinatura da nuvem (poucos bytes). Se nada mudou lá nem aqui, não baixa nada
    // (importa no plano gratuito: cada aparelho consulta a cada 90 s)
    const sig = await cloud.dbGet(`${path}/sig`);
    if (typeof sig === 'string' && sig === seen.sig && store.rev === seen.rev) return store.rev;
    const doc = await cloud.dbGet(path);
    const remote = doc && typeof doc.blob === 'string' ? parseBlob(doc.blob) : emptySnapshot();
    // daqui até aplicar não há "await": nenhuma edição do usuário entra no meio
    const local = store.snapshot();
    const now = iso();
    const merged = mergeSnapshots(local, remote, { now });
    const key = canonical(merged);
    if (key !== canonical(local)) store.applyRemote(merged);
    const revAfter = store.rev;
    let known = typeof doc?.sig === 'string' ? doc.sig : null;
    if (!doc || key !== canonical(remote)) {
      const blob = JSON.stringify(merged);
      if (blob.length > MAX_BLOB) throw new CloudError('toolarge', 'Há tarefas demais para sincronizar (limite de cerca de 900 KB). Exclua tarefas concluídas antigas.');
      const value = { v: 1, updatedAt: now, sig: newSig(), blob };
      if (config.exigirConvite && convite) value.convite = convite;
      await cloud.dbPut(path, value);
      known = value.sig;
    }
    seen = { sig: known, rev: revAfter };
    return revAfter;
  }

  async function run() {
    if (!cloud.session) {
      set({ state: 'off', error: null, errorCode: null });
      return { ok: false, code: 'off' };
    }
    set({ state: 'syncing', error: null, errorCode: null });
    try {
      const revAfter = await pass();
      failures = 0;
      set({ state: 'idle', lastSyncAt: iso(), error: null, errorCode: null });
      if (store.rev !== revAfter) scheduleSoon(1500); // o usuário mexeu enquanto sincronizava
      return { ok: true };
    } catch (e) {
      failures += 1;
      const code = e?.code ?? 'unknown';
      const message = e?.message ?? 'Não consegui sincronizar.';
      if (code === 'network') set({ state: 'offline', error: message, errorCode: code });
      else if (code === 'session' || code === 'disabled') set({ state: 'off', error: message, errorCode: code });
      else set({ state: 'error', error: message, errorCode: code });
      // tenta de novo sozinho, com intervalos maiores a cada falha (só quando faz sentido tentar)
      if (code === 'network' || code === 'server' || code === 'unknown') scheduleSoon(Math.min(120000, 15000 * 2 ** Math.min(failures - 1, 3)));
      return { ok: false, code, message };
    }
  }

  /** Sincroniza agora. Se já está sincronizando, pede mais uma rodada ao terminar. */
  function syncNow() {
    if (running) {
      again = true;
      return running;
    }
    running = run().finally(() => {
      running = null;
      if (again) {
        again = false;
        scheduleSoon(0);
      }
    });
    return running;
  }

  /** Espera terminar a rodada em andamento (se houver). Usado antes de apagar a conta, para nada ser regravado depois. */
  async function whenIdle() {
    while (running) await running.catch(() => {});
  }

  /** Agenda uma sincronização (vários pedidos seguidos viram um só). */
  function scheduleSoon(ms = 3000) {
    timers.clearTimeout(timer);
    timer = timers.setTimeout(() => {
      timer = 0;
      syncNow();
    }, ms);
  }

  function stop() {
    timers.clearTimeout(timer);
    timer = 0;
    again = false;
    failures = 0;
    seen = { sig: null, rev: -1 };
    set({ state: 'off', error: null, errorCode: null, lastSyncAt: null });
  }

  return {
    get status() { return { ...status }; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    syncNow, scheduleSoon, whenIdle, stop,
  };
}
