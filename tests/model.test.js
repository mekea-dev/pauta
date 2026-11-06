import test from 'node:test';
import assert from 'node:assert/strict';
import { createTask, sanitizeChecklist, sanitizeState, seedState, uid } from '../js/model.js';

const NOW = '2026-11-06T10:00:00.000Z';

test('uid não repete', () => {
  assert.equal(new Set(Array.from({ length: 500 }, () => uid())).size, 500);
});

test('createTask normaliza e descarta o que não faz sentido', () => {
  const t = createTask({ title: '  Olá   mundo \n', date: '2026-13-40', time: '10:00', priority: 9, labels: ['a', 'a', 5], recurrence: { freq: 'day' } }, NOW);
  assert.equal(t.title, 'Olá mundo');
  assert.equal(t.date, null);
  assert.equal(t.time, null); // sem data não há hora
  assert.equal(t.priority, 0);
  assert.deepEqual(t.labels, ['a']);
  assert.equal(t.recurrence, null); // sem data não repete
  assert.equal(t.done, false);
  assert.equal(t.createdAt, NOW);
});

test('checklist: ignora itens vazios, repara ids repetidos e mantém vazios se pedido', () => {
  const c = sanitizeChecklist([{ id: 'x', text: ' um ', done: true }, { id: 'x', text: 'dois' }, { text: '' }, 'lixo', null]);
  assert.equal(c.length, 2);
  assert.equal(c[0].text, 'um');
  assert.equal(c[0].done, true);
  assert.equal(c[1].done, false);
  assert.notEqual(c[0].id, c[1].id);
  assert.equal(sanitizeChecklist([{ text: '' }], { keepEmpty: true }).length, 1);
  assert.deepEqual(sanitizeChecklist('não é lista'), []);
});

test('sanitizeState limpa dados estranhos sem quebrar', () => {
  const s = sanitizeState({
    tasks: [
      { id: 'a', title: 'Boa', priority: 3, labels: ['L1', 'inexistente'] },
      { id: 'b', title: '   ' },
      null,
      'texto',
      { id: 'a', title: 'Boa v2', updatedAt: '2030-01-01T00:00:00.000Z', labels: ['L1', 'inexistente'] },
    ],
    labels: [
      { id: 'L1', name: 'Casa', color: 'red' },
      { id: 'L2', name: 'casa', color: 'blue' },
      { name: '', color: 'red' },
      { id: 'L3', name: 'X', color: 'neon' },
    ],
    settings: { theme: 'neon', weekStart: 7 },
  }, NOW);
  assert.equal(s.tasks.length, 1);
  assert.equal(s.tasks[0].title, 'Boa v2'); // do mesmo id, fica a versão mais recente
  assert.deepEqual(s.tasks[0].labels, ['L1']); // etiqueta que não existe é removida
  assert.deepEqual(s.labels.map((l) => [l.id, l.color]), [['L1', 'red'], ['L3', 'gray']]);
  assert.equal(s.settings.theme, 'auto');
  assert.equal(s.settings.weekStart, 1);
});

test('sanitizeState recusa o que não é objeto e aceita o envelope do backup', () => {
  assert.equal(sanitizeState(null), null);
  assert.equal(sanitizeState('x'), null);
  const s = sanitizeState({ app: 'pauta', data: { tasks: [{ title: 'Dentro do envelope' }], labels: [] } }, NOW);
  assert.equal(s.tasks[0].title, 'Dentro do envelope');
});

test('os dados de boas-vindas são válidos e sobrevivem à limpeza', () => {
  const seed = seedState('2026-11-06', NOW);
  assert.ok(seed.tasks.length >= 3);
  assert.deepEqual(sanitizeState(seed, NOW), seed);
});
