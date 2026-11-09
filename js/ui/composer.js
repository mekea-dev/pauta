// Campo de adição rápida: escreva "Reunião sexta 14h !alta #trabalho" e veja o que foi entendido.
// Também aceita fala: o microfone (ou o ditado do teclado do iPhone) escreve o pedido e o app cria a tarefa. O microfone ouve até a
// pessoa tocar nele de novo (ou apertar Enter). Se a fala não ficou clara (sem título, hora que não deu para entender...), o app não
// chuta: abre o editor com o que entendeu já preenchido e o resto em branco (js/ui/editor.js, openDraft).
import { WEEKDAYS_SHORT, capitalize, diffDays, relativeDay, weekday } from '../dates.js';
import { priorityLabel } from '../model.js';
import { parseQuickAdd } from '../parser.js';
import { describe } from '../recurrence.js';
import { remindLabel } from '../reminders.js';
import { createSpeech, createSpeechMemory, describeSpeechError } from '../speech.js';
import { fold } from '../text.js';
import { capitalizeTitle, interpretSpoken } from '../voice.js';
import { clip, h } from './dom.js';
import { icon } from './icons.js';

const EXAMPLES = [
  'Pagar boleto amanhã 10h !alta #contas',
  'Reunião sexta 14:30, me avise 15 min antes',
  'Academia toda segunda e quarta 19h',
  'Dentista dia 20/11 às 15h, me avise 1 hora antes',
  'Planejar a viagem semana que vem',
  'Revisar relatório hoje 16h !urgente',
];

const KEYBOARD_HELP = 'Toque no microfone do teclado e fale, por exemplo: “crie uma tarefa pagar boleto para dia 10 às 16 horas”. Depois toque em Adicionar.';
const BLOCKED_NOTE = 'O microfone do app não está disponível neste aparelho (no iPhone, o modo app costuma bloquear). Use o microfone do teclado: toque nele, fale e depois toque em Adicionar.';

export function createComposer(app) {
  const { store } = app;
  // se o navegador recusar o microfone (iPhone, modo app), o app lembra disso neste aparelho e deixa de insistir por alguns dias
  const speech = createSpeech(globalThis, { memory: createSpeechMemory(app.storage) });
  let ignore = {};
  let ctx = { date: null, labelId: null, priority: 0, hidden: false };
  // o texto do campo veio da fala (ou vai vir do ditado do teclado): lê como pedido falado ("crie uma tarefa... com prazo para dia 10")
  let spoken = false;
  let placeholder = `Nova tarefa… ex.: ${EXAMPLES[0]}`;

  const input = h('input', {
    class: 'composer-input', type: 'text', maxlength: 300, autocomplete: 'off', enterkeyhint: 'done',
    'aria-label': 'Nova tarefa', 'aria-describedby': 'composer-hint',
    placeholder,
    oninput: () => {
      if (speech.listening) speech.cancel(); // a pessoa começou a digitar: o microfone sai da frente e fica o texto dela
      if (!input.value) spoken = false;
      clearNote();
      update();
    },
    onfocus: () => showHint(),
    onblur: () => { rotatePlaceholder(); showHint(); },
    onkeydown: (e) => {
      if (e.key !== 'Escape') return;
      speech.cancel();
      if (input.value) { input.value = ''; ignore = {}; spoken = false; clearNote(); update(); } else input.blur();
    },
  });
  const micBtn = h('button', {
    class: 'icon-btn composer-mic', type: 'button', 'aria-pressed': 'false', 'aria-label': 'Falar a tarefa', title: 'Falar a tarefa',
    onclick: () => onMic(),
  }, icon('mic', 20));
  const preview = h('div', { class: 'composer-preview', hidden: true });
  const note = h('p', { class: 'composer-note', role: 'status', hidden: true });
  const hint = h('p', { class: 'composer-hint', id: 'composer-hint', hidden: true },
    'Escreva do seu jeito: ', h('b', {}, 'amanhã'), ', ', h('b', {}, 'sexta'), ', ', h('b', {}, '15/11'), ', ', h('b', {}, '14h'), ', ',
    h('b', {}, '!alta'), ', ', h('b', {}, '#etiqueta'), ', ', h('b', {}, 'toda segunda'), ', ', h('b', {}, 'me avise 15 min antes'), '… Ou toque no microfone e fale.');
  const addBtn = h('button', { class: 'btn btn-primary composer-add', type: 'submit' }, icon('plus', 18), h('span', {}, 'Adicionar'));
  // Enter (ou "Adicionar") enquanto o microfone ouve = "terminei": para de ouvir e entende o que foi dito
  const form = h('form', { class: 'composer', autocomplete: 'off', onsubmit: (e) => { e.preventDefault(); if (speech.listening) stopListening(); else submit(); } },
    h('div', { class: 'composer-box' }, h('span', { class: 'composer-icon' }, icon('plus', 20)), input, micBtn, addBtn),
    preview, note, hint);

  const rotatePlaceholder = () => {
    if (speech.listening) return;
    placeholder = `Nova tarefa… ex.: ${EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)]}`;
    input.placeholder = placeholder;
  };
  const showHint = () => { hint.hidden = !(document.activeElement === input && !input.value); };

  // ---------- recado sob o campo (ouvindo, erro do microfone, como ditar) ----------
  function showNote(text, kind = 'info', action = null) {
    note.replaceChildren(text);
    if (action) note.append(' ', h('button', { class: 'link-btn', type: 'button', onclick: action.onClick }, action.label));
    note.dataset.kind = kind;
    note.hidden = false;
  }
  function clearNote() {
    note.hidden = true;
    note.replaceChildren();
    delete note.dataset.kind;
  }

  // ---------- voz ----------
  function setListening(on) {
    micBtn.classList.toggle('is-listening', on);
    micBtn.setAttribute('aria-pressed', String(on));
    const label = on ? 'Parar de ouvir' : 'Falar a tarefa';
    micBtn.setAttribute('aria-label', label);
    micBtn.title = label;
    input.placeholder = on ? 'Ouvindo… diga a tarefa' : placeholder;
    if (on) showNote('Ouvindo… fale à vontade. Quando terminar, toque no microfone de novo ou aperte Enter.', 'listening');
    else if (note.dataset.kind === 'listening') clearNote();
  }

  /** Terminei de falar: o navegador entrega o que faltava e a tarefa é entendida (finishVoice). */
  function stopListening() {
    showNote('Entendendo o que você falou…', 'listening'); // antes do stop: se o fim vier na hora, o recado sai junto
    speech.stop();
  }

  function onMic() {
    if (speech.listening) {
      stopListening();
      return;
    }
    clearNote();
    if (speech.usable && startListening()) return;
    // o navegador já recusou o microfone neste aparelho: não insiste, mas a pessoa pode pedir para tentar de novo
    if (speech.blocked) startKeyboardDictation(BLOCKED_NOTE, { retry: true });
    else startKeyboardDictation();
  }

  function startListening() {
    input.value = '';
    ignore = {};
    spoken = true;
    const started = speech.start({
      lang: 'pt-BR',
      onInterim: (text) => { input.value = text; update(); },
      onFinal: (text, info) => finishVoice(text, info),
      onError: (code) => voiceError(code),
      onEnd: ({ text, failed, canceled } = {}) => {
        setListening(false);
        if (!text && !failed && !canceled) showNote(describeSpeechError('no-speech').text, 'warn'); // parou sem ter ouvido nada
      },
    });
    if (!started) {
      spoken = false;
      return false;
    }
    setListening(true);
    update();
    return true;
  }

  /**
   * Terminou de falar: entende o que foi dito. Ficou claro: cria a tarefa (com "Desfazer"). Ficou em dúvida (sem título, uma hora
   * que não deu para ler...): abre o editor com o que entendeu e o resto em branco, para a pessoa completar sem repetir nada.
   */
  function finishVoice(text, info = {}) {
    input.value = text;
    spoken = true;
    ignore = {};
    submit({ byVoice: true, confidence: info?.confidence ?? null });
  }

  /** Abre o editor com a tarefa que foi entendida (`p`, de interpretSpoken): o que não ficou claro fica em branco ou marcado. */
  function openDraft(p) {
    const labelIds = store.ensureLabels(p.labels);
    if (ctx.labelId && store.state.labels.some((l) => l.id === ctx.labelId) && !labelIds.includes(ctx.labelId)) labelIds.push(ctx.labelId);
    const fields = {
      title: p.title, date: p.effectiveDate, time: p.time, remind: p.remind,
      priority: p.priority ?? ctx.priority ?? 0, labels: labelIds, recurrence: p.recurrence,
    };
    input.value = '';
    ignore = {};
    spoken = false;
    clearNote();
    update();
    app.editor.openDraft(fields, { heard: p.heard, issues: p.issues });
  }

  function voiceError(code) {
    const e = describeSpeechError(code);
    if (!e) return; // a pessoa cancelou
    if (e.fatal) startKeyboardDictation(e.text);
    else showNote(e.text, 'warn');
  }

  /** Sem reconhecimento de voz no app (iPhone na Tela de Início, Firefox): leva ao campo, onde o teclado tem o microfone do ditado. */
  function startKeyboardDictation(reason, { retry = false } = {}) {
    spoken = true;
    const again = retry ? { label: 'Tentar o microfone do app de novo', onClick: () => { speech.reset(); onMic(); } } : null;
    showNote(reason ?? KEYBOARD_HELP, reason && !retry ? 'warn' : 'info', again);
    input.focus();
    update();
  }

  // ---------- o que foi entendido ----------
  function parse({ confidence = null } = {}) {
    const opts = { today: store.today(), weekStart: store.state.settings.weekStart, ignore };
    // texto falado: além de ler, diz o que ficou em dúvida (`issues`); texto digitado é lido do jeito de sempre
    return spoken ? interpretSpoken(input.value, { ...opts, now: new Date(), confidence, defaultDate: ctx.date }) : parseQuickAdd(input.value, opts);
  }

  function dateText(date, today) {
    const rel = relativeDay(date, today);
    return diffDays(date, today) >= 7 ? `${capitalize(WEEKDAYS_SHORT[weekday(date)])}, ${rel}` : rel;
  }

  function chip(iconName, text, key, extra = '') {
    return h('span', { class: `pv-chip ${extra}` }, icon(iconName, 13), h('span', {}, text),
      key ? h('button', {
        type: 'button', class: 'pv-x', 'aria-label': `Não reconhecer “${text}”`, title: 'Não reconhecer: manter como texto do título',
        onclick: () => { ignore[key] = true; update(); input.focus(); },
      }, icon('x', 11)) : null);
  }

  function update() {
    const p = parse();
    const today = store.today();
    const chips = [];
    // do que foi falado, o título é o que a pessoa não vê no campo (o texto cru traz o "crie uma tarefa..."): mostra como ficou
    if (spoken && p.title) chips.push(h('span', { class: 'pv-chip pv-title' }, icon('note', 13), h('span', {}, clip(capitalizeTitle(p.title), 50))));
    const dateTok = p.tokens.find((t) => t.type === 'date');
    if (p.date) chips.push(chip('calendar', dateText(p.date, today), dateTok && !dateTok.derived ? 'date' : null));
    if (p.time) chips.push(chip('clock', p.time, 'time'));
    if (p.remind !== null && p.remind !== undefined) {
      chips.push(p.time ? chip('bell', remindLabel(p.remind), 'remind') : chip('bell-off', `${remindLabel(p.remind)}: falta a hora`, 'remind', 'warn'));
    }
    if (p.priority) chips.push(chip('flag', priorityLabel(p.priority), 'priority', `p${p.priority}`));
    if (p.recurrence) chips.push(chip('repeat', describe(p.recurrence, p.date), 'recurrence'));
    if (p.labels.length) {
      const known = new Set(store.state.labels.map((l) => fold(l.name)));
      for (const name of p.labels) chips.push(chip('tag', `#${name}${known.has(fold(name)) ? '' : ' (nova)'}`, 'labels'));
    }
    if (input.value.trim() && !p.title) chips.push(h('span', { class: 'pv-warn' }, 'Falta o título da tarefa'));
    preview.replaceChildren(...chips);
    preview.hidden = chips.length === 0;
    showHint();
  }

  function submit({ byVoice = false, confidence = null } = {}) {
    speech.cancel();
    const p = parse({ confidence });
    // falado e em dúvida: não adivinha, abre o editor para a pessoa conferir e completar
    if (spoken && input.value.trim() && p.issues?.length) {
      openDraft(p);
      return;
    }
    if (!p.title) {
      form.classList.remove('shake');
      void form.offsetWidth; // reinicia a animação
      form.classList.add('shake');
      input.focus();
      return;
    }
    let date = p.date ?? ctx.date ?? null;
    if (!date && p.time) date = store.today(); // hora sem dia: vale hoje
    const labelIds = store.ensureLabels(p.labels);
    if (ctx.labelId && store.state.labels.some((l) => l.id === ctx.labelId) && !labelIds.includes(ctx.labelId)) labelIds.push(ctx.labelId);
    const task = store.addTask({
      title: spoken ? capitalizeTitle(p.title) : p.title, date, time: p.time, remind: p.remind, priority: p.priority ?? ctx.priority ?? 0, labels: labelIds, recurrence: p.recurrence,
    });
    if (!task) return;
    const remindLost = p.remind !== null && p.remind !== undefined && task.remind === null; // pediu lembrete mas a tarefa não tem hora
    input.value = '';
    ignore = {};
    spoken = false;
    clearNote();
    update();
    if (byVoice) app.actions.addedByVoice(task, { remindLost });
    else app.actions.added(task);
  }

  return {
    el: form,
    focus() { input.focus(); },
    refresh: update,
    /** Define onde a tarefa cai por padrão (dia aberto, etiqueta aberta...) e se o campo aparece. */
    setContext(next) {
      ctx = { date: null, labelId: null, priority: 0, hidden: false, ...next };
      form.hidden = ctx.hidden;
    },
  };
}
