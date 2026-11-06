import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickAdd } from '../js/parser.js';

const T = '2026-11-06'; // sexta-feira

const out = (text, opts = {}) => {
  const r = parseQuickAdd(text, { today: T, ...opts });
  return { title: r.title, date: r.date, time: r.time, priority: r.priority, labels: r.labels, recurrence: r.recurrence };
};
const NONE = { date: null, time: null, priority: null, labels: [], recurrence: null };

test('frase completa: data, hora, prioridade e etiqueta', () => {
  assert.deepEqual(out('Pagar boleto amanhã 10h !alta #financeiro'), {
    ...NONE, title: 'Pagar boleto', date: '2026-11-07', time: '10:00', priority: 3, labels: ['financeiro'],
  });
});

test('texto sem nada especial vira só o título', () => {
  assert.deepEqual(out('Comprar pão'), { ...NONE, title: 'Comprar pão' });
  assert.deepEqual(out(''), { ...NONE, title: '' });
});

test('dias da semana: sempre o próximo (nunca hoje)', () => {
  assert.equal(out('Reunião sexta').date, '2026-11-13');
  assert.equal(out('Reunião sábado').date, '2026-11-07');
  assert.equal(out('Reunião segunda feira').date, '2026-11-09');
  assert.equal(out('Reunião na próxima terça').date, '2026-11-10');
  assert.equal(out('Reunião de segunda').title, 'Reunião');
  assert.equal(out('Comprar presente para sexta').title, 'Comprar presente');
});

test('"segunda via" e "quarta parte" não são dias da semana', () => {
  assert.deepEqual(out('Pedir segunda via do boleto'), { ...NONE, title: 'Pedir segunda via do boleto' });
  assert.equal(out('Ler a quarta parte do livro').date, null);
});

test('hora com "às"', () => {
  assert.deepEqual(out('Ligar para o João segunda às 14:30'), { ...NONE, title: 'Ligar para o João', date: '2026-11-09', time: '14:30' });
  assert.equal(out('Reunião hoje às 14h30').time, '14:30');
  assert.equal(out('Ligar às 9').time, '09:00');
  assert.equal(out('Fechar até as 18h').time, '18:00');
});

test('número solto depois de "as"/"até" não é hora', () => {
  assert.deepEqual(out('Ver as 9 propostas'), { ...NONE, title: 'Ver as 9 propostas' });
  assert.deepEqual(out('Entregar até 15'), { ...NONE, title: 'Entregar até 15' });
});

test('"2h" é duração; "22h" é horário', () => {
  assert.deepEqual(out('Estudar 2h'), { ...NONE, title: 'Estudar 2h' });
  assert.equal(out('Dormir 22h').time, '22:00');
  assert.equal(out('Treino 6h').time, '06:00');
});

test('períodos do dia, meio-dia e am/pm', () => {
  assert.deepEqual(out('Reunião 3 da tarde'), { ...NONE, title: 'Reunião', time: '15:00' });
  assert.equal(out('Acordar 6 da manhã').time, '06:00');
  assert.equal(out('Jantar 8 da noite').time, '20:00');
  assert.equal(out('Almoço amanhã meio-dia').time, '12:00');
  assert.equal(out('Fechar meia-noite').time, '00:00');
  assert.equal(out('Call 3pm').time, '15:00');
  assert.equal(out('Call 12am').time, '00:00');
});

test('datas numéricas: dia/mês, com ano e virando para o ano que vem', () => {
  assert.deepEqual(out('Consulta 15/11'), { ...NONE, title: 'Consulta', date: '2026-11-15' });
  assert.equal(out('Consulta 15/10').date, '2027-10-15');
  assert.equal(out('Viagem 20/12/2026').date, '2026-12-20');
  assert.equal(out('Viagem 20/12/26').date, '2026-12-20');
  assert.equal(out('Consulta 31/02').date, null);
  assert.deepEqual(out('Pagar boleto dia 10/11 às 14h'), { ...NONE, title: 'Pagar boleto', date: '2026-11-10', time: '14:00' });
});

test('datas por extenso e "dia N"', () => {
  assert.deepEqual(out('Prova dia 25 de novembro'), { ...NONE, title: 'Prova', date: '2026-11-25' });
  assert.equal(out('Festa 3 de jan').date, '2027-01-03');
  assert.equal(out('Dentista dia 10').date, '2026-11-10');
  assert.equal(out('Dentista dia 5').date, '2026-12-05');
  assert.deepEqual(out('Pagar até dia 15'), { ...NONE, title: 'Pagar', date: '2026-11-15' });
});

test('hoje, amanhã, depois de amanhã e prazos relativos', () => {
  assert.equal(out('Lista de hoje').date, T);
  assert.equal(out('Lista de hoje').title, 'Lista');
  assert.equal(out('Limpar depois de amanhã').date, '2026-11-08');
  assert.equal(out('Entregar relatório em 3 dias').date, '2026-11-09');
  assert.equal(out('Revisão daqui a 2 semanas').date, '2026-11-20');
  assert.equal(out('Planejar semana que vem').date, '2026-11-09');
  assert.equal(out('Planejar semana que vem', { weekStart: 0 }).date, '2026-11-08');
  assert.equal(out('Fechar o mês que vem').date, '2026-12-01');
  assert.equal(out('Fechar fim do mês').date, '2026-11-30');
});

test('prioridade por palavra ou letra', () => {
  assert.equal(out('Tarefa !urgente').priority, 4);
  assert.equal(out('Tarefa !alta').priority, 3);
  assert.equal(out('Tarefa !média').priority, 2);
  assert.equal(out('Tarefa !baixa').priority, 1);
  assert.equal(out('Tarefa !b').priority, 1);
  assert.deepEqual(out('Tarefa !alta'), { ...NONE, title: 'Tarefa', priority: 3 });
});

test('etiquetas: várias, sem repetir, e "#4521" não é etiqueta', () => {
  assert.deepEqual(out('Comprar leite #casa #Mercado').labels, ['casa', 'Mercado']);
  assert.deepEqual(out('x #a #A').labels, ['a']);
  assert.deepEqual(out('Chamado #4521 aberto'), { ...NONE, title: 'Chamado #4521 aberto' });
  assert.deepEqual(out('Estudar C# hoje').labels, []);
  assert.equal(out('Encontro em #casa').title, 'Encontro');
  assert.deepEqual(out('Aula #saúde').labels, ['saúde']);
});

test('repetição: todo dia, dias da semana, a cada N, mensal e anual', () => {
  assert.deepEqual(out('Revisar e-mails todo dia 9h'), {
    ...NONE, title: 'Revisar e-mails', date: T, time: '09:00', recurrence: { freq: 'day', interval: 1 },
  });
  assert.deepEqual(out('Estudar inglês toda terça e quinta 19h'), {
    ...NONE, title: 'Estudar inglês', date: '2026-11-10', time: '19:00', recurrence: { freq: 'week', interval: 1, days: [2, 4] },
  });
  assert.deepEqual(out('Aluguel todo dia 5'), {
    ...NONE, title: 'Aluguel', date: '2026-12-05', recurrence: { freq: 'month', interval: 1, monthDay: 5 },
  });
  assert.deepEqual(out('Backup a cada 2 semanas'), {
    ...NONE, title: 'Backup', date: T, recurrence: { freq: 'week', interval: 2, days: [5] },
  });
  assert.deepEqual(out('Regar plantas a cada três dias').recurrence, { freq: 'day', interval: 3 });
  assert.deepEqual(out('Relatório dias úteis 8h'), {
    ...NONE, title: 'Relatório', date: T, time: '08:00', recurrence: { freq: 'week', interval: 1, days: [1, 2, 3, 4, 5] },
  });
  assert.deepEqual(out('Corrida todo sábado').recurrence, { freq: 'week', interval: 1, days: [6] });
  assert.equal(out('Corrida todo sábado').date, '2026-11-07');
  assert.deepEqual(out('Corrida todos os fins de semana').recurrence, { freq: 'week', interval: 1, days: [0, 6] });
  assert.deepEqual(out('Aniversário da mãe todo ano 15/12'), {
    ...NONE, title: 'Aniversário da mãe', date: '2026-12-15', recurrence: { freq: 'year', interval: 1, month: 12, monthDay: 15 },
  });
  assert.deepEqual(out('Fechar caixa todo mês').recurrence, { freq: 'month', interval: 1, monthDay: 6 });
});

test('o que foi reconhecido volta em `tokens` para mostrar na pré-visualização', () => {
  const r = parseQuickAdd('Pagar boleto amanhã 10h !alta #financeiro', { today: T });
  assert.deepEqual(r.tokens.map((t) => t.type).sort(), ['date', 'label', 'priority', 'time']);
  assert.equal(r.tokens.find((t) => t.type === 'date').text, 'amanhã');
});

test('ignore: desliga um tipo de reconhecimento e o texto fica no título', () => {
  assert.deepEqual(out('Comprar pão amanhã', { ignore: { date: true } }), { ...NONE, title: 'Comprar pão amanhã' });
  assert.deepEqual(out('Reunião 10h !alta', { ignore: { time: true, priority: true } }), { ...NONE, title: 'Reunião 10h !alta' });
  assert.deepEqual(out('Treino toda segunda', { ignore: { recurrence: true } }).recurrence, null);
});

test('só "amanhã": título vazio (o app não cria a tarefa)', () => {
  const r = out('amanhã');
  assert.equal(r.title, '');
  assert.equal(r.date, '2026-11-07');
});
