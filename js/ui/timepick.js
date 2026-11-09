// Escolha da hora em duas caixas: a hora (00 a 23) e os minutos de 5 em 5 (00, 05, 10...). No celular cada caixa abre a roda de
// seleção do próprio sistema, então os minutos não vão de 00 a 59, como no campo de hora comum.
import { minuteChoices, splitTime } from '../dates.js';
import { h } from './dom.js';

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));

/**
 * @param {object} options
 * @param {string} [options.label]   nome para leitores de tela ("Hora")
 * @param {(value: string|null) => void} options.onChange  "16:05", ou null quando a hora foi tirada
 */
export function createTimePicker({ label = 'Hora', onChange }) {
  let shownMinutes = ''; // quais minutos a caixa mostra agora (para só refazê-la quando muda, senão ela fecha na cara da pessoa)

  const hour = h('select', { class: 'input', 'aria-label': `${label} (horas)`, onchange: () => changed() },
    h('option', { value: '' }, '--'), HOURS.map((v) => h('option', { value: v }, v)));
  const minute = h('select', { class: 'input', 'aria-label': `${label} (minutos)`, onchange: () => changed() });
  const el = h('span', { class: 'time-pick' }, hour, h('span', { class: 'time-sep', 'aria-hidden': 'true' }, ':'), minute);

  function fillMinutes(current) {
    const choices = minuteChoices(current);
    const sig = choices.join(',');
    if (sig === shownMinutes) return;
    shownMinutes = sig;
    minute.replaceChildren(...choices.map((v) => h('option', { value: v }, v)));
  }

  function changed() {
    if (!hour.value) {
      minute.disabled = true;
      onChange(null);
      return;
    }
    minute.disabled = false;
    onChange(`${hour.value}:${minute.value || '00'}`);
  }

  /**
   * Mostra a hora de uma tarefa ("16:05") ou deixa em branco (null). Só mexe nas caixas se o valor mudou: refazer a lista de minutos
   * (quando um minuto "quebrado" como 07 sai da lista) zera a escolha, então o valor é sempre reaplicado.
   */
  function set(value) {
    const parts = splitTime(value);
    fillMinutes(parts ? parts.minute : null);
    const h = parts ? parts.hour : '';
    const m = parts ? parts.minute : '00';
    if (hour.value !== h) hour.value = h;
    if (minute.value !== m) minute.value = m;
    minute.disabled = !parts;
  }

  fillMinutes(null);
  minute.disabled = true;
  return { el, set, hour, minute };
}
