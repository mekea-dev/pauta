import test from 'node:test';
import assert from 'node:assert/strict';
import { createTask } from '../js/model.js';
import { canonical, emptySnapshot, isEmptySnapshot, mergeSnapshots, pruneDeleted } from '../js/sync/merge.js';

const NOW = '2026-11-06T12:00:00.000Z';
const task = (id, title, updatedAt, extra = {}) => ({ ...createTask({ title, ...extra }, updatedAt), id, updatedAt });
const label = (id, name, updatedAt = '2026-11-01T00:00:00.000Z', color = 'blue') => ({ id, name, color, updatedAt });
const snap = (tasks = [], labels = [], deleted = {}) => ({ tasks, labels, deleted });
const merge = (a, b) => mergeSnapshots(a, b, { now: NOW });
const titles = (s) => s.tasks.map((t) => t.title).sort();

test('une as tarefas dos dois lados; se existe nos dois, vence a mais recente', () => {
  const a = snap([task('1', 'antiga', '2026-11-01T10:00:00.000Z'), task('2', 'só no A', '2026-11-01T10:00:00.000Z')]);
  const b = snap([task('1', 'nova', '2026-11-02T10:00:00.000Z'), task('3', 'só no B', '2026-11-01T10:00:00.000Z')]);
  assert.deepEqual(titles(merge(a, b)), ['nova', 'só no A', 'só no B']);
  assert.deepEqual(titles(merge(b, a)), ['nova', 'só no A', 'só no B']);
});

test('empate de horário: o resultado não depende da ordem', () => {
  const x = task('1', 'versão X', '2026-11-01T10:00:00.000Z');
  const y = task('1', 'versão Y', '2026-11-01T10:00:00.000Z');
  assert.equal(canonical(merge(snap([x]), snap([y]))), canonical(merge(snap([y]), snap([x]))));
});

test('lápide mais nova que a tarefa: a exclusão vale e a lápide é mantida', () => {
  const a = snap([task('1', 'apagada em outro aparelho', '2026-11-01T10:00:00.000Z')]);
  const b = snap([], [], { 1: '2026-11-02T10:00:00.000Z' });
  const m = merge(a, b);
  assert.equal(m.tasks.length, 0);
  assert.equal(m.deleted['1'], '2026-11-02T10:00:00.000Z');
});

test('tarefa alterada DEPOIS da lápide (ex.: exclusão desfeita) sobrevive e a lápide some', () => {
  const a = snap([task('1', 'voltou', '2026-11-03T10:00:00.000Z')]);
  const b = snap([], [], { 1: '2026-11-02T10:00:00.000Z' });
  const m = merge(a, b);
  assert.equal(m.tasks.length, 1);
  assert.equal(m.deleted['1'], undefined);
});

test('etiquetas: vence a edição mais recente (renomear/trocar cor)', () => {
  const a = snap([], [label('L', 'Trabalho', '2026-11-01T00:00:00.000Z', 'blue')]);
  const b = snap([], [label('L', 'Escritório', '2026-11-02T00:00:00.000Z', 'teal')]);
  assert.deepEqual(merge(a, b).labels.map((l) => [l.name, l.color]), [['Escritório', 'teal']]);
});

test('etiquetas com o mesmo nome criadas em aparelhos diferentes viram uma só, e as tarefas passam a usar a que ficou', () => {
  const a = snap([task('1', 'do A', '2026-11-01T10:00:00.000Z', { labels: ['LA'] })], [label('LA', 'Casa')]);
  const b = snap([task('2', 'do B', '2026-11-01T10:00:00.000Z', { labels: ['LB'] })], [label('LB', 'casa')]);
  const m = merge(a, b);
  assert.equal(m.labels.length, 1);
  assert.equal(m.labels[0].id, 'LA'); // fica a de menor id
  assert.ok(m.tasks.every((t) => t.labels.length === 1 && t.labels[0] === 'LA'));
  assert.ok(m.deleted.LB); // a duplicada vira lápide, para sumir dos outros aparelhos também
  assert.equal(canonical(m), canonical(merge(b, a)));
});

test('tarefa que aponta para uma etiqueta que não existe mais perde a referência', () => {
  const a = snap([task('1', 't', '2026-11-01T10:00:00.000Z', { labels: ['X', 'Y'] })], [label('X', 'Fica')]);
  const m = merge(a, emptySnapshot());
  assert.deepEqual(m.tasks[0].labels, ['X']);
});

test('lápides antigas (mais de 90 dias) são esquecidas; as recentes ficam', () => {
  const d = pruneDeleted({ velha: '2026-06-01T00:00:00.000Z', nova: '2026-11-01T00:00:00.000Z' }, NOW);
  assert.deepEqual(Object.keys(d), ['nova']);
});

test('canonical ignora a ordem dos campos e das listas', () => {
  const a = snap([task('1', 'a', '2026-11-01T10:00:00.000Z'), task('2', 'b', '2026-11-01T10:00:00.000Z')]);
  const t1 = a.tasks[0];
  const reordenada = { ...snap([a.tasks[1], { updatedAt: t1.updatedAt, ...t1 }]) };
  assert.equal(canonical(a), canonical(reordenada));
  assert.ok(isEmptySnapshot(emptySnapshot()));
  assert.ok(!isEmptySnapshot(a));
});

// ---------- propriedades: o resultado tem que ser o mesmo em qualquer ordem ----------

function rng(seed) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

// Gera um retrato VÁLIDO (como os que existem de verdade): nomes de etiqueta únicos dentro do retrato,
// tarefas só apontam para etiquetas existentes e nenhum id é tarefa e lápide ao mesmo tempo.
function randomSnapshot(r, tag) {
  const two = (n) => String(Math.floor(r() * n)).padStart(2, '0');
  const day = () => `2026-11-0${1 + Math.floor(r() * 5)}T${two(24)}:${two(60)}:${two(60)}.000Z`; // horários finos: empate é raro, como na vida real
  const bases =[['Casa', 'casa'], ['Trabalho', 'trabalho'], ['Estudos', 'Estudos']].sort(() => r() - 0.5);
  const labels = ['La', 'Lb', 'Lc'].filter(() => r() < 0.7).map((id, i) => label(id, bases[i][Math.floor(r() * 2)], day()));
  const labelIds = labels.map((l) => l.id);
  const tasks = new Map();
  const deleted = {};
  for (let i = 0; i < 14; i++) {
    const id = `t${Math.floor(r() * 10)}`;
    if (r() < 0.25) deleted[id] = day();
    else tasks.set(id, task(id, `${tag}${i}`, day(), { labels: labelIds.length && r() < 0.7 ? [labelIds[Math.floor(r() * labelIds.length)]] : [] }));
  }
  for (const id of tasks.keys()) delete deleted[id];
  return snap([...tasks.values()], labels, deleted);
}

test('propriedades: comutativa, idempotente e "absorvente" em 300 combinações aleatórias', () => {
  const r = rng(20261106);
  for (let i = 0; i < 300; i++) {
    const a = randomSnapshot(r, 'a');
    const b = randomSnapshot(r, 'b');
    const ab = merge(a, b);
    assert.equal(canonical(ab), canonical(merge(b, a)), `comutativa falhou na rodada ${i}`);
    assert.equal(canonical(merge(ab, ab)), canonical(ab), `idempotente falhou na rodada ${i}`);
    // "absorvente": juntar de novo um dos lados que já entrou não muda nada (é o que garante que a sincronização termina)
    assert.equal(canonical(merge(ab, b)), canonical(ab), `reaplicar o lado B mudou o resultado na rodada ${i}`);
    assert.equal(canonical(merge(ab, a)), canonical(ab), `reaplicar o lado A mudou o resultado na rodada ${i}`);
  }
});

// ---------- simulação: 3 aparelhos editando e sincronizando por um único documento na nuvem ----------

function simulate(seed) {
  const r = rng(seed);
  let clock = Date.parse('2026-11-01T00:00:00.000Z');
  const tick = () => new Date((clock += 1000 + Math.floor(r() * 5000))).toISOString();
  const copy = (s) => ({ tasks: [...s.tasks], labels: [...s.labels], deleted: { ...s.deleted } });
  const devices = [emptySnapshot(), emptySnapshot(), emptySnapshot()];
  let server = emptySnapshot();
  let n = 0;
  const pick = (list) => list[Math.floor(r() * list.length)];
  const edit = (d) => {
    const at = tick();
    const p = r();
    if (p < 0.3 || d.tasks.length === 0) {
      d.tasks.push(task(`t${seed}-${n++}`, `tarefa ${n}`, at, { labels: d.labels.length && r() < 0.5 ? [pick(d.labels).id] : [] }));
    } else if (p < 0.55) {
      const i = Math.floor(r() * d.tasks.length);
      d.tasks[i] = { ...d.tasks[i], title: `editada ${at}`, updatedAt: at };
    } else if (p < 0.7) {
      const [x] = d.tasks.splice(Math.floor(r() * d.tasks.length), 1);
      d.deleted[x.id] = at;
    } else if (p < 0.85) {
      const name = pick(['Casa', 'Trabalho', 'Estudos']);
      if (!d.labels.some((l) => l.name.toLowerCase() === name.toLowerCase())) d.labels.push(label(`L${seed}-${n++}`, name, at));
    } else if (d.labels.length) {
      const i = Math.floor(r() * d.labels.length);
      const name = pick(['Casa', 'Trabalho', 'Estudos', 'Lazer']);
      if (!d.labels.some((l, j) => j !== i && l.name.toLowerCase() === name.toLowerCase())) d.labels[i] = { ...d.labels[i], name, updatedAt: at };
    }
  };
  const sync = (i) => {
    const merged = mergeSnapshots(devices[i], server, { now: tick() });
    devices[i] = copy(merged);
    server = copy(merged);
  };
  for (let step = 0; step < 70; step++) {
    const i = Math.floor(r() * 3);
    if (r() < 0.6) edit(devices[i]);
    else sync(i);
  }
  for (let round = 0; round < 2; round++) for (let i = 0; i < 3; i++) sync(i); // ninguém edita mais: todos sincronizam
  return [...devices, server].map(canonical);
}

test('convergência: 3 aparelhos editando e sincronizando em ordem aleatória terminam todos iguais (300 simulações)', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const [d0, d1, d2, server] = simulate(seed);
    assert.equal(d0, server, `aparelho 0 diverge do servidor na simulação ${seed}`);
    assert.equal(d1, server, `aparelho 1 diverge do servidor na simulação ${seed}`);
    assert.equal(d2, server, `aparelho 2 diverge do servidor na simulação ${seed}`);
  }
});
