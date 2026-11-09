// Datas como texto "AAAA-MM-DD" (sem fuso horário) e horas como "HH:MM".
// Tudo aqui é função pura: fácil de testar e imune a horário de verão.

export const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
export const WEEKDAYS_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const WEEKDAYS_INITIAL = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
export const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const DAY_MS = 86400000;
const pad2 = (n) => String(n).padStart(2, '0');
export const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const toISO = (y, m, d) => `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
/** m = 1..12 */
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function parseISO(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (y < 1900 || y > 2999 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return { y, m: mo, d };
}

export const isValidDate = (s) => parseISO(s) !== null;
export const isValidTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** De quanto em quanto os minutos aparecem na escolha da hora: 00, 05, 10... */
export const MINUTE_STEP = 5;

/** "16:05" -> { hour: '16', minute: '05' }; hora inválida ou vazia -> null. */
export function splitTime(s) {
  return isValidTime(s) ? { hour: s.slice(0, 2), minute: s.slice(3, 5) } : null;
}

/**
 * Minutos oferecidos na escolha da hora, de 5 em 5 ("00", "05", ... "55"). Um minuto "quebrado" que a tarefa já tem
 * (14:07, que veio de uma frase digitada) também aparece, para a escolha não mudar o horário sem querer.
 */
export function minuteChoices(current = null) {
  const minutes = [];
  for (let m = 0; m < 60; m += MINUTE_STEP) minutes.push(m);
  const now = current === null || current === '' ? NaN : Number(current);
  if (Number.isInteger(now) && now >= 0 && now < 60 && !minutes.includes(now)) minutes.push(now);
  return minutes.sort((a, b) => a - b).map(pad2);
}

/** Data de hoje no fuso do navegador. */
export const todayISO = (now = new Date()) => toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
/** Data local (AAAA-MM-DD) de um instante ISO, ex.: quando a tarefa foi concluída. */
export const localDate = (iso) => todayISO(new Date(iso));

const dayNum = (s) => {
  const { y, m, d } = parseISO(s);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
};
const fromDayNum = (n) => {
  const dt = new Date(n * DAY_MS);
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
};

export const addDays = (s, n) => fromDayNum(dayNum(s) + n);
/** Quantos dias de `a` até `b` (b - a... aqui: a - b). diffDays('2026-11-07','2026-11-06') === 1 */
export const diffDays = (a, b) => dayNum(a) - dayNum(b);
/** 0 = domingo ... 6 = sábado */
export const weekday = (s) => new Date(dayNum(s) * DAY_MS).getUTCDay();
/** Primeiro dia da semana que contém `s` (weekStart: 0 = domingo, 1 = segunda). */
export const startOfWeek = (s, weekStart = 1) => addDays(s, -((weekday(s) - weekStart + 7) % 7));

/** Soma meses mantendo o dia (ou o último dia do mês, se ele não existir). */
export function addMonths(s, n) {
  const { y, m, d } = parseISO(s);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return toISO(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** 42 datas (6 semanas) para desenhar o calendário do mês. */
export function monthGrid(year, month, weekStart = 1) {
  const start = startOfWeek(toISO(year, month, 1), weekStart);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** Iniciais/abreviações dos dias da semana começando em `weekStart`. */
export function weekdayLabels(weekStart = 1) {
  const order = Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);
  return { order, initial: order.map((d) => WEEKDAYS_INITIAL[d]), short: order.map((d) => WEEKDAYS_SHORT[d]) };
}

// ---------- formatação em português ----------

export function formatLong(s) {
  const { y, m, d } = parseISO(s);
  return `${d} de ${MONTHS[m - 1]} de ${y}`;
}

export function formatShort(s, withYear = false) {
  const { y, m, d } = parseISO(s);
  return `${d} ${MONTHS_SHORT[m - 1]}${withYear ? ` ${y}` : ''}`;
}

export function monthTitle(year, month) {
  return `${capitalize(MONTHS[month - 1])} de ${year}`;
}

/** "Hoje" | "Amanhã" | "Ontem" | "Sexta-feira" — título de um dia. */
export function dayTitle(s, today) {
  const diff = diffDays(s, today);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Amanhã';
  if (diff === -1) return 'Ontem';
  return capitalize(WEEKDAYS[weekday(s)]);
}

/** "sexta-feira, 6 de novembro" (com o ano só se não for o ano atual). */
export function daySubtitle(s, today) {
  const { y, m, d } = parseISO(s);
  const sameYear = y === parseISO(today).y;
  return `${WEEKDAYS[weekday(s)]}, ${d} de ${MONTHS[m - 1]}${sameYear ? '' : ` de ${y}`}`;
}

/** Cabeçalho de um grupo de dias: { title: 'Amanhã', subtitle: 'sábado, 7 de novembro' } */
export function dayHeading(s, today) {
  const diff = diffDays(s, today);
  const { y, m, d } = parseISO(s);
  const dayMonth = `${d} de ${MONTHS[m - 1]}${y !== parseISO(today).y ? ` de ${y}` : ''}`;
  if (diff >= -1 && diff <= 1) return { title: dayTitle(s, today), subtitle: daySubtitle(s, today) };
  return { title: capitalize(WEEKDAYS[weekday(s)]), subtitle: dayMonth };
}

/** Rótulo curto para etiquetas de tarefa: Hoje, Amanhã, Sexta, 12 nov, há 3 dias... */
export function relativeDay(s, today) {
  const diff = diffDays(s, today);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Amanhã';
  if (diff === -1) return 'Ontem';
  if (diff >= 2 && diff <= 6) return capitalize(WEEKDAYS[weekday(s)].replace('-feira', ''));
  if (diff <= -2 && diff >= -6) return `há ${-diff} dias`;
  return formatShort(s, parseISO(s).y !== parseISO(today).y);
}

/** 06/11/2026 */
export function formatDateBR(s) {
  const p = parseISO(s);
  return p ? `${pad2(p.d)}/${pad2(p.m)}/${p.y}` : '';
}

/** 06/11/2026 14:30 (horário local) a partir de um instante ISO. */
export function formatStamp(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
