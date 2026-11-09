// Microfone do app: a fala vira texto pelo reconhecimento de voz do próprio navegador (Web Speech API).
//
// Ouve até a pessoa mandar parar (tocar em "Parar e enviar", no microfone de novo ou apertar Enter), e SÓ ENTÃO entrega o texto
// (`onFinal`). Uma tarefa falada tem pausas para pensar: o modo contínuo atravessa as pausas e, se o navegador terminar sozinho
// mesmo assim, o app volta a ouvir e junta tudo. Se ficar muito tempo sem ouvir uma palavra, passar do tempo máximo ou o navegador
// não deixar voltar a ouvir, o app para de ouvir (o microfone não fica aberto à toa) mas NÃO envia: o texto fica com a pessoa
// (`onEnd` avisa `paused`) e ela continua falando ou manda criar a tarefa.
//
// O microfone NUNCA fica preso: depois de pedir para parar, cancelar, dar erro ou a página ir para segundo plano (iPhone), o app
// espera pouco pelo navegador e termina por ele (e pedir para parar de novo, passado um instante, termina na hora). Isso importa no
// iPhone, onde o modo contínuo do Safari às vezes não termina nem entrega o texto quando mandam parar.
//
// Onde funciona: Chrome e Edge (computador e Android) e Safari (aba comum do Mac e do iPhone). No app da Tela de Início do iPhone o
// aviso de permissão aparece e o microfone liga (relato do dono em 09/11/2026), mas a Apple diz que a API não é oficial nesse modo
// (WebKit, bug 225298): o Pauta tenta e, se o navegador recusar ou ficar mudo, lembra disso por alguns dias, para não falhar de novo a
// cada toque. Onde não funciona: Firefox. Nesses casos o app leva a pessoa ao microfone do teclado (js/ui/composer.js), que sempre
// funciona.
//
// Relatório (`report`): uma linha do tempo do último uso do microfone (horários, nomes de eventos e códigos de erro, NUNCA o que
// foi falado), para dar para descobrir o que houve quando algo trava num aparelho em que o desenvolvedor não pode testar.

const BLOCK_MS = 7 * 86400000; // por quanto tempo lembrar que o navegador recusou o reconhecimento de voz
const STOP_GRACE_MS = 3000; // depois de pedir para parar, quanto esperar o navegador terminar sozinho
const IOS_STOP_GRACE_MS = 2000; // idem, no iPhone (lá o fim costuma não chegar: não adianta esperar muito)
const FORCE_STOP_MS = 600; // pedir para parar DE NOVO depois deste tempo quer dizer "não espere mais": termina na hora
const ERROR_GRACE_MS = 1000; // depois de um erro, quanto esperar o navegador avisar o fim antes de o app terminar por ele
const MAX_LISTEN_MS = 3 * 60000; // tempo máximo ouvindo, de uma vez
const IDLE_MS = 45000; // sem ouvir nenhuma palavra por tanto tempo: a pessoa esqueceu o microfone aberto
const RESTART_MS = 250; // pausa entre o fim de uma rodada do navegador e o começo da próxima
const QUICK_END_MS = 1000; // uma rodada que termina antes disso sem ouvir nada...
const MAX_QUICK_ENDS = 4; // ...quatro vezes seguidas: o navegador não está conseguindo ouvir, para de insistir
const LOG_MAX = 160; // eventos guardados no relatório
const LOG_KEEP = 12; // os primeiros eventos nunca saem do relatório (mostram como a sessão começou)
const RESULT_LOG_MS = 800; // no relatório, no máximo um evento "chegou texto" por esse tempo

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

/** iPhone ou iPad (no Safari, no app da Tela de Início ou em qualquer outro navegador: no iOS todos usam o motor do Safari). */
export function isIos(env = globalThis) {
  const nav = env.navigator ?? {};
  return /iPad|iPhone|iPod/.test(nav.userAgent ?? '') || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}

/** O app foi aberto pelo ícone (sem a barra do navegador)? */
const isStandalone = (env) => env.navigator?.standalone === true || env.matchMedia?.('(display-mode: standalone)')?.matches === true;

/** O app aberto pela Tela de Início do iPhone/iPad (onde o reconhecimento de voz tem limites do sistema). */
export function isIosHomeScreenApp(env = globalThis) {
  return isIos(env) && isStandalone(env);
}

/**
 * Guarda, só neste aparelho, que o reconhecimento de voz foi recusado, e o relatório do último uso do microfone.
 * `storage`: getItem/setItem (o localStorage).
 */
export function createSpeechMemory(storage, key = 'pauta:voz') {
  const logKey = `${key}-log`;
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
    saveLog(report) {
      try { storage.setItem(logKey, JSON.stringify(report)); } catch { /* idem */ }
    },
    readLog() {
      try {
        const raw = storage.getItem(logKey);
        const saved = raw ? JSON.parse(raw) : null;
        return saved && Array.isArray(saved.events) ? saved : null;
      } catch {
        return null;
      }
    },
  };
}

/** O relatório do microfone em texto simples, uma linha por evento, para copiar e colar numa mensagem. Nunca tem o que foi falado. */
export function formatSpeechReport(report, version = '') {
  const m = report?.meta ?? {};
  const lines = [
    `Pauta ${version} - relatório do microfone (${m.startedAt || 'sem data'})`,
    `aparelho: ${m.ua || '?'}`,
    `iPhone ou iPad: ${m.ios ? 'sim' : 'não'} | app na Tela de Início: ${m.standalone ? 'sim' : 'não'} | modo contínuo: ${m.continuous ? 'sim' : 'não'} | idioma: ${m.lang || '?'}`,
  ];
  for (const ev of report?.events ?? []) lines.push(`+${ev.t} ms  ${ev.e}${ev.d !== undefined ? `  ${JSON.stringify(ev.d)}` : ''}`);
  if (report?.dropped) lines.push(`(${report.dropped} eventos do meio foram omitidos)`);
  return lines.join('\n');
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

/** Um evento a mais no relatório (o relatório é limitado: quando enche, saem os mais antigos depois dos primeiros). */
function addEvent(trail, name, detail) {
  if (!trail) return;
  if (trail.events.length >= LOG_MAX) {
    trail.events.splice(LOG_KEEP, 1);
    trail.dropped += 1;
  }
  const event = { t: Date.now() - trail.t0, e: name };
  if (detail !== undefined) event.d = detail;
  trail.events.push(event);
}

const isoDate = (ms) => {
  try { return new Date(ms).toISOString(); } catch { return ''; }
};

/**
 * @param {object} [env]     onde procurar a API (window)
 * @param {object} [options]
 * @param {object} [options.memory]  createSpeechMemory(): lembra entre uma abertura e outra do app que o navegador recusou
 */
export function createSpeech(env = globalThis, {
  memory = null, now = () => Date.now(), blockMs = BLOCK_MS, stopGraceMs = null, forceStopMs = FORCE_STOP_MS, errorGraceMs = ERROR_GRACE_MS,
  maxListenMs = MAX_LISTEN_MS, idleMs = IDLE_MS, restartMs = RESTART_MS, quickEndMs = QUICK_END_MS,
} = {}) {
  const Recognition = () => env.SpeechRecognition ?? env.webkitSpeechRecognition ?? null;
  const ios = isIos(env);
  const graceMs = () => stopGraceMs ?? (ios ? IOS_STOP_GRACE_MS : STOP_GRACE_MS);
  let active = null; // a sessão que está ouvindo
  let sessionBlocked = false;
  let trail = null; // o relatório do último uso do microfone: { meta, events, dropped, t0 }

  const snapshot = () => ({ meta: trail.meta, events: trail.events, dropped: trail.dropped });
  const persist = () => { if (trail) memory?.saveLog?.(snapshot()); };

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

  /**
   * Para de ouvir e entrega tudo o que foi ouvido (a pessoa mandou: Enter, "Parar e enviar", tocar no microfone). Se o navegador não
   * terminar sozinho, o app termina por ele daqui a pouco; pedir para parar de novo (passado um instante) termina na hora.
   * `auto: true` é o próprio app parando (silêncio longo demais, tempo máximo): aí NADA é entregue, o texto fica com a pessoa
   * (`onEnd` avisa `paused`) e só vira tarefa quando ela mandar.
   */
  function stop({ auto = false } = {}) {
    const session = active;
    if (!session) return;
    if (!auto) session.mode = 'send'; // a pessoa mandou: vale mesmo se o app já tinha começado a pausar sozinho
    if (session.stopping) {
      if (!auto && Date.now() - session.stopAt >= forceStopMs) session.forceEnd();
      return;
    }
    session.stopping = true;
    session.stopAt = Date.now();
    session.mode = auto ? 'pause' : 'send';
    session.note(auto ? 'auto-stop' : 'stop');
    if (session.restartTimer) { // entre uma rodada e outra não há nada rodando: termina agora
      session.finish('stop-between-rounds');
      return;
    }
    try { session.rec.stop(); } catch { /* já tinha terminado */ }
    session.later(session.forceEnd, graceMs()); // se o navegador não terminar sozinho, o app termina por ele
  }

  function cancel() {
    const session = active;
    if (!session || session.canceled) return;
    session.canceled = true;
    session.note('cancel');
    if (session.restartTimer) {
      session.finish('cancel-between-rounds');
      return;
    }
    try { session.rec.abort(); } catch { /* já tinha terminado */ }
    session.later(session.forceEnd, graceMs());
  }

  /**
   * Começa a ouvir. `onInterim(texto)` vem enquanto a pessoa fala (tudo o que foi ouvido até agora); `onFinal(texto, { confidence })`
   * uma vez, SÓ quando a pessoa manda parar (`confidence`: de 0 a 1, ou null se o navegador não informa); `onError(codigo)` se algo
   * falhar; `onEnd({ text, failed, canceled, paused })` sempre, no fim, mesmo que `onFinal` dê erro (`paused`: o app parou de ouvir
   * sozinho, por silêncio longo ou porque o navegador não deixou voltar a ouvir, e o texto NÃO foi entregue: fica com a pessoa).
   * `prefix`: texto que já estava no campo (continuar falando depois de uma pausa). Devolve false se não conseguiu começar.
   */
  function start({ lang = 'pt-BR', prefix = '', onInterim = () => {}, onFinal = () => {}, onError = () => {}, onEnd = () => {} } = {}) {
    const Ctor = Recognition();
    if (!Ctor || active) return false;
    let rec;
    try {
      rec = new Ctor();
    } catch {
      markBlocked('service-not-allowed'); // a API existe, mas o navegador não deixa usar
      return false;
    }
    // Contínuo em todo lugar, inclusive no iPhone: é o que ouve através das pausas. Sem ele o Safari termina a rodada no primeiro
    // silêncio e o app "enviava" no meio da frase (relato do dono com a 1.7.0, que usava uma rodada por frase no iPhone). O risco
    // do contínuo no iPhone (não terminar ao mandar parar) é coberto pelo fim garantido de `stop()`. Se o navegador terminar
    // sozinho mesmo assim, o app volta a ouvir (`scheduleRestart`); se ele não deixar, o texto fica com a pessoa (`paused`).
    const continuous = true;
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = continuous;
    rec.maxAlternatives = 1;

    const mine = {
      t0: Date.now(), dropped: 0, events: [],
      meta: { ua: String(env.navigator?.userAgent ?? ''), ios, standalone: isStandalone(env), continuous, lang, startedAt: isoDate(now()) },
    };
    trail = mine;
    const note = (name, detail) => addEvent(mine, name, detail);
    note('start');

    // `mode`: o que fazer com o texto quando a sessão acabar: 'send' (entregar com onFinal) ou 'pause' (deixar com a pessoa)
    const session = { rec, canceled: false, stopping: false, stopAt: 0, mode: 'send', restartTimer: null, timers: new Set(), note };
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
    const doc = env.document;
    let firm = joinText('', prefix); // o que ficou firme nas rodadas que já terminaram (e o que já estava no campo, se for continuação)
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
    let lastResultNote = 0;
    let running = false; // a rodada de agora está de pé (do `start()` até o `onend`)
    let lastLen = 0; // quantos trechos o navegador mandou da última vez (se encolher, ele zerou a lista: veja `onresult`)
    const text = () => joinText(firm, heard);
    if (prefix) note('resume', { chars: firm.length });

    const finish = (why = 'end') => {
      if (finished) return;
      finished = true;
      for (const timer of session.timers) clearTimeout(timer);
      session.timers.clear();
      session.restartTimer = null;
      if (active === session) active = null;
      doc?.removeEventListener?.('visibilitychange', onVisibility);
      const all = text();
      const paused = session.mode === 'pause' && !failed && !session.canceled && Boolean(all); // parou sozinho: o texto fica com a pessoa
      note('finish', { why, chars: all.length, failed, canceled: session.canceled, paused });
      persist();
      try {
        if (!failed && !session.canceled && !paused && all) {
          onFinal(all, { confidence: scores.length ? scores.reduce((sum, s) => sum + s, 0) / scores.length : null });
        }
      } catch (e) {
        note('onFinal-error');
        console.error(e);
      } finally {
        try { // o fim SEMPRE é avisado, para a tela voltar ao normal (mesmo que algo na entrega do texto tenha dado erro)
          onEnd({ text: all, failed, canceled: session.canceled, paused });
        } catch (e) {
          console.error(e);
        }
      }
    };
    session.finish = finish;
    const fail = (code) => {
      if (failed || finished) return;
      failed = true;
      note('error', code);
      markBlocked(code);
      session.later(session.forceEnd, errorGraceMs); // se o navegador não avisar o fim depois do erro, o app termina por ele
      try {
        onError(code);
      } catch (e) {
        console.error(e);
      }
    };
    /** Uma rodada acabou: o que foi ouvido nela passa a valer como firme. */
    const closeRound = () => {
      firm = joinText(firm, heard);
      heard = '';
      scores = scores.concat(roundScores);
      roundScores = [];
    };
    /** Pediram para parar (ou deu erro) e o navegador não terminou: termina por ele. Se nunca deu sinal de vida, está mudo (não funciona aqui). */
    session.forceEnd = () => {
      if (finished) return;
      note('force-end');
      if (!alive && !text() && !failed && !session.canceled) fail('service-not-allowed');
      try { rec.abort(); } catch { /* já tinha terminado */ }
      closeRound();
      finish('force');
    };
    /** iPhone: a página foi para segundo plano (outro app, tela bloqueada). O sistema tira o microfone dela, então o app larga a sessão. */
    function onVisibility() {
      if (finished || doc?.visibilityState !== 'hidden') return;
      note('hidden');
      if (!alive) return; // o aviso de permissão do sistema também pode esconder a página por um instante
      session.canceled = true; // o que foi ouvido continua no campo, mas nada é criado enquanto a pessoa não está olhando
      session.forceEnd();
    }

    const begin = () => {
      if (running) return true; // já está ouvindo (um segundo "terminou" do navegador não pode derrubar a rodada que já voltou)
      runStart = Date.now();
      runWords = false;
      try {
        rec.start();
        running = true;
        lastLen = 0;
        note('start-round');
        return true;
      } catch {
        note('start-failed');
        return false; // já estava ouvindo, ou o navegador recusou
      }
    };
    /** O navegador terminou sozinho e não deixa voltar a ouvir: com texto, ele fica com a pessoa (que continua ou envia); sem texto, é erro. */
    const giveUp = (why, aliveCode = 'unknown') => {
      if (text()) {
        session.mode = 'pause';
        closeRound();
        finish(why);
      } else {
        fail(alive ? aliveCode : 'service-not-allowed');
        finish(why);
      }
    };
    /** O navegador terminou sozinho (silêncio, ou o limite dele): volta a ouvir daqui a pouco. */
    const scheduleRestart = (attempt) => {
      session.restartTimer = session.later(() => {
        session.restartTimer = null;
        if (finished || session.stopping || session.canceled) return;
        if (begin()) return;
        if (attempt < 3) scheduleRestart(attempt + 1);
        else giveUp('restart-failed');
      }, restartMs);
    };
    // silêncio longo ou tempo máximo: o app para de ouvir (o microfone não fica aberto à toa), mas NÃO envia: o texto fica com a pessoa
    const autoStop = () => { if (active === session) stop({ auto: true }); };
    const armIdle = () => {
      if (idleTimer) session.clear(idleTimer);
      idleTimer = session.later(autoStop, idleMs);
    };

    const sign = (name) => () => { alive = true; note(name); };
    rec.onstart = sign('onstart');
    rec.onaudiostart = sign('audiostart');
    rec.onsoundstart = sign('soundstart');
    rec.onspeechstart = () => { alive = true; note('speechstart'); armIdle(); };
    rec.onspeechend = () => note('speechend');
    rec.onaudioend = () => note('audioend');
    rec.onnomatch = () => note('nomatch');
    rec.onresult = (event) => {
      alive = true;
      runWords = true;
      quickEnds = 0;
      // o navegador zerou a lista de trechos no meio da rodada (relatos do iOS 18.0: apaga o que foi dito antes de uma pausa): o que
      // já tínhamos vira firme, para não se perder. Dentro de uma rodada a lista só cresce, então encolher é sinal inequívoco.
      if (event.results.length < lastLen && heard) {
        firm = joinText(firm, heard);
        scores = scores.concat(roundScores);
        note('results-reset', { before: lastLen, after: event.results.length });
      }
      lastLen = event.results.length;
      let line = '';
      const conf = [];
      for (let i = 0; i < event.results.length; i++) {
        const best = event.results[i][0];
        line = absorb(line, (best?.transcript ?? '').trim());
        if (best?.confidence > 0) conf.push(best.confidence); // 0 = o navegador não informa
      }
      heard = line;
      roundScores = conf;
      if (Date.now() - lastResultNote >= RESULT_LOG_MS) {
        lastResultNote = Date.now();
        note('result', { n: event.results.length, chars: line.length, final: Boolean(event.results[event.results.length - 1]?.isFinal) });
      }
      armIdle();
      if (!session.canceled && !finished) onInterim(text());
    };
    rec.onerror = (event) => {
      if (session.canceled) return; // fomos nós que cancelamos: não é erro
      let code = event.error ?? 'unknown';
      lastError = code;
      if (code === 'no-speech') { // silêncio: normal numa pausa; o fim da rodada decide se volta a ouvir
        note('no-speech');
        return;
      }
      if (code === 'aborted') code = alive ? 'unknown' : 'service-not-allowed'; // o navegador desistiu sozinho
      fail(code);
    };
    rec.onend = () => {
      running = false;
      note('onend');
      closeRound();
      if (finished) return;
      if (failed || session.canceled || session.stopping) {
        finish('onend');
        return;
      }
      if (session.restartTimer) return; // já há uma volta a ouvir marcada: um segundo "terminou" não marca outra
      quickEnds = !runWords && Date.now() - runStart < quickEndMs ? quickEnds + 1 : 0;
      if (quickEnds >= MAX_QUICK_ENDS) { // acaba na hora, de novo e de novo, sem ouvir nada: não adianta insistir
        giveUp('quick-ends', lastError && lastError !== 'aborted' ? lastError : 'unknown');
        return;
      }
      scheduleRestart(1);
    };

    if (!begin()) return false;
    active = session;
    session.later(autoStop, maxListenMs);
    armIdle();
    if (ios) doc?.addEventListener?.('visibilitychange', onVisibility);
    return true;
  }

  return {
    /** O navegador tem a API E ainda não recusou (neste aparelho, nos últimos dias). */
    get usable() { return Boolean(Recognition()) && !isBlocked(); },
    /** O navegador tem a API, mas recusou: o app não insiste (a pessoa pode pedir para tentar de novo com `reset`). */
    get blocked() { return Boolean(Recognition()) && isBlocked(); },
    get listening() { return active !== null; },
    start,
    /**
     * Para de ouvir e entrega o que ouviu até agora (a pessoa mandou). Pedir de novo, passado um instante, termina na hora.
     * `{ auto: true }`: o app parando sozinho; nada é entregue e o texto fica com a pessoa (`onEnd` avisa `paused`).
     */
    stop,
    /** Cancela: nada é entregue. */
    cancel,
    /** Esquece que o navegador recusou (a pessoa quer tentar de novo). */
    reset() {
      sessionBlocked = false;
      memory?.clear();
    },
    /** Anota no relatório algo que o app fez com a fala (IA, tarefa criada...). Só nomes e códigos: nunca o texto falado. */
    note(name, detail) {
      addEvent(trail, name, detail);
      persist();
    },
    /** O que aconteceu na última vez que o microfone foi usado (neste aparelho): { meta, events, dropped }, ou null. */
    report() {
      return trail ? snapshot() : (memory?.readLog?.() ?? null);
    },
  };
}
