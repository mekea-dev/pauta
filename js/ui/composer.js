// Campo de adição rápida: escreva "Reunião sexta 14h !alta #trabalho" e veja o que foi entendido.
import { WEEKDAYS_SHORT, capitalize, diffDays, relativeDay, weekday } from '../dates.js';
import { priorityLabel } from '../model.js';
import { parseQuickAdd } from '../parser.js';
import { describe } from '../recurrence.js';
import { fold } from '../text.js';
import { h } from './dom.js';
import { icon } from './icons.js';

const EXAMPLES = [
  'Pagar boleto amanhã 10h !alta #contas',
  'Reunião sexta 14:30 #trabalho',
  'Academia toda segunda e quarta 19h',
  'Dentista dia 20/11 às 15h',
  'Planejar a viagem semana que vem',
  'Revisar relatório hoje 16h !urgente',
];

export function createComposer(app) {
  const { store } = app;
  let ignore = {};
  let ctx = { date: null, labelId: null, priority: 0, hidden: false };

  const input = h('input', {
    class: 'composer-input', type: 'text', maxlength: 300, autocomplete: 'off', enterkeyhint: 'done',
    'aria-label': 'Nova tarefa', 'aria-describedby': 'composer-hint',
    placeholder: `Nova tarefa… ex.: ${EXAMPLES[0]}`,
    oninput: () => update(),
    onfocus: () => showHint(),
    onblur: () => { rotatePlaceholder(); showHint(); },
    onkeydown: (e) => {
      if (e.key !== 'Escape') return;
      if (input.value) { input.value = ''; ignore = {}; update(); } else input.blur();
    },
  });
  const preview = h('div', { class: 'composer-preview', hidden: true });
  const hint = h('p', { class: 'composer-hint', id: 'composer-hint', hidden: true },
    'Escreva do seu jeito: ', h('b', {}, 'amanhã'), ', ', h('b', {}, 'sexta'), ', ', h('b', {}, '15/11'), ', ', h('b', {}, '14h'), ', ',
    h('b', {}, '!alta'), ', ', h('b', {}, '#etiqueta'), ', ', h('b', {}, 'toda segunda'), '…');
  const addBtn = h('button', { class: 'btn btn-primary composer-add', type: 'submit' }, icon('plus', 18), h('span', {}, 'Adicionar'));
  const form = h('form', { class: 'composer', autocomplete: 'off', onsubmit: (e) => { e.preventDefault(); submit(); } },
    h('div', { class: 'composer-box' }, h('span', { class: 'composer-icon' }, icon('plus', 20)), input, addBtn),
    preview, hint);

  const rotatePlaceholder = () => {
    input.placeholder = `Nova tarefa… ex.: ${EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)]}`;
  };
  const showHint = () => { hint.hidden = !(document.activeElement === input && !input.value); };

  function parse() {
    return parseQuickAdd(input.value, { today: store.today(), weekStart: store.state.settings.weekStart, ignore });
  }

  function dateText(date, today) {
    const rel = relativeDay(date, today);
    return diffDays(date, today) >= 7 ? `${capitalize(WEEKDAYS_SHORT[weekday(date)])}, ${rel}` : rel;
  }

  function chip(iconName, text, key, extra = '') {
    return h('span', { class: `pv-chip ${extra}` }, icon(iconName, 13), h('span', {}, text),
      key ? h('button', {
        type: 'button', class: 'pv-x', 'aria-label': `Não reconhecer “${text}”`, title: 'Não reconhecer: manter como texto do título',
        onclick: () => { ignore[key] = true; update(); input.focus(); },
      }, icon('x', 11)) : null);
  }

  function update() {
    const p = parse();
    const today = store.today();
    const chips = [];
    const dateTok = p.tokens.find((t) => t.type === 'date');
    if (p.date) chips.push(chip('calendar', dateText(p.date, today), dateTok && !dateTok.derived ? 'date' : null));
    if (p.time) chips.push(chip('clock', p.time, 'time'));
    if (p.priority) chips.push(chip('flag', priorityLabel(p.priority), 'priority', `p${p.priority}`));
    if (p.recurrence) chips.push(chip('repeat', describe(p.recurrence, p.date), 'recurrence'));
    if (p.labels.length) {
      const known = new Set(store.state.labels.map((l) => fold(l.name)));
      for (const name of p.labels) chips.push(chip('tag', `#${name}${known.has(fold(name)) ? '' : ' (nova)'}`, 'labels'));
    }
    if (input.value.trim() && !p.title) chips.push(h('span', { class: 'pv-warn' }, 'Falta o título da tarefa'));
    preview.replaceChildren(...chips);
    preview.hidden = chips.length === 0;
    showHint();
  }

  function submit() {
    const p = parse();
    if (!p.title) {
      form.classList.remove('shake');
      void form.offsetWidth; // reinicia a animação
      form.classList.add('shake');
      input.focus();
      return;
    }
    let date = p.date ?? ctx.date ?? null;
    if (!date && p.time) date = store.today(); // hora sem dia: vale hoje
    const labelIds = store.ensureLabels(p.labels);
    if (ctx.labelId && store.state.labels.some((l) => l.id === ctx.labelId) && !labelIds.includes(ctx.labelId)) labelIds.push(ctx.labelId);
    const task = store.addTask({
      title: p.title, date, time: p.time, priority: p.priority ?? ctx.priority ?? 0, labels: labelIds, recurrence: p.recurrence,
    });
    if (!task) return;
    input.value = '';
    ignore = {};
    update();
    app.actions.added(task);
  }

  return {
    el: form,
    focus() { input.focus(); },
    refresh: update,
    /** Define onde a tarefa cai por padrão (dia aberto, etiqueta aberta...) e se o campo aparece. */
    setContext(next) {
      ctx = { date: null, labelId: null, priority: 0, hidden: false, ...next };
      form.hidden = ctx.hidden;
    },
  };
}
