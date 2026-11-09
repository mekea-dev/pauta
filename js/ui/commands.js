// Comandos de voz sobre tarefas que JÁ EXISTEM: "já paguei a conta de luz" (concluir), "muda a reunião de sexta para segunda"
// (alterar), "apaga a tarefa do dentista" (excluir). A IA (js/ai.js) diz o que a pessoa quer e como ela chamou a tarefa (`alvo`);
// quem acha a tarefa é este aparelho (js/match.js), então os títulos das tarefas NUNCA saem daqui.
// Segurança: concluir é direto (com "Desfazer"); alterar e excluir pedem confirmação; se mais de uma tarefa combina, a pessoa escolhe;
// se nenhuma combina, o app avisa e não faz nada.
import { formatShort, relativeDay } from '../dates.js';
import { clearWinner, findTasks, soundsDone } from '../match.js';
import { priorityLabel } from '../model.js';
import { describe } from '../recurrence.js';
import { remindLabel } from '../reminders.js';
import { capitalizeTitle, interpretSpoken } from '../voice.js';
import { clip } from './dom.js';
import { choiceDialog, confirmDialog, toast } from './overlay.js';

const CHOOSE_TITLE = { concluir: 'Qual tarefa você concluiu?', alterar: 'Qual tarefa você quer alterar?', excluir: 'Qual tarefa você quer excluir?' };

export function createCommands(app) {
  const { store } = app;
  const today = () => store.today();
  const undo = () => {
    const token = store.lastToken; // chamado DEPOIS da mudança, para pegar o token dela
    return { label: 'Desfazer', onClick: () => store.undo(token) };
  };
  /** "terça, 10 nov" (o dia da semana ajuda a conferir); datas distantes já vêm como "10 nov". */
  const dayText = (date) => {
    if (!date) return 'sem data';
    const rel = relativeDay(date, today());
    return /\d/.test(rel) ? rel : `${rel.toLowerCase()}, ${formatShort(date)}`;
  };
  const quoted = (task, n = 40) => `“${clip(task.title, n)}”`;

  /** Uma tarefa clara fica direto; se há dúvida (ou só uma candidata fraca), pergunta. Devolve a tarefa ou null (desistiu). */
  async function choose(found, acao) {
    const winner = clearWinner(found);
    if (winner) return winner;
    const choices = found.slice(0, 5).map(({ task }) => ({
      label: `${clip(task.title, 48)}${task.date ? ` · ${dayText(task.date)}` : ''}${task.done ? ' (concluída)' : ''}`,
      value: task.id,
    }));
    choices.push({ label: 'Nenhuma', value: null });
    const id = await choiceDialog({ title: CHOOSE_TITLE[acao], message: 'Toque na que você quis dizer.', choices });
    return id ? store.find(id) : null;
  }

  /** `sure`: a frase diz que a pessoa JÁ fez ("já paguei"). Sem esse sinal a IA pode ter errado (era algo a fazer), então pergunta antes. */
  async function complete(task, sure) {
    if (task.done) return { done: false, message: `${quoted(task)} já estava concluída.` };
    if (!sure) {
      const ok = await confirmDialog({ title: 'Concluir esta tarefa?', message: `${quoted(task, 80)}. Dá para desfazer logo em seguida.`, confirmLabel: 'Concluir' });
      if (!ok) return { done: false };
    }
    const r = store.toggleDone(task.id);
    app.ui.flashId = task.id;
    toast(r?.spawned ? `Concluída: ${quoted(task)} · próxima: ${dayText(r.spawned.date)}` : `Concluída: ${quoted(task)}`, { action: undo(), timeout: 10000 });
    return { done: true };
  }

  async function remove(task) {
    const ok = await confirmDialog({
      title: 'Excluir esta tarefa?',
      message: `${quoted(task, 80)}. Dá para desfazer logo em seguida.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return { done: false };
    app.actions.remove(task.id);
    return { done: true };
  }

  /** O que mudar, a partir da linha que a IA devolveu (só o que muda): { patch, parts } com `parts` para mostrar na confirmação. */
  function changesFrom(line, task) {
    const p = interpretSpoken(line, { today: today(), now: new Date(), weekStart: store.state.settings.weekStart });
    const patch = {};
    const parts = [];
    if (p.title && !p.issues.some((i) => i.code === 'vague-title' || i.code === 'no-title')) {
      patch.title = capitalizeTitle(p.title);
      parts.push(`novo título ${quoted(patch)}`);
    }
    if (p.date) { patch.date = p.date; parts.push(`dia ${dayText(p.date)}`); }
    if (p.time) { patch.time = p.time; parts.push(`hora ${p.time}`); }
    if (p.remind !== null && p.remind !== undefined) { patch.remind = p.remind; parts.push(`lembrete ${remindLabel(p.remind).toLowerCase()}`); }
    if (p.priority) { patch.priority = p.priority; parts.push(`prioridade ${priorityLabel(p.priority).toLowerCase()}`); }
    if (p.recurrence) { patch.recurrence = p.recurrence; parts.push(`repete ${describe(p.recurrence, p.date ?? task.date).toLowerCase()}`); }
    if (p.labels.length) {
      const ids = store.ensureLabels(p.labels);
      patch.labels = [...new Set([...(task.labels ?? []), ...ids])];
      parts.push(`etiqueta ${p.labels.map((n) => `#${n}`).join(' ')}`);
    }
    return { patch, parts };
  }

  async function change(task, line) {
    const { patch, parts } = changesFrom(line, task);
    if (!parts.length) return { done: false, message: `Não entendi o que mudar em ${quoted(task)}.` };
    const ok = await confirmDialog({
      title: `Alterar ${quoted(task)}?`,
      message: `${parts.join(', ')}. Dá para desfazer logo em seguida.`.replace(/^./, (c) => c.toUpperCase()),
      confirmLabel: 'Alterar',
    });
    if (!ok) return { done: false };
    if (!store.updateTask(task.id, patch)) return { done: false, message: 'Não consegui alterar essa tarefa.' };
    app.ui.flashId = task.id;
    toast(`Alterada: ${quoted(task)} · ${parts.join(', ')}`, { action: undo(), timeout: 10000 });
    return { done: true };
  }

  return {
    /**
     * Executa o pedido da pessoa sobre uma tarefa que já existe.
     * @param {{acao: 'concluir'|'alterar'|'excluir', alvo: string, line?: string}} cmd  (de `interpretAiReply`)
     * @param {string} [heard]  o que a pessoa falou (para saber se concluir pode ir direto)
     * @returns {Promise<{done: boolean, message?: string}>}  `done`: algo foi feito; `message`: o que dizer à pessoa quando não
     */
    async run(cmd, heard = '') {
      const found = findTasks(store.state.tasks, cmd.alvo, { today: today(), include: cmd.acao === 'concluir' ? 'open' : 'all' });
      if (!found.length) return { done: false, message: `Não achei uma tarefa parecida com “${clip(cmd.alvo, 40)}”.` };
      const task = await choose(found, cmd.acao);
      if (!task) return { done: false };
      if (cmd.acao === 'concluir') return complete(task, soundsDone(heard));
      if (cmd.acao === 'excluir') return remove(task);
      return change(task, cmd.line ?? '');
    },
  };
}
