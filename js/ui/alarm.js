// A tela do alarme: cobre o app, toca o som e só some quando a pessoa toca em Parar, Adiar ou Concluir a tarefa (Esc não fecha).
// Quem decide QUANDO ela aparece é js/alerts.js (chama `update` com os alarmes que estão tocando); quem sabe o que fazer com Parar e
// Adiar também (`app.alerts.stopAlarm` e `snoozeAlarm`). Aqui fica só a tela, o som e a vibração (js/alarm-sound.js).
import { createAlarmSound } from '../alarm-sound.js';
import { SNOOZE_CHOICES } from '../alarm.js';
import { remindLabel } from '../reminders.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { toast } from './overlay.js';

const pad = (n) => String(n).padStart(2, '0');
const clock = (ms) => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`;

/** "Hoje"; num alarme com antecedência, "Hoje · alarme 15 minutos antes". */
function dayLine(e) {
  const day = String(e.day ?? '').split(' às ')[0];
  return e.remind > 0 ? `${day} · alarme ${remindLabel(e.remind).toLowerCase()}` : day;
}

export function createAlarmScreen(app, {
  // o som só é liberado no primeiro toque de quem tem algum alarme que ainda vai tocar
  sound = createAlarmSound({ wantsUnlock: () => app.store.state.tasks.some((t) => t.alarm === true && !t.done) }),
  now = () => new Date(),
} = {}) {
  const dlg = h('dialog', { class: 'alarm-dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'alarm-title', 'aria-describedby': 'alarm-when' });
  document.body.append(dlg);
  dlg.addEventListener('cancel', (e) => e.preventDefault()); // Esc não fecha: o alarme só para com Parar, Adiar ou Concluir
  dlg.addEventListener('pointerdown', () => { if (sound.blocked) sound.start().catch(() => {}); }); // o toque libera o som no navegador

  let entries = []; // os alarmes que estão tocando (do mais antigo ao mais novo)
  let testing = null; // o alarme de teste (Configurações), ou null
  let busy = false;
  let shownKey = '';
  let hintEl = null;

  const current = () => testing ?? entries[0] ?? null;

  sound.onChange(({ blocked }) => { if (hintEl) hintEl.hidden = !blocked; });

  function close() {
    shownKey = '';
    hintEl = null;
    if (dlg.open) dlg.close();
    sound.stop();
  }

  function render(e) {
    const more = testing ? 0 : entries.length - 1;
    hintEl = h('p', { class: 'alarm-hint', role: 'status', hidden: !sound.blocked }, 'Toque na tela para o alarme tocar.');
    dlg.replaceChildren(h('div', { class: 'alarm-body' },
      h('div', { class: 'alarm-ring', 'aria-hidden': 'true' }, icon('alarm-clock', 56)),
      h('p', { class: 'alarm-kind' }, testing ? 'Teste do alarme' : e.snoozed ? 'Alarme adiado' : 'Alarme'),
      h('p', { class: 'alarm-time', id: 'alarm-when' }, e.time),
      h('h2', { class: 'alarm-title', id: 'alarm-title' }, e.title),
      h('p', { class: 'alarm-day' }, testing ? 'É só um teste: nada é alterado.' : dayLine(e)),
      more > 0 ? h('p', { class: 'alarm-more' }, `Mais ${more} ${more === 1 ? 'alarme tocando' : 'alarmes tocando'}.`) : null,
      h('button', { class: 'btn btn-primary alarm-stop', type: 'button', onclick: () => act('stop') }, icon('bell-off', 22), 'Parar'),
      h('div', { class: 'alarm-snooze' }, SNOOZE_CHOICES.map((m) => h('button', { class: 'btn alarm-snooze-btn', type: 'button', onclick: () => act('snooze', m) }, `Adiar ${m} min`))),
      e.taskId && !testing ? h('button', { class: 'btn btn-ghost alarm-done', type: 'button', onclick: () => act('done') }, icon('check', 16), 'Concluir a tarefa') : null,
      hintEl));
    dlg.querySelector('.alarm-stop')?.focus();
  }

  function sync() {
    const e = current();
    if (!e) {
      close();
      return;
    }
    if (!dlg.open) dlg.showModal();
    sound.start().catch(() => {}); // já tocando: não faz nada
    const key = [e.id, e.snoozed ? 's' : '', entries.length, testing ? 't' : ''].join('|');
    if (key === shownKey) return;
    shownKey = key;
    render(e);
  }

  async function act(kind, minutes) {
    const e = current();
    if (busy || !e) return;
    busy = true;
    try {
      if (testing) {
        testing = null;
        sync();
        if (kind === 'snooze') toast(`No alarme de verdade, ele tocaria de novo em ${minutes} minutos.`);
        return;
      }
      if (kind === 'stop') {
        await app.alerts.stopAlarm(e.id);
      } else if (kind === 'snooze') {
        const r = await app.alerts.snoozeAlarm(e.id, minutes);
        toast(`Alarme adiado para ${clock(r.until)}.`);
      } else if (kind === 'done') {
        app.actions.complete(e.taskId);
        await app.alerts.stopAlarm(e.id);
      }
    } finally {
      busy = false;
    }
  }

  return {
    /** Deixa o som liberado: o primeiro toque na tela já basta para o alarme tocar depois. */
    prepare: () => sound.prepare(),
    /** Os alarmes que estão tocando agora (vazio = fecha a tela). Pode ser chamada à vontade. */
    update(list) {
      entries = Array.isArray(list) ? list : [];
      sync();
    },
    /** "Ouvir o alarme" nas Configurações: mostra a tela e toca o som, sem mexer em nenhuma tarefa. */
    test() {
      const at = now();
      testing = { id: 'teste', taskId: null, title: 'Alarme de teste', time: `${pad(at.getHours())}:${pad(at.getMinutes())}`, day: 'Hoje', remind: 0, snoozed: false };
      sync();
    },
    get showing() { return dlg.open; },
  };
}
