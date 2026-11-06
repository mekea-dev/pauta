// Mescla dois "retratos" dos dados (tarefas + etiquetas + lápides de exclusão) sem perder nada.
// É a base da sincronização entre aparelhos: roda igual em todos eles e dá o MESMO resultado
// qualquer que seja a ordem em que os retratos são juntados.
//
// Regras:
//  - tarefas e etiquetas são unidas pelo id; se existem dos dois lados, vence a mais recente (updatedAt);
//  - excluir deixa uma "lápide" (id + momento). A lápide vence se for mais nova que o item,
//    e perde se o item foi alterado depois (ex.: alguém desfez a exclusão);
//  - etiquetas com o mesmo nome criadas em aparelhos diferentes viram uma só.
import { fold } from '../text.js';

const EPOCH = '1970-01-01T00:00:00.000Z';
const DAY_MS = 86400000;

export const emptySnapshot = () => ({ tasks: [], labels: [], deleted: {} });

const stampOf = (x) => x.updatedAt ?? EPOCH;
// quem vence: o mais recente; no empate, um critério fixo (o resultado não pode depender da ordem)
const wins = (a, b) => stampOf(a) > stampOf(b) || (stampOf(a) === stampOf(b) && JSON.stringify(a) > JSON.stringify(b));

/** Esquece lápides antigas (um aparelho que ficou mais de `days` dias offline pode ressuscitar o que foi excluído). */
export function pruneDeleted(deleted, now, days = 90) {
  const limit = new Date(Date.parse(now) - days * DAY_MS).toISOString();
  const out = {};
  for (const [id, at] of Object.entries(deleted ?? {})) if (at >= limit) out[id] = at;
  return out;
}

export function mergeSnapshots(a, b, { now = new Date().toISOString() } = {}) {
  const deleted = {};
  for (const src of [a.deleted ?? {}, b.deleted ?? {}]) {
    for (const [id, at] of Object.entries(src)) if (!deleted[id] || at > deleted[id]) deleted[id] = at;
  }

  const tasks = new Map();
  for (const t of [...a.tasks, ...b.tasks]) {
    const cur = tasks.get(t.id);
    if (!cur || wins(t, cur)) tasks.set(t.id, t);
  }
  const labels = new Map();
  for (const l of [...a.labels, ...b.labels]) {
    const cur = labels.get(l.id);
    if (!cur || wins(l, cur)) labels.set(l.id, l);
  }

  // lápide x item: o mais novo vence
  for (const [id, t] of [...tasks]) {
    if (!deleted[id]) continue;
    if (stampOf(t) <= deleted[id]) tasks.delete(id);
    else delete deleted[id];
  }
  const dead = []; // etiquetas excluídas: ainda ajudam a redirecionar referências antigas
  for (const [id, l] of [...labels]) {
    if (!deleted[id]) continue;
    if (stampOf(l) <= deleted[id]) {
      labels.delete(id);
      dead.push(l);
    } else {
      delete deleted[id];
    }
  }

  // mesmo nome, ids diferentes: fica a de menor id e as tarefas passam a apontar para ela
  const byName = new Map();
  const remap = new Map();
  for (const l of [...labels.values()].sort((x, y) => (x.id < y.id ? -1 : 1))) {
    const key = fold(l.name);
    const keep = byName.get(key);
    if (!keep) {
      byName.set(key, l);
    } else {
      remap.set(l.id, keep.id);
      labels.delete(l.id);
      deleted[l.id] = now;
    }
  }
  // um aparelho desatualizado pode reenviar tarefas ligadas a uma duplicada já excluída: redireciona para a que ficou
  for (const l of dead) {
    const keep = byName.get(fold(l.name));
    if (keep) remap.set(l.id, keep.id);
  }

  // Trocar/remover a etiqueta de uma tarefa é uma alteração de verdade: a tarefa ganha um horário NOVO (sempre maior que
  // o atual), senão uma cópia antiga com o mesmo horário empataria e desfaria o redirecionamento.
  const bump = (t) => {
    const base = Date.parse(stampOf(t));
    return Date.parse(now) > base ? now : new Date(base + 1).toISOString();
  };
  const cleaned = [...tasks.values()].map((t) => {
    const ls = [...new Set(t.labels.map((id) => remap.get(id) ?? id).filter((id) => labels.has(id)))];
    const same = ls.length === t.labels.length && ls.every((id, i) => id === t.labels[i]);
    return same ? t : { ...t, labels: ls, updatedAt: bump(t) };
  });

  return { tasks: cleaned, labels: [...labels.values()], deleted: pruneDeleted(deleted, now) };
}

// ---------- comparação e texto ----------

/** JSON com chaves em ordem fixa (para comparar conteúdo, não a ordem em que os campos foram escritos). */
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Texto canônico de um retrato: dois retratos com o mesmo conteúdo dão o mesmo texto. */
export function canonical(s) {
  const byId = (x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
  return stable({ tasks: [...s.tasks].sort(byId), labels: [...s.labels].sort(byId), deleted: s.deleted ?? {} });
}

export const isEmptySnapshot = (s) => s.tasks.length === 0 && s.labels.length === 0;
