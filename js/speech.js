// Microfone do app: a fala vira texto pelo reconhecimento de voz do próprio navegador (Web Speech API).
//
// Onde ele funciona: Chrome e Edge (computador e Android), Safari (aba normal, no Mac e no iPhone).
// Onde NÃO funciona: Firefox e o app instalado na Tela de Início do iPhone. Isso é uma limitação do iOS, não do Pauta:
// lá o botão do microfone só leva ao campo e o ditado é feito pelo microfone do teclado (js/ui/composer.js).

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

/** O app aberto pela Tela de Início do iPhone/iPad (onde o reconhecimento de voz do navegador não funciona). */
export function isIosHomeScreenApp(env = globalThis) {
  const nav = env.navigator ?? {};
  const ios = /iPad|iPhone|iPod/.test(nav.userAgent ?? '') || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  const standalone = nav.standalone === true || env.matchMedia?.('(display-mode: standalone)')?.matches === true;
  return ios && standalone;
}

export function createSpeech(env = globalThis) {
  const Recognition = () => env.SpeechRecognition ?? env.webkitSpeechRecognition ?? null;
  let active = null; // { rec, canceled }

  return {
    /** O navegador sabe ouvir E isso funciona neste modo. */
    get usable() { return Boolean(Recognition()) && !isIosHomeScreenApp(env); },
    get listening() { return active !== null; },

    /**
     * Começa a ouvir. `onInterim(texto)` vem enquanto a pessoa fala; `onFinal(texto)` uma vez, quando ela termina;
     * `onError(codigo)` se algo falhar; `onEnd()` sempre, no fim. Devolve false se não conseguiu começar.
     */
    start({ lang = 'pt-BR', onInterim = () => {}, onFinal = () => {}, onError = () => {}, onEnd = () => {} } = {}) {
      const Ctor = Recognition();
      if (!Ctor || active) return false;
      const rec = new Ctor();
      rec.lang = lang;
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      const session = { rec, canceled: false };
      let text = ''; // tudo o que foi ouvido (o que já está firme e o que ainda pode mudar)
      let failed = false;
      rec.onresult = (event) => {
        let heard = '';
        for (let i = 0; i < event.results.length; i++) heard += event.results[i][0]?.transcript ?? '';
        text = heard.trim();
        if (!session.canceled) onInterim(text);
      };
      rec.onerror = (event) => {
        failed = true;
        if (!session.canceled) onError(event.error ?? 'unknown');
      };
      rec.onend = () => {
        if (active === session) active = null;
        if (!failed && !session.canceled && text) onFinal(text);
        onEnd();
      };
      try {
        rec.start();
      } catch {
        return false; // já estava ouvindo, ou o navegador recusou
      }
      active = session;
      return true;
    },

    /** Para de ouvir e entrega o que ouviu até agora. */
    stop() { active?.rec.stop(); },
    /** Cancela: nada é entregue. */
    cancel() {
      if (!active) return;
      active.canceled = true;
      active.rec.abort();
    },
  };
}
