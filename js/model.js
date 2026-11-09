// Modelo de dados: tarefas, etiquetas, configurações — e a limpeza de tudo que vem de fora
// (armazenamento, importação), para que dados estranhos nunca quebrem a tela.
import { SCHEMA_VERSION } from './config.js';
import { addDays, isValidDate, isValidTime } from './dates.js';
import { finalizeRule } from './recurrence.js';
import { cleanLine, fold } from './text.js';

export const PRIORITIES = [
  { value: 0, key: 'none', label: 'Sem prioridade' },
  { value: 1, key: 'low', label: 'Baixa' },
  { value: 2, key: 'medium', label: 'Média' },
  { value: 3, key: 'high', label: 'Alta' },
  { value: 4, key: 'urgent', label: 'Urgente' },
];
export const priorityLabel = (p) => (PRIORITIES[p] ?? PRIORITIES[0]).label;

export const LABEL_COLORS = ['red', 'orange', 'amber', 'green', 'teal', 'blue', 'indigo', 'violet', 'pink', 'gray'];
export const LABEL_COLOR_NAMES = {
  red: 'Vermelho', orange: 'Laranja', amber: 'Amarelo', green: 'Verde', teal: 'Turquesa',
  blue: 'Azul', indigo: 'Índigo', violet: 'Violeta', pink: 'Rosa', gray: 'Cinza',
};
// cores sugeridas, em ordem, para etiquetas criadas automaticamente
// (laranja e vermelho ficam de fora: já são as cores das prioridades alta e urgente)
export const AUTO_COLORS = ['blue', 'violet', 'teal', 'green', 'pink', 'indigo', 'amber', 'gray'];

export const LIMITS = { title: 300, notes: 20000, checkItem: 300, checklist: 200, labelName: 40, labelsPerTask: 20 };
/** Maior antecedência do lembrete: 7 dias, em minutos. */
export const MAX_REMIND = 10080;

export function uid() {
  const bytes = new Uint8Array(8);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Date.now().toString(36) + Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10);
}

export const defaultSettings = () => ({ theme: 'auto', weekStart: 1, showDone: true, lastBackupAt: null });

const EPOCH = '1970-01-01T00:00:00.000Z';
const MAX_TOMBSTONES = 5000;

const clampPriority = (p) => {
  const n = Math.trunc(Number(p));
  return Number.isInteger(n) && n >= 0 && n <= 4 ? n : 0;
};
const cleanTitle = (v) => cleanLine(v, LIMITS.title);
const cleanNotes = (v) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').slice(0, LIMITS.notes) : '');
const isoStamp = (v, dflt) => {
  if (typeof v !== 'string') return dflt;
  const t = Date.parse(v);
  return Number.isNaN(t) ? dflt : new Date(t).toISOString();
};
const cleanId = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 64) : null);
/** Lembrete: minutos de antecedência (0 = na hora). Só existe em tarefa com data e hora; fora disso vira null. */
const cleanRemind = (v, hasTime) => {
  if (!hasTime || v === null || v === undefined || v === '') return null;
  const n = Math.trunc(Number(v));
  return Number.isInteger(n) && n >= 0 && n <= MAX_REMIND ? n : null;
};
/** Alarme: o lembrete toca como despertador (som e vibração até a pessoa parar ou adiar). Só existe junto com um lembrete. */
const cleanAlarm = (v, remind) => remind !== null && v === true;

/** Itens do checklist. `keepEmpty` mantém linhas em branco (usado enquanto a pessoa digita). */
export function sanitizeChecklist(raw, { keepEmpty = false } = {}) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const it of raw.slice(0, LIMITS.checklist)) {
    if (!it || typeof it !== 'object') continue;
    const text = cleanLine(it.text, LIMITS.checkItem);
    if (!text && !keepEmpty) continue;
    let id = cleanId(it.id) ?? uid();
    if (seen.has(id)) id = uid();
    seen.add(id);
    out.push({ id, text, done: it.done === true });
  }
  return out;
}

/** Cria uma tarefa nova com valores válidos. */
export function createTask(partial = {}, now = new Date().toISOString()) {
  const date = isValidDate(partial.date) ? partial.date : null;
  const time = date && isValidTime(partial.time) ? partial.time : null;
  const remind = cleanRemind(partial.remind, Boolean(time));
  return {
    id: uid(),
    title: cleanTitle(partial.title),
    notes: cleanNotes(partial.notes),
    date,
    time,
    remind,
    alarm: cleanAlarm(partial.alarm, remind),
    priority: clampPriority(partial.priority),
    labels: [...new Set((Array.isArray(partial.labels) ? partial.labels : []).filter((x) => typeof x === 'string'))].slice(0, LIMITS.labelsPerTask),
    checklist: sanitizeChecklist(partial.checklist, { keepEmpty: true }),
    recurrence: date ? finalizeRule(partial.recurrence, date) : null, // sempre "completa": dia da semana, dia do mês...
    done: false,
    doneAt: null,
    nextId: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** O que a pessoa pode mudar numa tarefa (o resto, como id e datas de criação, é do sistema). */
export const EDITABLE = ['title', 'notes', 'date', 'time', 'remind', 'alarm', 'priority', 'labels', 'checklist', 'recurrence'];

/**
 * Aplica uma mudança a uma tarefa mantendo data e repetição coerentes entre si (ainda sem limpar os valores):
 * tirou a data, deixa de repetir; pediu para repetir sem data, começa hoje. Usada ao editar uma tarefa (store.js)
 * e também no rascunho de uma tarefa nova (ui/editor.js).
 */
export function mergePatch(cur, patch, today) {
  const merged = { ...cur };
  for (const k of EDITABLE) if (k in patch) merged[k] = patch[k];
  if ('date' in patch && !patch.date && !patch.recurrence) merged.recurrence = null; // tirou a data: deixa de repetir
  if (merged.recurrence && !merged.date) merged.date = today; // pediu para repetir sem data: começa hoje
  if (merged.recurrence) merged.recurrence = finalizeRule(merged.recurrence, merged.date);
  return merged;
}

/** Limpa uma tarefa vinda de fora. Retorna null se não tiver título. */
export function sanitizeTask(raw, { now = new Date().toISOString(), labelIds = null, keepEmptyItems = false } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const title = cleanTitle(raw.title);
  if (!title) return null;
  const date = isValidDate(raw.date) ? raw.date : null;
  const time = date && isValidTime(raw.time) ? raw.time : null;
  const remind = cleanRemind(raw.remind, Boolean(time));
  const createdAt = isoStamp(raw.createdAt, now);
  const updatedAt = isoStamp(raw.updatedAt, createdAt);
  const done = raw.done === true;
  return {
    id: cleanId(raw.id) ?? uid(),
    title,
    notes: cleanNotes(raw.notes),
    date,
    time,
    remind,
    alarm: cleanAlarm(raw.alarm, remind),
    priority: clampPriority(raw.priority),
    labels: [...new Set((Array.isArray(raw.labels) ? raw.labels : []).filter((x) => typeof x === 'string' && (!labelIds || labelIds.has(x))))].slice(0, LIMITS.labelsPerTask),
    checklist: sanitizeChecklist(raw.checklist, { keepEmpty: keepEmptyItems }),
    recurrence: date ? finalizeRule(raw.recurrence, date) : null,
    done,
    doneAt: done ? isoStamp(raw.doneAt, updatedAt) : null,
    nextId: cleanId(raw.nextId),
    createdAt,
    updatedAt,
  };
}

export function sanitizeLabels(raw) {
  const out = [];
  const ids = new Set();
  const names = new Set();
  for (const l of Array.isArray(raw) ? raw : []) {
    if (!l || typeof l !== 'object') continue;
    const name = cleanLine(l.name, LIMITS.labelName);
    if (!name) continue;
    const key = fold(name);
    if (names.has(key)) continue;
    let id = cleanId(l.id) ?? uid();
    if (ids.has(id)) id = uid();
    ids.add(id);
    names.add(key);
    out.push({ id, name, color: LABEL_COLORS.includes(l.color) ? l.color : 'gray', updatedAt: isoStamp(l.updatedAt, EPOCH) });
  }
  return out;
}

/** Lápides de exclusão: { id: "momento da exclusão" }. Só ficam as mais recentes. */
export function sanitizeDeleted(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const entries = [];
  for (const [id, at] of Object.entries(raw)) {
    const key = cleanId(id);
    const stamp = isoStamp(at, null);
    if (key && stamp) entries.push([key, stamp]);
  }
  entries.sort((a, b) => (a[1] < b[1] ? 1 : -1));
  return Object.fromEntries(entries.slice(0, MAX_TOMBSTONES));
}

export function sanitizeSettings(raw) {
  const d = defaultSettings();
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    theme: ['auto', 'light', 'dark'].includes(s.theme) ? s.theme : d.theme,
    weekStart: s.weekStart === 0 ? 0 : 1,
    showDone: s.showDone === false ? false : true,
    lastBackupAt: typeof s.lastBackupAt === 'string' && !Number.isNaN(Date.parse(s.lastBackupAt)) ? s.lastBackupAt : null,
  };
}

/** Aceita o estado salvo, o envelope do backup ({app, data}) ou um objeto parcial. */
export function sanitizeState(raw, now = new Date().toISOString()) {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw.data && typeof raw.data === 'object' ? raw.data : raw;
  const labels = sanitizeLabels(src.labels);
  const labelIds = new Set(labels.map((l) => l.id));
  const byId = new Map();
  for (const rt of Array.isArray(src.tasks) ? src.tasks : []) {
    const t = sanitizeTask(rt, { now, labelIds });
    if (!t) continue;
    const prev = byId.get(t.id);
    if (!prev || t.updatedAt >= prev.updatedAt) byId.set(t.id, t);
  }
  return {
    version: SCHEMA_VERSION,
    tasks: [...byId.values()],
    labels,
    deleted: sanitizeDeleted(src.deleted),
    owner: cleanId(src.owner), // conta (nuvem) a que estes dados pertencem; null = só deste aparelho
    seed: src.seed === true, // ainda são só as tarefas de boas-vindas, intocadas
    settings: sanitizeSettings(src.settings),
  };
}

/** Só o que é sincronizado (sem configurações do aparelho). */
export function sanitizeSnapshot(raw, now) {
  const s = sanitizeState({ tasks: raw?.tasks, labels: raw?.labels, deleted: raw?.deleted }, now);
  return { tasks: s.tasks, labels: s.labels, deleted: s.deleted };
}

export const emptyState = (settings = defaultSettings()) => ({
  version: SCHEMA_VERSION, tasks: [], labels: [], deleted: {}, owner: null, seed: false, settings,
});

/**
 * Dados de boas-vindas (tarefas e etiquetas de exemplo). O app NÃO os cria mais (desde a 1.8.0 o primeiro acesso e a conta nova
 * começam zerados, pedido do dono), mas aparelhos antigos ainda guardam esses dados marcados com `seed`; a função fica para os
 * testes simularem esse caso (js/cloud/account.js descarta esses exemplos ao criar ou entrar numa conta).
 */
export function seedState(today, now = new Date().toISOString()) {
  const labels = [
    { id: uid(), name: 'Trabalho', color: 'blue', updatedAt: now },
    { id: uid(), name: 'Pessoal', color: 'violet', updatedAt: now },
    { id: uid(), name: 'Estudos', color: 'teal', updatedAt: now },
    { id: uid(), name: 'Finanças', color: 'green', updatedAt: now },
  ];
  const [trabalho, pessoal, , financas] = labels.map((l) => l.id);
  const t = (p) => createTask(p, now);
  const tasks = [
    t({
      title: 'Conheça o Pauta (toque aqui para abrir)',
      date: today,
      priority: 2,
      notes: [
        'Este campo é para anotações da tarefa: detalhes, links, observações.',
        '',
        'Para adicionar tarefas rápido, escreva no campo lá em cima:',
        '- Pagar boleto amanhã 10h !alta #finanças',
        '- Academia toda segunda e quarta 19h',
        '- Dentista dia 20/11 14:30',
        '',
        'Quando quiser, é só apagar esta tarefa.',
      ].join('\n'),
      checklist: [
        { text: 'Adicionar uma tarefa no campo de cima', done: false },
        { text: 'Marcar este item como feito', done: false },
        { text: 'Abrir uma tarefa e testar o checklist', done: false },
        { text: 'Ver o calendário no menu', done: false },
      ],
    }),
    t({ title: 'Revisar e-mails', date: today, time: '09:00', labels: [trabalho], recurrence: { freq: 'day', interval: 1 } }),
    t({ title: 'Pagar a conta de luz', date: addDays(today, 1), priority: 3, labels: [financas] }),
    t({ title: 'Ideia: planejar a viagem de fim de ano', labels: [pessoal] }),
  ];
  return { version: SCHEMA_VERSION, tasks, labels, deleted: {}, owner: null, seed: true, settings: defaultSettings() };
}
