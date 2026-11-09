// Entender a fala com IA (LIGADA por padrão; cada aparelho pode desligar nas Configurações).
//
// O que sai do aparelho quando está ligada: a FRASE FALADA (só o texto), a data de hoje, a hora de agora e o token do seu login (para o
// serviço saber que é você). O serviço do Pauta na Cloudflare (worker/lembretes.js, rota /interpretar) pede a uma IA que reescreva a frase
// como uma linha de "adicionar tarefa" ("Pagar o boleto dia 10 às 16:00 me avise 30 minutos antes") e devolve essa linha; ele não guarda
// nem registra a frase. Desligada (ou sem internet, sem login, sem o recurso no serviço, ou com o limite do dia esgotado), tudo
// continua funcionando com as regras do aparelho (js/voice.js): a IA só melhora, nunca é necessária.
//
// A IA é tratada como fonte NÃO confiável e só pode usar o que a pessoa DISSE: a linha que ela devolve passa pelo mesmo analisador das
// frases digitadas (parser.js) e por `reconcile`, que tira o que a IA inventou (dia, hora, prioridade... sem nenhum sinal na fala,
// ou palavras do título que a pessoa não falou) e devolve o que a fala tinha e a IA deixou cair.
import { parseQuickAdd } from './parser.js';
import { fold } from './text.js';
import { normalizeSpoken } from './voice.js';

export const AI_PREF = 'pauta:ia'; // 'on' | 'off', por aparelho (sem escolha feita = ligada)
export const AI_NOTICE = 'pauta:ia-aviso'; // '1' depois que o aviso do primeiro uso foi mostrado neste aparelho
const TIMEOUT_MS = 10000; // tempo TOTAL para a IA responder (conferir o login e fazer o pedido); depois disso o app segue com as regras
const ACOES = ['criar', 'concluir', 'alterar', 'excluir']; // o que a pessoa pode pedir (o serviço só devolve "criar" a apps antigos)

const REASONS = {
  off: 'A IA está desligada neste aparelho.',
  config: 'O serviço da IA não está configurado neste app.',
  login: 'Entre na sua conta para usar a IA.',
  offline: 'Sem internet para falar com a IA.',
  limit: 'Você usou a IA demais por agora. Tente mais tarde.',
  unavailable: 'A IA está indisponível agora (talvez tenha acabado o limite grátis do dia).',
  timeout: 'A IA demorou demais para responder.',
  skipped: 'Você pulou a IA.',
  error: 'A IA respondeu de um jeito que não deu para usar.',
};

/** O motivo de a IA não ter servido, em palavras simples. */
export const describeAiFailure = (reason) => REASONS[reason] ?? REASONS.error;

const pad2 = (n) => String(n).padStart(2, '0');

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

/** Espera a promessa, mas desiste (rejeitando) se o sinal for acionado antes. */
function until(promise, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * @param {object} options
 * @param {string} options.workerUrl   endereço do serviço (o mesmo dos lembretes: js/push-config.js)
 * @param {() => Promise<string>} options.getToken  token do login do Firebase, renovado se preciso
 * @param {() => boolean} [options.isLoggedIn]
 * @param {{get: () => string|null, set: (v: string) => void}} [options.prefs]  a escolha da pessoa ('on' | 'off'; vazio = ligada)
 * @param {{get: () => boolean, set: () => void}} [options.notice]  se o aviso do primeiro uso já foi mostrado
 */
export function createAi({ workerUrl, getToken, isLoggedIn = () => true, prefs, notice, env = globalThis, fetchImpl, timeoutMs = TIMEOUT_MS } = {}) {
  const base = String(workerUrl ?? '').trim().replace(/\/+$/, '');
  const doFetch = fetchImpl ?? ((...args) => env.fetch(...args));
  const configured = () => /^https:\/\/[^/]+/.test(base);
  let choice = null; // a escolha feita nesta sessão (vale mesmo que o aparelho não deixe guardar)
  let shown = false; // o aviso do primeiro uso já saiu nesta sessão (idem)
  const ownChoice = () => {
    const v = choice ?? prefs?.get();
    return v === 'on' || v === 'off' ? v : null;
  };
  const isOn = () => ownChoice() !== 'off'; // ligada, a não ser que a pessoa tenha desligado
  const online = () => env.navigator?.onLine !== false;

  /**
   * Pede à IA que reescreva a frase. Nunca lança erro e nunca demora mais que `timeoutMs` (contando o login).
   * `signal`: se a pessoa pular a IA, o pedido é abandonado na hora (motivo "skipped").
   * @returns {Promise<{ok: true, texto: string, duvidas: string[]} | {ok: false, reason: string}>}
   */
  async function rewrite(heard, { today, now = new Date(), signal } = {}) {
    if (!isOn()) return { ok: false, reason: 'off' };
    if (!configured()) return { ok: false, reason: 'config' };
    if (!isLoggedIn()) return { ok: false, reason: 'login' };
    if (!online()) return { ok: false, reason: 'offline' };
    if (signal?.aborted) return { ok: false, reason: 'skipped' };
    const controller = new AbortController();
    const skip = () => controller.abort();
    signal?.addEventListener?.('abort', skip, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs); // (sem unref: no Node dos testes, este relógio é o que mantém o teste de "demora" vivo)
    const gaveUp = () => ({ ok: false, reason: timedOut ? 'timeout' : 'skipped' });
    try {
      let token;
      try {
        token = await until(getToken(), controller.signal); // renovar o login também é rede: também tem prazo
      } catch (e) {
        if (controller.signal.aborted) return gaveUp();
        return { ok: false, reason: e?.code === 'network' ? 'offline' : 'login' };
      }
      const res = await doFetch(`${base}/interpretar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        // `comandos`: este app sabe concluir, alterar e excluir tarefas que já existem (não é dado nenhum: só avisa o serviço)
        body: JSON.stringify({ fala: String(heard).slice(0, 400), hoje: today, agora: `${pad2(now.getHours())}:${pad2(now.getMinutes())}`, comandos: true }),
        signal: controller.signal,
      });
      if (res.status === 401) return { ok: false, reason: 'login' };
      if (res.status === 429) return { ok: false, reason: 'limit' };
      if (res.status === 503) return { ok: false, reason: 'unavailable' };
      if (!res.ok) return { ok: false, reason: 'error' };
      const data = await res.json().catch(() => null);
      if (controller.signal.aborted) return gaveUp();
      if (!data || typeof data.texto !== 'string' || !Array.isArray(data.duvidas)) return { ok: false, reason: 'error' };
      return {
        ok: true,
        acao: ACOES.includes(data.acao) ? data.acao : 'criar', // serviço antigo (sem o campo): é sempre "criar"
        texto: data.texto,
        descricao: typeof data.descricao === 'string' ? data.descricao : '',
        alvo: typeof data.alvo === 'string' ? data.alvo : '',
        duvidas: data.duvidas.filter((d) => typeof d === 'string' && d.trim()).slice(0, 3),
      };
    } catch (e) {
      if (controller.signal.aborted || e?.name === 'AbortError') return gaveUp();
      return { ok: false, reason: 'offline' };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', skip);
    }
  }

  return {
    get on() { return isOn(); },
    /** Liga ou desliga neste aparelho. */
    setOn(on) {
      choice = on ? 'on' : 'off';
      try { prefs?.set(choice); } catch { /* o aparelho não deixou guardar: a escolha vale até fechar o app */ }
    },
    /** O que impede (ou não) de usar a IA agora. */
    status() { return { on: isOn(), configured: configured(), loggedIn: isLoggedIn(), online: online() }; },
    /** Ligada e com tudo o que precisa (serviço, login, internet). */
    available() { return isOn() && configured() && isLoggedIn() && online(); },
    /** A IA está ligada só porque é o padrão (a pessoa nunca escolheu) e o aviso do primeiro uso ainda não foi mostrado. */
    needsNotice() { return isOn() && ownChoice() === null && !shown && !notice?.get(); },
    /** O aviso do primeiro uso foi mostrado. */
    noticed() {
      shown = true;
      try { notice?.set(); } catch { /* idem: o aviso sai uma vez por sessão */ }
    },
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

const WEEKDAY_WORD = /^(?:proxim[oa]\s+)?(segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/; // (texto de um item de data, sem acento)

// ---------- o que fazer com a resposta ----------
/**
 * Confere a resposta da IA contra o que a pessoa falou e diz o que o app deve fazer:
 *  - `criar`: `line` (a linha da tarefa, já conferida por `reconcile`) e `notes` (a descrição, só se for feita das palavras ditas);
 *  - `concluir`, `alterar`, `excluir`: `alvo` (como a pessoa chamou a tarefa, só vale se for feito das palavras ditas) e, em
 *    `alterar`, `line` com o que muda. Sem `alvo` que sirva, `ok: false` (o app não adivinha qual tarefa mexer).
 * @param {{acao?: string, texto: string, descricao?: string, alvo?: string, duvidas?: string[]}} r  o resultado de `rewrite`
 */
export function interpretAiReply(r, heard, local, opts = {}) {
  const doubts = Array.isArray(r.duvidas) ? r.duvidas : [];
  if (!ACOES.includes(r.acao) || r.acao === 'criar') {
    const descricao = String(r.descricao ?? '').trim();
    return { acao: 'criar', ok: true, line: reconcile(r.texto, heard, local, opts), notes: descricao && isLiteral(descricao, heard) ? descricao : '', doubts };
  }
  const alvo = String(r.alvo ?? '').trim();
  if (!alvo || !isLiteral(alvo, heard)) return { acao: r.acao, ok: false, doubts };
  const line = r.acao === 'alterar' ? reconcile(r.texto, heard, local, { ...opts, change: true }) : '';
  return { acao: r.acao, ok: true, alvo, line, doubts };
}

// ---------- o título só pode ter o que a pessoa disse ----------
// Palavras de ligação (artigos, preposições...): a IA pode usá-las à vontade ("pra" -> "para", "pro" -> "para o").
const FUNCTION_WORDS = new Set(['uma', 'uns', 'umas', 'dos', 'das', 'nos', 'nas', 'aos', 'pelo', 'pela', 'pelos', 'pelas', 'para', 'pra', 'pro', 'por', 'com', 'sem',
  'que', 'seu', 'sua', 'seus', 'suas', 'meu', 'minha', 'meus', 'minhas', 'ali', 'aqui', 'mais']);
const NUMBER_ONLY = new RegExp(`^${NUMBER_WORD}$`);
const wordsOf = (text) => fold(String(text ?? '')).split(/[^a-z0-9]+/).filter(Boolean);
// mesma palavra, ou da mesma família (reunião/reuniões, ligar/ligando: os 4 primeiros caracteres)
const sameWord = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4));

/**
 * Todas as palavras de conteúdo do título (`title`) foram ditas na fala (`heard`)? A IA pode TIRAR palavras (hesitações, o pedido) e
 * trocar as de ligação, mas não acrescentar nem trocar por outras ("Marcar consulta no dentista" para "marcar dentista" não vale).
 */
export function isLiteral(title, heard) {
  const spoken = wordsOf(heard);
  const digits = /\d/.test(String(heard ?? ''));
  const numberWords = spoken.some((w) => NUMBER_ONLY.test(w));
  for (const w of wordsOf(title)) {
    if (/^\d+$/.test(w)) { // número no título: "2" vale se a fala tinha número, em algarismos ou por extenso
      if (digits || numberWords) continue;
      return false;
    }
    if (w.length <= 2 || FUNCTION_WORDS.has(w)) continue;
    if (NUMBER_ONLY.test(w) && digits) continue; // "dois" no título, "2" na fala
    if (!spoken.some((s) => sameWord(w, s))) return false;
  }
  return true;
}

/**
 * Junta a linha da IA com o que as regras do aparelho entenderam da fala:
 *  - tira da linha da IA o que ela inventou (dia, hora, prioridade, repetição, lembrete ou etiqueta sem nenhum sinal na fala);
 *  - se o título da IA tem palavras que a pessoa não disse, vale o título das regras (o que foi dito);
 *  - acrescenta o que as regras acharam na fala e a IA deixou cair (ex.: a hora);
 *  - se os dois dizem a mesma coisa de formas diferentes, vale a IA (ela entende frases que as regras não alcançam).
 * @param {string} aiText   a linha devolvida pela IA
 * @param {string} heard    o que a pessoa falou
 * @param {{title?: string, tokens?: object[]}} local   o resultado de interpretSpoken(heard)
 * @param {object} [options]
 * @param {boolean} [options.change]  a linha é o que MUDA numa tarefa que já existe (alterar): título que a pessoa não disse não renomeia
 *   e o que as regras acharam na fala NÃO volta (aquilo é sobre a tarefa antiga, não sobre a mudança)
 * @returns {string} uma linha no formato de "adicionar tarefa", pronta para interpretSpoken
 */
export function reconcile(aiText, heard, local, { today, now, weekStart = 1, change = false } = {}) {
  const f = fold(String(heard ?? ''));
  let line = normalizeSpoken(aiText, { now });
  const read = () => parseQuickAdd(line, { today, weekStart });

  for (const tk of read().tokens) {
    const evidence = EVIDENCE[tk.type];
    if (!evidence || tk.derived || !tk.text) continue;
    // o sinal é largo de propósito; só um dia da semana tem que ser o MESMO que a pessoa disse ("terça" não vale por "sexta")
    const weekdayWord = tk.type === 'date' ? WEEKDAY_WORD.exec(fold(tk.text)) : null;
    if (evidence.test(f) && !(weekdayWord && !f.includes(weekdayWord[1]))) continue;
    line = line.replace(tk.text, ' '); // a IA inventou: sai
  }
  line = line.replace(/\s+/g, ' ').trim();

  let after = read();
  if (after.title && !isLiteral(after.title, f)) { // palavras que a pessoa não disse: vale o título que as regras tiraram da fala
    const kept = after.tokens.filter((t) => !t.derived && t.text).map((t) => t.text);
    // (alterar: sem título das regras, que seria a frase inteira: simplesmente não renomeia)
    line = [change ? '' : String(local?.title ?? '').trim(), ...kept].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    after = read();
  }
  if (change) return line;

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
