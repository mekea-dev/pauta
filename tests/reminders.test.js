// Lembretes: contas de quando avisar e o texto do aviso.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTask, sanitizeTask } from '../js/model.js';
import { REMIND_PRESETS, due, dueAt, reminderBody, remindAt, remindLabel, upcoming } from '../js/reminders.js';
import { createStore } from '../js/store.js';

const at = (s) => new Date(s); // "2026-11-10T15:30:00" = hora local
const mk = (partial) => createTask({ title: 'Reunião', ...partial });

test('lembrete só existe em tarefa com data e hora (senão vira nulo)', () => {
  assert.equal(mk({ date: '2026-11-10', time: '16:00', remind: 15 }).remind, 15);
  assert.equal(mk({ date: '2026-11-10', remind: 15 }).remind, null, 'sem hora');
  assert.equal(mk({ remind: 15 }).remind, null, 'sem data');
  assert.equal(mk({ date: '2026-11-10', time: '16:00' }).remind, null, 'sem lembrete');
  assert.equal(mk({ date: '2026-11-10', time: '16:00', remind: 0 }).remind, 0, 'na hora');
  for (const ruim of [-1, 'abc', 99999, NaN, '']) assert.equal(mk({ date: '2026-11-10', time: '16:00', remind: ruim }).remind, null, String(ruim));
  assert.equal(mk({ date: '2026-11-10', time: '16:00', remind: 1.5 }).remind, 1, 'decimal é arredondado para baixo');
});

test('lembrete: dados que vêm de fora são limpos e tirar a hora tira o lembrete', () => {
  const t = sanitizeTask({ id: 'a', title: 'X', date: '2026-11-10', time: '16:00', remind: '30' });
  assert.equal(t.remind, 30);
  assert.equal(sanitizeTask({ id: 'a', title: 'X', date: '2026-11-10', time: 'xx', remind: 30 }).remind, null);
  const store = createStore({ tasks: [], labels: [], settings: {} });
  const nova = store.addTask({ title: 'Reunião', date: '2026-11-10', time: '16:00', remind: 15 });
  assert.equal(store.find(nova.id).remind, 15);
  store.updateTask(nova.id, { remind: 60 });
  assert.equal(store.find(nova.id).remind, 60);
  store.updateTask(nova.id, { time: null });
  assert.equal(store.find(nova.id).remind, null, 'sem hora não há lembrete');
});

test('lembrete acompanha a tarefa ao repetir e ao duplicar', () => {
  const store = createStore({ tasks: [], labels: [], settings: {} }, { clock: () => new Date('2026-11-06T10:00:00') });
  const t = store.addTask({ title: 'Academia', date: '2026-11-06', time: '19:00', remind: 30, recurrence: { freq: 'day', interval: 1 } });
  const r = store.toggleDone(t.id);
  assert.equal(r.spawned.remind, 30, 'a próxima ocorrência herda o lembrete');
  assert.equal(store.duplicateTask(t.id).remind, 30);
});

test('dueAt e remindAt: hora local do aparelho', () => {
  const t = mk({ date: '2026-11-10', time: '16:00', remind: 15 });
  assert.equal(dueAt(t).getTime(), at('2026-11-10T16:00:00').getTime());
  assert.equal(remindAt(t).getTime(), at('2026-11-10T15:45:00').getTime());
  assert.equal(remindAt(mk({ date: '2026-11-10', time: '00:10', remind: 1440 })).getTime(), at('2026-11-09T00:10:00').getTime(), 'um dia antes cruza o dia');
  assert.equal(remindAt(mk({ date: '2026-11-10', time: '16:00' })), null);
  assert.equal(dueAt(mk({ date: '2026-11-10' })), null);
});

test('rótulos: na hora, minutos, horas e dias', () => {
  assert.deepEqual(REMIND_PRESETS.map(remindLabel), ['Na hora', '5 minutos antes', '10 minutos antes', '15 minutos antes', '30 minutos antes', '1 hora antes', '2 horas antes', '1 dia antes']);
  assert.equal(remindLabel(45), '45 minutos antes');
  assert.equal(remindLabel(90), '90 minutos antes');
  assert.equal(remindLabel(2880), '2 dias antes');
  assert.equal(remindLabel(1), '1 minuto antes');
});

test('upcoming: só o que ainda vai tocar, em ordem, sem tarefa concluída', () => {
  const now = at('2026-11-10T10:00:00');
  const a = mk({ date: '2026-11-10', time: '16:00', remind: 15 }); // 15:45
  const b = mk({ date: '2026-11-10', time: '11:00', remind: 30 }); // 10:30
  const passado = mk({ date: '2026-11-10', time: '10:10', remind: 30 }); // 09:40: já passou
  const feita = { ...mk({ date: '2026-11-10', time: '12:00', remind: 5 }), done: true };
  const semLembrete = mk({ date: '2026-11-10', time: '13:00' });
  const longe = mk({ date: '2027-03-01', time: '09:00', remind: 15 });
  const r = upcoming([a, b, passado, feita, semLembrete, longe], now);
  assert.deepEqual(r.map((x) => x.taskId), [b.id, a.id]);
  assert.equal(r[0].at, at('2026-11-10T10:30:00').getTime());
  assert.equal(upcoming([a, b], now, { limit: 1 }).length, 1);
});

test('due: avisos na hora de tocar (inclusive os que passaram com o app fechado), sem tarefa muito atrasada', () => {
  const tasks = [
    mk({ date: '2026-11-10', time: '16:00', remind: 15 }), // aviso 15:45
    mk({ date: '2026-11-10', time: '15:50', remind: 60 }), // aviso 14:50
    mk({ date: '2026-11-10', time: '12:00', remind: 15 }), // venceu há 4 h: não incomoda mais
    mk({ date: '2026-11-10', time: '18:00', remind: 15 }), // aviso 17:45: ainda não
  ];
  const r = due(tasks, at('2026-11-10T15:50:00'));
  assert.deepEqual(r.map((x) => x.time), ['15:50', '16:00']);
  assert.deepEqual(due(tasks, at('2026-11-10T15:44:00')).map((x) => x.time), ['15:50'], 'o das 16:00 ainda não');
});

test('o id do aviso muda quando a hora ou a antecedência mudam (aviso novo pode tocar de novo)', () => {
  const t = mk({ date: '2026-11-10', time: '16:00', remind: 15 });
  const id = (task) => upcoming([task], at('2026-11-10T08:00:00'))[0].id;
  assert.equal(id(t), id({ ...t }));
  assert.notEqual(id(t), id({ ...t, remind: 30 }));
  assert.notEqual(id(t), id({ ...t, time: '17:00' }));
});

test('texto do aviso: dia, hora e quanto falta', () => {
  const now = at('2026-11-10T15:45:00');
  const r = upcoming([mk({ date: '2026-11-10', time: '16:00', remind: 15 })], at('2026-11-10T08:00:00'))[0];
  assert.equal(reminderBody(r, now), 'Hoje às 16:00 · em 15 minutos');
  assert.equal(reminderBody(r, at('2026-11-10T16:00:00')), 'Hoje às 16:00 · agora');
  assert.equal(reminderBody(r, at('2026-11-10T16:07:00')), 'Hoje às 16:00 · há 7 minutos');
  assert.equal(reminderBody(r, at('2026-11-10T14:00:00')), 'Hoje às 16:00 · em 2 horas');
  assert.equal(reminderBody(r, at('2026-11-10T14:30:00')), 'Hoje às 16:00 · em 1 hora e 30 min');
  const amanha = upcoming([mk({ date: '2026-11-11', time: '09:00', remind: 60 })], at('2026-11-10T08:00:00'))[0];
  assert.match(reminderBody(amanha, at('2026-11-10T08:00:00')), /^Amanhã às 09:00 · em 1 dia$/);
});
