import test from 'node:test';
import assert from 'node:assert/strict';
import { backupFileName, exportJSON, mergeState, parseImport, toCSV } from '../js/io.js';
import { createTask, defaultSettings, seedState } from '../js/model.js';
import { getStorage, loadState, memoryStorage, saveState } from '../js/persist.js';
import { STORAGE_KEY } from '../js/config.js';

const NOW = '2026-11-06T10:00:00.000Z';

test('exportar e importar de volta preserva tudo', () => {
  const seed = seedState('2026-11-06', NOW);
  const r = parseImport(exportJSON(seed, new Date(NOW)));
  assert.ok(r.ok);
  assert.deepEqual(r.state.tasks, seed.tasks);
  assert.deepEqual(r.state.labels, seed.labels);
});

test('importar: erros claros para arquivo inválido e backup vazio é válido', () => {
  assert.equal(parseImport('isso não é json').ok, false);
  assert.equal(parseImport('{"qualquer":1}').ok, false);
  assert.equal(parseImport('"texto"').ok, false);
  const vazio = parseImport('{"tasks":[]}');
  assert.ok(vazio.ok);
  assert.equal(vazio.state.tasks.length, 0);
});

test('mesclar: etiqueta com o mesmo nome é unificada e vence a tarefa mais recente', () => {
  const local = {
    version: 1,
    settings: defaultSettings(),
    labels: [{ id: 'L1', name: 'Trabalho', color: 'blue' }],
    tasks: [{ ...createTask({ title: 'Antiga', labels: ['L1'] }, '2026-11-01T10:00:00.000Z'), id: 'A' }],
  };
  const incoming = {
    version: 1,
    settings: defaultSettings(),
    labels: [{ id: 'X9', name: 'trabalho', color: 'red' }, { id: 'N1', name: 'Nova', color: 'teal' }],
    tasks: [
      { ...createTask({ title: 'Nova versão', labels: ['X9'] }, '2026-11-01T10:00:00.000Z'), id: 'A', updatedAt: '2026-11-05T10:00:00.000Z' },
      { ...createTask({ title: 'Só no arquivo', labels: ['X9', 'N1'] }, '2026-11-02T10:00:00.000Z'), id: 'B' },
    ],
  };
  const { state, added, updated, labelsAdded } = mergeState(local, incoming);
  assert.equal(added, 1);
  assert.equal(updated, 1);
  assert.equal(labelsAdded, 1);
  assert.deepEqual(state.labels.map((l) => l.id), ['L1', 'N1']);
  const A = state.tasks.find((t) => t.id === 'A');
  assert.equal(A.title, 'Nova versão');
  assert.deepEqual(A.labels, ['L1']);
  assert.deepEqual(state.tasks.find((t) => t.id === 'B').labels, ['L1', 'N1']);
  // a versão mais antiga do arquivo não sobrescreve a local
  const velho = mergeState(state, { ...incoming, tasks: [{ ...incoming.tasks[0], title: 'Velha', updatedAt: '2026-10-01T00:00:00.000Z' }] });
  assert.equal(velho.updated, 0);
  assert.equal(velho.state.tasks.find((t) => t.id === 'A').title, 'Nova versão');
});

test('planilha: BOM, separador ";", aspas e proteção contra fórmula', () => {
  const t = { ...createTask({ title: '=SOMA(A1)', notes: 'linha1\nlinha2; "aspas"', date: '2026-11-06', time: '09:30', priority: 3, labels: ['L'], recurrence: { freq: 'day', interval: 1 }, checklist: [{ text: 'a', done: true }, { text: 'b' }] }, NOW), id: 'x' };
  const csv = toCSV({ tasks: [t], labels: [{ id: 'L', name: 'Casa', color: 'red' }] });
  assert.ok(csv.startsWith('﻿Título;Anotações;Data;Hora;Prioridade;Etiquetas;Status;'));
  assert.ok(csv.includes("'=SOMA(A1)"));
  assert.ok(csv.includes('"linha1\nlinha2; ""aspas"""'));
  assert.ok(csv.includes(';06/11/2026;09:30;Alta;Casa;Pendente;'));
  assert.ok(csv.includes(';Todo dia;1/2;"[x] a\n[ ] b";'));
  assert.ok(csv.endsWith('\r\n'));
});

test('planilha: coluna Lembrete (só com hora) no fim de cada linha', () => {
  const com = { ...createTask({ title: 'Reunião', date: '2026-11-10', time: '16:00', remind: 15 }, NOW), id: 'a' };
  const sem = { ...createTask({ title: 'Ligar', date: '2026-11-10', time: '17:00' }, NOW), id: 'b' };
  const [head, a, b] = toCSV({ tasks: [com, sem], labels: [] }).split('\r\n');
  assert.ok(head.endsWith(';Criada em;Lembrete'));
  assert.ok(a.endsWith(';15 minutos antes'));
  assert.ok(b.endsWith(';'), 'sem lembrete: célula vazia');
});

test('backup em JSON preserva o lembrete', () => {
  const t = { ...createTask({ title: 'Reunião', date: '2026-11-10', time: '16:00', remind: 60 }, NOW), id: 'a' };
  const r = parseImport(exportJSON({ tasks: [t], labels: [], settings: defaultSettings() }, new Date(NOW)));
  assert.ok(r.ok);
  assert.equal(r.state.tasks[0].remind, 60);
});

test('nome do arquivo de backup', () => {
  assert.equal(backupFileName('json', new Date(2026, 10, 6)), 'pauta-2026-11-06.json');
});

test('persistência: salvar, carregar e nunca perder dados corrompidos', () => {
  const guardado = new Map();
  const storage = { getItem: (k) => guardado.get(k) ?? null, setItem: (k, v) => guardado.set(k, String(v)), removeItem: (k) => guardado.delete(k) };
  assert.deepEqual(loadState(storage), { state: null });
  const seed = seedState('2026-11-06', NOW);
  assert.ok(saveState(storage, seed));
  assert.deepEqual(loadState(storage).state, seed);

  storage.setItem(STORAGE_KEY, '{quebrado');
  const r = loadState(storage);
  assert.equal(r.state, null);
  assert.equal(r.error, 'corrupt');
  // o texto original foi guardado numa chave de cópia
  const copias = [...guardado.keys()].filter((k) => k.startsWith(`${STORAGE_KEY}:corrompido:`));
  assert.equal(copias.length, 1);
  assert.equal(guardado.get(copias[0]), '{quebrado');
});

test('memoryStorage funciona como localStorage', () => {
  const m = memoryStorage();
  assert.equal(m.getItem('x'), null);
  m.setItem('x', 1);
  assert.equal(m.getItem('x'), '1');
  m.removeItem('x');
  assert.equal(m.getItem('x'), null);
});

test('persistência: armazenamento bloqueado cai para memória sem lançar erro', () => {
  const bloqueado = { get localStorage() { throw new Error('bloqueado'); } };
  const s = getStorage(bloqueado);
  assert.equal(s.isMemory, true);
  assert.ok(saveState(s, seedState('2026-11-06', NOW)));
  const cheio = { getItem: () => null, setItem: () => { throw new Error('cota'); } };
  assert.equal(saveState(cheio, seedState('2026-11-06', NOW)), false);
});
