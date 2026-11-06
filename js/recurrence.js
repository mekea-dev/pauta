// Repetição de tarefas. Uma regra é um objeto simples e serializável:
//   { freq: 'day'|'week'|'month'|'year', interval: 1+, days?: [0..6] (semana), monthDay?: 1..31, month?: 1..12 }
import { addDays, addMonths, daysInMonth, parseISO, toISO, weekday, WEEKDAYS, WEEKDAYS_SHORT } from './dates.js';

const FREQS = ['day', 'week', 'month', 'year'];
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // semana de segunda a domingo
const idx = (wd) => ORDER.indexOf(wd);
const clampInt = (v, min, max, dflt) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

/** Valida/limpa uma regra vinda de fora (importação, edição). Retorna null se inválida. */
export function normalizeRule(r) {
  if (!r || typeof r !== 'object' || !FREQS.includes(r.freq)) return null;
  const rule = { freq: r.freq, interval: clampInt(r.interval, 1, 365, 1) };
  if (r.freq === 'week' && Array.isArray(r.days)) {
    const days = [...new Set(r.days.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b);
    if (days.length) rule.days = days;
  }
  if (r.freq === 'month' || r.freq === 'year') {
    const md = Math.trunc(Number(r.monthDay));
    if (md >= 1 && md <= 31) rule.monthDay = md;
  }
  if (r.freq === 'year') {
    const mo = Math.trunc(Number(r.month));
    if (mo >= 1 && mo <= 12) rule.month = mo;
  }
  return rule;
}

/** Completa o que faltar (dia da semana, dia do mês...) a partir da data da tarefa. */
export function finalizeRule(rule, dateISO) {
  const r = normalizeRule(rule);
  if (!r) return null;
  const { m, d } = parseISO(dateISO);
  if (r.freq === 'week' && !r.days) r.days = [weekday(dateISO)];
  if (r.freq === 'month' && !r.monthDay) r.monthDay = d;
  if (r.freq === 'year') {
    if (!r.month) r.month = m;
    if (!r.monthDay) r.monthDay = d;
  }
  return r;
}

/** Primeira data ESTRITAMENTE depois de `from` que obedece à regra. */
export function nextDate(rule, from) {
  const n = rule.interval ?? 1;
  switch (rule.freq) {
    case 'day':
      return addDays(from, n);
    case 'week': {
      const days = rule.days?.length ? rule.days : [weekday(from)];
      const sorted = [...days].sort((a, b) => idx(a) - idx(b));
      const cur = idx(weekday(from));
      const later = sorted.find((wd) => idx(wd) > cur);
      if (later !== undefined) return addDays(from, idx(later) - cur); // ainda nesta semana
      const monday = addDays(from, -cur);
      return addDays(monday, 7 * n + idx(sorted[0]));
    }
    case 'month': {
      const { y, m, d } = parseISO(from);
      const target = rule.monthDay ?? d;
      const thisMonth = Math.min(target, daysInMonth(y, m));
      if (thisMonth > d) return toISO(y, m, thisMonth); // data fora do padrão: ainda dá tempo neste mês
      const first = addMonths(`${from.slice(0, 8)}01`, n);
      const p = parseISO(first);
      return toISO(p.y, p.m, Math.min(target, daysInMonth(p.y, p.m)));
    }
    case 'year': {
      const { y, m, d } = parseISO(from);
      const mo = rule.month ?? m;
      const dd = rule.monthDay ?? d;
      const thisYear = toISO(y, mo, Math.min(dd, daysInMonth(y, mo)));
      if (thisYear > from) return thisYear;
      return toISO(y + n, mo, Math.min(dd, daysInMonth(y + n, mo)));
    }
    default:
      return addDays(from, 1);
  }
}

/**
 * Próxima ocorrência ao concluir uma tarefa: depois da data dela E depois de hoje.
 * (Tarefa atrasada há 5 dias, concluída hoje, não gera 5 cópias atrasadas.)
 */
export function nextAfter(rule, from, today) {
  let d = nextDate(rule, from);
  for (let guard = 0; d <= today && guard < 4000; guard++) d = nextDate(rule, d);
  return d;
}

/** Primeira data igual ou depois de `from` que obedece à regra (ex.: "toda segunda" digitado numa quinta). */
export function firstOccurrence(rule, from) {
  switch (rule.freq) {
    case 'week': {
      if (!rule.days?.length) return from;
      for (let i = 0; i < 7; i++) {
        const d = addDays(from, i);
        if (rule.days.includes(weekday(d))) return d;
      }
      return from;
    }
    case 'month': {
      if (!rule.monthDay) return from;
      const { y, m, d } = parseISO(from);
      const target = Math.min(rule.monthDay, daysInMonth(y, m));
      if (target >= d) return toISO(y, m, target);
      const p = parseISO(addMonths(`${from.slice(0, 8)}01`, 1));
      return toISO(p.y, p.m, Math.min(rule.monthDay, daysInMonth(p.y, p.m)));
    }
    case 'year': {
      if (!rule.month || !rule.monthDay) return from;
      const { y } = parseISO(from);
      const thisYear = toISO(y, rule.month, Math.min(rule.monthDay, daysInMonth(y, rule.month)));
      if (thisYear >= from) return thisYear;
      return toISO(y + 1, rule.month, Math.min(rule.monthDay, daysInMonth(y + 1, rule.month)));
    }
    default:
      return from;
  }
}

/** Ocorrências em (start, to] que caem em [from, to] — usado para mostrar as próximas repetições. */
export function occurrencesBetween(rule, start, from, to, limit = 3000) {
  const out = [];
  let d = start;
  for (let i = 0; i < limit; i++) {
    d = nextDate(rule, d);
    if (d > to) break;
    if (d >= from) out.push(d);
  }
  return out;
}

// ---------- texto e atalhos para a tela ----------

const art = (wd) => (wd === 0 || wd === 6 ? 'Todo' : 'Toda');

export function describe(rule, dateISO) {
  if (!rule) return 'Não repete';
  const n = rule.interval ?? 1;
  switch (rule.freq) {
    case 'day':
      return n === 1 ? 'Todo dia' : `A cada ${n} dias`;
    case 'week': {
      const days = (rule.days?.length ? rule.days : dateISO ? [weekday(dateISO)] : []).slice().sort((a, b) => idx(a) - idx(b));
      const key = days.join(',');
      if (n === 1 && key === '1,2,3,4,5') return 'Dias úteis';
      if (n === 1 && key === '6,0') return 'Fins de semana';
      const names = days.map((d) => WEEKDAYS_SHORT[d]).join(', ');
      if (n === 1) {
        if (days.length === 1) return `${art(days[0])} ${WEEKDAYS[days[0]]}`;
        return days.length ? `Toda semana (${names})` : 'Toda semana';
      }
      return `A cada ${n} semanas${days.length ? ` (${names})` : ''}`;
    }
    case 'month':
      if (n === 1) return rule.monthDay ? `Todo mês, dia ${rule.monthDay}` : 'Todo mês';
      return `A cada ${n} meses`;
    case 'year':
      return n === 1 ? 'Todo ano' : `A cada ${n} anos`;
    default:
      return 'Repete';
  }
}

export const PRESETS = [
  { id: 'none', label: 'Não repete' },
  { id: 'day', label: 'Todo dia', rule: { freq: 'day', interval: 1 } },
  { id: 'weekdays', label: 'Dias úteis (seg a sex)', rule: { freq: 'week', interval: 1, days: [1, 2, 3, 4, 5] } },
  { id: 'week', label: 'Toda semana', rule: { freq: 'week', interval: 1 } },
  { id: 'month', label: 'Todo mês', rule: { freq: 'month', interval: 1 } },
  { id: 'year', label: 'Todo ano', rule: { freq: 'year', interval: 1 } },
  { id: 'custom', label: 'Personalizado…' },
];

/** Qual item de PRESETS corresponde a esta regra (ou 'custom'). */
export function presetOf(rule, dateISO) {
  if (!rule) return 'none';
  const n = rule.interval ?? 1;
  if (n !== 1) return 'custom';
  const p = dateISO ? parseISO(dateISO) : null;
  switch (rule.freq) {
    case 'day':
      return 'day';
    case 'week': {
      const key = (rule.days ?? []).join(',');
      if (key === '1,2,3,4,5') return 'weekdays';
      if (!rule.days?.length || (dateISO && key === String(weekday(dateISO)))) return 'week';
      return 'custom';
    }
    case 'month':
      return !rule.monthDay || (p && rule.monthDay === p.d) ? 'month' : 'custom';
    case 'year':
      return !rule.month || (p && rule.month === p.m && rule.monthDay === p.d) ? 'year' : 'custom';
    default:
      return 'custom';
  }
}
