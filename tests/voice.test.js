// O jeito FALADO de pedir uma tarefa (js/voice.js) + o lembrete ("me avise 15 minutos antes") do analisador.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickAdd } from '../js/parser.js';
import { capitalizeTitle, interpretSpoken, normalizeSpoken } from '../js/voice.js';

const T = '2026-11-06'; // sexta-feira
const NOW = new Date(2026, 10, 6, 9, 0); // sexta, 06/11/2026, 9h da manhã (hora local)

/** O que o app entende da fala, e se ficou em dúvida (`issues`). */
const read = (text, extra = {}) => interpretSpoken(text, { today: T, now: NOW, weekStart: 1, ...extra });
const got = (r) => ({ title: r.title, date: r.date, time: r.time, remind: r.remind, priority: r.priority, labels: r.labels, recurrence: r.recurrence?.freq ?? null });
const codes = (r) => r.issues.map((i) => i.code);

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

// ---------- fala de verdade: hesitações, rodeios e correções ----------

test('hesitações e palavras repetidas da fala não entram no título', () => {
  assert.equal(read('hum crie uma tarefa ahn pagar boleto amanhã').title, 'Pagar boleto');
  assert.equal(read('éééé crie uma tarefa pagar boleto amanhã').title, 'Pagar boleto');
  assert.equal(read('crie uma tarefa pagar pagar o boleto amanhã').title, 'Pagar o boleto');
  assert.equal(read('crie uma tarefa ligar para o o dentista amanhã').title, 'Ligar para o dentista');
});

test('conversa antes e depois do pedido some: "então", "ah tá", "né", "por favor"', () => {
  assert.equal(read('então crie uma tarefa pagar boleto amanhã').title, 'Pagar boleto');
  assert.equal(read('ah tá, anota aí pagar boleto amanhã').title, 'Pagar boleto');
  assert.equal(read('crie uma tarefa pagar boleto amanhã por favor').title, 'Pagar boleto');
  assert.equal(read('crie uma tarefa pagar boleto amanhã né').title, 'Pagar boleto');
  assert.equal(read('crie uma tarefa pagar boleto amanhã tá bom').title, 'Pagar boleto');
});

test('o pedido de jeitos mais naturais', () => {
  for (const frase of [
    'quero criar uma tarefa pagar boleto amanhã',
    'gostaria de criar um lembrete para pagar boleto amanhã',
    'cria aí uma tarefa pra mim pagar boleto amanhã',
    'nova tarefa pagar boleto amanhã',
    'tarefa: pagar boleto amanhã',
    'lembrete de pagar boleto amanhã',
    'anota aí pagar boleto amanhã',
    'adiciona pagar boleto amanhã',
  ]) assert.deepEqual(got(read(frase)), { ...NONE, title: 'Pagar boleto', date: '2026-11-07' }, frase);
});

test('a intenção vira o verbo: "preciso comprar", "tenho que ligar", "vou levar", "lembrar de pagar"', () => {
  for (const [frase, titulo] of [
    ['preciso comprar leite amanhã', 'Comprar leite'],
    ['tenho que ligar para o dentista amanhã', 'Ligar para o dentista'],
    ['vou levar o carro na oficina amanhã', 'Levar o carro na oficina'],
    ['crie uma tarefa para eu lembrar de pagar o boleto amanhã', 'Pagar o boleto'],
    ['não posso esquecer de enviar o relatório amanhã', 'Enviar o relatório'],
  ]) assert.equal(read(frase).title, titulo, frase);
});

test('títulos que parecem pedido ou conversa, mas são títulos, ficam como estão (e claros)', () => {
  for (const frase of [
    'Criar relatório mensal', 'Agendar dentista amanhã 10h', 'Fazer compras sábado', 'Anotar ideias para o livro', 'Marcar consulta',
    'Preciso de ajuda com o relatório', 'Tarefa de casa de matemática', 'Salão de beleza amanhã 15h', 'Deixar tudo pronto', 'Dar o ok no projeto',
    'Evento de aniversário da Ana sábado', 'Pagar boleto amanhã 10h !alta #contas',
  ]) {
    const r = read(frase, { now: new Date(2026, 10, 6, 7, 0) });
    assert.equal(r.clear, true, `${frase} -> ${JSON.stringify(r.issues)}`);
    assert.equal(r.title.toLowerCase().startsWith(frase.slice(0, 6).toLowerCase()), true, `${frase} -> ${r.title}`);
  }
  assert.equal(read('Preciso fazer compras sábado').title, 'Fazer compras', '"preciso" + verbo é a intenção; o verbo fica');
});

test('hora por extenso, com os minutos que se fala: "e vinte", "e meia", "e 30"', () => {
  assert.equal(read('crie uma tarefa reunião amanhã às quatro e vinte da tarde').time, '16:20');
  assert.equal(read('crie uma tarefa reunião amanhã às nove e dez').time, '09:10');
  assert.equal(read('crie uma tarefa reunião amanhã às dez e vinte e cinco').time, '10:25');
  assert.equal(read('crie uma tarefa reunião amanhã às 16 e 30').time, '16:30');
  assert.equal(read('crie uma tarefa reunião amanhã às 16 e vinte').time, '16:20');
  assert.equal(read('crie uma tarefa pagar aluguel dia primeiro').date, '2026-12-01');
});

test('quando a pessoa se corrige, vale o que disse por último', () => {
  assert.equal(read('crie uma tarefa reunião amanhã às 16, quer dizer, às 17').time, '17:00');
  assert.equal(read('crie uma tarefa pagar boleto dia 10, ou melhor, dia 12').date, '2026-11-12');
  assert.equal(read('reunião sexta 14h, na verdade 15h').time, '15:00');
  assert.equal(read('crie uma tarefa pagar boleto amanhã prioridade alta, ou melhor, prioridade urgente').priority, 4);
  const r = read('crie uma tarefa reunião amanhã às 16, quer dizer, às 17');
  assert.equal(r.title, 'Reunião');
  assert.equal(r.clear, true);
  // "na verdade" que não corrige nada identificável não mexe em nada
  assert.equal(read('crie uma tarefa conferir na verdade se pagou amanhã às 10').time, '10:00');
});

test('correção do título não é adivinhada: vira dúvida', () => {
  const r = read('crie uma tarefa pagar o boleto, quer dizer, pagar a fatura amanhã');
  assert.equal(r.clear, false);
  assert.deepEqual(codes(r), ['correction']);
  assert.equal(r.date, '2026-11-07');
});

// ---------- ficou claro ou não? ----------

test('ficou claro: pode criar direto (inclusive título curto, como o "x" do exemplo)', () => {
  const r = read('quero que crie uma tarefa com título pagar boleto com prazo para dia 10 às 16 horas');
  assert.equal(r.clear, true);
  assert.deepEqual(got(r), { ...NONE, title: 'Pagar boleto', date: '2026-11-10', time: '16:00' });
  const x = read('crie uma tarefa com título x para dia 10 às 16 horas');
  assert.equal(x.clear, true);
  assert.equal(x.title, 'X');
  assert.equal(read('Reunião com a Ana').clear, true, 'sem data nem hora também é uma tarefa clara (vai para "Sem data")');
});

test('sem título: não adivinha, devolve o que entendeu (dia e hora) e o título em branco', () => {
  const r = read('crie uma tarefa para dia 10 às 16 horas');
  assert.equal(r.clear, false);
  assert.equal(r.title, '');
  assert.equal(r.date, '2026-11-10');
  assert.equal(r.time, '16:00');
  assert.deepEqual(codes(r), ['no-title']);
  assert.match(r.issues[0].text, /título/);
  assert.deepEqual(codes(read('crie um lembrete amanhã às 10')), ['no-title']);
});

test('título vago ("algo", "uma coisa", "tarefa") é dúvida; título curto de verdade não', () => {
  assert.deepEqual(codes(read('crie uma tarefa algo amanhã')), ['vague-title']);
  assert.deepEqual(codes(read('crie uma tarefa uma coisa amanhã')), ['vague-title']);
  assert.deepEqual(codes(read('crie uma tarefa x amanhã')), []);
  assert.deepEqual(codes(read('crie uma tarefa Ana amanhã')), []);
});

test('"tarefa" e "lembrete" no começo da frase são o pedido; "tarefa de casa" continua sendo título', () => {
  for (const [frase, titulo] of [
    ['tarefa pagar boleto amanhã', 'Pagar boleto'],
    ['tarefa dentista dia 12 às 15 e 30', 'Dentista'],
    ['lembrete reunião com a equipe amanhã às 10 horas', 'Reunião com a equipe'],
    ['uma tarefa de estudar inglês toda segunda e quarta às 19h', 'Estudar inglês'],
    ['uma tarefa no dia 20 de novembro às três da tarde para consulta no médico', 'Consulta no médico'],
    ['um lembrete para pagar boleto amanhã', 'Pagar boleto'],
  ]) assert.equal(read(frase).title, titulo, frase);
  assert.equal(read('Tarefa de casa de matemática').title, 'Tarefa de casa de matemática');
});

test('o sujeito da frase não entra no título: "tenho reunião", "para eu ir ao mercado", "me avisa amanhã para pagar"', () => {
  for (const [frase, titulo] of [
    ['tenho reunião com o cliente na quinta às 14h30', 'Reunião com o cliente'],
    ['tenho dentista amanhã às 15 horas', 'Dentista'],
    ['então eu quero que você crie uma tarefa para eu ir ao mercado hoje às 18 horas', 'Ir ao mercado'],
    ['quero criar um lembrete para a reunião de segunda às 9 horas', 'Reunião'],
    ['me avisa amanhã às 8 para pagar o boleto', 'Pagar o boleto'],
  ]) assert.equal(read(frase).title, titulo, frase);
  assert.equal(read('Tenho que ligar para o dentista amanhã').title, 'Ligar para o dentista');
});

test('hesitação "é" e enfeites do pedido: "preciso é ligar", "cria uma tarefa é pagar", "então tipo eu quero"', () => {
  for (const [frase, titulo] of [
    ['ah então tipo eu preciso é ligar pro dentista amanhã de manhã né', 'Ligar pro dentista de manhã'],
    ['cria uma tarefa é pagar o aluguel todo dia cinco', 'Pagar o aluguel'],
    ['então eu quero comprar um presente sábado', 'Comprar um presente'],
  ]) assert.equal(read(frase).title, titulo, frase);
  assert.equal(read('cria uma tarefa é pagar o aluguel todo dia cinco').recurrence.monthDay, 5);
});

test('"às oito", "às dez", "à uma": com o acento, número por extenso depois de "às" é hora', () => {
  const r = read('me lembra amanhã às oito de levar o lixo');
  assert.deepEqual(got(r), { ...NONE, title: 'Levar o lixo', date: '2026-11-07', time: '08:00' });
  assert.equal(read('crie uma tarefa reunião amanhã às dez').time, '10:00');
  assert.equal(read('crie uma tarefa almoço amanhã à uma').time, '01:00');
  assert.equal(read('crie uma tarefa reunião amanhã pelas onze').time, '11:00');
  assert.equal(read('crie uma tarefa reunião amanhã às vinte e uma').time, '21:00');
  // sem o acento, "as oito pessoas" é artigo + número; e "às trinta" não é hora
  assert.equal(read('crie uma tarefa receber as oito pessoas amanhã').time, null);
  assert.equal(read('crie uma tarefa reunião amanhã às trinta').time, null);
});

test('"não" sozinho corrige quando vem seguido da mesma coisa de novo; em outras frases não mexe em nada', () => {
  const r = read('ligar para a Ana às 16, não, às 17');
  assert.deepEqual(got(r), { ...NONE, title: 'Ligar para a Ana', time: '17:00' });
  assert.equal(r.clear, true);
  assert.equal(read('crie uma tarefa pagar boleto dia 10, não, dia 12').date, '2026-11-12');
  // aqui o "não" não é correção: a data continua sendo a primeira (a próxima sexta, já que hoje é sexta)
  assert.equal(read('a reunião é sexta, não vou poder ir').date, '2026-11-13');
  assert.equal(read('não esquecer de pagar o boleto amanhã').title, 'Pagar o boleto');
});

test('hora relativa: "daqui a 20 minutos", "em duas horas", "dentro de meia hora" viram uma hora marcada', () => {
  const quando = (frase, now = NOW) => {
    const r = interpretSpoken(frase, { today: T, now, weekStart: 1 });
    return [r.date, r.time, r.title, r.clear];
  };
  assert.deepEqual(quando('me lembra de tirar o bolo do forno daqui a 20 minutos'), [T, '09:20', 'Tirar o bolo do forno', true]);
  assert.deepEqual(quando('crie uma tarefa ligar para a mãe em duas horas'), [T, '11:00', 'Ligar para a mãe', true]);
  assert.deepEqual(quando('ligar para o João dentro de meia hora'), [T, '09:30', 'Ligar para o João', true]);
  assert.deepEqual(quando('conferir o forno em 1 hora e meia'), [T, '10:30', 'Conferir o forno', true]);
  // passou da meia-noite: cai no dia seguinte
  assert.deepEqual(quando('ligar para o João daqui a uma hora', new Date(2026, 10, 6, 23, 30)), ['2026-11-07', '00:30', 'Ligar para o João', true]);
  // duração não é hora marcada
  assert.deepEqual(quando('estudar duas horas por dia'), [null, null, 'Estudar duas horas por dia', true]);
  // sem saber que horas são, não mexe
  assert.equal(normalizeSpoken('ligar daqui a 20 minutos'), 'ligar daqui a 20 minutos');
});

test('"é urgente", "com urgência" e "urgente" no fim da frase viram prioridade urgente', () => {
  const r = read('ligar para o contador urgente');
  assert.equal(r.priority, 4);
  assert.equal(r.title, 'Ligar para o contador');
  assert.equal(read('pagar o boleto amanhã, é urgente').priority, 4);
  assert.equal(read('pagar o boleto amanhã com urgência').priority, 4);
  assert.equal(read('resolver o problema urgente com o cliente').priority, null, '"urgente" no meio do título é só palavra');
});

test('hora ou data que sobrou no título, sem dar para entender, é dúvida', () => {
  const hora = read('crie uma tarefa reunião amanhã às 25 horas');
  assert.deepEqual(codes(hora), ['bad-time']);
  assert.equal(hora.time, null);
  assert.equal(hora.date, '2026-11-07');
  assert.deepEqual(codes(read('crie uma tarefa pagar boleto dia 32')), ['bad-date']);
  assert.equal(read('crie uma tarefa estudar duas horas hoje').clear, true, '"duas horas" é duração, não hora');
});

test('hora sem dia vale hoje; se a hora de hoje já passou, pergunta; dizendo o dia, não há o que perguntar', () => {
  const tarde = read('crie uma tarefa ligar para o João às 16 horas');
  assert.equal(tarde.clear, true);
  assert.equal(tarde.effectiveDate, T);
  const passou = read('crie uma tarefa ligar para o João às 8 horas');
  assert.deepEqual(codes(passou), ['time-passed']);
  assert.equal(passou.time, '08:00');
  assert.equal(passou.effectiveDate, T);
  assert.equal(read('crie uma tarefa ligar para o João hoje às 8 horas').clear, true);
  assert.equal(read('crie uma tarefa ligar para o João amanhã às 8 horas').clear, true);
  // vendo outro dia na tela, a hora vale nesse dia
  const outro = read('crie uma tarefa ligar para o João às 8 horas', { defaultDate: '2026-11-12' });
  assert.equal(outro.clear, true);
  assert.equal(outro.effectiveDate, '2026-11-12');
});

test('lembrete com o tempo por extenso: "me avise quinze minutos antes", "duas horas antes"', () => {
  assert.equal(read('crie uma tarefa reunião amanhã às 15h me avise quinze minutos antes').remind, 15);
  assert.equal(read('crie uma tarefa reunião amanhã às 15h lembrete vinte e cinco minutos antes').remind, 25);
  assert.equal(read('crie uma tarefa reunião amanhã às 15h me avise duas horas antes').remind, 120);
  assert.equal(read('crie uma tarefa reunião amanhã às 15h me avisa quarenta e cinco minutos antes').remind, 45);
  const r = read('crie uma tarefa reunião amanhã às 15h me avise quinze minutos antes');
  assert.equal(r.title, 'Reunião');
  assert.equal(r.clear, true);
});

test('lembrete que sobrou no título sem dar para ler é dúvida; "avisar a Maria antes" é só título', () => {
  const r = read('crie uma tarefa reunião amanhã às 15h me avise 30 dias antes');
  assert.deepEqual(codes(r), ['bad-remind']);
  assert.equal(r.remind, null);
  assert.equal(read('Avisar a Maria antes da reunião amanhã 15h').clear, true);
  assert.equal(read('Chegar 10 minutos antes da reunião amanhã 15h').clear, true);
});

test('lembrete pedido sem hora: é dúvida (o editor guarda o pedido até a hora ser escolhida)', () => {
  const r = read('crie uma tarefa pagar boleto dia 10 e me avise 15 minutos antes');
  assert.equal(r.remind, 15);
  assert.equal(r.time, null);
  assert.deepEqual(codes(r), ['remind-needs-time']);
  assert.equal(r.title, 'Pagar boleto');
  assert.equal(read('crie uma tarefa pagar boleto dia 10 às 10 horas e me avise 15 minutos antes').clear, true);
});

test('áudio sem clareza: confiança baixa vira dúvida; zero ou ausente quer dizer "o navegador não informa"', () => {
  assert.deepEqual(codes(read('crie uma tarefa pagar boleto amanhã', { confidence: 0.3 })), ['low-confidence']);
  assert.equal(read('crie uma tarefa pagar boleto amanhã', { confidence: 0.8 }).clear, true);
  assert.equal(read('crie uma tarefa pagar boleto amanhã', { confidence: 0 }).clear, true);
  assert.equal(read('crie uma tarefa pagar boleto amanhã', { confidence: null }).clear, true);
});

test('várias dúvidas juntas aparecem todas, com o que foi entendido preservado', () => {
  const r = read('crie uma tarefa para dia 10 às 8 horas e me avise 15 minutos antes', { confidence: 0.2 });
  assert.deepEqual(codes(r), ['no-title', 'low-confidence']);
  assert.equal(r.remind, 15);
  assert.equal(r.time, '08:00');
  assert.equal(r.heard, 'crie uma tarefa para dia 10 às 8 horas e me avise 15 minutos antes');
});
