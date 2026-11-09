// Achar, entre as tarefas que já existem, a que a pessoa quis dizer: "a conta de luz", "a reunião de sexta", "o dentista".
// Tudo aqui acontece NO APARELHO: a IA só diz como a pessoa chamou a tarefa (`alvo`); os títulos das tarefas nunca saem do aparelho.
// Compara palavras (sem acento nem maiúsculas, ignorando palavras de ligação; "reunião" e "reuniões" são a mesma palavra).
import { MONTHS, diffDays, weekday } from './dates.js';
import { fold } from './text.js';

// palavras de ligação e palavras que só dizem "uma tarefa" sem dizer qual
const LINK = new Set(['a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das', 'no', 'na', 'nos', 'nas', 'em', 'ao', 'aos', 'para', 'pra', 'pro',
  'por', 'pelo', 'pela', 'com', 'sem', 'e', 'ou', 'que', 'se', 'meu', 'minha', 'seu', 'sua', 'esse', 'essa', 'este', 'esta', 'desse', 'dessa', 'deste', 'desta', 'aquele',
  'aquela', 'tarefa', 'tarefas', 'lembrete', 'compromisso', 'item', 'coisa']);
const WEEKDAYS = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };
const MONTH_NUM = Object.fromEntries(MONTHS.map((m, i) => [fold(m), i + 1]));
// palavras de tempo: ajudam a escolher entre tarefas parecidas, mas a tarefa pode não tê-las no título
const TIMEY = new Set(['hoje', 'amanha', 'ontem', 'mes', 'meses', 'semana', 'ano', 'dia', 'dias', 'proximo', 'proxima', 'passado', 'passada', 'seguinte', 'ultimo', 'ultima',
  'manha', 'tarde', 'noite', ...Object.keys(WEEKDAYS), ...Object.keys(MONTH_NUM)]);

export const MIN_SCORE = 0.45; // abaixo disso a tarefa não é candidata
export const CLEAR_SCORE = 0.7; // a melhor só vale sem perguntar se passar disso...
export const CLEAR_GAP = 0.15; // ...e se ficar bem na frente da segunda

/** As palavras de conteúdo de um texto: sem acento, minúsculas, sem palavras de ligação. */
export const wordsOf = (text) => fold(String(text ?? '')).split(/[^a-z0-9]+/).filter((w) => w && !LINK.has(w));
// mesma palavra, ou da mesma família pelos 4 primeiros caracteres (reunião/reuniões, pagar/pagamento)
const same = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4));

/**
 * Procura as tarefas que a pessoa quis dizer com `target`.
 * @param {object[]} tasks
 * @param {string} target   como a pessoa chamou a tarefa ("conta de luz", "reunião de sexta")
 * @param {object} [options]
 * @param {string} [options.today]    dia de hoje (AAAA-MM-DD), para as dicas "desse mês" e para desempatar pelo dia
 * @param {'open'|'all'} [options.include]  'open': só as não concluídas (concluir); 'all': todas, as abertas primeiro
 * @returns {{task: object, score: number}[]} do melhor para o pior; só as que passam do mínimo
 */
export function findTasks(tasks, target, { today = null, include = 'all' } = {}) {
  const all = wordsOf(target);
  const hard = all.filter((w) => !TIMEY.has(w)); // o que identifica a tarefa
  const soft = all.filter((w) => TIMEY.has(w)); // o que só ajuda a escolher
  if (!hard.length) return [];
  const found = [];
  for (const task of tasks ?? []) {
    if (!task || task.ghost) continue;
    if (include === 'open' && task.done) continue;
    const words = wordsOf(task.title);
    if (!words.length) continue;
    const hits = hard.filter((w) => words.some((t) => same(w, t))).length;
    const coverage = hits / hard.length;
    if (coverage < 0.5) continue;
    const precision = hits / words.length; // título que é só o que a pessoa disse vale mais que título que tem muito mais
    let score = 0.75 * coverage + 0.25 * precision;
    if (soft.length && task.date) {
      const wd = soft.find((w) => w in WEEKDAYS);
      const mo = soft.find((w) => w in MONTH_NUM);
      const monthHint = soft.includes('mes') || soft.includes('meses');
      // a dica foi dita de propósito ("de sexta", "desse mês"): quando só uma das parecidas combina, ela fica bem na frente
      if (soft.some((w) => words.some((t) => same(w, t)))) score += 0.15; // o próprio título diz ("reunião de sexta")
      else if (wd !== undefined && weekday(task.date) === WEEKDAYS[wd]) score += 0.2; // a tarefa cai nesse dia da semana
      else if (mo !== undefined && Number(task.date.slice(5, 7)) === MONTH_NUM[mo]) score += 0.2;
      else if (monthHint && today && task.date.slice(0, 7) === today.slice(0, 7)) score += 0.2; // "desse mês"
      else if (soft.includes('hoje') && today && task.date === today) score += 0.2;
      else if (soft.includes('amanha') && today && diffDays(task.date, today) === 1) score += 0.2;
    }
    if (task.done) score -= 0.2; // as abertas vêm primeiro
    if (score >= MIN_SCORE) found.push({ task, score });
  }
  // empate: a que tem data mais perto de hoje (e as sem data por último), depois a mais recente
  const gap = (t) => (t.date && today ? Math.abs(diffDays(t.date, today)) : 99999);
  found.sort((a, b) => b.score - a.score || gap(a.task) - gap(b.task) || String(b.task.updatedAt ?? '').localeCompare(String(a.task.updatedAt ?? '')));
  return found;
}

// A frase soa como "já fiz"? ("já paguei", "terminei", "concluí", "marca como feito", "está pronto"). Serve de rede de segurança: a IA pode
// errar e chamar de "concluir" algo que a pessoa ainda vai fazer ("preciso pagar a conta de luz"); sem esse sinal, concluir pergunta.
const DONE_CUE = /\b(?:ja|feit[oa]s?|pront[oa]s?|fiz|fez|fizemos|conclu(?:i|iu|ido|ida|idos|idas)|marc(?:a|o|ou|ei)\s+como|marque\s+como)\b|\b[a-z]{3,}(?:ei|ou|amos|emos|imos)\b/;
/** A frase falada diz que a pessoa JÁ fez a tarefa (e não que vai fazer)? */
export const soundsDone = (heard) => DONE_CUE.test(fold(String(heard ?? '')));

/** A melhor candidata é clara (não precisa perguntar)? Devolve a tarefa ou null. */
export function clearWinner(found) {
  if (!found?.length) return null;
  const [best, second] = found;
  if (best.score < CLEAR_SCORE) return null;
  if (second && best.score - second.score < CLEAR_GAP) return null;
  return best.task;
}
