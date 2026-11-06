// O jeito FALADO de pedir uma tarefa (js/voice.js) + o lembrete ("me avise 15 minutos antes") do analisador.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickAdd } from '../js/parser.js';
import { capitalizeTitle, normalizeSpoken } from '../js/voice.js';

const T = '2026-11-06'; // sexta-feira

/** Do que a pessoa falou até a tarefa que seria criada. */
const heard = (text) => {
  const r = parseQuickAdd(normalizeSpoken(text), { today: T });
  return { title: r.title, date: r.date, time: r.time, remind: r.remind, priority: r.priority, labels: r.labels, recurrence: r.recurrence?.freq ?? null };
};
const NONE = { date: null, time: null, remind: null, priority: null, labels: [], recurrence: null };

test('a frase do exemplo: tarefa com título, prazo "dia 10" e "às 16 horas"', () => {
  assert.deepEqual(
    heard('quero que crie uma tarefa com título pagar boleto com prazo para dia 10 às 16 horas'),
    { ...NONE, title: 'Pagar boleto', date: '2026-11-10', time: '16:00' },
  );
  // o ditado do iPhone põe maiúscula e ponto final
  assert.deepEqual(
    heard('Quero que crie uma tarefa com título pagar boleto com prazo para dia 10 às 16 horas.'),
    { ...NONE, title: 'Pagar boleto', date: '2026-11-10', time: '16:00' },
  );
});

test('o pedido some do título: crie, adicione, anote, registre... + tarefa/lembrete', () => {
  for (const frase of [
    'Crie uma tarefa pagar boleto amanhã',
    'adicione uma nova tarefa pagar boleto amanhã',
    'Anote um lembrete para pagar boleto amanhã',
    'registre a tarefa de pagar boleto amanhã',
    'crie uma tarefa com o título pagar boleto amanhã',
    'por favor, adicione pagar boleto amanhã',
    'você pode criar uma tarefa chamada pagar boleto amanhã',
    'Me lembre de pagar boleto amanhã',
    'lembre-me de pagar boleto amanhã',
  ]) {
    assert.deepEqual(heard(frase), { ...NONE, title: 'Pagar boleto', date: '2026-11-07' }, frase);
  }
});

test('título que só começa com um verbo continua intacto (não é pedido)', () => {
  assert.deepEqual(heard('Criar relatório mensal'), { ...NONE, title: 'Criar relatório mensal' });
  assert.deepEqual(heard('Agendar dentista amanhã 10h'), { ...NONE, title: 'Agendar dentista', date: '2026-11-07', time: '10:00' });
  assert.deepEqual(heard('Fazer compras sábado'), { ...NONE, title: 'Fazer compras', date: '2026-11-07' });
  assert.deepEqual(heard('Anotar ideias para o livro'), { ...NONE, title: 'Anotar ideias para o livro' });
  assert.equal(normalizeSpoken('Marcar consulta'), 'Marcar consulta');
});

test('texto digitado do jeito de sempre não muda', () => {
  for (const texto of ['Pagar boleto amanhã 10h !alta #contas', 'Academia toda segunda e quarta 19h', 'Dentista dia 20/11 às 15h', '']) {
    assert.equal(normalizeSpoken(texto), texto);
  }
});

test('hora e dia por extenso, quando o contexto é de data ou hora', () => {
  assert.deepEqual(heard('me lembre de pagar a conta de luz dia vinte às dezesseis horas'), { ...NONE, title: 'Pagar a conta de luz', date: '2026-11-20', time: '16:00' });
  assert.equal(heard('quero que adicione consulta com a dentista dia 15 às quatro e meia da tarde').time, '16:30');
  assert.equal(heard('crie uma tarefa ligar para a Ana às nove da manhã').time, '09:00');
  assert.equal(heard('crie uma tarefa almoço meio dia e meia').time, '12:30');
  assert.equal(heard('crie uma tarefa reunião às 16 e meia').time, '16:30');
  assert.equal(heard('crie uma tarefa reunião às quinze e quinze').time, '15:15');
  assert.equal(heard('crie uma tarefa reunião dia dois de dezembro').date, '2026-12-02');
});

test('número por extenso em título comum não vira dígito', () => {
  assert.equal(heard('Estudar duas horas hoje').title, 'Estudar duas horas');
  assert.equal(heard('Comprar três maçãs').title, 'Comprar três maçãs');
  assert.equal(heard('Ler dez páginas').title, 'Ler dez páginas');
});

test('prioridade e etiqueta faladas', () => {
  assert.deepEqual(
    heard('adicione uma tarefa para ligar para o contador sexta-feira às 9 da manhã com prioridade alta'),
    { ...NONE, title: 'Ligar para o contador', date: '2026-11-13', time: '09:00', priority: 3 },
  );
  assert.equal(heard('crie uma tarefa pagar boleto amanhã alta prioridade').priority, 3);
  assert.equal(heard('crie uma tarefa pagar boleto amanhã prioridade urgente').priority, 4);
  assert.equal(heard('crie uma tarefa pagar boleto amanhã marque como baixa').priority, 1);
  assert.deepEqual(heard('anote uma tarefa estudar inglês toda segunda às 19h com a etiqueta estudos'),
    { ...NONE, title: 'Estudar inglês', date: '2026-11-09', time: '19:00', labels: ['estudos'], recurrence: 'week' });
  assert.deepEqual(heard('crie uma tarefa pagar a conta amanhã com a etiqueta finanças').labels, ['finanças']);
});

test('"com prazo", "com data", "com horário" são só maneira de falar', () => {
  assert.deepEqual(heard('crie uma tarefa entregar o relatório com prazo para amanhã'), { ...NONE, title: 'Entregar o relatório', date: '2026-11-07' });
  assert.deepEqual(heard('crie uma tarefa reunião com data de 15/11 com horário às 14h'), { ...NONE, title: 'Reunião', date: '2026-11-15', time: '14:00' });
});

// ---------- lembrete ("despertador") ----------

test('lembrete: "me avise 15 minutos antes", "lembrete 1 hora antes", "meia hora antes", "na hora"', () => {
  const t = (s) => heard(s).remind;
  assert.equal(t('Reunião amanhã 15h me avise 15 minutos antes'), 15);
  assert.equal(t('Reunião amanhã 15h lembrete 1 hora antes'), 60);
  assert.equal(t('Reunião amanhã 15h me avise meia hora antes'), 30);
  assert.equal(t('Reunião amanhã 15h me lembre uma hora antes'), 60);
  assert.equal(t('Reunião amanhã 15h avisar 2 horas antes'), 120);
  assert.equal(t('Reunião amanhã 15h alarme 1 dia antes'), 1440);
  assert.equal(t('Reunião amanhã 15h despertador 45 min antes'), 45);
  assert.equal(t('Reunião amanhã 15h lembre-me 10 minutos antes'), 10);
  assert.equal(t('Reunião amanhã 15h me avise na hora'), 0);
  assert.equal(t('Reunião amanhã 15h avisar com 20 minutos de antecedência'), 20);
});

test('lembrete: a frase fica só com o título, a data e a hora', () => {
  assert.deepEqual(
    heard('Crie uma tarefa reunião com o cliente amanhã às 14h e me avise 30 minutos antes'),
    { ...NONE, title: 'Reunião com o cliente', date: '2026-11-07', time: '14:00', remind: 30 },
  );
  assert.deepEqual(
    heard('Reunião de equipe segunda 9h lembrete 15 minutos antes'),
    { ...NONE, title: 'Reunião de equipe', date: '2026-11-09', time: '09:00', remind: 15 },
  );
});

test('lembrete: sem palavra de aviso, "10 minutos antes" é só parte do título', () => {
  assert.deepEqual(heard('Chegar 10 minutos antes da reunião às 15h'), { ...NONE, title: 'Chegar 10 minutos antes da reunião', time: '15:00', date: null });
  assert.equal(heard('Chegar 10 minutos antes').remind, null);
  assert.equal(heard('Avisar a Maria sobre a reunião amanhã 15h').remind, null);
});

test('lembrete: valores absurdos são ignorados e "me avise ... antes" no começo não é engolido como pedido', () => {
  assert.equal(heard('Reunião amanhã 15h me avise 30 dias antes').remind, null); // mais que 7 dias
  assert.equal(heard('Reunião amanhã 15h me avise 0 minutos antes').remind, null);
  assert.equal(heard('me avise 20 minutos antes da reunião amanhã 15h').remind, 20);
});

test('o lembrete pode ser desligado pelo "ignore" (o X do campo de adicionar)', () => {
  const r = parseQuickAdd('Reunião amanhã 15h lembrete 1 hora antes', { today: T, ignore: { remind: true } });
  assert.equal(r.remind, null);
  assert.match(r.title, /lembrete 1 hora antes/);
});

test('capitalizeTitle: só a primeira letra', () => {
  assert.equal(capitalizeTitle('pagar boleto'), 'Pagar boleto');
  assert.equal(capitalizeTitle('ágata'), 'Ágata');
  assert.equal(capitalizeTitle(''), '');
});
