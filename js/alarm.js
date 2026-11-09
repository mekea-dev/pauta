// Alarme: um lembrete que toca como despertador. Aqui ficam as contas (sem tela, sem som e sem rede):
//   - com o app aberto: o alarme toca (som e vibração, js/alarm-sound.js e js/ui/alarm.js) até a pessoa tocar em Parar ou Adiar
//     (ou até RING_MS se ninguém mexer);
//   - com o app fechado: o serviço de lembretes (worker/lembretes.js) dá um "toque" por minuto, PUSH_COUNT vezes, e o service
//     worker (sw.js) mostra uma notificação do alarme a cada toque. Parar ou adiar corta os toques que faltam (o app manda a
//     lista nova ao serviço, js/alerts.js).
// Quem escolhe o alarme é a tarefa (`alarm: true`, junto com um lembrete); o que a pessoa já fez com ele (parou, adiou) fica só
// neste aparelho. O serviço de lembretes só recebe horários, como nos lembretes comuns: nunca o título da tarefa.
import { reminderBody, reminderEntries } from './reminders.js';

/** Com o app aberto, o alarme toca por no máximo este tempo se ninguém mexer (depois, para sozinho). */
export const RING_MS = 30 * 60000;
/** Com o app fechado: quantos toques o serviço dá (um por minuto) enquanto a pessoa não parar. */
export const PUSH_COUNT = 10;
export const PUSH_EVERY_MS = 60000;
/** Por quanto tempo, depois da hora, ainda chega o toque do alarme (o sw.js usa este valor mais uma folga). */
export const PUSH_WINDOW_MS = PUSH_COUNT * PUSH_EVERY_MS;
/** Os botões de adiar, em minutos. */
export const SNOOZE_CHOICES = [5, 10];
/** Onde, neste aparelho, ficam anotados os alarmes parados e adiados. */
export const ALARM_STATE_KEY = 'pauta:alarmes';
/** O jeito de vibrar (liga, desliga, liga...) em milissegundos: no app e na notificação do alarme (só Android e computador). */
export const ALARM_VIBRATION = [500, 250, 500, 250, 500];

/** A "marca" da notificação de um alarme (o sw.js usa a mesma): a notificação nova troca a anterior em vez de empilhar. */
export const alarmTag = (id) => `alarme-${id}`;

const KEEP_MS = 2 * 86400000; // o que a pessoa fez com um alarme é lembrado por 2 dias

// ---------- o que a pessoa já fez com cada alarme ----------
/** Só números dentro de um limite razoável; o resto é ignorado (o armazenamento pode ter qualquer coisa). */
const stamp = (v) => (Number.isFinite(v) && v > 0 && v < 8.64e15 ? Math.trunc(v) : null);

/** { idDoAviso: { stop } | { until, at } }, sem o que está velho demais ou estragado. */
export function cleanAlarmState(raw, now = Date.now()) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, s] of Object.entries(raw)) {
    if (!id || id.length > 120 || !s || typeof s !== 'object') continue;
    const stop = stamp(s.stop);
    const until = stamp(s.until);
    const at = stamp(s.at);
    if (stop !== null) {
      if (stop >= now - KEEP_MS) out[id] = { stop };
    } else if (until !== null && (at ?? until) >= now - KEEP_MS) {
      out[id] = { until, at: at ?? until };
    }
  }
  return out;
}

/**
 * O que foi parado e adiado, guardado no aparelho (`storage`: getItem/setItem). Cada mudança avisa quem assinou (`subscribe`).
 * Se o armazenamento falhar, vale só até fechar o app.
 */
export function createAlarmState({ storage = null, key = ALARM_STATE_KEY, now = () => Date.now() } = {}) {
  const listeners = new Set();
  const read = () => {
    try {
      return cleanAlarmState(JSON.parse(storage?.getItem(key) ?? 'null'), now());
    } catch {
      return {};
    }
  };
  let data = read();
  const commit = (next) => {
    data = cleanAlarmState(next, now());
    try { storage?.setItem(key, JSON.stringify(data)); } catch { /* sem armazenamento: vale só nesta sessão */ }
    for (const fn of listeners) fn(data);
  };
  return {
    get: () => data,
    /** Parou o alarme: ele não toca mais (nem a notificação com o app fechado). */
    stop(id, t = now()) {
      commit({ ...data, [id]: { stop: t } });
    },
    /** Adiou: toca de novo em `until` (veja snoozeUntil). */
    snooze(id, until, t = now()) {
      commit({ ...data, [id]: { until, at: t } });
    },
    /** Outra aba mexeu: lê de novo do armazenamento. */
    reload() {
      data = read();
      for (const fn of listeners) fn(data);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

// ---------- os alarmes de agora ----------
/** Texto da notificação do alarme (o sw.js mostra este texto pronto: ele não tem o código do app). */
function withTexts(e) {
  const day = reminderBody(e, new Date(e.at)).split(' · ')[0]; // "Hoje às 06:00"
  return { ...e, day, body: `${e.snoozed ? 'Alarme adiado' : 'Alarme'} · ${day}. Toque para parar ou adiar.` };
}

/**
 * Os alarmes das tarefas abertas, do mais cedo ao mais tarde, com o que a pessoa já fez aplicado: o que foi parado some; o que foi
 * adiado toca no horário novo (`at`; `snoozed: true`; `firstAt` guarda o horário de antes).
 */
export function alarmEntries(tasks, state = {}) {
  const out = [];
  for (const r of reminderEntries(tasks)) {
    if (!r.alarm) continue;
    const s = state[r.id];
    if (s?.stop) continue;
    out.push(withTexts(s?.until ? { ...r, at: s.until, firstAt: r.at, snoozed: true } : r));
  }
  return out.sort((a, b) => a.at - b.at);
}

/** O alarme está tocando agora (na hora ou depois dela, até RING_MS)? */
export const isRinging = (e, t) => e.at <= t && t < e.at + RING_MS;

/** O próximo instante em que a lista muda sozinha (um alarme começa ou acaba de tocar), ou null. */
export function nextEdge(list, t) {
  let edge = Infinity;
  for (const e of list) {
    if (e.at > t) edge = Math.min(edge, e.at);
    if (e.at + RING_MS > t) edge = Math.min(edge, e.at + RING_MS);
  }
  return edge === Infinity ? null : edge;
}

/** Quando o alarme adiado volta a tocar: daqui a `minutes`, no próximo minuto cheio (o serviço de lembretes confere de minuto em minuto). */
export function snoozeUntil(now, minutes) {
  return Math.ceil((now + minutes * 60000) / 60000) * 60000;
}

/**
 * Os "toques" do serviço de lembretes para este alarme: um por minuto, PUSH_COUNT vezes, a partir da hora. `from`: os que já
 * passaram antes disso ficam de fora. O primeiro tem o id do alarme; os outros, o id com "~1", "~2"...
 */
export function pushTimes(e, { from = 0 } = {}) {
  const out = [];
  for (let k = 0; k < PUSH_COUNT; k++) {
    const at = e.at + k * PUSH_EVERY_MS;
    if (at >= from) out.push({ id: k === 0 ? e.id : `${e.id}~${k}`, at });
  }
  return out;
}
