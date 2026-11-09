// Backup, restauração e planilha: tudo em arquivos que a própria pessoa guarda.
import { formatDateBR, formatStamp } from './dates.js';
import { sanitizeState, priorityLabel } from './model.js';
import { describe } from './recurrence.js';
import { remindDescribe } from './reminders.js';
import { fold } from './text.js';

/** Backup completo em JSON (tarefas, etiquetas, configurações). */
export function exportJSON(state, now = new Date()) {
  return JSON.stringify(
    { app: 'pauta', version: state.version ?? 1, exportedAt: now.toISOString(), data: { tasks: state.tasks, labels: state.labels, settings: state.settings } },
    null,
    2,
  );
}

/** Lê um backup. Aceita o formato do Pauta ou um JSON simples { tasks, labels }. */
export function parseImport(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'O arquivo não é um JSON válido.' };
  }
  const src = raw && typeof raw === 'object' ? (raw.data && typeof raw.data === 'object' ? raw.data : raw) : null;
  if (!src || !Array.isArray(src.tasks)) return { ok: false, error: 'Não encontrei tarefas nesse arquivo.' };
  const state = sanitizeState(raw);
  return state ? { ok: true, state } : { ok: false, error: 'Formato de arquivo não reconhecido.' };
}

/**
 * Junta o que veio no arquivo com o que já existe: tarefas com o mesmo id ficam com a versão
 * mais recente; etiquetas iguais (mesmo id ou mesmo nome) são unificadas.
 */
export function mergeState(local, incoming) {
  const labelMap = new Map();
  const labels = [...local.labels];
  let labelsAdded = 0;
  for (const l of incoming.labels) {
    const hit = labels.find((x) => x.id === l.id) ?? labels.find((x) => fold(x.name) === fold(l.name));
    if (hit) {
      labelMap.set(l.id, hit.id);
    } else {
      labels.push(l);
      labelMap.set(l.id, l.id);
      labelsAdded++;
    }
  }
  const byId = new Map(local.tasks.map((t) => [t.id, t]));
  let added = 0;
  let updated = 0;
  for (const raw of incoming.tasks) {
    const t = { ...raw, labels: [...new Set(raw.labels.map((id) => labelMap.get(id)).filter(Boolean))] };
    const cur = byId.get(t.id);
    if (!cur) {
      byId.set(t.id, t);
      added++;
    } else if (t.updatedAt > cur.updatedAt) {
      byId.set(t.id, t);
      updated++;
    }
  }
  return { state: { ...local, tasks: [...byId.values()], labels }, added, updated, labelsAdded };
}

// Planilha: ";" como separador e BOM UTF-8, para abrir direto no Excel em português.
const HEAD = ['Título', 'Anotações', 'Data', 'Hora', 'Prioridade', 'Etiquetas', 'Status', 'Concluída em', 'Repetição', 'Checklist', 'Itens do checklist', 'Criada em', 'Lembrete'];

function cell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // evita que o Excel trate texto como fórmula
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(state) {
  const labelName = new Map(state.labels.map((l) => [l.id, l.name]));
  const rows = [...state.tasks]
    .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || (a.time ?? '').localeCompare(b.time ?? '') || a.createdAt.localeCompare(b.createdAt))
    .map((t) => {
      const total = t.checklist.length;
      return [
        t.title,
        t.notes,
        t.date ? formatDateBR(t.date) : '',
        t.time ?? '',
        t.priority ? priorityLabel(t.priority) : '',
        t.labels.map((id) => labelName.get(id)).filter(Boolean).join(', '),
        t.done ? 'Concluída' : 'Pendente',
        t.doneAt ? formatStamp(t.doneAt) : '',
        t.recurrence ? describe(t.recurrence, t.date) : '',
        total ? `${t.checklist.filter((c) => c.done).length}/${total}` : '',
        t.checklist.map((c) => `${c.done ? '[x]' : '[ ]'} ${c.text}`).join('\n'),
        formatStamp(t.createdAt),
        t.remind != null && t.time ? remindDescribe(t.remind, t.alarm === true) : '',
      ];
    });
  return `﻿${[HEAD, ...rows].map((r) => r.map(cell).join(';')).join('\r\n')}\r\n`;
}

export function backupFileName(ext, now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `pauta-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.${ext}`;
}
