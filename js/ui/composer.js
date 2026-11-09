// Campo de adição rápida: escreva "Reunião sexta 14h !alta #trabalho" e veja o que foi entendido.
// Também aceita fala: o microfone (ou o ditado do teclado do iPhone) escreve o pedido e o app cria a tarefa. O microfone ouve até a
// pessoa mandar parar ("Parar e enviar", tocar nele de novo ou apertar Enter). Se a fala não ficou clara (sem título, hora que não deu
// para entender...), o app não chuta: abre o editor com o que entendeu já preenchido e o resto em branco (js/ui/editor.js, openDraft).
// Com "Entender a fala com IA" ligada (é o padrão; as Configurações desligam), o texto falado passa antes por uma IA que o reescreve usando
// só o que foi dito (js/ai.js); sem ela, ou se ela falhar ou demorar, valem as regras do aparelho (js/voice.js). A tela nunca fica presa
// esperando: o microfone termina sozinho (js/speech.js) e a espera da IA tem prazo e um botão "Pular a IA".
import { describeAiFailure, interpretAiReply } from '../ai.js';
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
import { toast } from './overlay.js';

const EXAMPLES = [
  'Pagar boleto amanhã 10h !alta #contas',
  'Reunião sexta 14:30, me avise 15 min antes',
  'Academia toda segunda e quarta 19h',
  'Dentista dia 20/11 às 15h, me avise 1 hora antes',
  'Planejar a viagem semana que vem',
  'Revisar relatório hoje 16h !urgente',
];

const NO_WORDS_MS = 8000; // microfone ligado e nenhuma palavra por tanto tempo: avisa
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
  // IA: a linha do campo passa a ser a reescrita dela; `aiExtra` guarda o que foi dito de verdade e as dúvidas que ela apontou
  let aiExtra = null; // { heard, doubts }
  let aiRead = false; // a IA já leu o texto que está no campo (não pede de novo)
  let waiting = null; // o texto que está esperando a resposta da IA
  let aiAbort = null; // o pedido à IA em andamento (abortar = pular a IA)
  let noWordsTimer = 0; // avisa quando o microfone está ligado mas nenhuma palavra apareceu
  let pausedText = null; // o texto que ficou no campo quando o microfone parou sozinho (continuar falando o retoma)
  let placeholder = `Nova tarefa… ex.: ${EXAMPLES[0]}`;

  /** O texto do campo mudou por conta da pessoa (ou foi limpo): a leitura da IA, se havia, não vale mais. */
  const forgetAi = () => {
    aiExtra = null;
    aiRead = false;
    waiting = null;
    aiAbort?.abort(); // se a IA ainda estava respondendo, abandona o pedido
    aiAbort = null;
    if (addBtn) addBtn.disabled = false;
  };

  const input = h('input', {
    class: 'composer-input', type: 'text', maxlength: 300, autocomplete: 'off', enterkeyhint: 'done',
    'aria-label': 'Nova tarefa', 'aria-describedby': 'composer-hint',
    placeholder,
    oninput: () => {
      if (speech.listening) speech.cancel(); // a pessoa começou a digitar: o microfone sai da frente e fica o texto dela
      if (!input.value) spoken = false;
      pausedText = null;
      forgetAi();
      clearNote();
      update();
    },
    onfocus: () => showHint(),
    onblur: () => { rotatePlaceholder(); showHint(); },
    onkeydown: (e) => {
      if (e.key !== 'Escape') return;
      speech.cancel();
      if (input.value) { input.value = ''; ignore = {}; spoken = false; pausedText = null; forgetAi(); clearNote(); update(); } else input.blur();
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
    clearTimeout(noWordsTimer);
    if (on) {
      // o botão do recado é o jeito mais claro de terminar (no iPhone o teclado nem aparece, então não há Enter)
      showNote('Ouvindo… pode fazer pausas. Só envio quando você tocar no microfone ou apertar Enter.', 'listening', { label: 'Parar e enviar', onClick: () => stopListening() });
      noWordsTimer = setTimeout(noWordsYet, NO_WORDS_MS);
    } else if (note.dataset.kind === 'listening') {
      clearNote();
    }
  }

  /** O microfone está ligado há um tempo e nenhuma palavra apareceu: pode ser que o reconhecimento não funcione aqui. */
  function noWordsYet() {
    if (!speech.listening || input.value.trim() || note.dataset.kind !== 'listening') return;
    speech.note('no-words');
    showNote('Ainda não apareceu nenhuma palavra.', 'listening', {
      label: 'Usar o microfone do teclado',
      onClick: () => { speech.cancel(); startKeyboardDictation(); },
    });
  }

  /** Terminei de falar: o navegador entrega o que faltava e a tarefa é entendida (finishVoice). Tocar de novo não espera mais. */
  function stopListening() {
    clearTimeout(noWordsTimer);
    speech.note('ui-stop');
    showNote('Entendendo o que você falou…', 'listening', { label: 'Enviar agora', onClick: () => speech.stop() }); // antes do stop: se o fim vier na hora, o recado sai junto
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
    // o microfone parou sozinho (silêncio longo...) e o texto continua no campo: tocar no microfone CONTINUA a frase em vez de apagá-la
    const resume = pausedText !== null && input.value.trim() === pausedText.trim();
    const prefix = resume ? input.value : '';
    pausedText = null;
    if (!resume) input.value = '';
    ignore = {};
    spoken = true;
    forgetAi();
    const started = speech.start({
      lang: 'pt-BR',
      prefix,
      onInterim: (text) => { input.value = text; update(); },
      onFinal: (text, info) => finishVoice(text, info), // só quando a pessoa manda parar (Enter, Parar e enviar, tocar no microfone)
      onError: (code) => voiceError(code),
      onEnd: ({ text, failed, canceled, paused } = {}) => {
        setListening(false);
        if (paused && text) { // o app parou de ouvir sozinho: nada foi enviado, o texto fica no campo para continuar ou criar
          pausedText = text;
          showNote('Parei de ouvir. Toque em Adicionar para criar a tarefa, ou', 'info', { label: 'continue falando', onClick: () => onMic() });
        } else if (!text && !failed && !canceled) {
          showNote(describeSpeechError('no-speech').text, 'warn'); // parou sem ter ouvido nada
        }
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
    speech.note('draft', p.issues.map((i) => i.code));
    const labelIds = store.ensureLabels(p.labels);
    if (ctx.labelId && store.state.labels.some((l) => l.id === ctx.labelId) && !labelIds.includes(ctx.labelId)) labelIds.push(ctx.labelId);
    const fields = {
      title: p.title, date: p.effectiveDate, time: p.time, remind: p.remind,
      priority: p.priority ?? ctx.priority ?? 0, labels: labelIds, recurrence: p.recurrence, notes: aiExtra?.notes ?? '',
    };
    input.value = '';
    ignore = {};
    spoken = false;
    pausedText = null;
    forgetAi();
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
    if (!spoken) return parseQuickAdd(input.value, opts); // texto digitado é lido do jeito de sempre
    // texto falado: além de ler, diz o que ficou em dúvida (`issues`)
    const p = interpretSpoken(input.value, { ...opts, now: new Date(), confidence, defaultDate: ctx.date });
    if (aiExtra) { // a linha do campo é a reescrita da IA: no rascunho aparece o que a pessoa disse, e as dúvidas da IA entram junto
      p.heard = aiExtra.heard;
      const titleIssue = p.issues.some((i) => i.code === 'no-title' || i.code === 'vague-title'); // já dito pelas regras: não repete
      for (const text of aiExtra.doubts) if (!(titleIssue && /t[ií]tulo|tarefa/i.test(text))) p.issues.push({ code: 'ai', text });
      p.clear = p.issues.length === 0;
    }
    return p;
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

  /**
   * Pede à IA (se estiver ligada e disponível) que reescreva o texto falado e põe a reescrita no campo. Tem prazo (js/ai.js) e a
   * pessoa pode pular a espera; nada aqui deixa a tela presa. Se a IA não servir, o texto fica como a pessoa falou e valem as regras.
   * Devolve false se a pessoa mexeu no campo enquanto esperava (aí não se faz mais nada com a resposta).
   */
  async function understandWithAi() {
    const heard = input.value;
    const controller = new AbortController();
    waiting = heard;
    aiAbort = controller;
    addBtn.disabled = true;
    if (app.ai.needsNotice()) { // ligada só porque é o padrão: no primeiro uso, avisa o que acontece com a frase falada
      app.ai.noticed();
      toast('A IA está ligada para entender melhor o que você fala: só o texto falado vai ao serviço do Pauta, que não o guarda. Para desligar, vá em Configurações.', { timeout: 10000 });
    }
    // o tipo "ai" (e não "listening") para o fim do microfone não apagar o recado
    showNote('Entendendo com IA…', 'ai', { label: 'Pular a IA', onClick: () => controller.abort() });
    speech.note('ai-start');
    const today = store.today();
    const now = new Date();
    const weekStart = store.state.settings.weekStart;
    let r = { ok: false, reason: 'error' };
    let local = null;
    try {
      local = interpretSpoken(heard, { today, now, weekStart, ignore });
      r = await app.ai.rewrite(heard, { today, now, signal: controller.signal });
    } catch {
      r = { ok: false, reason: 'error' };
    } finally {
      if (aiAbort === controller) aiAbort = null;
    }
    speech.note('ai-end', r.ok ? 'ok' : r.reason);
    if (input.value !== heard) return false; // a pessoa digitou, limpou ou falou de novo: esta resposta ficou velha
    waiting = null;
    addBtn.disabled = false;
    if (note.dataset.kind === 'ai') clearNote();
    aiRead = true;
    if (r.ok) {
      let res = null;
      try {
        res = interpretAiReply(r, heard, local, { today, now, weekStart });
      } catch {
        res = null; // a resposta não deu para usar: ficam as palavras que a pessoa falou
      }
      if (res && res.acao !== 'criar') return runCommand(res, heard);
      if (res) {
        aiExtra = { heard, doubts: r.duvidas, notes: res.notes }; // notes: a descrição que a IA tirou da fala (só com as palavras ditas)
        input.value = res.line;
      }
    } else if (r.reason !== 'skipped') {
      toast(`${describeAiFailure(r.reason)} Usei o jeito normal.`);
    }
    return true;
  }

  /** A IA entendeu que a pessoa quer mexer numa tarefa que já existe (concluir, alterar, excluir): quem faz é `app.commands`. */
  async function runCommand(res, heard) {
    speech.note('ai-command', res.acao);
    const out = res.ok
      ? await app.commands.run(res, heard)
      : { done: false, message: 'Parece que você quer mexer numa tarefa que já existe, mas não percebi qual. Diga o nome dela de novo ou toque em Adicionar para criar uma tarefa nova.' };
    if (out.done) {
      input.value = '';
      ignore = {};
      spoken = false;
      pausedText = null;
      forgetAi();
      clearNote();
      update();
    } else if (out.message) {
      showNote(out.message, 'warn'); // o texto continua no campo: dá para corrigir ou criar uma tarefa nova com ele
    }
    return 'handled';
  }

  async function submit({ byVoice = false, confidence = null } = {}) {
    speech.cancel();
    if (waiting !== null && waiting === input.value) {
      aiAbort?.abort(); // já está esperando a IA: apertar de novo quer dizer "não espere mais"
      return;
    }
    if (spoken && input.value.trim() && !aiRead && app.ai.available()) {
      let go = true;
      try {
        go = await understandWithAi();
      } catch {
        // a tela nunca fica presa esperando a IA: segue com as regras do aparelho
        waiting = null;
        aiAbort = null;
        addBtn.disabled = false;
        if (note.dataset.kind === 'ai') clearNote();
      }
      if (!go || go === 'handled') return; // abandonou (mexeram no campo) ou foi um comando sobre tarefa que já existe
    }
    finishSubmit({ byVoice, confidence });
  }

  function finishSubmit({ byVoice = false, confidence = null } = {}) {
    const notes = aiExtra?.notes ?? ''; // a descrição que a IA tirou da fala (vira as anotações da tarefa)
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
      title: spoken ? capitalizeTitle(p.title) : p.title, date, time: p.time, remind: p.remind, priority: p.priority ?? ctx.priority ?? 0, labels: labelIds, recurrence: p.recurrence, notes,
    });
    if (!task) return;
    if (byVoice) speech.note('created');
    const remindLost = p.remind !== null && p.remind !== undefined && task.remind === null; // pediu lembrete mas a tarefa não tem hora
    input.value = '';
    ignore = {};
    spoken = false;
    pausedText = null;
    forgetAi();
    clearNote();
    update();
    if (byVoice) app.actions.addedByVoice(task, { remindLost });
    else app.actions.added(task);
  }

  return {
    el: form,
    focus() { input.focus(); },
    refresh: update,
    /** O relatório do último uso do microfone (horários e códigos, nunca o que foi falado): as Configurações o copiam. */
    speechReport: () => speech.report(),
    /** Define onde a tarefa cai por padrão (dia aberto, etiqueta aberta...) e se o campo aparece. */
    setContext(next) {
      ctx = { date: null, labelId: null, priority: 0, hidden: false, ...next };
      form.hidden = ctx.hidden;
    },
  };
}
