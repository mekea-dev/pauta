import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, addMonths, dayHeading, dayTitle, daysInMonth, diffDays, formatDateBR, isValidDate, isValidTime,
  minuteChoices, monthGrid, parseISO, relativeDay, splitTime, startOfWeek, todayISO, weekday,
} from '../js/dates.js';

const T = '2026-11-06'; // sexta-feira

test('parseISO aceita só datas reais', () => {
  assert.deepEqual(parseISO('2026-11-06'), { y: 2026, m: 11, d: 6 });
  assert.equal(parseISO('2026-02-30'), null);
  assert.equal(parseISO('2026-13-01'), null);
  assert.equal(parseISO('2026-1-1'), null);
  assert.equal(parseISO('26-01-01'), null);
  assert.equal(parseISO(null), null);
  assert.ok(isValidDate('2028-02-29'));
  assert.ok(!isValidDate('2027-02-29'));
});

test('isValidTime', () => {
  assert.ok(isValidTime('09:30'));
  assert.ok(isValidTime('00:00'));
  assert.ok(!isValidTime('24:00'));
  assert.ok(!isValidTime('9:30'));
  assert.ok(!isValidTime('09:60'));
});

test('minutos da escolha da hora: de 5 em 5; um minuto "quebrado" que a tarefa já tem continua aparecendo', () => {
  assert.deepEqual(minuteChoices(), ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55']);
  assert.deepEqual(minuteChoices('30'), minuteChoices(), '30 já está na lista');
  assert.deepEqual(minuteChoices('07').slice(0, 4), ['00', '05', '07', '10'], '14:07 não pode virar 14:05 sem querer');
  assert.equal(minuteChoices('07').length, 13);
  assert.equal(minuteChoices(59).at(-1), '59');
  assert.equal(minuteChoices('abc').length, 12, 'lixo não entra na lista');
  assert.equal(minuteChoices(75).length, 12);
  assert.equal(minuteChoices(null).length, 12);
});

test('splitTime separa hora e minutos de um horário válido', () => {
  assert.deepEqual(splitTime('16:05'), { hour: '16', minute: '05' });
  assert.deepEqual(splitTime('00:00'), { hour: '00', minute: '00' });
  assert.equal(splitTime('24:00'), null);
  assert.equal(splitTime(''), null);
  assert.equal(splitTime(null), null);
});

test('addDays cruza mês, ano e fevereiro bissexto', () => {
  assert.equal(addDays(T, 1), '2026-11-07');
  assert.equal(addDays(T, -6), '2026-10-31');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2027-02-28', 1), '2027-03-01');
});

test('diffDays e weekday', () => {
  assert.equal(diffDays('2026-11-07', T), 1);
  assert.equal(diffDays(T, '2026-11-07'), -1);
  assert.equal(diffDays('2027-01-01', '2026-01-01'), 365);
  assert.equal(weekday(T), 5);
  assert.equal(weekday('2026-11-01'), 0);
  assert.equal(weekday('2000-01-01'), 6);
});

test('startOfWeek respeita o primeiro dia da semana', () => {
  assert.equal(startOfWeek(T, 1), '2026-11-02');
  assert.equal(startOfWeek(T, 0), '2026-11-01');
  assert.equal(startOfWeek('2026-11-01', 1), '2026-10-26');
  assert.equal(startOfWeek('2026-11-02', 1), '2026-11-02');
});

test('addMonths mantém o dia ou usa o último do mês', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-11-30', 3), '2027-02-28');
  assert.equal(addMonths('2026-12-15', 1), '2027-01-15');
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
  assert.equal(daysInMonth(2028, 2), 29);
});

test('monthGrid tem 42 dias e começa na semana do dia 1', () => {
  const g = monthGrid(2026, 11, 1);
  assert.equal(g.length, 42);
  assert.equal(g[0], '2026-10-26');
  assert.equal(g[41], '2026-12-06');
  assert.equal(monthGrid(2026, 11, 0)[0], '2026-11-01');
});

test('títulos e rótulos de dia em português', () => {
  assert.equal(dayTitle(T, T), 'Hoje');
  assert.equal(dayTitle('2026-11-07', T), 'Amanhã');
  assert.equal(dayTitle('2026-11-05', T), 'Ontem');
  assert.equal(dayTitle('2026-11-09', T), 'Segunda-feira');
  assert.equal(relativeDay('2026-11-09', T), 'Segunda');
  assert.equal(relativeDay('2026-11-12', T), 'Quinta');
  assert.equal(relativeDay('2026-11-13', T), '13 nov');
  assert.equal(relativeDay('2026-11-03', T), 'há 3 dias');
  assert.equal(relativeDay('2026-10-30', T), '30 out');
  assert.equal(relativeDay('2027-01-10', T), '10 jan 2027');
  assert.deepEqual(dayHeading('2026-11-07', T), { title: 'Amanhã', subtitle: 'sábado, 7 de novembro' });
  assert.deepEqual(dayHeading('2026-11-10', T), { title: 'Terça-feira', subtitle: '10 de novembro' });
});

test('formatDateBR e todayISO', () => {
  assert.equal(formatDateBR(T), '06/11/2026');
  assert.equal(todayISO(new Date(2026, 10, 6, 23, 59)), '2026-11-06');
  assert.equal(todayISO(new Date(2026, 0, 1, 0, 0)), '2026-01-01');
});
