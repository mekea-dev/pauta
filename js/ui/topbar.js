// Topo da página: título da tela, navegação de dias/meses e busca.
// Os elementos são criados uma vez e só atualizados (assim o campo de busca não perde o foco ao digitar).
import { addDays, dayTitle, daySubtitle, monthTitle, startOfWeek, todayISO, WEEKDAYS, WEEKDAYS_SHORT, formatLong, parseISO, weekday } from '../dates.js';
import { priorityLabel } from '../model.js';
import { dayCounts } from '../query.js';
import { h } from './dom.js';
import { icon } from './icons.js';

export function createTopbar(app) {
  const { ui, store } = app;

  const menuBtn = h('button', { class: 'icon-btn menu-btn', type: 'button', 'aria-label': 'Abrir menu', onclick: () => app.toggleSidebar(true) }, icon('menu', 22));
  const title = h('h1', { class: 'title' });
  const subtitle = h('p', { class: 'subtitle' });
  const pickDate = h('input', { class: 'date-pick', type: 'date', tabindex: -1, 'aria-label': 'Escolher uma data', onchange: () => { if (pickDate.value) app.go(`#/dia/${pickDate.value}`); } });
  const pickBtn = h('button', {
    class: 'icon-btn', type: 'button', title: 'Ir para uma data', 'aria-label': 'Ir para uma data',
    onclick: () => { try { pickDate.showPicker(); } catch { pickDate.focus(); pickDate.click(); } },
  }, icon('calendar', 20));
  const titleBox = h('div', { class: 'titles' }, h('div', { class: 'title-line' }, title, pickBtn, pickDate), subtitle);

  const goMonth = (delta) => {
    const r = ui.route;
    const d = new Date(r.year, r.month - 1 + delta, 1);
    app.go(`#/calendario/${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const prevBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Mês anterior', onclick: () => goMonth(-1) }, icon('chevron-left', 20));
  const nextBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Próximo mês', onclick: () => goMonth(1) }, icon('chevron-right', 20));
  const todayBtn = h('button', { class: 'btn btn-sm', type: 'button', onclick: () => app.go('#/hoje') }, 'Hoje');

  const searchInput = h('input', {
    class: 'search-input', type: 'search', placeholder: 'Buscar tarefas…', 'aria-label': 'Buscar tarefas', autocomplete: 'off',
    oninput: () => { ui.search = searchInput.value; app.render(); },
    onkeydown: (e) => {
      if (e.key !== 'Escape') return;
      searchInput.value = '';
      ui.search = '';
      ui.searchOpen = false;
      searchInput.blur();
      app.render();
    },
  });
  const searchBox = h('div', { class: 'search' }, icon('search', 16), searchInput);
  const searchToggle = h('button', {
    class: 'icon-btn search-toggle', type: 'button', 'aria-label': 'Buscar',
    onclick: () => { ui.searchOpen = !ui.searchOpen; app.render(); if (ui.searchOpen) searchInput.focus(); },
  }, icon('search', 20));

  // sol/lua: alterna entre claro e escuro (o "automático" fica nas Configurações)
  const themeBtn = h('button', { class: 'icon-btn', type: 'button', onclick: () => app.toggleTheme() });
  const renderTheme = () => {
    const dark = app.effectiveTheme() === 'dark';
    const label = dark ? 'Mudar para o tema claro' : 'Mudar para o tema escuro';
    themeBtn.replaceChildren(icon(dark ? 'sun' : 'moon', 20));
    themeBtn.title = label;
    themeBtn.setAttribute('aria-label', label);
  };

  const strip = h('div', { class: 'weekstrip-wrap' });
  const el = h('header', { class: 'topbar' },
    h('div', { class: 'topbar-row' }, menuBtn, titleBox, h('div', { class: 'topbar-actions' }, prevBtn, nextBtn, todayBtn, searchToggle, searchBox, themeBtn)),
    strip);

  function heading() {
    const r = ui.route;
    const today = store.today();
    if (ui.search.trim()) return { title: 'Busca', subtitle: 'Procurando em título, anotações, etiquetas e checklist' };
    switch (r.name) {
      case 'upcoming': return { title: 'Próximos', subtitle: 'Atrasadas e os próximos dias' };
      case 'month': return { title: monthTitle(r.year, r.month), subtitle: 'Calendário' };
      case 'inbox': return { title: 'Sem data', subtitle: 'Tarefas que ainda não têm um dia' };
      case 'overdue': return { title: 'Pendentes', subtitle: 'Tarefas de dias anteriores que ainda não foram concluídas' };
      case 'done': return { title: 'Concluídas', subtitle: 'O que você já fez' };
      case 'label': {
        const l = store.state.labels.find((x) => x.id === r.id);
        return { title: l ? l.name : 'Etiqueta', subtitle: 'Etiqueta', label: l };
      }
      case 'priority': return { title: priorityLabel(r.value), subtitle: 'Prioridade', priority: r.value };
      default: {
        const date = r.date ?? today;
        return { title: dayTitle(date, today), subtitle: daySubtitle(date, today) };
      }
    }
  }

  function weekStrip(selected) {
    const today = store.today();
    const ws = store.state.settings.weekStart;
    const days = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(selected, ws), i));
    const counts = dayCounts(store.state.tasks, days, today);
    const href = (d) => (d === today ? '#/hoje' : `#/dia/${d}`);
    return h('div', { class: 'weekstrip', role: 'group', 'aria-label': 'Dias da semana' },
      h('a', { class: 'icon-btn', href: href(addDays(selected, -7)), 'aria-label': 'Semana anterior' }, icon('chevron-left', 20)),
      days.map((d) => {
        const c = counts.get(d);
        const n = c?.open ?? 0;
        return h('a', {
          class: `wd${d === selected ? ' is-selected' : ''}${d === today ? ' is-today' : ''}${[0, 6].includes(weekday(d)) ? ' is-weekend' : ''}`,
          href: href(d), 'aria-current': d === selected ? 'date' : undefined,
          'aria-label': `${WEEKDAYS[weekday(d)]}, ${formatLong(d)}${n ? `, ${n} ${n === 1 ? 'tarefa' : 'tarefas'}` : ''}`,
        },
        h('span', { class: 'wd-name' }, WEEKDAYS_SHORT[weekday(d)]),
        h('span', { class: 'wd-num' }, String(parseISO(d).d)),
        h('span', { class: `wd-dots top-${c?.top ?? 0}` }, Array.from({ length: Math.min(n, 3) }, () => h('i'))));
      }),
      h('a', { class: 'icon-btn', href: href(addDays(selected, 7)), 'aria-label': 'Próxima semana' }, icon('chevron-right', 20)));
  }

  function render() {
    const r = ui.route;
    const today = store.today();
    const searching = ui.search.trim().length > 0;
    renderTheme();
    const head = heading();
    title.replaceChildren(
      ...(head.label ? [h('span', { class: `dot-lead lg lc-${head.label.color}` })] : []),
      ...(head.priority ? [h('span', { class: `flag-lead p${head.priority}` }, icon('flag', 22))] : []),
      head.title);
    subtitle.textContent = head.subtitle;
    pickBtn.hidden = !(r.name === 'day' && !searching);
    prevBtn.hidden = nextBtn.hidden = !(r.name === 'month' && !searching);
    const dayNotToday = r.name === 'day' && r.date !== null && r.date !== today;
    const monthNotCurrent = r.name === 'month' && todayISO().slice(0, 7) !== `${r.year}-${String(r.month).padStart(2, '0')}`;
    todayBtn.hidden = searching || !(dayNotToday || monthNotCurrent);
    searchBox.classList.toggle('is-open', ui.searchOpen || searching);
    if (searchInput.value !== ui.search) searchInput.value = ui.search;
    el.classList.toggle('is-searching', searching);
    strip.replaceChildren(...(r.name === 'day' && !searching ? [weekStrip(r.date ?? today)] : []));
  }

  return { el, render, focusSearch() { ui.searchOpen = true; app.render(); searchInput.focus(); searchInput.select(); } };
}
