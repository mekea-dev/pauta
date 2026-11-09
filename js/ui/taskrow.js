// Uma linha de tarefa: caixa de marcar, título, detalhes (hora, prioridade, etiquetas, checklist) e menu.
import { addDays, relativeDay, startOfWeek } from '../dates.js';
import { priorityLabel } from '../model.js';
import { checklistProgress, isOverdue } from '../query.js';
import { describe } from '../recurrence.js';
import { remindLabel, remindShort } from '../reminders.js';
import { clip, h, reducedMotion } from './dom.js';
import { icon } from './icons.js';
import { openMenu } from './overlay.js';
import { attachSwipe } from './swipe.js';

export function taskRow(app, task, { showDate = false } = {}) {
  const { store, ui } = app;
  const ghost = task.ghost === true;
  const realId = task.ghostOf ?? task.id;
  const today = store.today();
  const labels = store.state.labels;
  const overdue = isOverdue(task, today);
  const prog = checklistProgress(task);
  const expanded = !ghost && prog.total > 0 && ui.expanded.has(task.id);

  const li = h('li', {
    class: `task p${task.priority}${task.done ? ' is-done' : ''}${overdue ? ' is-overdue' : ''}${ghost ? ' is-ghost' : ''}${ui.flashId === task.id ? ' flash' : ''}`,
    dataset: { id: task.id },
    tabindex: -1,
  });
  if (ui.flashId === task.id) ui.flashId = null;

  const check = h('button', {
    class: 'check', type: 'button', role: 'checkbox', disabled: ghost, dataset: { role: 'check' },
    'aria-checked': task.done,
    'aria-label': ghost ? `Repetição futura de ${task.title}` : `${task.done ? 'Reabrir' : 'Concluir'}: ${task.title}`,
    title: ghost ? 'Repetição futura: conclua a ocorrência atual para gerar a próxima.' : undefined,
    onclick: () => {
      if (li.classList.contains('is-completing')) return;
      if (task.done) return app.actions.reopen(task.id);
      li.classList.add('is-completing');
      check.setAttribute('aria-checked', 'true');
      setTimeout(() => app.actions.complete(task.id), reducedMotion() ? 0 : 260);
    },
  }, h('span', { class: 'box' }, icon('check', 13)));

  // ---- detalhes ----
  const meta = [];
  const when = [showDate && task.date ? relativeDay(task.date, today) : null, task.time].filter(Boolean).join(' · ');
  if (when) {
    meta.push(h('span', { class: `meta meta-when${overdue ? ' is-overdue' : ''}` }, icon(showDate && task.date ? 'calendar' : 'clock', 13), when));
  }
  if (task.remind != null && task.time && !task.done) {
    meta.push(h('span', { class: 'meta', title: `Lembrete: ${remindLabel(task.remind).toLowerCase()}`, 'aria-label': `Lembrete: ${remindLabel(task.remind).toLowerCase()}` }, icon('bell', 13), remindShort(task.remind)));
  }
  if (task.priority > 0) {
    meta.push(h('span', { class: `chip prio p${task.priority}`, title: `Prioridade ${priorityLabel(task.priority).toLowerCase()}` }, icon('flag', 12), priorityLabel(task.priority)));
  }
  for (const id of task.labels) {
    const l = labels.find((x) => x.id === id);
    if (l) meta.push(h('a', { class: `chip lbl lc-${l.color}`, href: `#/etiqueta/${encodeURIComponent(l.id)}`, title: `Etiqueta: ${l.name}` }, l.name));
  }
  if (task.recurrence) meta.push(h('span', { class: 'meta', title: describe(task.recurrence, task.date) }, icon('repeat', 13), ghost ? 'Repete' : null));
  if (task.notes?.trim()) meta.push(h('span', { class: 'meta', title: clip(task.notes.trim().replace(/\s+/g, ' '), 140) }, icon('note', 13)));
  if (prog.total > 0) {
    meta.push(h('button', {
      type: 'button', class: `meta meta-check${prog.done === prog.total ? ' is-complete' : ''}`, dataset: { role: 'toggle-check' },
      'aria-expanded': expanded, 'aria-label': `Checklist: ${prog.done} de ${prog.total}. ${expanded ? 'Recolher' : 'Mostrar itens'}`,
      onclick: () => {
        if (ui.expanded.has(task.id)) ui.expanded.delete(task.id);
        else ui.expanded.add(task.id);
        app.render();
      },
    }, icon('checklist', 13), `${prog.done}/${prog.total}`, icon('chevron-down', 12)));
  }

  const inline = expanded
    ? h('ul', { class: 'inline-check' }, task.checklist.map((c) => h('li', { class: c.done ? 'done' : '' },
      h('button', {
        class: 'ci-box', type: 'button', role: 'checkbox', 'aria-checked': c.done, 'aria-label': c.text, dataset: { role: `ci:${c.id}` },
        onclick: () => app.actions.toggleCheckItem(task.id, c.id),
      }, icon('check', 11)),
      h('span', {}, c.text))))
    : null;

  const body = h('div', { class: 'task-body' },
    h('button', { class: 'task-title', type: 'button', dataset: { role: 'title' }, onclick: () => app.editor.open(realId) }, task.title),
    meta.length ? h('div', { class: 'task-meta' }, meta) : null,
    inline);

  const more = ghost ? null : h('button', {
    class: 'icon-btn more', type: 'button', 'aria-label': `Mais ações para ${task.title}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false', dataset: { role: 'more' },
    onclick: (e) => openMore(e.currentTarget),
  }, icon('more', 18));

  function openMore(anchor) {
    const ws = store.state.settings.weekStart;
    const items = [{ label: 'Editar', icon: 'edit', onClick: () => app.editor.open(task.id) }];
    if (!task.done) {
      items.push(
        { separator: true },
        { label: 'Hoje', icon: 'today', onClick: () => app.actions.move(task.id, today) },
        { label: 'Amanhã', icon: 'calendar', onClick: () => app.actions.move(task.id, addDays(today, 1)) },
        { label: 'Próxima semana', icon: 'calendar', onClick: () => app.actions.move(task.id, startOfWeek(addDays(today, 7), ws)) },
        { label: 'Sem data', icon: 'inbox', onClick: () => app.actions.move(task.id, null) },
      );
      if (task.recurrence) items.push({ label: 'Pular esta vez', icon: 'skip', onClick: () => app.actions.skip(task.id) });
    }
    items.push(
      { separator: true },
      { label: 'Duplicar', icon: 'copy', onClick: () => app.actions.duplicate(task.id) },
      { label: 'Excluir', icon: 'trash', danger: true, onClick: () => app.actions.remove(task.id) },
    );
    openMenu(anchor, items);
  }

  li.append(check, body);
  if (more) li.append(more);

  // celular: arrastar para a direita conclui (ou reabre), para a esquerda exclui (js/ui/swipe.js); as repetições futuras não mexem
  if (!ghost) {
    attachSwipe(li, {
      right: task.done
        ? { label: 'Reabrir', armedLabel: 'Solte para reabrir', icon: 'undo', run: () => app.actions.reopen(realId) }
        : { label: 'Concluir', armedLabel: 'Solte para concluir', icon: 'check', run: () => app.actions.complete(realId) },
      left: { label: 'Excluir', armedLabel: 'Solte para excluir', icon: 'trash', run: () => app.actions.remove(realId) },
    });
  }
  return li;
}
