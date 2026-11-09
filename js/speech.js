// Microfone do app: a fala vira texto pelo reconhecimento de voz do próprio navegador (Web Speech API).
//
// Ouve até a pessoa mandar parar (tocar no microfone de novo ou apertar Enter): o navegador costuma encerrar sozinho no primeiro
// silêncio, e uma tarefa falada tem pausas para pensar, então quando ele termina por conta própria o app volta a ouvir e junta tudo.
// Só para sozinho se ficar muito tempo sem ouvir uma palavra ou passar do tempo máximo (para o microfone não ficar aberto à toa).
//
// Onde funciona: Chrome e Edge (computador e Android) e Safari (aba comum, no Mac e no iPhone).
// Onde não funciona: Firefox e, até onde se sabe, o app instalado na Tela de Início do iPhone (a Apple respondeu que a API
// não está disponível nesse modo "por enquanto": WebKit, bug 225298). Mesmo assim o Pauta TENTA nesse modo, porque uma versão nova
// do iOS pode liberar. Se o navegador recusar (ou ficar mudo), o app lembra disso por alguns dias, para não falhar de novo a cada
// toque, e leva a pessoa ao microfone do teclado (js/ui/composer.js), que sempre funciona.

const BLOCK_MS = 7 * 86400000; // por quanto tempo lembrar que o navegador recusou o reconhecimento de voz
const STOP_GRACE_MS = 3000; // depois de pedir para parar, quanto esperar o navegador terminar sozinho
const MAX_LISTEN_MS = 3 * 60000; // tempo máximo ouvindo, de uma vez
const IDLE_MS = 45000; // sem ouvir nenhuma palavra por tanto tempo: a pessoa esqueceu o microfone aberto
const RESTART_MS = 250; // pausa entre o fim de uma rodada do navegador e o começo da próxima
const QUICK_END_MS = 1000; // uma rodada que termina antes disso sem ouvir nada...
const MAX_QUICK_ENDS = 4; // ...quatro vezes seguidas: o navegador não está conseguindo ouvir, para de insistir

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

/** Junta dois trechos de texto com um espaço só. */
const joinText = (a, b) => `${a} ${b}`.replace(/\s+/g, ' ').trim();

/**
 * Soma um trecho do navegador ao que já veio. Alguns navegadores (Chrome no Android) mandam cada trecho já com tudo o que foi
 * dito antes ("oi", "oi tudo", "oi tudo bem"): nesse caso fica só o mais completo, em vez de repetir.
 */
function absorb(line, piece) {
  if (!piece) return line;
  if (!line) return piece;
  if (piece.toLowerCase().startsWith(line.toLowerCase())) return piece;
  return `${line} ${piece}`;
}

/**
 * @param {object} [env]     onde procurar a API (window)
 * @param {object} [options]
 * @param {object} [options.memory]  createSpeechMemory(): lembra entre uma abertura e outra do app que o navegador recusou
 */
export function createSpeech(env = globalThis, {
  memory = null, now = () => Date.now(), blockMs = BLOCK_MS, stopGraceMs = STOP_GRACE_MS,
  maxListenMs = MAX_LISTEN_MS, idleMs = IDLE_MS, restartMs = RESTART_MS, quickEndMs = QUICK_END_MS,
} = {}) {
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

  /** Para de ouvir e entrega tudo o que foi ouvido. */
  function stop() {
    const session = active;
    if (!session) return;
    session.stopping = true;
    if (session.restartTimer) { // entre uma rodada e outra não há nada rodando: termina agora
      session.finish();
      return;
    }
    try { session.rec.stop(); } catch { /* já tinha terminado */ }
    session.later(session.forceEnd, stopGraceMs); // se o navegador não terminar sozinho, o app termina por ele
  }

  function cancel() {
    const session = active;
    if (!session) return;
    session.canceled = true;
    if (session.restartTimer) {
      session.finish();
      return;
    }
    try { session.rec.abort(); } catch { /* já tinha terminado */ }
    session.later(session.forceEnd, stopGraceMs);
  }

  /**
   * Começa a ouvir. `onInterim(texto)` vem enquanto a pessoa fala (tudo o que foi ouvido até agora); `onFinal(texto, { confidence })`
   * uma vez, quando acaba (`confidence`: de 0 a 1, ou null se o navegador não informa); `onError(codigo)` se algo falhar;
   * `onEnd({ text, failed, canceled })` sempre, no fim. Devolve false se não conseguiu começar.
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
    rec.continuous = true; // não para no primeiro silêncio (e se parar mesmo assim, o app volta a ouvir)
    rec.maxAlternatives = 1;

    const session = { rec, canceled: false, stopping: false, restartTimer: null, timers: new Set() };
    session.later = (fn, ms) => {
      const timer = setTimeout(() => { session.timers.delete(timer); fn(); }, ms);
      timer?.unref?.(); // no Node, um relógio pendente não pode segurar o programa aberto
      session.timers.add(timer);
      return timer;
    };
    session.clear = (timer) => {
      clearTimeout(timer);
      session.timers.delete(timer);
    };
    let firm = ''; // o que ficou firme nas rodadas que já terminaram
    let heard = ''; // o que a rodada de agora ouviu (firme e provisório)
    let scores = []; // confiança de cada trecho reconhecido, das rodadas que já terminaram
    let roundScores = []; // idem, da rodada de agora
    let alive = false; // o navegador deu algum sinal de vida (começou a ouvir, ouviu algo)
    let failed = false;
    let finished = false;
    let runStart = 0;
    let runWords = false;
    let quickEnds = 0;
    let lastError = null;
    let idleTimer = null;
    const text = () => joinText(firm, heard);

    const finish = () => {
      if (finished) return;
      finished = true;
      for (const timer of session.timers) clearTimeout(timer);
      session.timers.clear();
      session.restartTimer = null;
      if (active === session) active = null;
      const all = text();
      if (!failed && !session.canceled && all) {
        onFinal(all, { confidence: scores.length ? scores.reduce((sum, s) => sum + s, 0) / scores.length : null });
      }
      onEnd({ text: all, failed, canceled: session.canceled });
    };
    session.finish = finish;
    const fail = (code) => {
      if (failed || finished) return;
      failed = true;
      markBlocked(code);
      onError(code);
    };
    /** Uma rodada acabou: o que foi ouvido nela passa a valer como firme. */
    const closeRound = () => {
      firm = joinText(firm, heard);
      heard = '';
      scores = scores.concat(roundScores);
      roundScores = [];
    };
    /** Pediram para parar e o navegador não terminou: termina por ele. Se nunca deu sinal de vida, está mudo (não funciona aqui). */
    session.forceEnd = () => {
      if (finished) return;
      if (!alive && !text() && !failed && !session.canceled) fail('service-not-allowed');
      try { rec.abort(); } catch { /* já tinha terminado */ }
      closeRound();
      finish();
    };

    const begin = () => {
      runStart = Date.now();
      runWords = false;
      try {
        rec.start();
        return true;
      } catch {
        return false; // já estava ouvindo, ou o navegador recusou
      }
    };
    /** O navegador terminou sozinho (silêncio, ou o limite dele): volta a ouvir daqui a pouco. */
    const scheduleRestart = (attempt) => {
      session.restartTimer = session.later(() => {
        session.restartTimer = null;
        if (finished || session.stopping || session.canceled) return;
        if (begin()) return;
        if (attempt < 3) {
          scheduleRestart(attempt + 1);
        } else {
          fail(alive ? 'unknown' : 'service-not-allowed');
          finish();
        }
      }, restartMs);
    };
    const armIdle = () => {
      if (idleTimer) session.clear(idleTimer);
      idleTimer = session.later(() => { if (active === session) stop(); }, idleMs);
    };

    const sign = () => { alive = true; };
    rec.onstart = sign;
    rec.onaudiostart = sign;
    rec.onsoundstart = sign;
    rec.onspeechstart = () => { alive = true; armIdle(); };
    rec.onresult = (event) => {
      alive = true;
      runWords = true;
      quickEnds = 0;
      let line = '';
      const conf = [];
      for (let i = 0; i < event.results.length; i++) {
        const best = event.results[i][0];
        line = absorb(line, (best?.transcript ?? '').trim());
        if (best?.confidence > 0) conf.push(best.confidence); // 0 = o navegador não informa
      }
      heard = line;
      roundScores = conf;
      armIdle();
      if (!session.canceled && !finished) onInterim(text());
    };
    rec.onerror = (event) => {
      if (session.canceled) return; // fomos nós que cancelamos: não é erro
      let code = event.error ?? 'unknown';
      lastError = code;
      if (code === 'no-speech') return; // silêncio: normal numa pausa; o fim da rodada decide se volta a ouvir
      if (code === 'aborted') code = alive ? 'unknown' : 'service-not-allowed'; // o navegador desistiu sozinho
      fail(code);
    };
    rec.onend = () => {
      closeRound();
      if (finished) return;
      if (failed || session.canceled || session.stopping) {
        finish();
        return;
      }
      quickEnds = !runWords && Date.now() - runStart < quickEndMs ? quickEnds + 1 : 0;
      if (quickEnds >= MAX_QUICK_ENDS) { // acaba na hora, de novo e de novo, sem ouvir nada: não adianta insistir
        fail(alive ? (lastError && lastError !== 'aborted' ? lastError : 'unknown') : 'service-not-allowed');
        finish();
        return;
      }
      scheduleRestart(1);
    };

    if (!begin()) return false;
    active = session;
    session.later(() => { if (active === session) stop(); }, maxListenMs);
    armIdle();
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
