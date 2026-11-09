// Entender a fala com IA (OPCIONAL, desligado por padrão, escolha de cada aparelho nas Configurações).
//
// O que sai do aparelho quando está ligado: a FRASE FALADA (só o texto), a data de hoje, a hora de agora e o token do seu login (para o
// serviço saber que é você). O serviço do Pauta na Cloudflare (worker/lembretes.js, rota /interpretar) pede a uma IA que reescreva a frase
// como uma linha de "adicionar tarefa" ("Pagar o boleto dia 10 às 16:00 me avise 30 minutos antes") e devolve essa linha; ele não guarda
// nem registra a frase. Desligado (ou sem internet, sem login, sem o recurso no serviço, ou com o limite do dia esgotado), tudo
// continua funcionando com as regras do aparelho (js/voice.js): a IA só melhora, nunca é necessária.
//
// A IA é tratada como fonte NÃO confiável: a linha que ela devolve passa pelo mesmo analisador das frases digitadas (parser.js) e por
// `reconcile`, que tira o que a IA inventou (dia, hora, prioridade... sem nenhum sinal na fala) e devolve o que a fala tinha e a IA deixou cair.
import { parseQuickAdd } from './parser.js';
import { fold } from './text.js';
import { normalizeSpoken } from './voice.js';

export const AI_PREF = 'pauta:ia'; // 'on' | 'off', por aparelho
const TIMEOUT_MS = 9000;

const REASONS = {
  off: 'A IA está desligada neste aparelho.',
  config: 'O serviço da IA não está configurado neste app.',
  login: 'Entre na sua conta para usar a IA.',
  offline: 'Sem internet para falar com a IA.',
  limit: 'Você usou a IA demais por agora. Tente mais tarde.',
  unavailable: 'A IA está indisponível agora (talvez tenha acabado o limite grátis do dia).',
  timeout: 'A IA demorou demais para responder.',
  error: 'A IA respondeu de um jeito que não deu para usar.',
};

/** O motivo de a IA não ter servido, em palavras simples. */
export const describeAiFailure = (reason) => REASONS[reason] ?? REASONS.error;

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * @param {object} options
 * @param {string} options.workerUrl   endereço do serviço (o mesmo dos lembretes: js/push-config.js)
 * @param {() => Promise<string>} options.getToken  token do login do Firebase, renovado se preciso
 * @param {() => boolean} [options.isLoggedIn]
 * @param {{get: () => string|null, set: (v: string) => void}} [options.prefs]  a escolha da pessoa ('on' | 'off')
 */
export function createAi({ workerUrl, getToken, isLoggedIn = () => true, prefs, env = globalThis, fetchImpl, timeoutMs = TIMEOUT_MS } = {}) {
  const base = String(workerUrl ?? '').trim().replace(/\/+$/, '');
  const doFetch = fetchImpl ?? ((...args) => env.fetch(...args));
  const configured = () => /^https:\/\/[^/]+/.test(base);
  const isOn = () => prefs?.get() === 'on';
  const online = () => env.navigator?.onLine !== false;

  /**
   * Pede à IA que reescreva a frase. Nunca lança erro.
   * @returns {Promise<{ok: true, texto: string, duvidas: string[]} | {ok: false, reason: string}>}
   */
  async function rewrite(heard, { today, now = new Date() } = {}) {
    if (!isOn()) return { ok: false, reason: 'off' };
    if (!configured()) return { ok: false, reason: 'config' };
    if (!isLoggedIn()) return { ok: false, reason: 'login' };
    if (!online()) return { ok: false, reason: 'offline' };
    let token;
    try {
      token = await getToken();
    } catch (e) {
      return { ok: false, reason: e?.code === 'network' ? 'offline' : 'login' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer?.unref?.();
    try {
      const res = await doFetch(`${base}/interpretar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ fala: String(heard).slice(0, 400), hoje: today, agora: `${pad2(now.getHours())}:${pad2(now.getMinutes())}` }),
        signal: controller.signal,
      });
      if (res.status === 401) return { ok: false, reason: 'login' };
      if (res.status === 429) return { ok: false, reason: 'limit' };
      if (res.status === 503) return { ok: false, reason: 'unavailable' };
      if (!res.ok) return { ok: false, reason: 'error' };
      const data = await res.json().catch(() => null);
      if (!data || typeof data.texto !== 'string' || !Array.isArray(data.duvidas)) return { ok: false, reason: 'error' };
      return { ok: true, texto: data.texto, duvidas: data.duvidas.filter((d) => typeof d === 'string' && d.trim()).slice(0, 3) };
    } catch (e) {
      return { ok: false, reason: e?.name === 'AbortError' ? 'timeout' : 'offline' };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    get on() { return isOn(); },
    /** Liga ou desliga neste aparelho. */
    setOn(on) { prefs?.set(on ? 'on' : 'off'); },
    /** O que impede (ou não) de usar a IA agora. */
    status() { return { on: isOn(), configured: configured(), loggedIn: isLoggedIn(), online: online() }; },
    /** Ligada e com tudo o que precisa (serviço, login, internet). */
    available() { return isOn() && configured() && isLoggedIn() && online(); },
    rewrite,
  };
}

// ---------- juntar a resposta da IA com o que a fala dizia ----------
// Sinais, na fala, de que a pessoa mesmo disse cada coisa. Largos de propósito: só barram o que a IA INVENTOU do nada.
const NUMBER_WORD = '(?:dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|meia|meio)';
const EVIDENCE = {
  date: new RegExp(`\\d|\\b(?:hoje|amanha|ontem|depois|segunda|terca|quarta|quinta|sexta|sabado|domingo|semana|mes|meses|ano|anos|dia|dias|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|proxim[oa]|fim|final|tod[oa]s?|cada|diariamente|semanalmente|mensalmente|sempre|daqui|dentro|primeiro|${NUMBER_WORD})\\b`),
  time: new RegExp(`\\d|\\b(?:hora|horas|meio|meia|manha|tarde|noite|madrugada|cedo|daqui|dentro|minutos?|${NUMBER_WORD})\\b`),
  priority: /urgen|priorid|importan|\b(?:alta|baixa|media|critic[oa]|grave|emergencia)\b|!/,
  recurrence: /\btod[oa]s?\b|\bcada\b|diari|semanal|mensal|anual|sempre|uteis|\butil\b|fim de semana/,
  remind: /avis|lembr|alarm|despert|antes|notific|alert/,
  label: /etiqueta|#|categoria|marcador|\btag\b/,
};

/**
 * Junta a linha da IA com o que as regras do aparelho entenderam da fala:
 *  - tira da linha da IA o que ela inventou (dia, hora, prioridade, repetição, lembrete ou etiqueta sem nenhum sinal na fala);
 *  - acrescenta o que as regras acharam na fala e a IA deixou cair (ex.: a hora);
 *  - se os dois dizem a mesma coisa de formas diferentes, vale a IA (ela entende frases que as regras não alcançam).
 * @param {string} aiText   a linha devolvida pela IA
 * @param {string} heard    o que a pessoa falou
 * @param {{tokens?: object[]}} local   o resultado de interpretSpoken(heard)
 * @returns {string} uma linha no formato de "adicionar tarefa", pronta para interpretSpoken
 */
export function reconcile(aiText, heard, local, { today, now, weekStart = 1 } = {}) {
  const f = fold(String(heard ?? ''));
  let line = normalizeSpoken(aiText, { now });
  const read = () => parseQuickAdd(line, { today, weekStart });

  for (const tk of read().tokens) {
    const evidence = EVIDENCE[tk.type];
    if (!evidence || tk.derived || !tk.text || evidence.test(f)) continue;
    line = line.replace(tk.text, ' '); // a IA inventou: sai
  }
  line = line.replace(/\s+/g, ' ').trim();

  const after = read();
  const has = new Set(after.tokens.filter((t) => !t.derived).map((t) => t.type));
  const labels = new Set(after.labels.map(fold));
  const extra = [];
  for (const tk of local?.tokens ?? []) {
    if (tk.derived || !tk.text) continue;
    if (tk.type === 'label') {
      if (!labels.has(fold(String(tk.value)))) extra.push(tk.text);
    } else if (!has.has(tk.type)) {
      extra.push(tk.text); // a fala tinha e a IA deixou cair: volta
      has.add(tk.type);
    }
  }
  return [line, ...extra].join(' ').trim();
}
