// Menu lateral: telas, prioridades e etiquetas (com contadores).
import { PRIORITIES } from '../model.js';
import { counts } from '../query.js';
import { h } from './dom.js';
import { icon, logo } from './icons.js';

export function renderSidebar(app) {
  const { store, ui } = app;
  const { tasks, labels } = store.state;
  const today = store.today();
  const r = ui.route;
  const c = counts(tasks, today);

  const item = (href, iconName, label, { active = false, count = 0, tone = '', lead = null } = {}) =>
    h('a', { class: `nav-item${active ? ' is-active' : ''}`, href, 'aria-current': active ? 'page' : undefined },
      lead ?? icon(iconName, 18),
      h('span', { class: 'nav-label' }, label),
      count ? h('span', { class: `badge${tone ? ` tone-${tone}` : ''}` }, count) : null);

  const nav = h('nav', { class: 'nav', 'aria-label': 'Telas' },
    item('#/hoje', 'today', 'Hoje', { active: r.name === 'day' && (r.date === null || r.date === today), count: c.today }),
    item('#/pendentes', 'overdue', 'Pendentes', { active: r.name === 'overdue', count: c.overdue, tone: 'danger' }),
    item('#/proximos', 'upcoming', 'Próximos', { active: r.name === 'upcoming' }),
    item('#/calendario', 'calendar', 'Calendário', { active: r.name === 'month' }),
    item('#/sem-data', 'inbox', 'Sem data', { active: r.name === 'inbox', count: c.inbox }),
    item('#/concluidas', 'done', 'Concluídas', { active: r.name === 'done' }));

  const prios = h('div', { class: 'nav-group' },
    h('h2', { class: 'nav-title' }, 'Prioridades'),
    h('nav', { class: 'nav', 'aria-label': 'Prioridades' },
      [...PRIORITIES].reverse().filter((p) => p.value > 0).map((p) =>
        item(`#/prioridade/${p.value}`, 'flag', p.label, { active: r.name === 'priority' && r.value === p.value, count: c.byPriority[p.value], lead: h('span', { class: `flag-lead p${p.value}` }, icon('flag', 17)) }))));

  const labelNav = labels.length
    ? h('nav', { class: 'nav', 'aria-label': 'Etiquetas' },
      labels.map((l) => item(`#/etiqueta/${encodeURIComponent(l.id)}`, 'tag', l.name, { active: r.name === 'label' && r.id === l.id, count: c.byLabel.get(l.id) ?? 0, lead: h('span', { class: `dot-lead lc-${l.color}` }) })))
    : h('p', { class: 'nav-empty' }, 'Nenhuma etiqueta ainda. Escreva #nome ao adicionar uma tarefa.');
  const labelGroup = h('div', { class: 'nav-group' },
    h('div', { class: 'nav-title-row' },
      h('h2', { class: 'nav-title' }, 'Etiquetas'),
      h('button', { class: 'icon-btn sm', type: 'button', title: 'Gerenciar etiquetas', 'aria-label': 'Gerenciar etiquetas', onclick: () => app.settings.open('labels') }, icon('sliders', 16))),
    labelNav);

  const foot = h('div', { class: 'sidebar-foot' },
    app.account.sidebarItem(),
    h('button', { class: 'nav-item', type: 'button', onclick: () => app.settings.open(), title: 'Configurações, backup e atalhos' }, icon('sliders', 18), h('span', { class: 'nav-label' }, 'Configurações')));

  return [
    h('a', { class: 'brand', href: '#/hoje', 'aria-label': 'Pauta — ir para hoje' }, logo(30), h('span', {}, 'Pauta')),
    nav, prios, labelGroup, foot,
  ];
}
