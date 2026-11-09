// Motor dos lembretes: decide QUANDO avisar e mantém tudo em dia.
//   - com o app aberto: um relógio confere a cada 20 s e mostra o aviso (na tela se você está olhando; notificação do sistema
//     se a aba está escondida);
//   - com o app fechado: o serviço de lembretes (worker/lembretes.js) dá um "toque" (Web Push) na hora certa e o service worker
//     (sw.js) mostra a notificação lendo a cópia da lista guardada aqui, no aparelho (o "espelho").
// Os dois lados avisam cada lembrete UMA vez: o que já foi mostrado fica anotado em "mostrados" (também no espelho).
import { due, notificationEntry, upcoming } from './reminders.js';

/** Nome do cache do espelho. NÃO pode começar com "pauta-": o sw.js apaga os caches antigos com esse prefixo. */
const MIRROR_CACHE = 'avisos-v1';
const SHOWN_KEEP_MS = 3 * 86400000;
const MAX_LIST = 100; // o serviço de lembretes aceita até 100 avisos por aparelho

/** Guarda a lista de avisos e os já mostrados num lugar que a página E o service worker enxergam (Cache API). */
export function createMirror({ cacheStorage = globalThis.caches, base = globalThis.location?.href } = {}) {
  const urlOf = (key) => new URL(`./__${key}.json`, base).href;
  return {
    async read(key, fallback = null) {
      try {
        const hit = await (await cacheStorage.open(MIRROR_CACHE)).match(urlOf(key));
        return hit ? await hit.json() : fallback;
      } catch {
        return fallback;
      }
    },
    async write(key, value) {
      try {
        const cache = await cacheStorage.open(MIRROR_CACHE);
        await cache.put(urlOf(key), new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }));
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * @param {object} deps
 * @param {object} deps.store      as tarefas (state.tasks e subscribe)
 * @param {object} deps.mirror     createMirror()
 * @param {object} deps.push       createPush()
 * @param {object} deps.notify     { fire(aviso) -> Promise<boolean> }: o que aparece na tela (js/ui/notify.js)
 * @param {object} deps.prefs      { get(): 'on' | 'off' | null, set(valor) }: a escolha da pessoa, só neste aparelho
 * @param {() => Date} [deps.now]
 * @param {number} [deps.intervalMs]
 * @param {object} [deps.env]      window (para saber quando o app volta para a frente)
 */
export function createAlerts({ store, mirror, push, notify, prefs, now = () => new Date(), intervalMs = 20000, env = globalThis }) {
  const listeners = new Set();
  const state = { permission: 'default', push: 'off', detail: '' }; // push: on | off | unsupported | unconfigured
  let lastSent = null; // a última lista enviada ao serviço (não reenvia a mesma)
  let timer = 0;
  let syncTimer = 0;
  let ticking = false;

  const emit = () => { for (const fn of listeners) fn(state); };
  const muted = () => prefs.get() === 'off';

  const prune = (shown, t) => Object.fromEntries(Object.entries(shown).filter(([, at]) => at > t - SHOWN_KEEP_MS));
  const loadShown = async () => (await mirror.read('mostrados', {})) ?? {};

  /** Avisos que ainda vão tocar mais os que acabaram de vencer (o service worker precisa deles na hora do "toque"). */
  function entries(t) {
    const tasks = store.state.tasks;
    return [...upcoming(tasks, t, { limit: MAX_LIST }), ...due(tasks, t)].map(notificationEntry).sort((a, b) => a.at - b.at);
  }

  async function refresh() {
    const info = push.info();
    state.permission = info.permission;
    if (!info.configured) state.push = 'unconfigured';
    else if (!info.push) state.push = 'unsupported';
    else state.push = info.permission === 'granted' && (await push.subscription()) ? 'on' : 'off';
    emit();
  }

  /** Atualiza o espelho (sempre) e a lista no serviço de lembretes (se este aparelho está inscrito). */
  async function sync(force = false) {
    const t = now();
    const all = entries(t);
    await mirror.write('avisos', all);
    if (state.push !== 'on' || muted()) return;
    const shown = await loadShown();
    // o que a página já mostrou não precisa de "toque": senão a notificação do sistema viria depois do aviso na tela
    const payload = all.filter((r) => !(r.at <= t.getTime() && shown[r.id])).slice(0, MAX_LIST).map(({ id, at }) => ({ id, at }));
    const sig = JSON.stringify(payload);
    if (!force && sig === lastSent) return;
    const r = await push.syncList(payload);
    if (r.ok) {
      lastSent = sig;
      if (state.detail) { state.detail = ''; emit(); }
    } else {
      state.detail = r.reason === 'network' ? 'sem conexão com o serviço de lembretes' : `o serviço de lembretes recusou o pedido (${r.status ?? r.reason})`;
      emit();
    }
  }

  /** Mostra os avisos que já estão na hora e ainda não foram mostrados. Devolve quantos. */
  async function tick() {
    if (muted() || ticking) return 0;
    ticking = true;
    try {
      const t = now();
      const ms = t.getTime();
      const shown = await loadShown();
      const fresh = due(store.state.tasks, t).map(notificationEntry).filter((r) => !shown[r.id]);
      let delivered = 0;
      for (const r of fresh) {
        // só anota como mostrado o que apareceu de verdade (aba escondida e sem permissão: tenta de novo no próximo ciclo)
        if (await notify.fire(r)) {
          shown[r.id] = ms;
          delivered += 1;
        }
      }
      if (delivered) {
        await mirror.write('mostrados', prune(shown, ms));
        sync().catch(() => {}); // o serviço pode largar estes avisos: já foram mostrados
      }
      return delivered;
    } finally {
      ticking = false;
    }
  }

  const scheduleSync = (ms = 1500) => {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => sync().catch(() => {}), ms);
  };

  async function start() {
    push.prefetch();
    await refresh();
    // a permissão já foi dada mas a inscrição sumiu (o navegador as vezes limpa): refaz, sem perguntar nada
    if (state.permission === 'granted' && state.push === 'off' && push.info().push && push.info().configured && !muted()) {
      await push.enable();
      await refresh();
    }
    await sync();
    await tick();
    timer = setInterval(() => tick().catch(() => {}), intervalMs);
    store.subscribe(() => scheduleSync());
    // o app voltou para a frente (ou a internet voltou): confere na hora, sem esperar o relógio
    const wake = () => {
      if (env.document?.visibilityState && env.document.visibilityState !== 'visible') return;
      tick().catch(() => {});
      refresh().then(() => sync()).catch(() => {});
    };
    env.document?.addEventListener?.('visibilitychange', wake);
    env.addEventListener?.('online', wake);
  }

  async function enable() {
    prefs.set('on');
    const r = await push.enable();
    await refresh();
    state.detail = !r.ok && r.reason === 'push' ? (r.detail ?? '') : '';
    if (state.push === 'on') await sync(true);
    else await mirror.write('avisos', entries(now()));
    emit();
    return r;
  }

  async function disable() {
    prefs.set('off');
    await push.disable();
    lastSent = null;
    state.detail = '';
    await refresh();
  }

  return {
    start,
    stop() {
      clearInterval(timer);
      clearTimeout(syncTimer);
    },
    tick,
    sync,
    refresh,
    enable,
    disable,
    status: () => ({ ...state, muted: muted() }),
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
