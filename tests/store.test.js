import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings } from '../js/model.js';
import { createStore } from '../js/store.js';

// relógio fixo: sexta-feira, 6/11/2026, 10:00 (horário local)
function make() {
  let now = new Date(2026, 10, 6, 10, 0, 0);
  const store = createStore({ version: 1, tasks: [], labels: [], settings: defaultSettings() }, { clock: () => now });
  return { store, setNow: (d) => { now = d; } };
}
const DAILY = { freq: 'day', interval: 1 };

test('addTask recusa título vazio e guarda o resto normalizado', () => {
  const { store } = make();
  assert.equal(store.addTask({ title: '   ' }), null);
  const t = store.addTask({ title: ' Pagar luz ', date: '2026-11-07', priority: 3 });
  assert.equal(t.title, 'Pagar luz');
  assert.equal(store.state.tasks.length, 1);
  assert.equal(t.createdAt, new Date(2026, 10, 6, 10, 0, 0).toISOString());
});

test('concluir tarefa que repete cria a próxima; desfazer volta ao estado anterior', () => {
  const { store } = make();
  const t = store.addTask({ title: 'Revisar e-mails', date: '2026-11-06', time: '09:00', recurrence: DAILY, checklist: [{ text: 'caixa de entrada', done: true }] });
  const r = store.toggleDone(t.id);
  assert.equal(r.done, true);
  assert.equal(store.state.tasks.length, 2);
  const next = store.state.tasks.find((x) => !x.done);
  assert.equal(next.date, '2026-11-07');
  assert.equal(next.time, '09:00');
  assert.equal(next.checklist[0].done, false); // o checklist volta desmarcado
  assert.equal(store.find(t.id).nextId, next.id);
  assert.ok(store.find(t.id).doneAt);
  assert.ok(store.undo(store.lastToken));
  assert.equal(store.state.tasks.length, 1);
  assert.equal(store.find(t.id).done, false);
});

test('reabrir uma tarefa concluída remove a próxima ocorrência que ainda está aberta', () => {
  const { store } = make();
  const t = store.addTask({ title: 'Regar plantas', date: '2026-11-06', recurrence: DAILY });
  store.toggleDone(t.id);
  assert.equal(store.state.tasks.length, 2);
  store.toggleDone(t.id);
  assert.equal(store.state.tasks.length, 1);
  assert.equal(store.find(t.id).done, false);
  assert.equal(store.find(t.id).doneAt, null);
});

test('recorrente atrasada, ao concluir, gera a próxima depois de hoje', () => {
  const { store } = make();
  const t = store.addTask({ title: 'Backup', date: '2026-11-01', recurrence: DAILY });
  store.toggleDone(t.id);
  assert.equal(store.state.tasks.find((x) => !x.done).date, '2026-11-07');
});

test('tarefa comum: concluir e reabrir', () => {
  const { store } = make();
  const t = store.addTask({ title: 'Enviar relatório' });
  assert.equal(store.toggleDone(t.id).spawned, null);
  assert.equal(store.find(t.id).done, true);
  store.toggleDone(t.id);
  assert.equal(store.find(t.id).done, false);
});

test('pular esta vez avança a data sem concluir', () => {
  const { store } = make();
  const t = store.addTask({ title: 'Academia', date: '2026-11-06', recurrence: { freq: 'week', interval: 1, days: [1, 3, 5] } });
  store.skipOccurrence(t.id);
  assert.equal(store.find(t.id).date, '2026-11-09');
  assert.equal(store.find(t.id).done, false);
  const simples = store.addTask({ title: 'Sem repetição', date: '2026-11-06' });
  assert.equal(store.skipOccurrence(simples.id), null);
});

test('updateTask: título em branco mantém o anterior', () => {
  const { store } = make();
  const t = store.addTask({ title: 'Original' });
  store.updateTask(t.id, { title: '   ', priority: 4 });
  assert.equal(store.find(t.id).title, 'Original');
  assert.equal(store.find(t.id).priority, 4);
});

test('updateTask: tirar a data tira também hora e repetição; repetir sem data usa hoje', () => {
  const { store } = make();
  const t = store.addTask({ title: 'Reunião', date: '2026-11-10', time: '14:00', recurrence: { freq: 'week', interval: 1 } });
  assert.deepEqual(store.find(t.id).recurrence, { freq: 'week', interval: 1, days: [2] }); // completou o dia da semana
  store.updateTask(t.id, { date: null });
  const sem = store.find(t.id);
  assert.equal(sem.time, null);
  assert.equal(sem.recurrence, null);
  store.updateTask(t.id, { recurrence: DAILY });
  assert.equal(store.find(t.id).date, '2026-11-06');
  assert.deepEqual(store.find(t.id).recurrence, DAILY);
});

test('checklist: marcar item e itens em branco durante a digitação', () => {
  const { store } = make();
  const t = store.addTask({ title: 'Mudança', checklist: [{ text: 'Caixas' }, { text: 'Fita' }] });
  const [a] = store.find(t.id).checklist;
  store.toggleCheckItem(t.id, a.id);
  assert.equal(store.find(t.id).checklist[0].done, true);
  store.updateTask(t.id, { checklist: [...store.find(t.id).checklist, { id: 'novo', text: '' }] });
  assert.equal(store.find(t.id).checklist.length, 3); // linha em branco é mantida enquanto edita
});

test('duplicar copia a tarefa com o checklist desmarcado', () => {
  const { store } = make();
  const t = store.addTask({ title: 'Modelo', checklist: [{ text: 'a', done: true }] });
  const c = store.duplicateTask(t.id);
  assert.notEqual(c.id, t.id);
  assert.equal(c.title, 'Modelo');
  assert.equal(c.checklist[0].done, false);
  assert.notEqual(c.checklist[0].id, store.find(t.id).checklist[0].id);
});

test('etiquetas: criar por nome sem duplicar, renomear e excluir tirando das tarefas', () => {
  const { store } = make();
  const [a] = store.ensureLabels(['Finanças']);
  assert.deepEqual(store.ensureLabels(['financas', 'FINANÇAS']), [a]);
  assert.equal(store.state.labels.length, 1);
  const t = store.addTask({ title: 'Pagar', labels: [a] });
  assert.equal(store.addLabel('Finanças').ok, false);
  assert.equal(store.updateLabel(a, { name: '   ' }).ok, false);
  assert.equal(store.updateLabel(a, { name: 'Contas', color: 'red' }).ok, true);
  const l = store.state.labels[0];
  assert.deepEqual([l.id, l.name, l.color], [a, 'Contas', 'red']);
  assert.ok(l.updatedAt);
  store.deleteLabel(a);
  assert.deepEqual(store.find(t.id).labels, []);
  assert.equal(store.state.labels.length, 0);
});

test('etiqueta que não existe mais é ignorada ao salvar a tarefa', () => {
  const { store } = make();
  const [a] = store.ensureLabels(['Casa']);
  const t = store.addTask({ title: 'X', labels: [a] });
  store.updateTask(t.id, { labels: [a, 'fantasma'] });
  assert.deepEqual(store.find(t.id).labels, [a]);
});

test('reagendar atrasadas move só as abertas e atrasadas', () => {
  const { store } = make();
  const velha = store.addTask({ title: 'Velha', date: '2026-11-01', time: '08:00' });
  const hoje = store.addTask({ title: 'Hoje', date: '2026-11-06' });
  const feita = store.addTask({ title: 'Feita', date: '2026-11-02' });
  store.toggleDone(feita.id);
  assert.equal(store.rescheduleOverdue('2026-11-06'), 1);
  assert.equal(store.find(velha.id).date, '2026-11-06');
  assert.equal(store.find(velha.id).time, '08:00');
  assert.equal(store.find(feita.id).date, '2026-11-02');
  assert.equal(store.find(hoje.id).date, '2026-11-06');
});

test('limpar concluídas', () => {
  const { store } = make();
  const a = store.addTask({ title: 'A' });
  store.addTask({ title: 'B' });
  store.toggleDone(a.id);
  assert.equal(store.clearDone(), 1);
  assert.equal(store.state.tasks.length, 1);
});

test('desfazer só vale para a última ação (token) e refazer volta', () => {
  const { store } = make();
  const t = store.addTask({ title: 'Primeira' });
  const tokenExcluir = (store.deleteTask(t.id), store.lastToken);
  store.addTask({ title: 'Segunda' });
  assert.equal(store.undo(tokenExcluir), false); // já houve outra ação depois
  assert.equal(store.state.tasks.length, 1);
  assert.ok(store.undo(store.lastToken)); // desfaz "Segunda"
  assert.ok(store.undo()); // desfaz a exclusão
  assert.equal(store.find(t.id).title, 'Primeira');
  assert.ok(store.redo());
  assert.equal(store.find(t.id), undefined);
});

test('edições "ao vivo" (undoable: false) não entram no histórico', () => {
  const { store } = make();
  const t = store.addTask({ title: 'Texto' });
  const antes = store.lastToken;
  store.updateTask(t.id, { notes: 'a' }, { undoable: false });
  store.updateTask(t.id, { notes: 'ab' }, { undoable: false });
  assert.equal(store.lastToken, antes);
  assert.ok(store.undo()); // desfaz a criação, não as anotações
  assert.equal(store.state.tasks.length, 0);
});

test('excluir deixa uma lápide; desfazer a remove e dá updatedAt novo (para vencer a lápide já enviada)', () => {
  const { store, setNow } = make();
  const t = store.addTask({ title: 'Tarefa' });
  setNow(new Date(2026, 10, 6, 11, 0, 0));
  store.deleteTask(t.id);
  const lapide = store.state.deleted[t.id];
  assert.ok(lapide);
  setNow(new Date(2026, 10, 6, 12, 0, 0));
  assert.ok(store.undo());
  assert.equal(store.state.deleted[t.id], undefined);
  assert.ok(store.find(t.id).updatedAt > lapide);
});

test('limpar concluídas, reabrir recorrente e apagar etiqueta também deixam lápide', () => {
  const { store } = make();
  const a = store.addTask({ title: 'A' });
  store.toggleDone(a.id);
  store.clearDone();
  assert.ok(store.state.deleted[a.id]);
  const r = store.addTask({ title: 'R', date: '2026-11-06', recurrence: DAILY });
  store.toggleDone(r.id);
  const proxima = store.state.tasks.find((x) => x.title === 'R' && !x.done);
  store.toggleDone(r.id); // reabre: a próxima ocorrência some
  assert.ok(store.state.deleted[proxima.id]);
  const [l] = store.ensureLabels(['X']);
  store.deleteLabel(l);
  assert.ok(store.state.deleted[l]);
});

test('desfazer uma edição dá updatedAt novo à tarefa (a sincronização não pode desfazer o desfazer)', () => {
  const { store, setNow } = make();
  const t = store.addTask({ title: 'Original' });
  setNow(new Date(2026, 10, 6, 11, 0, 0));
  store.toggleDone(t.id);
  const concluidaEm = store.find(t.id).updatedAt;
  setNow(new Date(2026, 10, 6, 12, 0, 0));
  assert.ok(store.undo());
  assert.equal(store.find(t.id).done, false);
  assert.ok(store.find(t.id).updatedAt > concluidaEm);
});

test('mexer nas tarefas de boas-vindas tira a marca "seed"; mudar configuração não', () => {
  const store = createStore({ version: 1, tasks: [], labels: [], settings: defaultSettings(), seed: true });
  store.setSettings({ theme: 'dark' });
  assert.equal(store.state.seed, true);
  store.addTask({ title: 'Minha' });
  assert.equal(store.state.seed, false);
});

test('applyRemote troca os dados, zera o desfazer e não conta como mudança local', () => {
  const { store } = make();
  const t = store.addTask({ title: 'Local' });
  const rev = store.rev;
  const eventos = [];
  store.subscribe((s, meta) => eventos.push(meta));
  store.applyRemote({ tasks: [{ ...t, title: 'Do outro aparelho' }], labels: [], deleted: { x: '2026-11-01T00:00:00.000Z' } });
  assert.equal(store.find(t.id).title, 'Do outro aparelho');
  assert.equal(store.canUndo, false);
  assert.equal(store.rev, rev);
  assert.deepEqual(eventos, [{ external: false, remote: true }]);
});

test('dono dos dados: setOwner e resetForAccount (trocar de conta não é "excluir")', () => {
  const { store } = make();
  store.addTask({ title: 'A' });
  store.setOwner('uid-1');
  assert.equal(store.state.owner, 'uid-1');
  store.resetForAccount('uid-2');
  assert.equal(store.state.owner, 'uid-2');
  assert.equal(store.state.tasks.length, 0);
  assert.deepEqual(store.state.deleted, {});
});

test('importar por cima de algo excluído antes: a tarefa volta com updatedAt mais novo que a lápide', () => {
  const { store, setNow } = make();
  const t = store.addTask({ title: 'Volta' });
  setNow(new Date(2026, 10, 6, 11, 0, 0));
  store.deleteTask(t.id);
  const lapide = store.state.deleted[t.id];
  setNow(new Date(2026, 10, 6, 12, 0, 0));
  store.replaceAll({ tasks: [t], labels: [] });
  assert.equal(store.state.deleted[t.id], undefined);
  assert.ok(store.find(t.id).updatedAt > lapide);
});

test('estado vindo de outra aba entra sem histórico e avisa que é externo', () => {
  const { store } = make();
  store.addTask({ title: 'Local' });
  const metas = [];
  store.subscribe((state, meta) => metas.push(meta));
  store.loadExternal({ version: 1, tasks: [], labels: [], settings: defaultSettings() });
  assert.deepEqual(metas, [{ external: true }]);
  assert.equal(store.canUndo, false);
  store.setSettings({ theme: 'dark', weekStart: 0 });
  assert.equal(store.state.settings.theme, 'dark');
  assert.equal(store.state.settings.weekStart, 0);
});
