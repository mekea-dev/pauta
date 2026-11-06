// Calendário do mês: visão geral. Clique num dia para abrir a agenda dele.
import { formatLong, monthGrid, parseISO, weekdayLabels } from '../dates.js';
import { compareDay, ghosts } from '../query.js';
import { h } from './dom.js';

const MAX_PILLS = 3;

export function renderCalendar(app, route) {
  const { store } = app;
  const { tasks, settings } = store.state;
  const today = store.today();
  const { year, month } = route;
  const cells = monthGrid(year, month, settings.weekStart);
  const first = cells[0];
  const last = cells[cells.length - 1];

  const byDate = new Map();
  const put = (t) => {
    if (!byDate.has(t.date)) byDate.set(t.date, []);
    byDate.get(t.date).push(t);
  };
  for (const t of tasks) if (!t.done && t.date && t.date >= first && t.date <= last) put(t);
  for (const g of ghosts(tasks, first, last, today)) put(g);
  for (const arr of byDate.values()) arr.sort(compareDay);

  const names = weekdayLabels(settings.weekStart);
  const head = h('div', { class: 'cal-head', role: 'row' },
    names.short.map((s, i) => h('div', { class: 'cal-dow', role: 'columnheader' }, h('span', { class: 'long' }, s), h('span', { class: 'short' }, names.initial[i]))));

  const grid = h('div', { class: 'cal-grid', role: 'grid', 'aria-label': 'Calendário do mês' }, cells.map((date) => {
    const p = parseISO(date);
    const items = byDate.get(date) ?? [];
    const href = date === today ? '#/hoje' : `#/dia/${date}`;
    const pills = items.slice(0, MAX_PILLS).map((t) => h('button', {
      class: `cal-pill p${t.priority}${t.ghost ? ' is-ghost' : ''}`, type: 'button',
      title: `${t.time ? `${t.time} · ` : ''}${t.title}${t.ghost ? ' (repetição)' : ''}`,
      onclick: (e) => { e.stopPropagation(); app.editor.open(t.ghostOf ?? t.id); },
    }, t.time ? h('b', {}, t.time) : null, t.title));
    return h('div', {
      class: `cal-cell${p.m !== month ? ' is-other' : ''}${date === today ? ' is-today' : ''}${date < today ? ' is-past' : ''}`,
      role: 'gridcell',
      onclick: (e) => { if (!e.target.closest('button, a')) app.go(href); },
    },
    h('a', { class: 'cal-num', href, 'aria-label': `${formatLong(date)}${items.length ? `, ${items.length} ${items.length === 1 ? 'tarefa' : 'tarefas'}` : ''}` }, String(p.d)),
    h('div', { class: 'cal-items' }, pills, items.length > MAX_PILLS ? h('a', { class: 'cal-more', href }, `+${items.length - MAX_PILLS}`) : null));
  }));

  return [h('div', { class: 'cal' }, head, grid)];
}
