// Janela de edição da tarefa: título, anotações, checklist, data/hora, prioridade, etiquetas e repetição.
// Tudo é gravado enquanto você digita (sem botão "Salvar").
// Também serve de RASCUNHO para uma tarefa nova que veio da fala e não ficou clara (openDraft): os campos que o app entendeu já vêm
// preenchidos, o resto fica em branco, e a tarefa só entra na lista quando a pessoa toca em "Adicionar".
import { WEEKDAYS, addDays, capitalize, formatStamp, relativeDay, startOfWeek, todayISO, weekday, weekdayLabels } from '../dates.js';
import { LIMITS, PRIORITIES, createTask, mergePatch, uid } from '../model.js';
import { PRESETS, describe, presetOf } from '../recurrence.js';
import { REMIND_PRESETS, remindAt, remindDescribe, remindLabel } from '../reminders.js';
import { clip, h, isTouch } from './dom.js';
import { icon } from './icons.js';
import { toast } from './overlay.js';
import { createTimePicker } from './timepick.js';

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;
// marcadores de lista ao colar texto: - * bolinha, quadradinho, circulo, travessao, "1." e "1)"
const BULLET = /^(?:[-*\u2022\u25AA\u25E6\u2013]|\d+[.)])\s+/;

export function createEditor(app) {
  const { store } = app;
  const dlg = h('dialog', { class: 'dialog editor', 'aria-label': 'Editar tarefa' });
  document.body.append(dlg);

  let taskId = null;
  let draft = null; // tarefa NOVA que ainda não existe na lista (veio da fala); null = está editando uma tarefa que já existe
  let draftInfo = null; // { heard: o que foi dito, issues: o que não ficou claro, wantRemind: lembrete pedido que espera a hora, wantAlarm: era um alarme }
  let items = []; // rascunho do checklist: { id, text, done }
  let pending = {};
  let timer = 0;
  let forceCustom = false;
  let customDays = new Set();
  let c = null; // referências aos controles da tela aberta
  let downOnBackdrop = false;

  /** A tarefa que a tela mostra: a que está sendo editada ou o rascunho da nova. */
  const current = () => draft ?? (taskId ? store.find(taskId) : null);

  dlg.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === dlg; });
  dlg.addEventListener('click', (e) => { if (e.target === dlg && downOnBackdrop) close(); });
  dlg.addEventListener('close', onClosed);

  // ---------- gravação ----------
  function flush() {
    clearTimeout(timer);
    if (!Object.keys(pending).length) return;
    const patch = pending;
    pending = {};
    if (draft) applyToDraft(patch);
    else if (taskId) store.updateTask(taskId, patch, { undoable: false });
  }

  /** No rascunho as mudanças ficam só na memória, com as mesmas regras de uma tarefa de verdade (mergePatch + createTask). */
  function applyToDraft(patch) {
    if ('remind' in patch || 'alarm' in patch) { // a pessoa mexeu no lembrete: vale a escolha dela
      draftInfo.wantRemind = null;
      draftInfo.wantAlarm = false;
    }
    const merged = mergePatch(draft, patch, store.today());
    // pediu "avise 15 minutos antes" (ou um alarme) sem dizer a hora: o pedido espera, e vale assim que a hora for escolhida
    if (!('remind' in patch) && merged.remind == null && draftInfo.wantRemind != null) {
      merged.remind = draftInfo.wantRemind;
      if (draftInfo.wantAlarm) merged.alarm = true;
    }
    draft = { ...createTask(merged, draft.createdAt), id: draft.id };
  }
  function queue(patch, now = false) {
    Object.assign(pending, patch);
    clearTimeout(timer);
    if (now) {
      flush();
      refresh();
    } else {
      timer = setTimeout(flush, 250);
    }
  }

  function open(id) {
    const t = store.find(id);
    if (!t) return;
    if (dlg.open) flush();
    if (draft) discardDraft(); // abriu outra tarefa com um rascunho na tela: o rascunho não se perde em silêncio
    taskId = id;
    pending = {};
    forceCustom = false;
    items = t.checklist.map((x) => ({ ...x }));
    build(t);
    if (!dlg.open) dlg.showModal();
    // só dá para medir a altura depois que a janela está visível
    fit(c.title, 160);
    fit(c.notes, 320);
    if (!isTouch()) {
      c.title.focus();
      c.title.setSelectionRange(c.title.value.length, c.title.value.length);
    }
  }

  /**
   * Abre a janela para uma tarefa NOVA, já com o que o app entendeu da fala. `fields`: título, data, hora, lembrete, prioridade,
   * etiquetas (ids), repetição. `info`: `heard` (o que foi dito), `issues` ([{ text }]: o que não ficou claro).
   */
  function openDraft(fields, info = {}) {
    if (dlg.open) flush();
    if (draft) discardDraft();
    taskId = null;
    draft = createTask(fields, new Date().toISOString());
    const wanted = Number.isInteger(fields.remind) ? fields.remind : info.wantRemind;
    draftInfo = {
      heard: info.heard ?? '', issues: info.issues ?? [], wantRemind: Number.isInteger(wanted) ? wanted : null,
      wantAlarm: Number.isInteger(wanted) && (fields.alarm === true || info.wantAlarm === true),
    };
    pending = {};
    forceCustom = false;
    items = draft.checklist.map((x) => ({ ...x }));
    build(draft);
    if (!dlg.open) dlg.showModal();
    fit(c.title, 160);
    fit(c.notes, 320);
    // sem título é o que mais falta: leva direto para ele (no celular o teclado só sobe se a pessoa tocar)
    if (!draft.title || !isTouch()) {
      c.title.focus();
      c.title.setSelectionRange(c.title.value.length, c.title.value.length);
    }
  }

  /** "Adicionar": o rascunho vira uma tarefa de verdade. Sem título não dá. */
  function commitDraft() {
    flush();
    if (!draft || !c) return;
    if (!draft.title.trim()) {
      c.title.classList.add('is-missing');
      c.title.classList.remove('shake');
      void c.title.offsetWidth; // reinicia a animação
      c.title.classList.add('shake');
      c.title.focus();
      return;
    }
    const task = store.addTask({ ...draft });
    if (!task) return;
    draft = null;
    draftInfo = null;
    if (dlg.open) dlg.close();
    app.actions.added(task);
  }

  /** Fechou o rascunho sem adicionar: descarta, mas deixa "Desfazer" (um toque fora da janela é fácil de errar). */
  function discardDraft() {
    const lost = draft;
    const info = draftInfo;
    draft = null;
    draftInfo = null;
    if (!lost || !(lost.title.trim() || lost.date || lost.notes || lost.checklist.length)) return;
    toast('Rascunho descartado', { action: { label: 'Desfazer', onClick: () => openDraft(lost, info ?? {}) } });
  }

  function close() {
    flush();
    if (dlg.open) dlg.close();
  }

  function onClosed() {
    flush();
    if (draft) {
      discardDraft();
    } else {
      const t = taskId && store.find(taskId);
      if (t && t.checklist.some((x) => !x.text.trim())) {
        store.updateTask(taskId, { checklist: t.checklist.filter((x) => x.text.trim()) }, { undoable: false });
      }
    }
    taskId = null;
    c = null;
    dlg.replaceChildren();
  }

  // ---------- montagem ----------
  function build(t) {
    const today = store.today();
    const ws = store.state.settings.weekStart;
    c = {};
    dlg.setAttribute('aria-label', draft ? 'Nova tarefa' : 'Editar tarefa');

    // uma tarefa nova ainda não pode ser concluída
    c.doneBtn = draft ? null : h('button', {
      class: 'check big', type: 'button', role: 'checkbox', 'aria-checked': t.done, 'aria-label': 'Concluir tarefa',
      onclick: () => {
        const cur = store.find(taskId);
        if (!cur) return;
        if (cur.done) { store.toggleDone(taskId); refresh(); return; }
        flush();
        const id = taskId;
        close(); // o aviso com "Desfazer" aparece na tela principal
        app.actions.complete(id);
      },
    }, h('span', { class: 'box' }, icon('check', 15)));

    // caixa de uma linha lógica que quebra e cresce quando o título é longo
    c.title = h('textarea', {
      class: 'ed-title', rows: 1, value: t.title, maxlength: LIMITS.title, placeholder: 'Título da tarefa', 'aria-label': 'Título da tarefa',
      oninput: () => {
        const v = c.title.value;
        if (/[\r\n]/.test(v)) {
          const pos = c.title.selectionStart;
          c.title.value = v.replace(/[\r\n]+/g, ' ');
          c.title.setSelectionRange(pos, pos);
        }
        fit(c.title, 160);
        if (draft) c.title.classList.toggle('is-missing', !c.title.value.trim());
        queue({ title: c.title.value });
      },
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); c.notes.focus(); } },
      // numa tarefa que já existe o título não pode ficar vazio (volta o anterior); no rascunho, vazio é o que falta preencher
      onblur: () => { if (!draft && !c.title.value.trim()) { c.title.value = store.find(taskId)?.title ?? ''; fit(c.title, 160); } },
    });
    if (draft && !t.title) c.title.classList.add('is-missing');

    // o que o app entendeu da fala e o que ficou em dúvida (só no rascunho)
    c.draftNote = draft ? draftNote() : null;

    // --- anotações ---
    c.notes = h('textarea', {
      class: 'ed-notes', rows: 3, value: t.notes, maxlength: LIMITS.notes, placeholder: 'Anotações: detalhes, links, observações…', 'aria-label': 'Anotações',
      oninput: () => { fit(c.notes, 320); queue({ notes: c.notes.value }); renderLinks(); },
    });
    c.links = h('div', { class: 'ed-links', hidden: true });

    // --- checklist ---
    c.checkCount = h('span', { class: 'ed-count' });
    c.checkBar = h('div', { class: 'progress-bar thin' }, h('span'));
    c.checkList = h('ul', { class: 'ci-list' });
    c.checkBanner = h('div', { class: 'ci-banner', hidden: true },
      h('span', {}, 'Tudo feito!'),
      h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => c.doneBtn.click() }, 'Concluir tarefa'));
    c.checkAdd = h('input', {
      class: 'ci-add-input', type: 'text', maxlength: LIMITS.checkItem, placeholder: 'Adicionar item…', 'aria-label': 'Adicionar item ao checklist',
      onkeydown: (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addFromInput(); }
        else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); focusItem(items.length - 1); }
      },
      onpaste: (e) => pasteInto(e, items.length),
    });

    // --- data e hora ---
    c.date = h('input', { class: 'input', type: 'date', value: t.date ?? '', 'aria-label': 'Data', onchange: () => queue({ date: c.date.value || null }, true) });
    c.dateHint = h('span', { class: 'hint' });
    const quick = [
      ['Hoje', () => today], ['Amanhã', () => addDays(today, 1)],
      ['Próx. semana', () => startOfWeek(addDays(today, 7), ws)], ['Sem data', () => null],
    ].map(([label, fn]) => h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => queue({ date: fn() }, true) }, label));
    // hora e minutos em duas caixas: os minutos vão de 5 em 5 (00, 05, 10...)
    c.time = createTimePicker({
      label: 'Hora',
      onChange: (value) => {
        const patch = { time: value };
        if (value && !c.date.value) patch.date = todayISO();
        queue(patch, true);
      },
    });
    c.time.set(t.time);
    c.timeClear = h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Tirar a hora', title: 'Tirar a hora', onclick: () => queue({ time: null }, true) }, icon('x', 14));

    // --- lembrete: um aviso X minutos antes da hora (só existe com data e hora) ---
    c.remind = h('select', { class: 'input', 'aria-label': 'Lembrete', onchange: () => queue({ remind: c.remind.value === '' ? null : Number(c.remind.value) }, true) });
    c.remindHint = h('div', { class: 'hint remind-hint' });
    remindSig = '';
    // --- alarme: o lembrete toca como despertador até a pessoa parar ou adiar (se não havia lembrete, liga um "na hora") ---
    c.alarm = h('input', {
      class: 'switch', type: 'checkbox', role: 'switch', 'aria-label': 'Tocar como alarme',
      onchange: () => {
        const cur = current();
        if (cur) queue(c.alarm.checked ? { alarm: true, remind: cur.remind ?? 0 } : { alarm: false }, true);
      },
    });
    c.alarmLine = h('label', { class: 'ctrl-line alarm-line' }, c.alarm, icon('alarm-clock', 15), h('span', {}, 'Tocar como alarme'));

    // --- prioridade ---
    c.prio = PRIORITIES.map((p) => h('button', {
      class: `seg-btn p${p.value}`, type: 'button', 'aria-pressed': false, dataset: { value: String(p.value) },
      onclick: () => queue({ priority: p.value }, true),
    }, p.value ? icon('flag', 14) : null, p.value ? p.label : 'Nenhuma'));

    // --- etiquetas ---
    c.labels = h('div', { class: 'ed-labels' });
    c.newLabel = h('input', {
      class: 'input sm', type: 'text', maxlength: LIMITS.labelName, placeholder: 'Nova etiqueta…', 'aria-label': 'Criar etiqueta',
      onkeydown: (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const name = c.newLabel.value.trim();
        if (!name) return;
        const [id] = store.ensureLabels([name]);
        c.newLabel.value = '';
        const cur = current();
        if (id && cur && !cur.labels.includes(id)) queue({ labels: [...cur.labels, id] }, true);
        else refresh();
      },
    });

    // --- repetição ---
    c.rec = h('select', { class: 'input', 'aria-label': 'Repetir', onchange: () => onRecChange(c.rec.value) },
      PRESETS.map((p) => h('option', { value: p.id }, p.label)));
    c.recNum = h('input', { class: 'input sm num', type: 'number', min: 1, max: 365, value: 1, 'aria-label': 'Intervalo', onchange: customChanged });
    c.recUnit = h('select', { class: 'input sm', 'aria-label': 'Unidade', onchange: customChanged },
      [['day', 'dia(s)'], ['week', 'semana(s)'], ['month', 'mês(es)'], ['year', 'ano(s)']].map(([v, l]) => h('option', { value: v }, l)));
    const order = weekdayLabels(ws);
    c.recDays = h('div', { class: 'rec-days', role: 'group', 'aria-label': 'Dias da semana' }, order.order.map((d, i) => h('button', {
      class: 'day-btn', type: 'button', 'aria-pressed': false, title: WEEKDAYS[d], 'aria-label': WEEKDAYS[d], dataset: { day: String(d) },
      onclick: () => {
        if (customDays.has(d)) customDays.delete(d); else customDays.add(d);
        customChanged();
      },
    }, order.initial[i])));
    c.recCustom = h('div', { class: 'rec-custom', hidden: true }, h('span', {}, 'A cada'), c.recNum, c.recUnit, c.recDays);
    c.recHint = h('p', { class: 'hint' });

    const row = (iconName, label, ...content) => h('div', { class: 'ed-row' },
      h('div', { class: 'ed-label' }, icon(iconName, 16), h('span', {}, label)),
      h('div', { class: 'ed-ctrl' }, ...content));

    c.created = h('span', { class: 'ed-created' });

    const foot = draft
      ? h('div', { class: 'ed-foot' },
        h('div', { class: 'ed-foot-left' },
          h('button', { class: 'btn btn-sm btn-danger-ghost', type: 'button', onclick: close }, icon('trash', 15), 'Descartar')),
        c.created,
        h('button', { class: 'btn btn-primary', type: 'button', onclick: commitDraft }, icon('plus', 16), 'Adicionar'))
      : h('div', { class: 'ed-foot' },
        h('div', { class: 'ed-foot-left' },
          h('button', {
            class: 'btn btn-sm', type: 'button',
            onclick: () => {
              flush();
              const copy = store.duplicateTask(taskId);
              if (copy) open(copy.id);
            },
          }, icon('copy', 15), 'Duplicar'),
          h('button', {
            class: 'btn btn-sm btn-danger-ghost', type: 'button',
            onclick: () => { const id = taskId; close(); app.actions.remove(id); },
          }, icon('trash', 15), 'Excluir')),
        c.created,
        h('button', { class: 'btn btn-primary', type: 'button', onclick: close }, 'Pronto'));

    dlg.replaceChildren(h('div', { class: 'dialog-body editor-body' },
      c.draftNote,
      h('div', { class: 'ed-head' }, c.doneBtn, c.title, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fechar', onclick: close }, icon('x', 20))),
      h('div', { class: 'ed-section' },
        h('div', { class: 'ed-label' }, icon('note', 16), h('span', {}, 'Anotações')),
        c.notes, c.links),
      h('div', { class: 'ed-section' },
        h('div', { class: 'ed-label' }, icon('checklist', 16), h('span', {}, 'Checklist'), c.checkCount),
        c.checkBar, c.checkList,
        h('div', { class: 'ci-add' }, icon('plus', 16), c.checkAdd),
        c.checkBanner),
      h('div', { class: 'ed-fields' },
        row('calendar', 'Data', h('div', { class: 'ctrl-line' }, c.date, c.dateHint), h('div', { class: 'ctrl-line wrap' }, quick)),
        row('clock', 'Hora', h('div', { class: 'ctrl-line' }, c.time.el, c.timeClear)),
        row('bell', 'Lembrete', c.remind, c.alarmLine, c.remindHint),
        row('flag', 'Prioridade', h('div', { class: 'seg', role: 'group', 'aria-label': 'Prioridade' }, c.prio)),
        row('tag', 'Etiquetas', c.labels, c.newLabel),
        row('repeat', 'Repetir', c.rec, c.recCustom, c.recHint)),
      foot));

    renderChecklist();
    renderLinks();
    refresh();
  }

  /** Aviso no alto do rascunho: o que ficou em dúvida e o que foi dito (para a pessoa conferir sem precisar lembrar). */
  function draftNote() {
    const { issues, heard } = draftInfo;
    return h('div', { class: 'ed-draft', role: 'status' },
      h('b', {}, issues.length ? 'Confira antes de adicionar' : 'Nova tarefa'),
      ...issues.map((i) => h('p', {}, i.text)),
      h('p', {}, 'Complete o que faltou e toque em Adicionar.'),
      heard ? h('p', { class: 'ed-heard' }, 'Você disse: ', h('i', {}, `“${clip(heard, 160)}”`)) : null);
  }

  // ---------- sincronizar controles com a tarefa gravada ----------
  function refresh() {
    const t = current();
    if (!t || !c) return;
    if (c.doneBtn) {
      c.doneBtn.className = `check big p${t.priority}`;
      c.doneBtn.setAttribute('aria-checked', String(t.done));
      c.doneBtn.setAttribute('aria-label', t.done ? 'Reabrir tarefa' : 'Concluir tarefa');
    }
    if (document.activeElement !== c.date) c.date.value = t.date ?? '';
    c.dateHint.textContent = t.date ? capitalize(WEEKDAYS[weekday(t.date)]) : 'Sem data';
    c.time.set(t.time);
    c.timeClear.hidden = !t.time;
    syncRemind(t);
    for (const b of c.prio) b.setAttribute('aria-pressed', String(Number(b.dataset.value) === t.priority));

    const labels = store.state.labels;
    c.labels.replaceChildren(...labels.map((l) => h('button', {
      class: `chip lbl lc-${l.color} toggle`, type: 'button', 'aria-pressed': t.labels.includes(l.id),
      onclick: () => {
        const cur = current();
        queue({ labels: cur.labels.includes(l.id) ? cur.labels.filter((x) => x !== l.id) : [...cur.labels, l.id] }, true);
      },
    }, l.name)));
    c.labels.hidden = labels.length === 0;

    const preset = forceCustom ? 'custom' : presetOf(t.recurrence, t.date);
    c.rec.value = preset;
    c.recCustom.hidden = preset !== 'custom';
    if (preset === 'custom') {
      const r = t.recurrence ?? { freq: 'week', interval: 1 };
      c.recNum.value = r.interval ?? 1;
      c.recUnit.value = r.freq;
      c.recDays.hidden = r.freq !== 'week';
      customDays = new Set(r.days ?? (t.date ? [weekday(t.date)] : []));
      for (const b of c.recDays.children) b.setAttribute('aria-pressed', String(customDays.has(Number(b.dataset.day))));
    }
    c.recHint.textContent = t.recurrence ? `${describe(t.recurrence, t.date)}. Ao concluir, a próxima já é criada.` : '';
    c.recHint.hidden = !t.recurrence;
    c.created.textContent = draft ? '' : t.done && t.doneAt ? `Concluída em ${formatStamp(t.doneAt)}` : `Criada em ${formatStamp(t.createdAt)}`;
    updateBanner();
  }

  // ---------- lembrete ----------
  let remindSig = ''; // as opções do seletor só são refeitas quando mudam (mexer nelas com o seletor aberto o fecharia)

  function syncRemind(t) {
    const remind = t.remind ?? null;
    const hasTime = Boolean(t.date && t.time);
    const options = [['', 'Sem lembrete'], ...REMIND_PRESETS.map((m) => [String(m), remindLabel(m)])];
    if (remind !== null && !REMIND_PRESETS.includes(remind)) { // valor fora da lista (45 min, 3 horas...): aparece também
      options.push([String(remind), remindLabel(remind)]);
      options.sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : Number(a[0]) - Number(b[0])));
    }
    const sig = options.map((o) => o[0]).join(',');
    if (sig !== remindSig) {
      remindSig = sig;
      c.remind.replaceChildren(...options.map(([value, label]) => h('option', { value }, label)));
    }
    c.remind.value = remind === null ? '' : String(remind);
    c.remind.disabled = !hasTime;
    c.alarm.checked = remind !== null && t.alarm === true;
    c.alarm.disabled = !hasTime;
    c.alarmLine.classList.toggle('is-disabled', !hasTime);
    c.remindHint.replaceChildren(...remindHint(t, remind, hasTime));
  }

  function remindHint(t, remind, hasTime) {
    if (!hasTime) {
      if (draft && draftInfo.wantRemind !== null) {
        const wanted = draftInfo.wantAlarm ? remindDescribe(draftInfo.wantRemind, true) : `aviso ${remindLabel(draftInfo.wantRemind)}`;
        return [`Você pediu ${wanted.toLowerCase()}. Escolha a hora e ele é ligado.`];
      }
      return ['Escolha uma data e uma hora para poder ter lembrete ou alarme.'];
    }
    if (remind === null) return ['Escolha quanto tempo antes você quer ser avisado, ou ligue o alarme.'];
    const at = remindAt(t);
    const day = relativeDay(todayISO(at), store.today()).toLowerCase();
    const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    let first = `Você será avisado ${day} às ${clock}.`;
    if (t.alarm) first = `O alarme toca ${day} às ${clock} e só para quando você tocar em Parar ou Adiar. Com o app fechado, chega como notificação que se repete a cada minuto.`;
    const lines = [at.getTime() <= Date.now() ? 'Esse horário de aviso já passou.' : first];
    const a = app.alerts.status();
    if (a.muted) lines.push(' Os avisos estão desligados neste aparelho (veja em Configurações).');
    else if (a.permission === 'denied') lines.push(' Os avisos estão bloqueados neste aparelho: libere nas configurações do sistema.');
    else if (a.permission === 'unsupported') lines.push(' Este navegador não mostra avisos. No iPhone, abra o Pauta pela Tela de Início.');
    else if (a.permission === 'default') {
      lines.push(' ', h('button', {
        class: 'link-btn', type: 'button',
        onclick: async () => { await app.alerts.enable(); if (c) refresh(); },
      }, 'Ativar avisos neste aparelho'));
    }
    return lines;
  }

  function onRecChange(id) {
    if (id === 'custom') {
      forceCustom = true;
      const cur = current();
      queue({ recurrence: cur.recurrence ?? { freq: 'week', interval: 1 } }, true);
      return;
    }
    forceCustom = false;
    queue({ recurrence: id === 'none' ? null : PRESETS.find((p) => p.id === id).rule }, true);
  }

  function customChanged() {
    const freq = c.recUnit.value;
    const interval = Math.min(365, Math.max(1, parseInt(c.recNum.value, 10) || 1));
    const rule = { freq, interval };
    if (freq === 'week' && customDays.size) rule.days = [...customDays];
    queue({ recurrence: rule }, true);
  }

  // ---------- anotações ----------
  function renderLinks() {
    const urls = [...new Set((c.notes.value.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:!?]+$/, '')))].slice(0, 6);
    const chips = urls.map((u) => {
      try {
        const url = new URL(u);
        if (!/^https?:$/.test(url.protocol)) return null;
        return h('a', { class: 'chip link', href: url.href, target: '_blank', rel: 'noopener noreferrer', title: url.href }, icon('link', 12), url.hostname.replace(/^www\./, ''));
      } catch {
        return null;
      }
    }).filter(Boolean);
    c.links.replaceChildren(...chips);
    c.links.hidden = chips.length === 0;
  }

  // ---------- checklist ----------
  function commitChecklist(now = false) {
    queue({ checklist: items.map(({ id, text, done }) => ({ id, text, done })) }, now);
    updateProgress();
  }

  function updateProgress() {
    const done = items.filter((i) => i.done).length;
    c.checkCount.textContent = items.length ? `${done}/${items.length}` : '';
    c.checkBar.hidden = items.length === 0;
    c.checkBar.firstElementChild.style.setProperty('width', `${items.length ? Math.round((done / items.length) * 100) : 0}%`);
    updateBanner();
  }

  function updateBanner() {
    const t = !draft && taskId && store.find(taskId); // "Concluir tarefa" não existe numa tarefa que ainda não foi criada
    c.checkBanner.hidden = !(t && !t.done && items.length > 0 && items.every((i) => i.done));
  }

  function focusItem(i) {
    if (i >= items.length) c.checkAdd.focus();
    else c.checkList.children[i]?.querySelector('.ci-text')?.focus();
  }

  function removeAt(i, focusTo = null) {
    items.splice(i, 1);
    commitChecklist(true);
    renderChecklist();
    if (focusTo !== null) focusItem(focusTo);
  }

  function renderChecklist() {
    c.checkList.replaceChildren(...items.map((item, i) => {
      const input = h('input', {
        class: 'ci-text', type: 'text', value: item.text, maxlength: LIMITS.checkItem, 'aria-label': `Item ${i + 1}`,
        oninput: () => { item.text = input.value; commitChecklist(); },
        onkeydown: (e) => {
          if (e.key === 'Enter') { e.preventDefault(); focusItem(i + 1); }
          else if (e.key === 'Backspace' && input.value === '') { e.preventDefault(); removeAt(i, i - 1 >= 0 ? i - 1 : items.length - 1); }
          else if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); focusItem(i - 1); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(i + 1); }
        },
        onpaste: (e) => pasteInto(e, i + 1),
        onblur: () => { if (!input.value.trim() && items.includes(item)) removeAt(items.indexOf(item)); },
      });
      return h('li', { class: `ci${item.done ? ' done' : ''}` },
        h('button', {
          class: 'ci-box', type: 'button', role: 'checkbox', 'aria-checked': item.done, 'aria-label': `Marcar item ${i + 1}`,
          onclick: () => { item.done = !item.done; commitChecklist(true); renderChecklist(); },
        }, icon('check', 12)),
        input,
        h('button', { class: 'icon-btn sm ci-del', type: 'button', 'aria-label': `Remover item ${i + 1}`, onclick: () => removeAt(i) }, icon('x', 14)));
    }));
    updateProgress();
  }

  function addFromInput() {
    const text = c.checkAdd.value.trim();
    if (!text || items.length >= LIMITS.checklist) return;
    items.push({ id: uid(), text: text.slice(0, LIMITS.checkItem), done: false });
    c.checkAdd.value = '';
    commitChecklist(true);
    renderChecklist();
    c.checkAdd.focus();
  }

  /** Colar várias linhas vira vários itens (aceita "- item", "1) item", "[x] item"). */
  function pasteInto(e, index) {
    const text = e.clipboardData?.getData('text') ?? '';
    if (!/\r?\n/.test(text.trim())) return; // uma linha só: colar normal
    e.preventDefault();
    const added = text.split(/\r?\n/).map(parseLine).filter(Boolean);
    items.splice(index, 0, ...added);
    items = items.slice(0, LIMITS.checklist);
    commitChecklist(true);
    renderChecklist();
  }

  return { open, openDraft, close, get isOpen() { return dlg.open; } };
}

/** Ajusta a altura de uma caixa de texto ao conteúdo (até um máximo). */
function fit(el, max) {
  el.style.setProperty('height', 'auto');
  el.style.setProperty('height', `${Math.min(el.scrollHeight + 2, max)}px`);
}

function parseLine(line) {
  let s = line.trim();
  if (!s) return null;
  let done = false;
  const box = /^(?:(?:[-*\u2022\u25AA\u25E6\u2013]|\d+[.)])\s*)?\[( |x|X)?\]\s*/.exec(s);
  if (box) {
    done = box[1] === 'x' || box[1] === 'X';
    s = s.slice(box[0].length);
  } else {
    s = s.replace(BULLET, '');
  }
  s = s.trim();
  return s ? { id: uid(), text: s.slice(0, LIMITS.checkItem), done } : null;
}
