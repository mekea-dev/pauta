import test from 'node:test';
import assert from 'node:assert/strict';
import { describe, finalizeRule, firstOccurrence, nextAfter, nextDate, normalizeRule, occurrencesBetween, presetOf } from '../js/recurrence.js';

const T = '2026-11-06'; // sexta-feira
const week = (days, interval = 1) => ({ freq: 'week', interval, days });

test('todo dia / a cada N dias', () => {
  assert.equal(nextDate({ freq: 'day', interval: 1 }, T), '2026-11-07');
  assert.equal(nextDate({ freq: 'day', interval: 3 }, T), '2026-11-09');
});

test('semana: próximos dias marcados, sem pular a semana certa', () => {
  assert.equal(nextDate(week([1, 3]), '2026-11-02'), '2026-11-04'); // seg -> qua
  assert.equal(nextDate(week([1, 3]), '2026-11-04'), '2026-11-09'); // qua -> seg seguinte
  assert.equal(nextDate(week([1, 2, 3, 4, 5]), T), '2026-11-09'); // sexta -> segunda
  assert.equal(nextDate(week([1, 2, 3, 4, 5]), '2026-11-09'), '2026-11-10');
  assert.equal(nextDate(week([1], 2), '2026-11-02'), '2026-11-16'); // a cada 2 semanas
  assert.equal(nextDate({ freq: 'week', interval: 1 }, T), '2026-11-13'); // sem dias: mesmo dia da semana
  assert.equal(nextDate(week([0]), '2026-11-01'), '2026-11-08'); // domingo
  assert.equal(nextDate(week([0, 6]), '2026-11-07'), '2026-11-08'); // sábado -> domingo
  assert.equal(nextDate(week([0, 6]), '2026-11-08'), '2026-11-14'); // domingo -> sábado seguinte
});

test('mês: dia 31 cai no último dia dos meses curtos e volta ao 31', () => {
  const r = { freq: 'month', interval: 1, monthDay: 31 };
  assert.equal(nextDate(r, '2026-01-31'), '2026-02-28');
  assert.equal(nextDate(r, '2026-02-28'), '2026-03-31');
  assert.equal(nextDate({ freq: 'month', interval: 1, monthDay: 15 }, '2026-11-03'), '2026-11-15'); // data fora do padrão
  assert.equal(nextDate({ freq: 'month', interval: 2, monthDay: 15 }, '2026-11-15'), '2027-01-15');
});

test('ano: 29 de fevereiro vira 28 nos anos comuns', () => {
  const r = { freq: 'year', interval: 1, month: 2, monthDay: 29 };
  assert.equal(nextDate(r, '2028-02-29'), '2029-02-28');
  assert.equal(nextDate({ freq: 'year', interval: 1, month: 12, monthDay: 25 }, T), '2026-12-25');
});

test('nextAfter: atrasada não gera cópias no passado e adiantada respeita a data', () => {
  const daily = { freq: 'day', interval: 1 };
  assert.equal(nextAfter(daily, '2026-11-01', T), '2026-11-07'); // atrasada há 5 dias
  assert.equal(nextAfter(daily, T, T), '2026-11-07'); // em dia
  assert.equal(nextAfter(daily, '2026-11-20', T), '2026-11-21'); // concluída adiantada
  assert.equal(nextAfter(week([1]), '2026-10-26', T), '2026-11-09');
  assert.equal(nextAfter(week([1], 2), '2026-10-26', '2026-11-05'), '2026-11-09'); // mantém o ritmo quinzenal
});

test('firstOccurrence: primeira data igual ou depois de hoje', () => {
  assert.equal(firstOccurrence(week([2, 4]), T), '2026-11-10');
  assert.equal(firstOccurrence(week([5]), T), T);
  assert.equal(firstOccurrence({ freq: 'month', interval: 1, monthDay: 5 }, T), '2026-12-05');
  assert.equal(firstOccurrence({ freq: 'month', interval: 1, monthDay: 6 }, T), T);
  assert.equal(firstOccurrence({ freq: 'year', interval: 1, month: 3, monthDay: 1 }, T), '2027-03-01');
  assert.equal(firstOccurrence({ freq: 'day', interval: 1 }, T), T);
});

test('occurrencesBetween lista as próximas datas dentro do intervalo', () => {
  assert.deepEqual(occurrencesBetween({ freq: 'day', interval: 1 }, T, '2026-11-08', '2026-11-10'), ['2026-11-08', '2026-11-09', '2026-11-10']);
  assert.deepEqual(occurrencesBetween(week([1]), '2026-11-09', '2026-11-10', '2026-11-30'), ['2026-11-16', '2026-11-23', '2026-11-30']);
});

test('describe escreve a regra em português', () => {
  assert.equal(describe(null), 'Não repete');
  assert.equal(describe({ freq: 'day', interval: 1 }), 'Todo dia');
  assert.equal(describe({ freq: 'day', interval: 3 }), 'A cada 3 dias');
  assert.equal(describe(week([1, 2, 3, 4, 5])), 'Dias úteis');
  assert.equal(describe(week([0, 6])), 'Fins de semana');
  assert.equal(describe(week([1])), 'Toda segunda-feira');
  assert.equal(describe(week([6])), 'Todo sábado');
  assert.equal(describe(week([1, 3])), 'Toda semana (seg, qua)');
  assert.equal(describe(week([1], 2)), 'A cada 2 semanas (seg)');
  assert.equal(describe({ freq: 'week', interval: 1 }, T), 'Toda sexta-feira');
  assert.equal(describe({ freq: 'month', interval: 1, monthDay: 15 }), 'Todo mês, dia 15');
  assert.equal(describe({ freq: 'year', interval: 1 }), 'Todo ano');
});

test('presetOf reconhece os atalhos e cai em "personalizado"', () => {
  assert.equal(presetOf(null, T), 'none');
  assert.equal(presetOf({ freq: 'day', interval: 1 }, T), 'day');
  assert.equal(presetOf(week([1, 2, 3, 4, 5]), T), 'weekdays');
  assert.equal(presetOf(week([5]), T), 'week');
  assert.equal(presetOf(week([1, 3]), T), 'custom');
  assert.equal(presetOf(week([5], 2), T), 'custom');
  assert.equal(presetOf({ freq: 'month', interval: 1, monthDay: 6 }, T), 'month');
  assert.equal(presetOf({ freq: 'month', interval: 1, monthDay: 15 }, T), 'custom');
});

test('normalizeRule e finalizeRule', () => {
  assert.equal(normalizeRule({ freq: 'hora' }), null);
  assert.equal(normalizeRule(null), null);
  assert.deepEqual(normalizeRule({ freq: 'day', interval: 0 }), { freq: 'day', interval: 1 });
  assert.deepEqual(normalizeRule({ freq: 'week', interval: 1, days: [3, 1, 3, 9, 'x'] }), { freq: 'week', interval: 1, days: [1, 3] });
  assert.deepEqual(finalizeRule({ freq: 'week', interval: 1 }, T), { freq: 'week', interval: 1, days: [5] });
  assert.deepEqual(finalizeRule({ freq: 'month', interval: 1 }, T), { freq: 'month', interval: 1, monthDay: 6 });
  assert.deepEqual(finalizeRule({ freq: 'year', interval: 1 }, T), { freq: 'year', interval: 1, month: 11, monthDay: 6 });
});
