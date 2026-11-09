// Lembretes ("despertador"): a tarefa tem data e hora e um aviso X minutos ANTES. Aqui ficam as contas (sem tela e sem rede):
// quando avisar, quais avisos já estão na hora e o texto de cada um. A hora é a do relógio do aparelho.
import { relativeDay } from './dates.js';

/** Antecedências oferecidas na tela, em minutos (0 = na hora). Outros valores (45 min, 3 horas...) também valem. */
export const REMIND_PRESETS = [0, 5, 10, 15, 30, 60, 120, 1440];

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** 0 -> "Na hora"; 15 -> "15 minutos antes"; 60 -> "1 hora antes"; 1440 -> "1 dia antes". */
export function remindLabel(minutes) {
  if (minutes === 0) return 'Na hora';
  if (minutes % 1440 === 0) return `${plural(minutes / 1440, 'dia', 'dias')} antes`;
  if (minutes % 60 === 0) return `${plural(minutes / 60, 'hora', 'horas')} antes`;
  return `${plural(minutes, 'minuto', 'minutos')} antes`;
}

/** Versão curta para a linha da tarefa: "na hora", "15 min", "1 h", "1 dia". */
export function remindShort(minutes) {
  if (minutes === 0) return 'na hora';
  if (minutes % 1440 === 0) return plural(minutes / 1440, 'dia', 'dias');
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  return `${minutes} min`;
}

/** O que o lembrete é, por extenso: "15 minutos antes"; no alarme, "Alarme 15 minutos antes" ou "Alarme na hora". */
export function remindDescribe(minutes, alarm = false) {
  if (!alarm) return remindLabel(minutes);
  return minutes === 0 ? 'Alarme na hora' : `Alarme ${remindLabel(minutes).toLowerCase()}`;
}

/** O mesmo, curto, para a linha da tarefa: "15 min"; no alarme, "alarme" ou "alarme 15 min". */
export function remindBrief(minutes, alarm = false) {
  if (!alarm) return remindShort(minutes);
  return minutes === 0 ? 'alarme' : `alarme ${remindShort(minutes)}`;
}

/** Quando a tarefa vence (hora local), ou null se não tem data e hora. */
export function dueAt(task) {
  if (!task?.date || !task?.time) return null;
  const [y, m, d] = task.date.split('-').map(Number);
  const [hh, mm] = task.time.split(':').map(Number);
  const at = new Date(y, m - 1, d, hh, mm, 0, 0);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** Quando o aviso deve tocar (hora local), ou null se a tarefa não tem lembrete. */
export function remindAt(task) {
  const due = dueAt(task);
  return due && Number.isInteger(task.remind) ? new Date(due.getTime() - task.remind * 60000) : null;
}

/**
 * Um aviso: `id` muda se a data, a hora ou a antecedência mudarem (então um aviso novo pode tocar de novo).
 * `alarm: true` só aparece nos alarmes (js/alarm.js cuida deles: tocam até a pessoa parar ou adiar).
 */
function entry(task, at, due) {
  return {
    id: `${task.id}|${at.toISOString()}`, taskId: task.id, title: task.title, at: at.getTime(), dueAt: due.getTime(), date: task.date, time: task.time, remind: task.remind,
    ...(task.alarm === true ? { alarm: true } : {}),
  };
}

/** Todos os avisos das tarefas abertas, comuns e alarmes, do mais cedo ao mais tarde. */
export function reminderEntries(tasks) {
  const out = [];
  for (const t of tasks) {
    if (t.done) continue;
    const at = remindAt(t);
    if (at) out.push(entry(t, at, dueAt(t)));
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Avisos comuns que ainda vão tocar (do mais próximo para o mais distante). Os alarmes ficam de fora: veja js/alarm.js. */
export function upcoming(tasks, now = new Date(), { horizonMs = 30 * 86400000, limit = 200 } = {}) {
  const t = now.getTime();
  return reminderEntries(tasks).filter((r) => !r.alarm && r.at > t && r.at <= t + horizonMs).slice(0, limit);
}

/**
 * Avisos comuns que já estão na hora de tocar: o horário do aviso passou, mas a tarefa não está atrasada há muito tempo
 * (`lateMs`). Serve também para avisar de algo que passou com o app fechado. Os alarmes ficam de fora: veja js/alarm.js.
 */
export function due(tasks, now = new Date(), { lateMs = 30 * 60000 } = {}) {
  const t = now.getTime();
  return reminderEntries(tasks).filter((r) => !r.alarm && r.at <= t && r.dueAt + lateMs >= t);
}

/** Texto do aviso: "Hoje às 16:00 · em 15 minutos". */
export function reminderBody(r, now = new Date()) {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const day = r.date === today ? 'Hoje' : relativeDay(r.date, today);
  const diff = Math.round((r.dueAt - now.getTime()) / 60000);
  const when = diff > 1 ? `em ${diff < 60 ? plural(diff, 'minuto', 'minutos') : diff < 1440 ? `${plural(Math.floor(diff / 60), 'hora', 'horas')}${diff % 60 ? ` e ${diff % 60} min` : ''}` : plural(Math.round(diff / 1440), 'dia', 'dias')}`
    : diff >= -1 ? 'agora' : `há ${plural(-diff, 'minuto', 'minutos')}`;
  return `${day} às ${r.time} · ${when}`;
}

/**
 * O aviso com o texto da notificação já pronto (`body`, e `day` = só "Hoje às 16:00"). Com o app fechado quem mostra a
 * notificação é o service worker, que não tem este código: ele lê estes textos prontos da cópia guardada no aparelho.
 * O texto vale para a hora em que o aviso deve tocar; se o aviso chegar atrasado, o service worker usa só `day`.
 */
export function notificationEntry(r) {
  const body = reminderBody(r, new Date(r.at));
  return { ...r, body, day: body.split(' · ')[0] };
}
