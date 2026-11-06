// As telas de lista: dia, próximos, sem data, concluídas, etiqueta, prioridade e busca.
import { byLabel, byPriority, compareDay, dayView, doneGroups, ghosts, groupByDate, inbox, overdueGroups, search } from '../query.js';
import { priorityLabel } from '../model.js';
import { plural } from '../text.js';
import { renderCalendar } from './calendar.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { taskRow } from './taskrow.js';

const list = (app, tasks, opts) => h('ul', { class: 'task-list card' }, tasks.map((t) => taskRow(app, t, opts)));

function section({ title, subtitle, count, tone, actions, collapsible, open, onToggle } = {}, body) {
  let head = null;
  if (title) {
    head = collapsible
      ? h('header', { class: 'section-head' },
        h('button', { class: 'section-toggle', type: 'button', 'aria-expanded': open, onclick: onToggle }, icon('chevron-down', 16), title, count != null ? h('span', { class: 'count' }, count) : null))
      : h('header', { class: 'section-head' },
        h('h2', { class: 'section-title' }, title, subtitle ? h('span', { class: 'section-sub' }, subtitle) : null, count != null ? h('span', { class: 'count' }, count) : null),
        actions);
  }
  return h('section', { class: `section${tone ? ` tone-${tone}` : ''}` }, head, body);
}

function empty(iconName, title, text) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, icon(iconName, 28)), h('h2', {}, title), text ? h('p', {}, text) : null);
}

export function renderView(app) {
  const { route, search: q } = app.ui;
  if (q.trim()) return searchView(app, q);
  switch (route.name) {
    case 'upcoming': return upcomingView(app);
    case 'inbox': return inboxView(app);
    case 'overdue': return overdueView(app);
    case 'done': return doneView(app);
    case 'label': return labelView(app, route);
    case 'priority': return priorityView(app, route);
    case 'month': return renderCalendar(app, route);
    default: return dayNodes(app, route);
  }
}

// ---------- dia ----------

function dayNodes(app, route) {
  const { store, ui } = app;
  const { tasks, settings } = store.state;
  const today = store.today();
  const date = route.date ?? today;
  const v = dayView(tasks, date, today);
  const future = date > today ? ghosts(tasks, date, date, today) : [];
  const open = [...v.open, ...future].sort(compareDay);
  const total = v.overdue.length + open.length + v.done.length;
  const nodes = [];

  if (total > 0) {
    const pct = Math.round((v.done.length / total) * 100);
    nodes.push(h('div', { class: 'progress', role: 'group', 'aria-label': 'Progresso do dia' },
      h('span', { class: 'progress-text' }, `${v.done.length} de ${total} concluída${total === 1 ? '' : 's'}`),
      h('div', { class: 'progress-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct }, h('span', { style: { width: `${pct}%` } }))));
  }

  if (v.overdue.length) {
    nodes.push(section({
      title: 'Pendentes de dias anteriores', count: v.overdue.length, tone: 'danger',
      actions: h('button', { class: 'btn btn-sm', type: 'button', onclick: () => app.actions.rescheduleOverdue() }, 'Reagendar para hoje'),
    }, list(app, v.overdue, { showDate: true })));
  }

  if (open.length) {
    nodes.push(section(v.overdue.length ? { title: 'Hoje', count: open.length } : {}, list(app, open)));
  } else if (!v.overdue.length) {
    nodes.push(v.done.length
      ? empty('done', 'Tudo concluído!', date === today ? 'Você terminou o que tinha para hoje. Dá para respirar.' : 'Nada pendente neste dia.')
      : empty('today', date === today ? 'Dia livre' : 'Nada para este dia', date === today ? 'Nada planejado para hoje. Adicione algo no campo acima.' : 'Adicione uma tarefa no campo acima e ela entra neste dia.'));
  }

  if (settings.showDone && v.done.length) {
    nodes.push(section({
      title: 'Concluídas', count: v.done.length, collapsible: true, open: ui.doneOpen,
      onToggle: () => { ui.doneOpen = !ui.doneOpen; app.render(); },
    }, ui.doneOpen ? list(app, v.done) : null));
  }
  return nodes;
}

// ---------- listas agrupadas ----------

function grouped(app, groups, emptyNode, { forceDate = false } = {}) {
  if (!groups.length) return [emptyNode];
  return groups.map((g) => section({
    title: g.title, subtitle: g.subtitle, count: g.tasks.length, tone: g.key === 'overdue' ? 'danger' : '',
    actions: g.key === 'overdue' ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => app.actions.rescheduleOverdue() }, 'Reagendar para hoje') : null,
  }, list(app, g.tasks, { showDate: forceDate || g.key === 'overdue' || g.key === 'later' })));
}

function upcomingView(app) {
  const { store } = app;
  const groups = groupByDate(store.state.tasks, store.today(), { horizon: 13, undated: false });
  return grouped(app, groups, empty('upcoming', 'Nada planejado', 'Quando você agendar tarefas, elas aparecem aqui, dia a dia.'));
}

function inboxView(app) {
  const items = inbox(app.store.state.tasks);
  if (!items.length) return [empty('inbox', 'Nenhuma tarefa sem data', 'Ideias e lembretes sem dia marcado ficam aqui até você agendar.')];
  return [section({}, list(app, items))];
}

function labelView(app, route) {
  const { store } = app;
  const l = store.state.labels.find((x) => x.id === route.id);
  if (!l) return [empty('tag', 'Etiqueta não encontrada', 'Ela pode ter sido excluída.')];
  const groups = groupByDate(byLabel(store.state.tasks, l.id), store.today());
  return grouped(app, groups, empty('tag', 'Nada com esta etiqueta', `Use #${l.name} ao adicionar uma tarefa.`));
}

function priorityView(app, route) {
  const { store } = app;
  const groups = groupByDate(byPriority(store.state.tasks, route.value), store.today());
  return grouped(app, groups, empty('flag', 'Nada com esta prioridade', `Nenhuma tarefa aberta com prioridade ${priorityLabel(route.value).toLowerCase()}.`));
}

// ---------- pendentes (dias anteriores) ----------

function overdueView(app) {
  const { store } = app;
  const groups = overdueGroups(store.state.tasks, store.today());
  if (!groups.length) return [empty('done', 'Nada pendente', 'Todas as tarefas de dias anteriores foram concluídas ou reagendadas.')];
  const total = groups.reduce((n, g) => n + g.tasks.length, 0);
  return [
    h('div', { class: 'view-actions' },
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => app.actions.rescheduleOverdue() }, icon('today', 15), `Reagendar ${total === 1 ? 'a tarefa' : `as ${total} tarefas`} para hoje`)),
    ...groups.map((g) => section({ title: g.title, subtitle: g.subtitle, count: g.tasks.length, tone: 'danger' }, list(app, g.tasks))),
  ];
}

// ---------- concluídas ----------

function doneView(app) {
  const { store, ui } = app;
  const groups = doneGroups(store.state.tasks, store.today());
  if (!groups.length) return [empty('done', 'Nada concluído ainda', 'As tarefas que você concluir ficam registradas aqui.')];
  const nodes = [h('div', { class: 'view-actions' },
    h('button', { class: 'btn btn-sm btn-danger-ghost', type: 'button', onclick: () => app.actions.clearDone() }, icon('trash', 15), 'Limpar concluídas'))];
  let shown = 0;
  for (const g of groups) {
    if (shown >= ui.doneLimit) break;
    const tasks = g.tasks.slice(0, ui.doneLimit - shown);
    shown += tasks.length;
    nodes.push(section({ title: g.title, subtitle: g.subtitle, count: g.tasks.length }, list(app, tasks)));
  }
  const total = groups.reduce((n, g) => n + g.tasks.length, 0);
  if (shown < total) {
    nodes.push(h('div', { class: 'view-actions center' },
      h('button', { class: 'btn', type: 'button', onclick: () => { ui.doneLimit += 200; app.render(); } }, `Mostrar mais (${total - shown})`)));
  }
  return nodes;
}

// ---------- busca ----------

function searchView(app, q) {
  const { store } = app;
  const found = search(store.state.tasks, store.state.labels, q);
  if (!found.length) return [empty('search', 'Nada encontrado', `Não achei tarefas com “${q.trim()}”. A busca olha título, anotações, etiquetas e checklist.`)];
  return [
    h('p', { class: 'result-count' }, `${plural(found.length, 'resultado', 'resultados')} para “${q.trim()}”`),
    section({}, list(app, found, { showDate: true })),
  ];
}
