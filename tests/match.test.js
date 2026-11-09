// Achar a tarefa que a pessoa quis dizer ("a conta de luz", "a reunião de sexta"): js/match.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_SCORE, clearWinner, findTasks, soundsDone, wordsOf } from '../js/match.js';

const TODAY = '2026-11-09'; // segunda-feira
let seq = 0;
const task = (title, extra = {}) => ({ id: `t${++seq}`, title, done: false, date: null, updatedAt: '2026-11-01T10:00:00.000Z', ...extra });
const titles = (found) => found.map((f) => f.task.title);

test('palavras: sem acento, minúsculas, sem palavras de ligação nem "tarefa"', () => {
  assert.deepEqual(wordsOf('Pagar a conta de luz'), ['pagar', 'conta', 'luz']);
  assert.deepEqual(wordsOf('a tarefa do Dentista'), ['dentista']);
  assert.deepEqual(wordsOf(''), []);
  assert.deepEqual(wordsOf(null), []);
});

test('"já paguei a conta de luz": acha a tarefa pelas palavras do alvo, e é clara (não precisa perguntar)', () => {
  const tasks = [task('Pagar a conta de luz', { date: '2026-11-10' }), task('Pagar o boleto da faculdade'), task('Comprar pão')];
  const found = findTasks(tasks, 'conta de luz', { today: TODAY, include: 'open' });
  assert.deepEqual(titles(found), ['Pagar a conta de luz']);
  assert.equal(clearWinner(found), found[0].task);
});

test('a mesma palavra no plural, no singular ou com outra terminação também vale (reunião / reuniões)', () => {
  const tasks = [task('Reuniões com o cliente'), task('Dentista')];
  assert.deepEqual(titles(findTasks(tasks, 'reunião do cliente', { today: TODAY })), ['Reuniões com o cliente']);
});

test('tarefa que não tem nada a ver não aparece, e nada é adivinhado (lista vazia)', () => {
  const tasks = [task('Pagar a conta de luz'), task('Comprar pão')];
  assert.deepEqual(findTasks(tasks, 'academia', { today: TODAY }), []);
  assert.deepEqual(findTasks(tasks, '', { today: TODAY }), []);
  assert.deepEqual(findTasks(tasks, 'a tarefa', { today: TODAY }), [], 'só "tarefa": não diz qual');
  assert.deepEqual(findTasks(tasks, 'sexta', { today: TODAY }), [], 'só uma palavra de tempo: não identifica nenhuma');
  assert.deepEqual(findTasks([], 'conta de luz'), []);
  assert.deepEqual(findTasks(null, 'conta de luz'), []);
});

test('metade das palavras do alvo só dá candidatas fracas: "conta de luz" com "Conta do banco" e "Luz do jardim" nunca é clara', () => {
  const tasks = [task('Conta do banco'), task('Luz do jardim')];
  const found = findTasks(tasks, 'conta de luz', { today: TODAY });
  assert.equal(found.length, 2, 'cada uma tem metade das palavras: entram como candidatas');
  assert.ok(found.every((f) => f.score < 0.7));
  assert.equal(clearWinner(found), null, 'a pessoa confirma qual é (ou nenhuma)');
  // menos da metade das palavras: nem candidata
  assert.deepEqual(findTasks([task('Banco')], 'conta de luz do apartamento novo', { today: TODAY }), []);
});

test('concluir só olha as abertas; excluir e alterar olham todas, as abertas primeiro', () => {
  const aberta = task('Pagar a conta de luz', { date: '2026-11-12' });
  const feita = task('Pagar a conta de luz', { done: true, date: '2026-10-12' });
  assert.deepEqual(findTasks([feita, aberta], 'conta de luz', { today: TODAY, include: 'open' }).map((f) => f.task.id), [aberta.id]);
  const todas = findTasks([feita, aberta], 'conta de luz', { today: TODAY, include: 'all' });
  assert.deepEqual(todas.map((f) => f.task.id), [aberta.id, feita.id], 'a aberta vem primeiro');
  assert.ok(todas[0].score - todas[1].score >= 0.15, 'a concluída perde pontos');
});

test('várias tarefas parecidas: não é clara, e o desempate é a data mais perto de hoje', () => {
  const luz1 = task('Pagar a conta de luz', { date: '2026-11-10' });
  const luz2 = task('Pagar a conta de luz', { date: '2026-12-10' });
  const found = findTasks([luz2, luz1], 'conta de luz', { today: TODAY, include: 'open' });
  assert.deepEqual(found.map((f) => f.task.id), [luz1.id, luz2.id]);
  assert.equal(clearWinner(found), null, 'duas iguais: a pessoa escolhe');
});

test('dicas de tempo desempatam: "reunião de sexta" prefere a que cai numa sexta; "desse mês", a deste mês', () => {
  const sexta = task('Reunião com o cliente', { date: '2026-11-13' }); // sexta
  const quinta = task('Reunião com a equipe', { date: '2026-11-12' }); // quinta
  const f1 = findTasks([quinta, sexta], 'reunião de sexta', { today: TODAY });
  assert.equal(f1[0].task.id, sexta.id);
  assert.ok(f1[0].score > f1[1].score);

  const deste = task('Pagar a conta de luz', { date: '2026-11-20' });
  const proximo = task('Pagar a conta de luz', { date: '2026-12-20' });
  const f2 = findTasks([proximo, deste], 'conta de luz desse mês', { today: TODAY, include: 'open' });
  assert.equal(f2[0].task.id, deste.id);
  assert.equal(clearWinner(f2), deste, 'com a dica, a deste mês fica bem na frente');
});

test('o título que diz a palavra de tempo conta ("Reunião de sexta" na segunda-feira)', () => {
  const t = task('Reunião de sexta', { date: '2026-11-09' });
  const found = findTasks([t, task('Reunião com o cliente', { date: '2026-11-09' })], 'reunião de sexta', { today: TODAY });
  assert.equal(found[0].task.id, t.id);
});

test('soundsDone: "já fiz" é diferente de "preciso fazer" (rede de segurança para a IA que erra o tipo do pedido)', () => {
  for (const feito of ['já paguei a conta de luz desse mês', 'paguei a conta de luz', 'terminei o relatório', 'concluí a reunião', 'liguei para o João', 'o João ligou',
    'marca a conta de luz como feita', 'a conta de luz está paga, pronto', 'comprei o pão', 'fiz o relatório', 'marque como feito o dentista']) {
    assert.equal(soundsDone(feito), true, feito);
  }
  for (const afazer of ['preciso pagar a conta de luz', 'pagar a conta de luz amanhã', 'tenho que ligar para o João', 'vou terminar o relatório', 'comprar pão e leite',
    'marcar dentista amanhã às três da tarde', 'apaga a tarefa do dentista', '', null]) {
    assert.equal(soundsDone(afazer), false, String(afazer));
  }
});

test('linhas fantasma (repetições futuras) e títulos vazios são ignorados; o mínimo vale', () => {
  const real = task('Pagar a conta de luz');
  const fantasma = { ...task('Pagar a conta de luz'), ghost: true };
  const vazia = task('');
  assert.deepEqual(findTasks([fantasma, vazia, real], 'conta de luz').map((f) => f.task.id), [real.id]);
  assert.ok(MIN_SCORE > 0 && MIN_SCORE < 1);
  assert.equal(clearWinner([]), null);
  assert.equal(clearWinner(null), null);
});
