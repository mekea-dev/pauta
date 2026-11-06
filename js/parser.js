// "Adicionar rápido": entende frases como
//   "Pagar boleto amanhã 10h !alta #financeiro"  ou  "Academia toda segunda e quarta 19h"
// e separa título, data, hora, prioridade, etiquetas e repetição.
//
// O texto é "dobrado" (minúsculas, sem acento, mesmo comprimento) para casar os padrões,
// e os trechos reconhecidos são recortados do texto ORIGINAL pelos mesmos índices.
import { addDays, addMonths, daysInMonth, isValidDate, parseISO, startOfWeek, toISO, todayISO, weekday } from './dates.js';
import { MAX_REMIND } from './model.js';
import { finalizeRule, firstOccurrence } from './recurrence.js';
import { fold } from './text.js';

const NUM = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };
const NUM_SRC = Object.keys(NUM).join('|');
const WD_INDEX = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };
const WD_NAMES = /domingo|segunda|terca|quarta|quinta|sexta|sabado/g;
const WD_SRC = '(?:domingo|segunda|terca|quarta|quinta|sexta|sabado)s?(?:[- ]feiras?)?';
const MONTH_INDEX = {
  janeiro: 1, jan: 1, fevereiro: 2, fev: 2, marco: 3, mar: 3, abril: 4, abr: 4, maio: 5, mai: 5, junho: 6, jun: 6,
  julho: 7, jul: 7, agosto: 8, ago: 8, setembro: 9, set: 9, outubro: 10, out: 10, novembro: 11, nov: 11, dezembro: 12, dez: 12,
};
const MONTH_SRC = '(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)';
// "segunda via", "segunda parcela"... não são o dia da semana
const ORDINAL_NEXT = /^\s+(?:via|parcela|chamada|opiniao|vez|etapa|fase|serie|temporada|edicao|parte|rodada)\b/;

const START = '(^|\\s)';
const END = '(?=$|[\\s.,;:!?])';
const PREP = '(?:(?:para|pra|ate|em|no|na|ao|do|da|de)\\s+)?';
const TRAILING_CONNECTOR = /(?:^|\s)(?:para|pra|em|no|na|nos|nas|ate|as|às|ao|de|do|da|por|e|com)$/i;

/** Qual `ignore` desliga cada tipo de trecho reconhecido. */
export const IGNORE_KEY = { date: 'date', time: 'time', priority: 'priority', recurrence: 'recurrence', label: 'labels', remind: 'remind' };

/** Procura o primeiro casamento para o qual make() devolve um valor. */
function scan(f, src, make) {
  const re = new RegExp(src, 'gu');
  let m;
  while ((m = re.exec(f))) {
    const value = make(m);
    if (value != null && value !== false) return { m, value };
    if (m[0] === '') re.lastIndex++;
  }
  return null;
}

const nextWeekday = (today, wd) => addDays(today, (wd - weekday(today) + 7) % 7 || 7);

function nextDayOfMonth(today, n) {
  const { y, m, d } = parseISO(today);
  let yy = y;
  let mm = m;
  for (let i = 0; i < 14; i++) {
    if (n <= daysInMonth(yy, mm) && (i > 0 || n >= d)) return toISO(yy, mm, n);
    mm += 1;
    if (mm > 12) { mm = 1; yy += 1; }
  }
  return null;
}

const mk = (y, m, d) => {
  const s = toISO(y, m, d);
  return isValidDate(s) ? s : null;
};

const hhmm = (h, mi = 0) => `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
const okHM = (h, mi = 0) => h >= 0 && h <= 23 && mi >= 0 && mi <= 59;
const num = (w) => (/^\d+$/.test(w) ? +w : NUM[w]);
const unitOf = (w) => (w.startsWith('dia') ? 'day' : w.startsWith('semana') ? 'week' : w.startsWith('mes') ? 'month' : 'year');

/** "15" + "minutos" -> 15; "1" + "hora" -> 60; "meia" + "hora" -> 30; "2" + "dias" -> 2880. Devolve null se não faz sentido. */
function remindMinutes(amount, unit) {
  const half = amount === 'meia' || amount === 'meio';
  const n = half ? 0.5 : num(amount);
  if (!n) return null;
  const perUnit = /^min/.test(unit) ? 1 : /^dia/.test(unit) ? 1440 : 60;
  const minutes = Math.round(n * perUnit);
  if (half && perUnit === 1) return null; // "meio minuto" não é lembrete
  return minutes >= 1 && minutes <= MAX_REMIND ? minutes : null;
}

/**
 * @param {string} input texto digitado
 * @param {{today?: string, weekStart?: number, ignore?: object}} opts
 * @returns {{title:string, date:string|null, time:string|null, priority:number|null, labels:string[], recurrence:object|null, tokens:object[]}}
 */
export function parseQuickAdd(input, { today = todayISO(), weekStart = 1, ignore = {} } = {}) {
  const text = String(input ?? '').normalize('NFC');
  let f = fold(text);
  const cuts = [];
  const tokens = [];
  const res = { title: '', date: null, time: null, priority: null, labels: [], recurrence: null, remind: null, tokens };

  // Recorta o trecho casado (sem o espaço inicial) e devolve o texto original dele.
  const cut = (m) => {
    const start = m.index + m[1].length;
    const end = m.index + m[0].length;
    cuts.push([start, end]);
    f = f.slice(0, start) + ' '.repeat(end - start) + f.slice(end);
    return text.slice(start, end).trim();
  };
  const startOf = (m) => m.index + m[1].length;

  // ---- etiquetas: #trabalho (precisa ter ao menos uma letra: "#4521" é número de chamado) ----
  if (!ignore.labels) {
    const seen = new Set();
    const re = new RegExp(`${START}#(?=[\\p{N}_-]*\\p{L})([\\p{L}\\p{N}_-]+)`, 'gu');
    for (const m of [...f.matchAll(re)]) {
      const name = text.slice(startOf(m) + 1, m.index + m[0].length);
      cut(m);
      const key = fold(name);
      if (!seen.has(key)) {
        seen.add(key);
        res.labels.push(name);
        tokens.push({ type: 'label', text: `#${name}`, value: name });
      }
    }
  }

  // ---- prioridade: !urgente !alta !media !baixa (ou !u !a !m !b) ----
  if (!ignore.priority) {
    const map = { urgente: 4, u: 4, alta: 3, a: 3, media: 2, m: 2, baixa: 1, b: 1 };
    const hit = scan(f, `${START}!(urgente|alta|media|baixa|u|a|m|b)${END}`, (m) => map[m[2]]);
    if (hit) {
      res.priority = hit.value;
      tokens.push({ type: 'priority', text: cut(hit.m), value: hit.value });
    }
  }

  // ---- repetição: "todo dia", "toda segunda e quarta", "a cada 2 semanas", "dias úteis"... ----
  let rule = null;
  if (!ignore.recurrence) {
    const table = [
      [`${START}(?:a cada|cada)\\s+(\\d{1,3}|${NUM_SRC})\\s+(dias?|semanas?|meses|mes|anos?)${END}`,
        (m) => ({ freq: unitOf(m[3]), interval: num(m[2]) })],
      [`${START}(?:todos os |todo |toda )?(?:dias uteis|dia util|de segunda a sexta|de seg a sex)${END}`,
        () => ({ freq: 'week', interval: 1, days: [1, 2, 3, 4, 5] })],
      [`${START}(?:todo|todos os) (?:fim|fins) de semana${END}`,
        () => ({ freq: 'week', interval: 1, days: [0, 6] })],
      [`${START}(?:todas as|todos os|toda|todo)\\s+(${WD_SRC}(?:\\s*(?:,|e)\\s*${WD_SRC})*)${END}`,
        (m) => ({ freq: 'week', interval: 1, days: [...m[2].matchAll(WD_NAMES)].map((x) => WD_INDEX[x[0]]) })],
      [`${START}todo dia (\\d{1,2})${END}`,
        (m) => (+m[2] >= 1 && +m[2] <= 31 ? { freq: 'month', interval: 1, monthDay: +m[2] } : null)],
      [`${START}(?:todo dia|todos os dias|diariamente)${END}`, () => ({ freq: 'day', interval: 1 })],
      [`${START}(?:toda semana|todas as semanas|semanalmente)${END}`, () => ({ freq: 'week', interval: 1 })],
      [`${START}(?:todo mes|todos os meses|mensalmente)${END}`, () => ({ freq: 'month', interval: 1 })],
      [`${START}(?:todo ano|todos os anos|anualmente)${END}`, () => ({ freq: 'year', interval: 1 })],
    ];
    for (const [src, make] of table) {
      const hit = scan(f, src, make);
      if (hit) {
        rule = hit.value;
        tokens.push({ type: 'recurrence', text: cut(hit.m) });
        break;
      }
    }
  }

  // ---- lembrete ("despertador"): "me avise 15 minutos antes", "lembrete 1 hora antes", "avisar na hora" ----
  // Precisa de uma palavra de aviso (avise, lembrete, alarme...): "Chegar 10 minutos antes" continua sendo só título.
  if (!ignore.remind) {
    const kw = '(?:(?:me )?(?:avis[ae]r?|lembr[ae]r?|alert[ae]r?|notific[ae]r?)(?:-me)?|lembrete|alarme|despertador|aviso|alerta)';
    const attempts = [
      [`${START}${kw}(?:\\s+(?:de|com|em|para|por))?\\s+(\\d{1,4}|${NUM_SRC}|meia|meio)\\s*(minutos?|mins?|horas?|hrs?|hs?|dias?)\\s+(?:de\\s+)?(?:antes|antecedencia)${END}`,
        (m) => remindMinutes(m[2], m[3])],
      [`${START}${kw}\\s+(?:na hora|no horario|no momento|pontualmente)${END}`, () => 0],
    ];
    for (const [src, make] of attempts) {
      const hit = scan(f, src, make);
      if (hit) {
        res.remind = hit.value;
        tokens.push({ type: 'remind', text: cut(hit.m), value: hit.value });
        break;
      }
    }
  }

  // ---- hora: "14h", "14:30", "às 9", "3 da tarde", "meio-dia" ----
  if (!ignore.time) {
    const prevWord = (m) => f.slice(0, startOf(m)).trimEnd().split(/\s+/).pop();
    const attempts = [
      // "8 da manhã", "3h da tarde", "9:30 da noite"
      [`${START}(?:(?:ate as|ate|por volta das|pelas|as)\\s+)?(\\d{1,2})(?:(?::|h)([0-5]\\d)?)?\\s*(?:da|de|pela)\\s+(manha|tarde|noite|madrugada)${END}`, (m) => {
        let h = +m[2];
        const mi = m[3] != null ? +m[3] : 0;
        if (h > 12) return null;
        if (m[4] === 'tarde' || m[4] === 'noite') h = h < 12 ? h + 12 : m[4] === 'noite' && h === 12 ? 0 : h;
        else if (m[4] === 'madrugada' && h === 12) h = 0;
        return okHM(h, mi) ? hhmm(h, mi) : null;
      }],
      // 9am, 3pm
      [`${START}(\\d{1,2})(?::([0-5]\\d))?\\s?(am|pm)${END}`, (m) => {
        let h = +m[2];
        if (h < 1 || h > 12) return null;
        if (m[4] === 'pm' && h < 12) h += 12;
        if (m[4] === 'am' && h === 12) h = 0;
        return hhmm(h, m[3] != null ? +m[3] : 0);
      }],
      // com preposição: "às 14", "até as 18h", "por volta das 9:30", "às 14 horas"
      [`${START}(ate as|ate|por volta das|pelas|as)\\s+(\\d{1,2})(?:(?::|h)([0-5]\\d))?\\s*(h|hs|hrs|horas?)?${END}`, (m) => {
        const h = +m[3];
        const mi = m[4] != null ? +m[4] : 0;
        const bare = m[4] == null && !m[5];
        if (bare && m[2] === 'ate') return null; // "até 15" costuma ser dia 15
        if (bare && m[2] === 'as' && !/^[àÀ]/.test(text.slice(startOf(m)))) return null; // "as 9 propostas"
        return okHM(h, mi) ? hhmm(h, mi) : null;
      }],
      [`${START}meio[- ]dia${END}`, () => '12:00'],
      [`${START}meia[- ]noite${END}`, () => '00:00'],
      // "14:30", "14h30", "14h" (sem preposição). "2h" sozinho é duração ("estudar 2h"), não horário.
      [`${START}(\\d{1,2})(?::([0-5]\\d)|h([0-5]\\d)?)${END}`, (m) => {
        const h = +m[2];
        const mi = m[3] ?? m[4];
        const prev = prevWord(m);
        if (prev === 'por' || prev === 'durante') return null;
        if (mi == null && h < 5) return null;
        return okHM(h, mi == null ? 0 : +mi) ? hhmm(h, mi == null ? 0 : +mi) : null;
      }],
    ];
    for (const [src, make] of attempts) {
      const hit = scan(f, src, make);
      if (hit) {
        res.time = hit.value;
        tokens.push({ type: 'time', text: cut(hit.m), value: hit.value });
        break;
      }
    }
  }

  // ---- data ----
  if (!ignore.date) {
    const t = parseISO(today);
    const dm = (d, mo, y) => {
      if (y == null) {
        let s = mk(t.y, mo, d);
        if (s && s < today) s = mk(t.y + 1, mo, d); // já passou este ano: vale o próximo
        return s;
      }
      return mk(y < 100 ? 2000 + y : y, mo, d);
    };
    const offset = (n, unit) => (unit.startsWith('dia') ? addDays(today, n) : unit.startsWith('semana') ? addDays(today, 7 * n) : unit.startsWith('mes') ? addMonths(today, n) : addMonths(today, 12 * n));
    const rel = { 'depois de amanha': 2, amanha: 1, hoje: 0, ontem: -1 };
    const attempts = [
      [`${START}(\\d{4})-(\\d{2})-(\\d{2})${END}`, (m) => mk(+m[2], +m[3], +m[4])],
      [`${START}${PREP}(?:o\\s+)?(?:dia\\s+)?(\\d{1,2})/(\\d{1,2})(?:/(\\d{4}|\\d{2}))?${END}`, (m) => dm(+m[2], +m[3], m[4] ? +m[4] : null)],
      [`${START}${PREP}(?:o\\s+)?(?:dia\\s+)?(\\d{1,2})\\s+de\\s+${MONTH_SRC}(?:\\s+(?:de\\s+)?(\\d{4}))?${END}`, (m) => dm(+m[2], MONTH_INDEX[m[3]], m[4] ? +m[4] : null)],
      [`${START}${PREP}(depois de amanha|amanha|hoje|ontem)${END}`, (m) => addDays(today, rel[m[2]])],
      [`${START}${PREP}(?:semana que vem|proxima semana)${END}`, () => startOfWeek(addDays(today, 7), weekStart)],
      [`${START}${PREP}(?:mes que vem|proximo mes)${END}`, () => addMonths(toISO(t.y, t.m, 1), 1)],
      [`${START}${PREP}(?:fim|final) (?:do|de) mes${END}`, () => toISO(t.y, t.m, daysInMonth(t.y, t.m))],
      [`${START}(?:em|daqui a|daqui)\\s+(\\d{1,3}|${NUM_SRC})\\s+(dias?|semanas?|meses|mes|anos?)${END}`, (m) => offset(num(m[2]), m[3])],
      [`${START}(?:(?:na proxima|no proximo|nesta|neste|proxima|proximo|esta|este|para|pra|ate|em|no|na|ao|do|da|de)\\s+)?(${WD_SRC})(?:\\s+que\\s+vem)?${END}`, (m) => {
        const name = m[2].match(WD_NAMES)[0];
        const ordinalWord = !m[2].includes('feira') && ['segunda', 'terca', 'quarta', 'quinta', 'sexta'].includes(name);
        if (ordinalWord && ORDINAL_NEXT.test(f.slice(m.index + m[0].length))) return null;
        return nextWeekday(today, WD_INDEX[name]);
      }],
      [`${START}${PREP}(?:o\\s+)?dia\\s+(\\d{1,2})${END}`, (m) => (+m[2] >= 1 && +m[2] <= 31 ? nextDayOfMonth(today, +m[2]) : null)],
    ];
    for (const [src, make] of attempts) {
      const hit = scan(f, src, make);
      if (hit) {
        res.date = hit.value;
        tokens.push({ type: 'date', text: cut(hit.m), value: hit.value });
        break;
      }
    }
  }

  // ---- fecha a repetição (e deduz a data inicial, se não foi dita) ----
  if (rule) {
    res.recurrence = finalizeRule(rule, res.date ?? today);
    if (!res.date) {
      res.date = firstOccurrence(res.recurrence, today);
      tokens.push({ type: 'date', text: '', value: res.date, derived: true });
    }
  }

  // ---- título = o que sobrou ----
  cuts.sort((a, b) => a[0] - b[0]);
  let title = '';
  let pos = 0;
  for (const [s, e] of cuts) {
    title += `${text.slice(pos, s)} `;
    pos = e;
  }
  title += text.slice(pos);
  title = title.replace(/\s+/g, ' ').trim();
  if (cuts.length) {
    // "Reunião em #casa" -> "Reunião em" -> "Reunião"
    for (let i = 0; i < 3 && TRAILING_CONNECTOR.test(title); i++) title = title.replace(TRAILING_CONNECTOR, '').trim();
    title = title.replace(/^[\s,;:.\-–—]+|[\s,;:\-–—]+$/g, '');
  }
  res.title = title;
  return res;
}
