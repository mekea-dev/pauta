// Consultas sobre a lista de tarefas: o que mostrar em cada tela, em que ordem.
// Funções puras (recebem as tarefas e devolvem listas), por isso fáceis de testar.
import { addDays, dayHeading, localDate } from './dates.js';
import { occurrencesBetween } from './recurrence.js';
import { foldLoose } from './text.js';

export const isOpen = (t) => !t.done;
export const isOverdue = (t, today) => !t.done && !!t.date && t.date < today;

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Ordem dentro de um dia: com horário primeiro (pela hora), depois por prioridade, depois por criação. */
export function compareDay(a, b) {
  if (a.time && b.time) {
    if (a.time !== b.time) return cmp(a.time, b.time);
  } else if (a.time || b.time) {
    return a.time ? -1 : 1;
  }
  if (a.priority !== b.priority) return b.priority - a.priority;
  return cmp(a.createdAt, b.createdAt) || cmp(a.id, b.id);
}

export function compareDateThenDay(a, b) {
  if (a.date !== b.date) {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return cmp(a.date, b.date);
  }
  return compareDay(a, b);
}

const byDoneAtDesc = (a, b) => cmp(b.doneAt ?? '', a.doneAt ?? '');

/** O que aparece na tela de um dia: atrasadas (só em "hoje"), abertas do dia e concluídas. */
export function dayView(tasks, iso, today) {
  const open = tasks.filter((t) => !t.done && t.date === iso).sort(compareDay);
  const overdue = iso === today ? tasks.filter((t) => isOverdue(t, today)).sort(compareDateThenDay) : [];
  const done = tasks
    .filter((t) => t.done && (t.date === iso || (iso === today && t.doneAt && localDate(t.doneAt) === today)))
    .sort(byDoneAtDesc);
  return { overdue, open, done };
}

export const inbox = (tasks) => tasks.filter((t) => !t.done && !t.date).sort(compareDay);

/** Ocorrências futuras de tarefas que repetem (virtuais, só para exibição). */
export function ghosts(tasks, from, to, today) {
  const lo = from > today ? from : addDays(today, 1);
  if (lo > to) return [];
  const out = [];
  for (const t of tasks) {
    if (t.done || !t.recurrence || !t.date || t.date >= to) continue;
    for (const d of occurrencesBetween(t.recurrence, t.date, lo, to)) out.push({ ...t, date: d, ghost: true, ghostOf: t.id });
  }
  return out;
}

/** Agrupa tarefas abertas por dia: Atrasadas, Hoje, Amanhã, ..., Depois, Sem data. */
export function groupByDate(tasks, today, { horizon = Infinity, undated = true } = {}) {
  const groups = [];
  const open = tasks.filter(isOpen);
  const overdue = open.filter((t) => t.date && t.date < today).sort(compareDateThenDay);
  if (overdue.length) groups.push({ key: 'overdue', title: 'Pendentes de dias anteriores', tasks: overdue });
  const byDate = new Map();
  const later = [];
  for (const t of open) {
    if (!t.date || t.date < today) continue;
    if (Date.parse(t.date) - Date.parse(today) > horizon * 86400000) {
      later.push(t);
      continue;
    }
    if (!byDate.has(t.date)) byDate.set(t.date, []);
    byDate.get(t.date).push(t);
  }
  for (const date of [...byDate.keys()].sort()) {
    groups.push({ key: date, date, ...dayHeading(date, today), tasks: byDate.get(date).sort(compareDay) });
  }
  if (later.length) groups.push({ key: 'later', title: 'Depois', tasks: later.sort(compareDateThenDay) });
  if (undated) {
    const nd = inbox(open);
    if (nd.length) groups.push({ key: 'nodate', title: 'Sem data', tasks: nd });
  }
  return groups;
}

/** Pendentes: tarefas abertas de dias anteriores, agrupadas pelo dia original (o mais recente primeiro). */
export function overdueGroups(tasks, today) {
  const byDate = new Map();
  for (const t of tasks) {
    if (t.done || !t.date || t.date >= today) continue;
    if (!byDate.has(t.date)) byDate.set(t.date, []);
    byDate.get(t.date).push(t);
  }
  return [...byDate.keys()]
    .sort()
    .reverse()
    .map((date) => ({ key: date, date, ...dayHeading(date, today), tasks: byDate.get(date).sort(compareDay) }));
}

/** Concluídas agrupadas pelo dia em que foram concluídas (mais recentes primeiro). */
export function doneGroups(tasks, today) {
  const map = new Map();
  for (const t of tasks) {
    if (!t.done) continue;
    const key = t.doneAt ? localDate(t.doneAt) : 'sem-data';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(t);
  }
  return [...map.keys()]
    .sort()
    .reverse()
    .map((key) => ({ key, ...(key === 'sem-data' ? { title: 'Sem data' } : dayHeading(key, today)), tasks: map.get(key).sort(byDoneAtDesc) }));
}

export function checklistProgress(t) {
  const items = t.checklist ?? [];
  return { done: items.filter((c) => c.done).length, total: items.length };
}

export function byLabel(tasks, labelId) {
  return tasks.filter((t) => t.labels.includes(labelId));
}

export function byPriority(tasks, p) {
  return tasks.filter((t) => t.priority === p);
}

// texto pesquisável de cada tarefa (título, anotações, checklist), guardado enquanto a tarefa não muda
const hayCache = new WeakMap();
function haystack(t) {
  let h = hayCache.get(t);
  if (h === undefined) {
    h = foldLoose([t.title, t.notes, ...t.checklist.map((c) => c.text)].join('\n'));
    hayCache.set(t, h);
  }
  return h;
}

/** Busca por palavras (todas precisam aparecer) no título, anotações, etiquetas e itens do checklist. */
export function search(tasks, labels, query) {
  const terms = foldLoose(String(query ?? '')).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const labelName = new Map(labels.map((l) => [l.id, foldLoose(l.name)]));
  return tasks
    .filter((t) => {
      const names = t.labels.map((id) => labelName.get(id) ?? '').join(' ');
      const h = names ? `${haystack(t)}\n${names}` : haystack(t);
      return terms.every((w) => h.includes(w));
    })
    .sort((a, b) => (a.done !== b.done ? (a.done ? 1 : -1) : a.done ? byDoneAtDesc(a, b) : compareDateThenDay(a, b)));
}

/** Números para o menu lateral. */
export function counts(tasks, today) {
  const c = { today: 0, overdue: 0, inbox: 0, byLabel: new Map(), byPriority: [0, 0, 0, 0, 0] };
  for (const t of tasks) {
    if (t.done) continue;
    if (t.date && t.date < today) c.overdue++;
    else if (t.date === today) c.today++;
    if (!t.date) c.inbox++;
    for (const id of t.labels) c.byLabel.set(id, (c.byLabel.get(id) ?? 0) + 1);
    c.byPriority[t.priority]++;
  }
  return c;
}

/** Para cada data, quantas tarefas abertas (reais + repetições futuras) e a maior prioridade. */
export function dayCounts(tasks, dates, today) {
  const set = new Set(dates);
  const map = new Map();
  const add = (date, t) => {
    const cur = map.get(date) ?? { open: 0, top: 0 };
    cur.open += 1;
    cur.top = Math.max(cur.top, t.priority);
    map.set(date, cur);
  };
  for (const t of tasks) if (!t.done && t.date && set.has(t.date)) add(t.date, t);
  const first = dates[0];
  const last = dates[dates.length - 1];
  for (const g of ghosts(tasks, first, last, today)) if (set.has(g.date)) add(g.date, g);
  return map;
}
