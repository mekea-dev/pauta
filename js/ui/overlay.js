// Avisos (toast), menu de contexto e caixas de confirmação.
import { h } from './dom.js';
import { icon } from './icons.js';

// ---------- avisos ----------
let host = null;
export const initToasts = (el) => { host = el; };

export function toast(message, { action = null, timeout = 5500, tone = 'default' } = {}) {
  if (!host) return () => {};
  let timer = 0;
  const close = () => {
    clearTimeout(timer);
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 180);
  };
  const arm = () => { clearTimeout(timer); timer = setTimeout(close, timeout); };
  const el = h('div', { class: `toast tone-${tone}`, onmouseenter: () => clearTimeout(timer), onmouseleave: arm },
    h('span', { class: 'toast-msg' }, message),
    action ? h('button', { class: 'toast-action', type: 'button', onclick: () => { action.onClick(); close(); } }, action.label) : null,
    h('button', { class: 'icon-btn toast-close', type: 'button', 'aria-label': 'Fechar aviso', onclick: close }, icon('x', 14)));
  host.append(el);
  while (host.children.length > 3) host.firstElementChild.remove();
  arm();
  return close;
}

// ---------- menu ----------
let current = null;
export const closeMenu = () => current?.();

export function openMenu(anchor, items) {
  closeMenu();
  const menu = h('div', { class: 'menu', role: 'menu' });
  const cleanup = () => {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', cleanup);
    window.removeEventListener('scroll', cleanup, true);
    menu.remove();
    anchor.setAttribute('aria-expanded', 'false');
    if (current === cleanup) current = null;
  };
  const onDown = (e) => {
    if (!menu.contains(e.target) && !anchor.contains(e.target)) cleanup();
  };
  const onKey = (e) => {
    const buttons = [...menu.querySelectorAll('.menu-item:not(:disabled)')];
    const i = buttons.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cleanup();
      anchor.focus?.({ preventScroll: true });
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length;
      buttons[next]?.focus({ preventScroll: true });
    } else if (e.key === 'Tab') {
      cleanup();
    }
  };
  for (const it of items) {
    if (it.separator) {
      menu.append(h('div', { class: 'menu-sep', role: 'separator' }));
      continue;
    }
    menu.append(h('button', {
      class: `menu-item${it.danger ? ' danger' : ''}`, type: 'button', role: 'menuitem', disabled: it.disabled,
      onclick: () => { cleanup(); it.onClick(); },
    }, it.icon ? icon(it.icon, 16) : h('span', { class: 'menu-gap' }), h('span', {}, it.label)));
  }
  // dentro de um diálogo aberto o menu precisa ficar dentro dele, senão o resto da página está "travado"
  (document.querySelector('dialog[open]') ?? document.body).append(menu);
  const r = anchor.getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  let top = r.bottom + 6;
  if (top + m.height > vh - 8) top = Math.max(8, r.top - m.height - 6);
  const left = Math.min(Math.max(8, r.right - m.width), vw - m.width - 8);
  menu.style.setProperty('top', `${top}px`);
  menu.style.setProperty('left', `${left}px`);
  anchor.setAttribute('aria-expanded', 'true');
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', cleanup);
  window.addEventListener('scroll', cleanup, true);
  current = cleanup;
  menu.querySelector('.menu-item:not(:disabled)')?.focus({ preventScroll: true });
}

// ---------- caixas de diálogo ----------
let dlgSeq = 0;

/** Pergunta com vários botões. Devolve o `value` do botão escolhido ou null (Esc). */
export function choiceDialog({ title, message, choices, defaultChoice }) {
  return new Promise((resolve) => {
    const id = `cd-${++dlgSeq}`;
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      dlg.close();
      dlg.remove();
      resolve(value);
    };
    const dlg = h('dialog', { class: 'dialog dialog-sm', 'aria-labelledby': id },
      h('div', { class: 'dialog-body' },
        h('h2', { id, class: 'dialog-title' }, title),
        message ? h('p', { class: 'dialog-text' }, message) : null,
        h('div', { class: 'dialog-actions' }, choices.map((c) => h('button', {
          type: 'button', class: `btn${c.primary ? ' btn-primary' : ''}${c.danger ? ' btn-danger' : ''}`, dataset: { value: String(c.value) },
          onclick: () => finish(c.value),
        }, c.label)))));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    document.body.append(dlg);
    dlg.showModal();
    (dlg.querySelector(`[data-value="${String(defaultChoice)}"]`) ?? dlg.querySelector('button'))?.focus();
  });
}

/**
 * Pede a senha para confirmar algo que não dá para desfazer. `run(senha)` faz o trabalho; se lançar um erro, a mensagem
 * aparece na própria caixa, que continua aberta para tentar de novo. Devolve true se deu certo e false se a pessoa desistiu.
 */
export function passwordDialog({ title, message, confirmLabel = 'Confirmar', danger = false, run }) {
  return new Promise((resolve) => {
    const id = `pd-${++dlgSeq}`;
    let busy = false;
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      dlg.close();
      dlg.remove();
      resolve(value);
    };
    const pass = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: 'Sua senha', 'aria-label': 'Senha' });
    const msg = h('p', { class: 'auth-msg', role: 'alert', hidden: true });
    const cancel = h('button', { class: 'btn', type: 'button', onclick: () => { if (!busy) finish(false); } }, 'Cancelar');
    const ok = h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'submit' }, confirmLabel);
    const setBusy = (b) => {
      busy = b;
      for (const el of [pass, cancel, ok]) el.disabled = b;
    };
    const fail = (text) => {
      msg.textContent = text;
      msg.hidden = false;
    };
    async function onSubmit() {
      if (busy) return;
      if (!pass.value) return fail('Digite sua senha.');
      msg.hidden = true;
      setBusy(true);
      try {
        await run(pass.value);
        return finish(true);
      } catch (err) {
        fail(err?.message ?? 'Não foi possível concluir.');
        setBusy(false);
        pass.focus();
        return pass.select();
      }
    }
    const dlg = h('dialog', { class: 'dialog dialog-sm', 'aria-labelledby': id },
      h('div', { class: 'dialog-body' },
        h('h2', { id, class: 'dialog-title' }, title),
        message ? h('p', { class: 'dialog-text' }, message) : null,
        h('form', { class: 'auth-form', noValidate: true, onsubmit: (e) => { e.preventDefault(); onSubmit(); } },
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Senha'), pass),
          msg,
          h('div', { class: 'dialog-actions' }, cancel, ok))));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); if (!busy) finish(false); });
    document.body.append(dlg);
    dlg.showModal();
    pass.focus();
  });
}

export async function confirmDialog({ title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false }) {
  const r = await choiceDialog({
    title, message, defaultChoice: false,
    choices: [{ label: cancelLabel, value: false }, { label: confirmLabel, value: true, primary: !danger, danger }],
  });
  return r === true;
}
