// Microfone do app: a fala vira texto pelo reconhecimento de voz do próprio navegador (Web Speech API).
//
// Onde funciona: Chrome e Edge (computador e Android) e Safari (aba comum, no Mac e no iPhone).
// Onde não funciona: Firefox e, até onde se sabe, o app instalado na Tela de Início do iPhone (a Apple respondeu que a API
// não está disponível nesse modo "por enquanto": WebKit, bug 225298). Mesmo assim o Pauta TENTA nesse modo, porque uma versão nova
// do iOS pode liberar. Se o navegador recusar (ou ficar mudo), o app lembra disso por alguns dias, para não falhar de novo a cada
// toque, e leva a pessoa ao microfone do teclado (js/ui/composer.js), que sempre funciona.

const BLOCK_MS = 7 * 86400000; // por quanto tempo lembrar que o navegador recusou o reconhecimento de voz
const STOP_GRACE_MS = 3000; // depois de pedir para parar, quanto esperar o navegador terminar sozinho
const MAX_LISTEN_MS = 30000; // ninguém dita uma tarefa por mais tempo que isso: para sozinho

/** Mensagem para cada erro do reconhecimento. `fatal`: não adianta tentar de novo; usa o ditado do teclado. */
const ERRORS = {
  'not-allowed': { fatal: true, text: 'O microfone está bloqueado para este site. Libere nas permissões do navegador ou use o microfone do teclado.' },
  'service-not-allowed': { fatal: true, text: 'O reconhecimento de voz não está disponível neste modo. Use o microfone do teclado.' },
  'language-not-supported': { fatal: true, text: 'O reconhecimento de voz em português não está disponível neste navegador. Use o microfone do teclado.' },
  'audio-capture': { fatal: false, text: 'Não encontrei um microfone neste aparelho.' },
  network: { fatal: false, text: 'Sem internet para reconhecer a fala. Tente de novo.' },
  'no-speech': { fatal: false, text: 'Não ouvi nada. Toque no microfone e fale.' },
};

/** O que dizer para um erro do reconhecimento. `aborted` (a pessoa cancelou) devolve null: não é erro. */
export function describeSpeechError(code) {
  if (code === 'aborted') return null;
  return ERRORS[code] ?? { fatal: false, text: 'Não consegui ouvir. Tente de novo.' };
}

/** O app aberto pela Tela de Início do iPhone/iPad (onde o reconhecimento de voz do navegador, até onde se sabe, não funciona). */
export function isIosHomeScreenApp(env = globalThis) {
  const nav = env.navigator ?? {};
  const ios = /iPad|iPhone|iPod/.test(nav.userAgent ?? '') || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  const standalone = nav.standalone === true || env.matchMedia?.('(display-mode: standalone)')?.matches === true;
  return ios && standalone;
}

/** Guarda, só neste aparelho, que o reconhecimento de voz foi recusado. `storage`: getItem/setItem (o localStorage). */
export function createSpeechMemory(storage, key = 'pauta:voz') {
  return {
    get() {
      try {
        const raw = storage.getItem(key);
        const saved = raw ? JSON.parse(raw) : null;
        return saved && Number.isFinite(saved.at) ? { at: saved.at, code: String(saved.code ?? '') } : null;
      } catch {
        return null;
      }
    },
    set(entry) {
      try { storage.setItem(key, JSON.stringify(entry)); } catch { /* sem armazenamento: vale só nesta sessão */ }
    },
    clear() {
      try { storage.setItem(key, ''); } catch { /* idem */ }
    },
  };
}

/**
 * @param {object} [env]     onde procurar a API (window)
 * @param {object} [options]
 * @param {object} [options.memory]  createSpeechMemory(): lembra entre uma abertura e outra do app que o navegador recusou
 */
export function createSpeech(env = globalThis, { memory = null, now = () => Date.now(), blockMs = BLOCK_MS, stopGraceMs = STOP_GRACE_MS, maxListenMs = MAX_LISTEN_MS } = {}) {
  const Recognition = () => env.SpeechRecognition ?? env.webkitSpeechRecognition ?? null;
  let active = null; // a sessão que está ouvindo
  let sessionBlocked = false;

  function isBlocked() {
    if (sessionBlocked) return true;
    const saved = memory?.get();
    if (!saved) return false;
    const age = now() - saved.at;
    return age >= 0 && age < blockMs; // relógio mudado para trás: ignora o que foi anotado "no futuro"
  }

  /**
   * O navegador recusou: não adianta insistir agora. "Não permitido" só conta no app da Tela de Início do iPhone, onde é um limite
   * do sistema; em outros lugares é escolha da pessoa (que pode liberar nas permissões) e o navegador já cuida disso.
   */
  function markBlocked(code) {
    const limit = code === 'service-not-allowed' || code === 'language-not-supported' || (code === 'not-allowed' && isIosHomeScreenApp(env));
    if (!limit) return;
    sessionBlocked = true;
    memory?.set({ at: now(), code });
  }

  function stop() {
    const session = active;
    if (!session) return;
    try { session.rec.stop(); } catch { /* já tinha terminado */ }
    session.later(session.forceEnd, stopGraceMs); // se o navegador não terminar sozinho, o app termina por ele
  }

  function cancel() {
    const session = active;
    if (!session) return;
    session.canceled = true;
    try { session.rec.abort(); } catch { /* já tinha terminado */ }
    session.later(session.forceEnd, stopGraceMs);
  }

  /**
   * Começa a ouvir. `onInterim(texto)` vem enquanto a pessoa fala; `onFinal(texto)` uma vez, quando ela termina;
   * `onError(codigo)` se algo falhar; `onEnd()` sempre, no fim. Devolve false se não conseguiu começar.
   */
  function start({ lang = 'pt-BR', onInterim = () => {}, onFinal = () => {}, onError = () => {}, onEnd = () => {} } = {}) {
    const Ctor = Recognition();
    if (!Ctor || active) return false;
    let rec;
    try {
      rec = new Ctor();
    } catch {
      markBlocked('service-not-allowed'); // a API existe, mas o navegador não deixa usar
      return false;
    }
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    const session = { rec, canceled: false, timers: [] };
    session.later = (fn, ms) => {
      const timer = setTimeout(fn, ms);
      timer?.unref?.(); // no Node, um relógio pendente não pode segurar o programa aberto
      session.timers.push(timer);
    };
    let text = ''; // tudo o que foi ouvido (o que já está firme e o que ainda pode mudar)
    let alive = false; // o navegador deu algum sinal de vida (começou a ouvir, ouviu algo)
    let failed = false;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      for (const timer of session.timers) clearTimeout(timer);
      if (active === session) active = null;
      if (!failed && !session.canceled && text) onFinal(text);
      onEnd();
    };
    const fail = (code) => {
      if (failed || finished) return;
      failed = true;
      markBlocked(code);
      onError(code);
    };
    /** Pediram para parar e o navegador não terminou: termina por ele. Se nunca deu sinal de vida, está mudo (não funciona aqui). */
    session.forceEnd = () => {
      if (finished) return;
      if (!alive && !text && !failed && !session.canceled) fail('service-not-allowed');
      try { rec.abort(); } catch { /* já tinha terminado */ }
      finish();
    };

    const sign = () => { alive = true; };
    rec.onstart = sign;
    rec.onaudiostart = sign;
    rec.onsoundstart = sign;
    rec.onspeechstart = sign;
    rec.onresult = (event) => {
      alive = true;
      let heard = '';
      for (let i = 0; i < event.results.length; i++) heard += event.results[i][0]?.transcript ?? '';
      text = heard.trim();
      if (!session.canceled && !finished) onInterim(text);
    };
    rec.onerror = (event) => {
      if (session.canceled) return; // fomos nós que cancelamos: não é erro
      let code = event.error ?? 'unknown';
      if (code === 'aborted') code = alive ? 'unknown' : 'service-not-allowed'; // o navegador desistiu sozinho
      fail(code);
    };
    rec.onend = finish;

    try {
      rec.start();
    } catch {
      return false; // já estava ouvindo, ou o navegador recusou
    }
    active = session;
    session.later(() => { if (active === session) stop(); }, maxListenMs);
    return true;
  }

  return {
    /** O navegador tem a API E ainda não recusou (neste aparelho, nos últimos dias). */
    get usable() { return Boolean(Recognition()) && !isBlocked(); },
    /** O navegador tem a API, mas recusou: o app não insiste (a pessoa pode pedir para tentar de novo com `reset`). */
    get blocked() { return Boolean(Recognition()) && isBlocked(); },
    get listening() { return active !== null; },
    start,
    /** Para de ouvir e entrega o que ouviu até agora. */
    stop,
    /** Cancela: nada é entregue. */
    cancel,
    /** Esquece que o navegador recusou (a pessoa quer tentar de novo). */
    reset() {
      sessionBlocked = false;
      memory?.clear();
    },
  };
}
