// O som e a vibração do alarme. Não há arquivo de áudio: o toque (quatro bipes curtos e uma pausa) é montado aqui, em amostras, e o
// Web Audio o repete sem parar até chamar stop(). Os navegadores só liberam som depois de um toque da pessoa na tela (principalmente
// o iPhone): por isso prepare() fica de olho no primeiro toque em qualquer lugar do app e start() conta se o som saiu (`blocked`).
// No iPhone o som do navegador some com o aparelho no silencioso; pedimos a categoria "playback" (iOS 16.4 ou mais novo), que toca
// mesmo assim. Isso, o toque na tela bloqueada e a vibração (só Android) dependem do aparelho: veja docs/LEMBRETES.md.
import { ALARM_VIBRATION } from './alarm.js';

const BEEP_HZ = 1175; // um ré agudo, que se ouve de longe
const BEEPS = 4;
const BEEP_S = 0.14;
const GAP_S = 0.11;
const CYCLE_S = 2; // quatro bipes (1 s) e uma pausa, e recomeça
const FADE_S = 0.008; // sobe e desce rápido para o bipe não "estalar"
const VIBRATION_EVERY_MS = 3000;
const RESUME_WAIT_MS = 500; // o navegador pode deixar o resume() pendurado até a pessoa tocar na tela

/** Uma volta do toque, em amostras entre -1 e 1 (quatro bipes e uma pausa). Função pura: serve também para os testes. */
export function beepSamples(sampleRate) {
  const out = new Float32Array(Math.round(CYCLE_S * sampleRate));
  const len = Math.round(BEEP_S * sampleRate);
  const fade = Math.max(1, Math.round(FADE_S * sampleRate));
  for (let k = 0; k < BEEPS; k++) {
    const start = Math.round(k * (BEEP_S + GAP_S) * sampleRate);
    for (let i = 0; i < len && start + i < out.length; i++) {
      const envelope = Math.min(1, i / fade, (len - i) / fade);
      const t = i / sampleRate;
      out[start + i] = envelope * 0.8 * (0.8 * Math.sin(2 * Math.PI * BEEP_HZ * t) + 0.2 * Math.sin(2 * Math.PI * BEEP_HZ * 2 * t));
    }
  }
  return out;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {{ env?: object }} [options]  `env`: window (ou um de mentira nos testes)
 * @returns {{ prepare(): void, start(): Promise<{sound: boolean}>, stop(): void, readonly playing: boolean, readonly blocked: boolean, onChange(fn: Function): Function }}
 */
export function createAlarmSound({ env = globalThis, resumeWaitMs = RESUME_WAIT_MS, wantsUnlock = () => true } = {}) {
  let ctx = null;
  let source = null;
  let playing = false; // pediram para tocar
  let prepared = false;
  let vibeTimer = 0;
  let lock = null;
  let starting = null;
  const listeners = new Set();
  const emit = () => { for (const fn of listeners) fn({ playing, blocked: playing && !source }); };

  /** O Web Audio do app (criado uma vez). Quando o navegador o libera sozinho (statechange), o toque começa se estava esperando. */
  function context(Ctx) {
    if (!ctx) {
      ctx = new Ctx();
      ctx.addEventListener?.('statechange', () => { if (playing && !source) begin().then(emit).catch(() => {}); });
    }
    return ctx;
  }

  /** Cria o Web Audio, tenta liberá-lo e liga o toque. Devolve true se o som está saindo. */
  async function begin() {
    if (source) return true;
    const Ctx = env.AudioContext ?? env.webkitAudioContext;
    if (!Ctx) return false;
    try {
      if (env.navigator?.audioSession) env.navigator.audioSession.type = 'playback'; // iPhone: toca mesmo no silencioso
    } catch { /* aparelho sem essa opção */ }
    try {
      context(Ctx);
      if (ctx.state !== 'running') await Promise.race([Promise.resolve(ctx.resume()).catch(() => {}), wait(resumeWaitMs)]);
      if (ctx.state !== 'running' || !playing || source) return Boolean(source);
      const samples = beepSamples(ctx.sampleRate);
      const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      buffer.getChannelData(0).set(samples);
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.loop = true;
      node.connect(ctx.destination);
      node.start(0);
      source = node;
      return true;
    } catch {
      return false;
    }
  }

  function startVibration() {
    const vibrate = env.navigator?.vibrate;
    if (typeof vibrate !== 'function' || vibeTimer) return;
    const once = () => {
      // o Chrome ignora (e reclama no console) a vibração antes de a pessoa ter tocado na página: espera o primeiro toque
      if (env.navigator.userActivation && !env.navigator.userActivation.hasBeenActive) return;
      try { vibrate.call(env.navigator, ALARM_VIBRATION); } catch { /* sem vibração neste aparelho */ }
    };
    once();
    vibeTimer = setInterval(once, VIBRATION_EVERY_MS);
  }

  function stopVibration() {
    clearInterval(vibeTimer);
    vibeTimer = 0;
    try { env.navigator?.vibrate?.(0); } catch { /* idem */ }
  }

  /** Mantém a tela acesa enquanto toca (o sistema solta sozinho ao esconder a página; pedimos de novo ao voltar). */
  async function holdScreen() {
    if (lock || !playing) return;
    try { lock = await env.navigator?.wakeLock?.request?.('screen'); } catch { lock = null; }
  }

  const back = () => {
    if (env.document?.visibilityState === 'visible' && playing) {
      lock = null;
      holdScreen().catch(() => {});
      if (!source) begin().then(emit).catch(() => {});
    }
  };

  /**
   * O primeiro toque na tela libera o som (o navegador só deixa com um gesto da pessoa). Quem não tem nenhum alarme (`wantsUnlock`
   * falso) não ganha um Web Audio ligado à toa.
   */
  const unlock = () => {
    const Ctx = env.AudioContext ?? env.webkitAudioContext;
    if (!Ctx) return;
    if (playing) { begin().then(emit).catch(() => {}); return; }
    if (!wantsUnlock()) return;
    try {
      if (context(Ctx).state !== 'running') Promise.resolve(ctx.resume()).catch(() => {});
    } catch { /* sem Web Audio */ }
  };

  return {
    /** Fica de olho no primeiro toque, para o som já estar liberado quando o alarme tocar. Pode chamar mais de uma vez. */
    prepare() {
      if (prepared || !env.document?.addEventListener) return;
      prepared = true;
      for (const type of ['pointerdown', 'touchend', 'keydown', 'click']) env.document.addEventListener(type, unlock, { capture: true, passive: true });
    },

    /** Começa a tocar e vibrar. `sound: false` = o navegador ainda não liberou o som (a pessoa precisa tocar na tela). */
    async start() {
      if (!playing) {
        playing = true;
        env.document?.addEventListener?.('visibilitychange', back);
        startVibration();
        holdScreen().catch(() => {});
      }
      starting ??= begin().finally(() => { starting = null; });
      const sound = await starting;
      emit();
      return { sound };
    },

    stop() {
      if (!playing) return; // a tela do alarme chama isto a cada conferência, mesmo sem alarme tocando: não faz nada à toa
      playing = false;
      env.document?.removeEventListener?.('visibilitychange', back);
      stopVibration();
      try { lock?.release?.(); } catch { /* já solto */ }
      lock = null;
      if (source) {
        try { source.stop(); } catch { /* já parou */ }
        try { source.disconnect(); } catch { /* idem */ }
        source = null;
      }
      emit();
    },

    get playing() { return playing; },
    /** Pediram para tocar, mas o som ainda não saiu. */
    get blocked() { return playing && !source; },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
