import test from 'node:test';
import assert from 'node:assert/strict';
import { createTask } from '../js/model.js';
import { checklistProgress, compareDay, counts, dayCounts, dayView, doneGroups, ghosts, groupByDate, inbox, overdueGroups, search } from '../js/query.js';

const T = '2026-11-06'; // sexta-feira
let n = 0;
// cria tarefas com criação crescente (para a ordem ser previsível)
const mk = (p = {}) => {
  n++;
  const t = createTask({ title: p.title ?? `T${n}`, ...p }, `2026-11-01T10:${String(n % 60).padStart(2, '0')}:00.000Z`);
  const doneAt = p.doneAt ?? new Date(2026, 10, 6, 9, 0).toISOString();
  return { ...t, id: p.id ?? `id${n}`, ...(p.done ? { done: true, doneAt } : {}) };
};
const ids = (list) => list.map((t) => t.id);

test('ordem do dia: com horário primeiro, depois prioridade, depois criação', () => {
  const A = mk({ id: 'A', date: T, time: '14:00' });
  const B = mk({ id: 'B', date: T, time: '09:00' });
  const C = mk({ id: 'C', date: T, priority: 4 });
  const D = mk({ id: 'D', date: T, priority: 1 });
  const E = mk({ id: 'E', date: T, priority: 4 });
  assert.deepEqual(ids([A, B, C, D, E].sort(compareDay)), ['B', 'A', 'C', 'E', 'D']);
});

test('tela do dia: atrasadas só aparecem em "hoje"; concluídas hoje entram em "hoje"', () => {
  const tasks = [
    mk({ id: 'od', date: '2026-11-03' }),
    mk({ id: 'td', date: T }),
    mk({ id: 'dt', date: T, done: true }),
    mk({ id: 'dl', date: '2026-11-04', done: true }), // concluída hoje, mas era do dia 4
    mk({ id: 'do', date: '2026-11-04', done: true, doneAt: new Date(2026, 10, 4, 9, 0).toISOString() }),
    mk({ id: 'tm', date: '2026-11-07' }),
  ];
  const v = dayView(tasks, T, T);
  assert.deepEqual(ids(v.overdue), ['od']);
  assert.deepEqual(ids(v.open), ['td']);
  assert.deepEqual(ids(v.done).sort(), ['dl', 'dt']);
  const amanha = dayView(tasks, '2026-11-07', T);
  assert.deepEqual(amanha.overdue, []);
  assert.deepEqual(ids(amanha.open), ['tm']);
  assert.deepEqual(ids(dayView(tasks, '2026-11-04', T).done).sort(), ['dl', 'do']);
});

test('agrupar por dia: atrasadas, dias em ordem, depois e sem data', () => {
  const tasks = [mk({ date: '2026-11-02' }), mk({ date: '2026-11-07' }), mk({ date: T }), mk({ date: '2026-11-12' }), mk({}), mk({ done: true, date: T })];
  const g = groupByDate(tasks, T, { horizon: 3 });
  assert.deepEqual(g.map((x) => x.key), ['overdue', '2026-11-06', '2026-11-07', 'later', 'nodate']);
  assert.equal(g[1].title, 'Hoje');
  assert.equal(g[2].title, 'Amanhã');
  const g2 = groupByDate(tasks, T, { undated: false });
  assert.deepEqual(g2.map((x) => x.key), ['overdue', '2026-11-06', '2026-11-07', '2026-11-12']);
});

test('repetições futuras aparecem como "fantasmas" (e só depois de hoje)', () => {
  const diaria = mk({ id: 'd', date: T, recurrence: { freq: 'day', interval: 1 } });
  const segunda = mk({ id: 's', date: '2026-11-09', recurrence: { freq: 'week', interval: 1, days: [1] } });
  const g = ghosts([diaria, segunda], '2026-11-06', '2026-11-09', T);
  assert.deepEqual(g.map((x) => `${x.id}@${x.date}`), ['d@2026-11-07', 'd@2026-11-08', 'd@2026-11-09']);
  assert.ok(g.every((x) => x.ghost === true && x.ghostOf === 'd'));
  assert.deepEqual(ghosts([segunda], '2026-11-07', '2026-11-30', T).map((x) => x.date), ['2026-11-16', '2026-11-23', '2026-11-30']);
  assert.deepEqual(ghosts([diaria], '2026-10-01', '2026-11-06', T), []); // passado e hoje: nada
  assert.deepEqual(ghosts([{ ...diaria, done: true }], '2026-11-07', '2026-11-09', T), []);
});

test('contagem por dia soma tarefas reais e repetições futuras', () => {
  const tasks = [mk({ date: '2026-11-07', priority: 3 }), mk({ date: '2026-11-07' }), mk({ date: T, recurrence: { freq: 'day', interval: 1 } })];
  const m = dayCounts(tasks, ['2026-11-06', '2026-11-07', '2026-11-08'], T);
  assert.deepEqual(m.get('2026-11-06'), { open: 1, top: 0 });
  assert.deepEqual(m.get('2026-11-07'), { open: 3, top: 3 }); // 2 reais + 1 repetição
  assert.deepEqual(m.get('2026-11-08'), { open: 1, top: 0 });
});

test('busca ignora acento e maiúsculas, exige todas as palavras e olha anotações, etiquetas e checklist', () => {
  const labels = [{ id: 'L', name: 'Finanças', color: 'green' }];
  const tasks = [
    mk({ id: 'a', title: 'Reunião com o Fornecedor', date: T }),
    mk({ id: 'b', title: 'Pagar luz', labels: ['L'] }),
    mk({ id: 'c', title: 'Viagem', notes: 'reservar hotel perto do centro' }),
    mk({ id: 'd', title: 'Mudança', checklist: [{ text: 'Embalar louças' }] }),
    mk({ id: 'e', title: 'Reunião antiga', done: true }),
  ];
  assert.deepEqual(ids(search(tasks, labels, 'reuniao fornecedor')), ['a']);
  assert.deepEqual(ids(search(tasks, labels, 'FINANCAS')), ['b']);
  assert.deepEqual(ids(search(tasks, labels, 'hotel centro')), ['c']);
  assert.deepEqual(ids(search(tasks, labels, 'loucas')), ['d']);
  assert.deepEqual(ids(search(tasks, labels, 'reuniao')), ['a', 'e']); // abertas primeiro
  assert.deepEqual(search(tasks, labels, '   '), []);
});

test('pendentes: só abertas de dias anteriores, agrupadas pelo dia original (mais recente primeiro)', () => {
  const tasks = [
    mk({ id: 'a', date: '2026-11-02' }),
    mk({ id: 'b', date: '2026-11-05', time: '10:00' }),
    mk({ id: 'c', date: '2026-11-05' }),
    mk({ id: 'd', date: T }), // hoje não é pendente
    mk({ id: 'e', date: '2026-11-03', done: true }), // concluída não é pendente
    mk({ id: 'f' }), // sem data não é pendente
  ];
  const g = overdueGroups(tasks, T);
  assert.deepEqual(g.map((x) => x.key), ['2026-11-05', '2026-11-02']);
  assert.equal(g[0].title, 'Ontem');
  assert.deepEqual(ids(g[0].tasks), ['b', 'c']); // com horário primeiro
  assert.deepEqual(overdueGroups([], T), []);
});

test('concluídas agrupadas pelo dia em que foram concluídas', () => {
  const tasks = [
    mk({ id: 'x', done: true, doneAt: new Date(2026, 10, 6, 9, 0).toISOString() }),
    mk({ id: 'y', done: true, doneAt: new Date(2026, 10, 5, 18, 0).toISOString() }),
    mk({ id: 'z', done: true, doneAt: new Date(2026, 10, 6, 11, 0).toISOString() }),
    mk({ id: 'aberta' }),
  ];
  const g = doneGroups(tasks, T);
  assert.deepEqual(g.map((x) => x.key), ['2026-11-06', '2026-11-05']);
  assert.deepEqual(g.map((x) => x.title), ['Hoje', 'Ontem']);
  assert.deepEqual(ids(g[0].tasks), ['z', 'x']); // mais recente primeiro
});

test('contadores do menu e progresso do checklist', () => {
  const tasks = [
    mk({ date: '2026-11-01', labels: ['L'], priority: 4 }),
    mk({ date: T, labels: ['L'] }),
    mk({}),
    mk({ date: T, done: true }),
  ];
  const c = counts(tasks, T);
  assert.equal(c.overdue, 1);
  assert.equal(c.today, 1);
  assert.equal(c.inbox, 1);
  assert.equal(c.byLabel.get('L'), 2);
  assert.deepEqual(c.byPriority, [2, 0, 0, 0, 1]);
  assert.deepEqual(ids(inbox(tasks)).length, 1);
  assert.deepEqual(checklistProgress({ checklist: [{ done: true }, { done: false }, { done: true }] }), { done: 2, total: 3 });
  assert.deepEqual(checklistProgress({ checklist: [] }), { done: 0, total: 0 });
});
