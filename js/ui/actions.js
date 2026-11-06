// Ações que a pessoa dispara na tela (concluir, mover, excluir...), sempre com aviso e "Desfazer".
import { formatShort, monthGrid, relativeDay } from '../dates.js';
import { remindLabel } from '../reminders.js';
import { clip } from './dom.js';
import { confirmDialog, toast } from './overlay.js';

/** "terça, 10 nov" (o dia da semana ajuda a conferir o que a fala entendeu); datas distantes já vêm como "10 nov". */
function dayAndDate(date, today) {
  const rel = relativeDay(date, today);
  return /\d/.test(rel) ? rel : `${rel.toLowerCase()}, ${formatShort(date)}`;
}

export function createActions(app) {
  const { store } = app;
  const undo = () => {
    const token = store.lastToken; // chamado DEPOIS da mudança, para pegar o token dela
    return { label: 'Desfazer', onClick: () => store.undo(token) };
  };
  const when = (date) => (date ? relativeDay(date, store.today()).toLowerCase() : '“Sem data”');

  const actions = {
    complete(id) {
      const t = store.find(id);
      if (!t || t.done) return;
      const r = store.toggleDone(id);
      toast(r?.spawned ? `Concluída. Próxima: ${when(r.spawned.date)}` : 'Tarefa concluída', { action: undo() });
    },

    reopen(id) {
      store.toggleDone(id);
    },

    toggleCheckItem(taskId, itemId) {
      const before = store.find(taskId);
      if (!before) return;
      store.toggleCheckItem(taskId, itemId);
      const t = store.find(taskId);
      const wasAll = before.checklist.every((c) => c.done);
      if (t && !t.done && t.checklist.length && !wasAll && t.checklist.every((c) => c.done)) {
        toast('Checklist completo!', { action: { label: 'Concluir tarefa', onClick: () => actions.complete(taskId) } });
      }
    },

    remove(id) {
      const t = store.deleteTask(id);
      if (t) toast(`“${clip(t.title, 40)}” excluída`, { action: undo() });
    },

    move(id, date) {
      if (store.updateTask(id, { date })) toast(`Movida para ${when(date)}`, { action: undo() });
    },

    skip(id) {
      const t = store.skipOccurrence(id);
      if (t) toast(`Pulada. Próxima: ${when(t.date)}`, { action: undo() });
    },

    duplicate(id) {
      if (store.duplicateTask(id)) toast('Tarefa duplicada', { action: undo() });
    },

    rescheduleOverdue() {
      const n = store.rescheduleOverdue(store.today());
      if (n) toast(`${n} ${n === 1 ? 'tarefa reagendada' : 'tarefas reagendadas'} para hoje`, { action: undo() });
    },

    async clearDone() {
      const n = store.state.tasks.filter((t) => t.done).length;
      if (!n) return;
      const ok = await confirmDialog({
        title: 'Limpar concluídas?',
        message: `${n} ${n === 1 ? 'tarefa concluída será excluída' : 'tarefas concluídas serão excluídas'}. Dá para desfazer logo em seguida.`,
        confirmLabel: 'Limpar',
        danger: true,
      });
      if (!ok) return;
      store.clearDone();
      toast('Concluídas removidas', { action: undo() });
    },

    /** Tarefa criada por voz: a pessoa não viu o texto, então diz o que foi entendido (e deixa desfazer). */
    addedByVoice(task, { remindLost = false } = {}) {
      app.ui.flashId = task.id;
      const parts = [];
      if (task.date) parts.push(`${dayAndDate(task.date, store.today())}${task.time ? ` às ${task.time}` : ''}`);
      else parts.push('sem data');
      if (task.remind !== null) parts.push(`avisa ${remindLabel(task.remind).toLowerCase()}`);
      else if (remindLost) parts.push('sem lembrete (faltou a hora)');
      toast(`Criada: “${clip(task.title, 40)}” · ${parts.join(' · ')}`, { action: undo(), timeout: 10000 });
    },

    /** Depois de criar uma tarefa: destaca a linha e, se ela não aparece na tela atual, avisa onde foi parar. */
    added(task) {
      app.ui.flashId = task.id;
      if (visibleHere(app, task)) return;
      const href = task.date ? `#/dia/${task.date}` : '#/sem-data';
      toast(`Adicionada em ${when(task.date)}`, { action: { label: 'Ver', onClick: () => app.go(href) } });
    },
  };
  return actions;
}

function visibleHere(app, task) {
  const { route } = app.ui;
  const today = app.store.today();
  switch (route.name) {
    case 'day': {
      const shown = route.date ?? today;
      // a tela de hoje também mostra as atrasadas
      return shown === task.date || (shown === today && !!task.date && task.date < today);
    }
    case 'upcoming': return !!task.date;
    case 'inbox': return !task.date;
    case 'label': return task.labels.includes(route.id);
    case 'priority': return task.priority === route.value;
    case 'month': {
      const g = monthGrid(route.year, route.month, app.store.state.settings.weekStart);
      return !!task.date && task.date >= g[0] && task.date <= g[41];
    }
    default: return false;
  }
}
