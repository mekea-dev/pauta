// Estado da aplicação: tarefas, etiquetas e configurações, com desfazer.
// Guarda também as "lápides" de exclusão e o dono (conta) dos dados, que a sincronização entre
// aparelhos usa. Não sabe nada de tela, de armazenamento (persist.js) nem de rede (cloud/).
import { todayISO } from './dates.js';
import { nextAfter } from './recurrence.js';
import { AUTO_COLORS, LABEL_COLORS, LIMITS, createTask, mergePatch, sanitizeSettings, sanitizeTask, uid } from './model.js';
import { cleanLine, fold } from './text.js';

export function createStore(initial, { clock = () => new Date(), maxUndo = 50 } = {}) {
  let state = { deleted: {}, owner: null, seed: false, ...initial };
  let past = [];
  let future = [];
  let seq = 0;
  let lastToken = 0;
  let rev = 0; // sobe a cada mudança em tarefas/etiquetas feita aqui (a sincronização usa para saber se há o que enviar)
  const listeners = new Set();
  const today = () => todayISO(clock());
  const stamp = () => clock().toISOString();
  const find = (id) => state.tasks.find((t) => t.id === id);
  const labelIds = () => new Set(state.labels.map((l) => l.id));

  function emit(meta) {
    for (const fn of [...listeners]) fn(state, meta);
  }

  /**
   * Compara o estado anterior com o novo: o que sumiu ganha uma lápide (para a exclusão chegar aos outros
   * aparelhos) e o que voltou (desfazer) perde a lápide.
   */
  function trackDeletions(prev, next, force) {
    const lengthChanged = prev.tasks.length !== next.tasks.length || prev.labels.length !== next.labels.length;
    if (!lengthChanged && !force) return next;
    const ids = new Set();
    for (const t of next.tasks) ids.add(t.id);
    for (const l of next.labels) ids.add(l.id);
    const now = stamp();
    let deleted = next.deleted;
    const write = () => { if (deleted === next.deleted) deleted = { ...deleted }; };
    for (const t of prev.tasks) if (!ids.has(t.id)) { write(); deleted[t.id] = now; }
    for (const l of prev.labels) if (!ids.has(l.id)) { write(); deleted[l.id] = now; }
    for (const id of Object.keys(deleted)) if (ids.has(id)) { write(); delete deleted[id]; }
    return deleted === next.deleted ? next : { ...next, deleted };
  }

  /** Aplica uma mudança. `undoable: false` para edições "ao vivo" (digitação) e configurações. */
  function commit(patch, { undoable = true, external = false, diff = false } = {}) {
    if (undoable) {
      past.push({ token: ++seq, tasks: state.tasks, labels: state.labels });
      if (past.length > maxUndo) past.shift();
      future = [];
      lastToken = seq;
    }
    let next = { ...state, ...patch };
    if ('tasks' in patch || 'labels' in patch) {
      next = trackDeletions(state, next, diff);
      if (!external) next.seed = false; // mexeu: já não são só as tarefas de boas-vindas
      rev += 1;
    }
    state = next;
    emit({ external });
    return lastToken;
  }

  // ---------- tarefas ----------

  function addTask(partial = {}, opts) {
    const task = createTask(partial, stamp());
    if (!task.title) return null;
    commit({ tasks: [...state.tasks, task] }, opts);
    return task;
  }

  function updateTask(id, patch, opts) {
    const cur = find(id);
    if (!cur) return null;
    const merged = mergePatch(cur, patch, today());
    const o = { now: cur.createdAt, labelIds: labelIds(), keepEmptyItems: true };
    // título em branco (a pessoa apagou para digitar outro): mantém o anterior
    const clean = sanitizeTask(merged, o) ?? sanitizeTask({ ...merged, title: cur.title }, o);
    if (!clean) return null;
    const next = { ...clean, id: cur.id, createdAt: cur.createdAt, done: cur.done, doneAt: cur.doneAt, nextId: cur.nextId, updatedAt: stamp() };
    commit({ tasks: state.tasks.map((t) => (t.id === id ? next : t)) }, opts);
    return next;
  }

  function deleteTask(id, opts) {
    const cur = find(id);
    if (!cur) return null;
    commit({ tasks: state.tasks.filter((t) => t.id !== id) }, opts);
    return cur;
  }

  /** Conclui/reabre. Tarefa que repete gera a próxima ocorrência ao ser concluída. */
  function toggleDone(id) {
    const cur = find(id);
    if (!cur) return null;
    const now = stamp();
    if (!cur.done) {
      let spawned = null;
      if (cur.recurrence) {
        const date = nextAfter(cur.recurrence, cur.date ?? today(), today());
        spawned = createTask({
          title: cur.title, notes: cur.notes, date, time: cur.time, remind: cur.remind, alarm: cur.alarm, priority: cur.priority, labels: cur.labels, recurrence: cur.recurrence,
          checklist: cur.checklist.map((c) => ({ id: uid(), text: c.text, done: false })),
        }, now);
      }
      const tasks = state.tasks.map((t) => (t.id === id ? { ...t, done: true, doneAt: now, nextId: spawned?.id ?? null, updatedAt: now } : t));
      commit({ tasks: spawned ? [...tasks, spawned] : tasks });
      return { done: true, spawned };
    }
    // reabrir: se a próxima ocorrência gerada ainda está em aberto, ela some
    const dropId = cur.nextId && find(cur.nextId) && !find(cur.nextId).done ? cur.nextId : null;
    const tasks = state.tasks
      .filter((t) => t.id !== dropId)
      .map((t) => (t.id === id ? { ...t, done: false, doneAt: null, nextId: null, updatedAt: now } : t));
    commit({ tasks });
    return { done: false, spawned: null };
  }

  /** "Pular esta vez": avança uma tarefa que repete para a próxima data, sem registrar como concluída. */
  function skipOccurrence(id) {
    const cur = find(id);
    if (!cur?.recurrence || !cur.date || cur.done) return null;
    return updateTask(id, { date: nextAfter(cur.recurrence, cur.date, today()) });
  }

  function duplicateTask(id) {
    const cur = find(id);
    if (!cur) return null;
    return addTask({ ...cur, checklist: cur.checklist.map((c) => ({ id: uid(), text: c.text, done: false })) });
  }

  function toggleCheckItem(taskId, itemId, opts) {
    const cur = find(taskId);
    if (!cur) return null;
    return updateTask(taskId, { checklist: cur.checklist.map((c) => (c.id === itemId ? { ...c, done: !c.done } : c)) }, opts);
  }

  /** Move todas as tarefas atrasadas (abertas, com data anterior a hoje) para `toDate`. */
  function rescheduleOverdue(toDate) {
    const td = today();
    const now = stamp();
    let n = 0;
    const tasks = state.tasks.map((t) => {
      if (t.done || !t.date || t.date >= td) return t;
      n++;
      return { ...t, date: toDate, updatedAt: now };
    });
    if (n) commit({ tasks });
    return n;
  }

  function clearDone() {
    const n = state.tasks.filter((t) => t.done).length;
    if (n) commit({ tasks: state.tasks.filter((t) => !t.done) });
    return n;
  }

  // ---------- etiquetas ----------

  const nextColor = () => AUTO_COLORS[state.labels.length % AUTO_COLORS.length];

  /** Devolve os ids das etiquetas com esses nomes, criando as que não existem. */
  function ensureLabels(names) {
    const ids = [];
    let labels = state.labels;
    let changed = false;
    for (const raw of names) {
      const name = cleanLine(raw, LIMITS.labelName);
      if (!name) continue;
      let l = labels.find((x) => fold(x.name) === fold(name));
      if (!l) {
        l = { id: uid(), name, color: AUTO_COLORS[labels.length % AUTO_COLORS.length], updatedAt: stamp() };
        labels = [...labels, l];
        changed = true;
      }
      if (!ids.includes(l.id)) ids.push(l.id);
    }
    if (changed) commit({ labels }, { undoable: false });
    return ids;
  }

  function addLabel(name, color) {
    const clean = cleanLine(name, LIMITS.labelName);
    if (!clean) return { ok: false, error: 'Digite um nome para a etiqueta.' };
    if (state.labels.some((l) => fold(l.name) === fold(clean))) return { ok: false, error: 'Já existe uma etiqueta com esse nome.' };
    const label = { id: uid(), name: clean, color: LABEL_COLORS.includes(color) ? color : nextColor(), updatedAt: stamp() };
    commit({ labels: [...state.labels, label] }, { undoable: false });
    return { ok: true, label };
  }

  function updateLabel(id, patch) {
    const cur = state.labels.find((l) => l.id === id);
    if (!cur) return { ok: false, error: 'Etiqueta não encontrada.' };
    const name = patch.name !== undefined ? cleanLine(patch.name, LIMITS.labelName) : cur.name;
    if (!name) return { ok: false, error: 'O nome não pode ficar vazio.' };
    if (state.labels.some((l) => l.id !== id && fold(l.name) === fold(name))) return { ok: false, error: 'Já existe uma etiqueta com esse nome.' };
    const color = LABEL_COLORS.includes(patch.color) ? patch.color : cur.color;
    commit({ labels: state.labels.map((l) => (l.id === id ? { ...l, name, color, updatedAt: stamp() } : l)) }, { undoable: false });
    return { ok: true };
  }

  function deleteLabel(id) {
    if (!state.labels.some((l) => l.id === id)) return false;
    const now = stamp();
    commit({
      labels: state.labels.filter((l) => l.id !== id),
      tasks: state.tasks.map((t) => (t.labels.includes(id) ? { ...t, labels: t.labels.filter((x) => x !== id), updatedAt: now } : t)),
    });
    return true;
  }

  // ---------- configurações e dados ----------

  function setSettings(patch) {
    commit({ settings: sanitizeSettings({ ...state.settings, ...patch }) }, { undoable: false });
  }

  /** Troca tarefas e etiquetas (importação, "apagar tudo"). Mantém as configurações deste aparelho. */
  function replaceAll(next, { withSettings = false } = {}) {
    const now = stamp();
    // o que foi excluído antes e volta agora precisa parecer "mais novo" que a lápide, senão a sincronização apaga de novo
    const tasks = next.tasks.map((t) => (state.deleted[t.id] ? { ...t, updatedAt: now } : t));
    const labels = next.labels.map((l) => (state.deleted[l.id] ? { ...l, updatedAt: now } : l));
    commit({ tasks, labels, ...(withSettings ? { settings: next.settings } : {}) }, { diff: true });
  }

  /** Estado vindo de outra aba: entra sem histórico e sem ser salvo de novo. */
  function loadExternal(next) {
    past = [];
    future = [];
    state = { deleted: {}, owner: null, seed: false, ...next };
    rev += 1;
    emit({ external: true });
  }

  /** Recomeça do zero (ex.: dados de exemplo). */
  function reset(next) {
    past = [];
    future = [];
    state = { deleted: {}, owner: null, seed: false, ...next };
    rev += 1;
    emit({ external: false });
  }

  // ---------- conta na nuvem ----------

  /** Aplica o resultado de uma sincronização. O desfazer é zerado: não pode voltar atrás de mudanças de outro aparelho. */
  function applyRemote(snap) {
    past = [];
    future = [];
    state = { ...state, tasks: snap.tasks, labels: snap.labels, deleted: snap.deleted, seed: false };
    emit({ external: false, remote: true });
  }

  /** Define de qual conta são os dados deste aparelho (null = só do aparelho). */
  function setOwner(owner) {
    state = { ...state, owner };
    emit({ external: false });
  }

  /** Esvazia as tarefas deste aparelho e passa a pertencer a `owner` (sem lápides: nada foi "excluído" de verdade). */
  function resetForAccount(owner) {
    past = [];
    future = [];
    state = { ...state, tasks: [], labels: [], deleted: {}, owner, seed: false };
    rev += 1;
    emit({ external: false });
  }

  // ---------- desfazer ----------

  /** Volta para um retrato. O que mudou ganha updatedAt novo, senão a sincronização "desfaria o desfazer". */
  function restore(snap) {
    const now = stamp();
    const curTasks = new Map(state.tasks.map((t) => [t.id, t]));
    const curLabels = new Map(state.labels.map((l) => [l.id, l]));
    const tasks = snap.tasks.map((t) => (curTasks.get(t.id) === t ? t : { ...t, updatedAt: now }));
    const labels = snap.labels.map((l) => (curLabels.get(l.id) === l ? l : { ...l, updatedAt: now }));
    state = { ...trackDeletions(state, { ...state, tasks, labels }, true), seed: false };
    rev += 1;
    emit({ external: false });
  }

  function undo(expectedToken) {
    const top = past.at(-1);
    if (!top || (expectedToken !== undefined && top.token !== expectedToken)) return false;
    past.pop();
    future.push({ tasks: state.tasks, labels: state.labels });
    restore(top);
    return true;
  }

  function redo() {
    const top = future.pop();
    if (!top) return false;
    past.push({ token: ++seq, tasks: state.tasks, labels: state.labels });
    restore(top);
    return true;
  }

  return {
    get state() { return state; },
    get lastToken() { return lastToken; },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
    get rev() { return rev; },
    today,
    find,
    snapshot: () => ({ tasks: state.tasks, labels: state.labels, deleted: state.deleted }),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    addTask, updateTask, deleteTask, toggleDone, skipOccurrence, duplicateTask, toggleCheckItem, rescheduleOverdue, clearDone,
    ensureLabels, addLabel, updateLabel, deleteLabel,
    setSettings, replaceAll, loadExternal, reset,
    applyRemote, setOwner, resetForAccount,
    undo, redo,
  };
}
