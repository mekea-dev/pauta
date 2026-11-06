// Telas da conta: entrar / criar conta, estado da sincronização no menu e o cartão da conta nas Configurações.
// Conta OPCIONAL: entrar e criar conta abrem numa janela. Conta OBRIGATÓRIA (exigirLogin em cloud/config.js): uma tela de
// entrada cobre o app inteiro enquanto não houver sessão. As regras do que acontece com os dados ficam em cloud/account.js;
// aqui é só a tela.
import { connect, disconnect, loginRequired, needsLogin, removeAccount } from '../cloud/account.js';
import { formatStamp } from '../dates.js';
import { plural } from '../text.js';
import { h, isTouch, qs } from './dom.js';
import { icon, logo } from './icons.js';
import { choiceDialog, confirmDialog, passwordDialog, toast } from './overlay.js';

const STATUS_TEXT = { idle: 'Sincronizado', syncing: 'Sincronizando…', offline: 'Sem conexão', error: 'Erro ao sincronizar' };
const STATUS_ICON = { idle: 'cloud-check', syncing: 'sync', offline: 'cloud-off', error: 'cloud-alert' };
const EMAIL_OK = /^\S+@\S+\.\S+$/;

export function createAccountUI(app) {
  const { cloud, sync, store } = app;
  // sem Firebase configurado: nada de conta aparece no app
  if (!cloud) return { enabled: false, required: false, gated: false, start() {}, sidebarItem: () => null, section: () => null, open() {} };
  const config = app.cloudConfig;
  const required = loginRequired(config);

  const dlg = h('dialog', { class: 'dialog dialog-sm auth', 'aria-labelledby': 'au-title' });
  document.body.append(dlg);
  let mode = 'signIn';
  let busy = false; // entrando, criando a conta ou pedindo o e-mail de redefinição
  let lastEmail = '';
  let downOnBackdrop = false;
  dlg.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === dlg; });
  dlg.addEventListener('click', (e) => { if (e.target === dlg && downOnBackdrop && !busy) dlg.close(); });
  dlg.addEventListener('cancel', (e) => { if (busy) e.preventDefault(); });

  const spinner = () => {
    const s = icon('spinner', 16);
    s.classList.add('spin');
    return s;
  };

  /** Pergunta o que fazer quando o aparelho e a conta já têm tarefas. */
  const askAdopt = ({ tasks }) => choiceDialog({
    title: 'Você já tem tarefas neste aparelho',
    message: `Há ${plural(tasks, 'tarefa', 'tarefas')} aqui e a conta também já tem tarefas. O que fazer?`,
    defaultChoice: 'merge',
    choices: [
      { label: 'Cancelar', value: null },
      { label: 'Usar só a conta', value: 'discard', danger: true },
      { label: 'Juntar as duas', value: 'merge', primary: true },
    ],
  });

  /** Aviso depois de entrar ou criar a conta. */
  const welcome = (signUp, r) => toast(signUp ? 'Conta criada. Suas tarefas estão sendo sincronizadas.'
    : r.ok ? 'Conectado. Suas tarefas estão sincronizadas.'
    : 'Conectado, mas não consegui sincronizar agora. Vou tentar de novo.');

  /** Aviso de privacidade que acompanha o cadastro. */
  const privacyNote = () => h('p', { class: 'auth-note' }, icon('shield', 15),
    h('span', {}, `Suas tarefas ficam guardadas na nuvem (Firebase, do Google), ligadas ao seu e-mail. Quem administra o serviço consegue ver os dados armazenados.${required ? '' : ' Sem conta, nada sai do seu aparelho.'}`));

  /**
   * O formulário de entrar / criar conta (o mesmo na janela e na tela de entrada).
   * onSwitch(modo): a pessoa quer trocar entre "Entrar" e "Criar conta". onDone(criou, resultado): deu certo.
   */
  function buildForm(m, { onSwitch, onDone }) {
    const signUp = m === 'signUp';
    const email = h('input', {
      class: 'input', type: 'email', autocomplete: 'email', inputmode: 'email', autocapitalize: 'none', spellcheck: 'false',
      placeholder: 'voce@exemplo.com', value: lastEmail, 'aria-label': 'E-mail',
    });
    const pass = h('input', {
      class: 'input', type: 'password', autocomplete: signUp ? 'new-password' : 'current-password',
      placeholder: signUp ? 'Pelo menos 8 caracteres' : 'Sua senha', 'aria-label': 'Senha',
    });
    const eye = h('button', {
      class: 'icon-btn sm', type: 'button', title: 'Mostrar a senha', 'aria-label': 'Mostrar a senha',
      onclick: () => {
        const show = pass.type === 'password';
        pass.type = show ? 'text' : 'password';
        eye.replaceChildren(icon(show ? 'eye-off' : 'eye', 16));
        eye.setAttribute('aria-label', show ? 'Esconder a senha' : 'Mostrar a senha');
        eye.title = show ? 'Esconder a senha' : 'Mostrar a senha';
      },
    }, icon('eye', 16));
    const invite = signUp && config.exigirConvite
      ? h('input', { class: 'input', type: 'text', autocomplete: 'off', autocapitalize: 'none', placeholder: 'Código de convite', 'aria-label': 'Código de convite' })
      : null;
    const msg = h('p', { class: 'auth-msg', role: 'alert', hidden: true });
    const label = signUp ? 'Criar conta' : 'Entrar';
    const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, icon(signUp ? 'user-plus' : 'log-in', 16), label);
    const resetBtn = h('button', { class: 'link-btn', type: 'button', onclick: () => onReset() }, 'Esqueci minha senha');

    const show = (text, tone = 'bad') => {
      msg.hidden = !text;
      msg.textContent = text;
      msg.className = `auth-msg${tone === 'info' ? ' info' : ''}`;
    };
    const setBusy = (b) => {
      busy = b;
      for (const el of [email, pass, invite, submit, resetBtn, eye]) if (el) el.disabled = b;
      submit.replaceChildren(b ? spinner() : icon(signUp ? 'user-plus' : 'log-in', 16), label);
    };

    async function onSubmit() {
      if (busy) return;
      const e = email.value.trim();
      const p = pass.value;
      lastEmail = e;
      const problem = !EMAIL_OK.test(e) ? 'Digite um e-mail válido.'
        : !p ? 'Digite a senha.'
        : signUp && p.length < 8 ? 'Escolha uma senha com pelo menos 8 caracteres.'
        : invite && !invite.value.trim() ? 'Digite o código de convite.'
        : '';
      if (problem) return show(problem);
      show('');
      setBusy(true);
      try {
        const r = await connect({ cloud, sync, store, mode: m, email: e, password: p, convite: invite?.value.trim() ?? '', exigirConvite: Boolean(config.exigirConvite), askAdopt });
        if (r.cancelled) return setBusy(false);
        onDone(signUp, r);
      } catch (err) {
        show(err?.message ?? 'Não foi possível concluir. Tente de novo.');
      }
      return setBusy(false);
    }

    async function onReset() {
      if (busy) return;
      const e = email.value.trim();
      if (!EMAIL_OK.test(e)) return show('Digite seu e-mail acima para receber o link de redefinição.');
      show('');
      setBusy(true);
      try {
        await cloud.sendReset(e);
        show('Se existir uma conta com esse e-mail, enviamos um link para criar uma nova senha. Olhe também o spam.', 'info');
      } catch (err) {
        show(err?.message ?? 'Não consegui enviar o e-mail agora.');
      }
      return setBusy(false);
    }

    const field = (title, control, hint) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, title), control, hint ? h('span', { class: 'hint' }, hint) : null);

    const form = h('form', { class: 'auth-form', noValidate: true, onsubmit: (e) => { e.preventDefault(); onSubmit(); } },
      field('E-mail', email),
      field('Senha', h('div', { class: 'pass-row' }, pass, eye)),
      invite ? field('Código de convite', invite, 'Peça o código para quem convidou você.') : null,
      msg,
      submit,
      signUp ? null : h('div', { class: 'auth-links' }, resetBtn),
      h('p', { class: 'auth-switch' },
        signUp ? 'Já tem conta? ' : 'Ainda não tem conta? ',
        h('button', { class: 'link-btn', type: 'button', onclick: () => { lastEmail = email.value.trim(); onSwitch(signUp ? 'signIn' : 'signUp'); } }, signUp ? 'Entrar' : 'Criar conta')));
    return { form, email };
  }

  // ---------- janela de entrar (conta opcional) ----------
  function build() {
    const signUp = mode === 'signUp';
    const { form, email } = buildForm(mode, {
      onSwitch: (m) => open(m),
      onDone: (isSignUp, r) => { dlg.close(); welcome(isSignUp, r); },
    });
    dlg.replaceChildren(h('div', { class: 'dialog-body' },
      h('div', { class: 'auth-head' },
        h('h2', { id: 'au-title', class: 'dialog-title' }, signUp ? 'Criar conta' : 'Entrar'),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fechar', onclick: () => { if (!busy) dlg.close(); } }, icon('x', 20))),
      h('p', { class: 'dialog-text' }, signUp ? 'Veja as mesmas tarefas no celular, no notebook e no PC.' : 'Entre para ver suas tarefas em qualquer aparelho.'),
      form,
      signUp ? privacyNote() : null));
    return email;
  }

  function open(m = 'signIn') {
    if (required) {
      if (!cloud.session) showGate();
      return;
    }
    mode = m;
    const email = build();
    if (!dlg.open) dlg.showModal();
    email.focus();
  }

  // ---------- tela de entrada (login obrigatório) ----------
  let gateEl = null;
  let gateOn = false;
  let gateMode = 'signIn';
  let gateNotice = '';
  const shell = () => [qs('.app'), qs('#fab')].filter(Boolean);

  function renderGate() {
    const signUp = gateMode === 'signUp';
    const { form, email } = buildForm(gateMode, {
      onSwitch: (m) => { gateMode = m; renderGate().focus(); },
      onDone: (isSignUp, r) => {
        hideGate();
        welcome(isSignUp, r);
        app.render();
        if (!isTouch()) app.composer.focus();
      },
    });
    gateEl.replaceChildren(h('div', { class: 'gate-card' },
      h('div', { class: 'gate-brand' }, logo(34), h('span', {}, 'Pauta')),
      h('h1', { id: 'gate-title', class: 'gate-title' }, signUp ? 'Criar conta' : 'Entrar'),
      h('p', { class: 'gate-text' }, signUp
        ? `Crie sua conta${config.exigirConvite ? ' com o código de convite' : ''}. Suas tarefas ficam sincronizadas no celular, no notebook e no PC.`
        : 'Entre com a sua conta para ver e criar suas tarefas.'),
      h('p', { class: 'auth-msg info gate-notice', role: 'status', hidden: !gateNotice }, gateNotice),
      form,
      signUp ? privacyNote() : null));
    return email;
  }

  function setGateNotice(text) {
    gateNotice = text;
    const el = gateEl?.querySelector('.gate-notice');
    if (el) {
      el.textContent = text;
      el.hidden = !text;
    }
  }

  function showGate(notice = '') {
    if (!gateEl) {
      gateEl = h('main', { class: 'gate', id: 'gate', 'aria-labelledby': 'gate-title' });
      document.body.append(gateEl);
    }
    gateNotice = notice;
    gateOn = true;
    document.body.classList.add('gated');
    for (const el of shell()) el.setAttribute('inert', '');
    // janelas abertas ficam por cima de tudo (camada superior do navegador): fecha para não aparecerem sobre a tela de entrada
    for (const d of document.querySelectorAll('dialog[open]')) d.close();
    gateEl.hidden = false;
    renderGate().focus();
  }

  function hideGate() {
    gateOn = false;
    gateNotice = '';
    document.body.classList.remove('gated');
    for (const el of shell()) el.removeAttribute('inert');
    if (gateEl) {
      gateEl.hidden = true;
      gateEl.replaceChildren(); // não deixa e-mail e senha digitados para trás
    }
  }

  /** Chamado uma vez, antes do primeiro desenho: com login obrigatório e sem sessão, a tela de entrada vem antes de qualquer tarefa. */
  function start() {
    if (!required) return;
    if (needsLogin(config, cloud.session)) showGate();
    cloud.onChange((session) => {
      if (!session && !gateOn) showGate(sync.status.errorCode === 'session' ? sync.status.error ?? '' : ''); // saiu, a sessão venceu ou a conta foi excluída
      else if (session && gateOn && !busy) location.reload(); // entrou em outra aba deste navegador: recomeça já com a sessão
    });
    sync.onChange((st) => {
      if (gateOn && st.errorCode === 'session' && st.error && st.error !== gateNotice) setGateNotice(st.error);
    });
  }

  // ---------- menu lateral ----------
  function sidebarItem() {
    const s = cloud.session;
    if (!s) {
      return h('button', { class: 'nav-item', type: 'button', title: 'Entrar para ver suas tarefas em outros aparelhos', onclick: () => open('signIn') },
        icon('log-in', 18), h('span', { class: 'nav-label' }, 'Entrar ou criar conta'));
    }
    const st = sync.status;
    const ic = icon(STATUS_ICON[st.state] ?? 'cloud', 18);
    if (st.state === 'syncing') ic.classList.add('spin');
    return h('button', {
      class: `nav-item account state-${st.state}`, type: 'button', title: st.error ?? `${s.email}: ${STATUS_TEXT[st.state] ?? ''}`,
      onclick: () => app.settings.open('conta'),
    }, ic, h('span', { class: 'nav-label two' }, h('span', { class: 'nav-main' }, s.email), h('span', { class: 'nav-sub' }, STATUS_TEXT[st.state] ?? '')));
  }

  // ---------- Configurações ----------
  async function leave() {
    const ok = await confirmDialog({
      title: 'Sair deste aparelho?',
      message: 'Suas tarefas continuam salvas na conta. Elas serão removidas deste aparelho. Se quiser uma cópia, baixe um backup antes.',
      confirmLabel: 'Sair', danger: true,
    });
    if (!ok) return;
    let r = await disconnect({ cloud, sync, store });
    if (r.pending) {
      const force = await confirmDialog({
        title: 'Há alterações que ainda não foram enviadas',
        message: `${r.message ?? 'Não consegui sincronizar agora.'} Se sair mesmo assim, o que não foi enviado será perdido.`,
        confirmLabel: 'Sair mesmo assim', danger: true,
      });
      if (!force) return;
      r = await disconnect({ cloud, sync, store, force: true });
    }
    if (r.ok) {
      app.settings.close();
      toast('Você saiu. As tarefas deste aparelho foram removidas; elas continuam na sua conta.');
    }
  }

  async function erase() {
    const done = await passwordDialog({
      title: 'Excluir sua conta?',
      message: `Sua conta e todas as tarefas guardadas na nuvem serão apagadas e isso não pode ser desfeito. ${required
        ? 'Para usar o Pauta de novo você vai precisar criar uma nova conta; as tarefas deste aparelho entram nela.'
        : 'As tarefas deste aparelho continuam aqui.'} Digite sua senha para confirmar.`,
      confirmLabel: 'Excluir a conta', danger: true,
      run: async (password) => {
        try {
          const r = await removeAccount({ cloud, sync, store, password });
          if (!r.ok) throw new Error('Você não está conectado.');
        } catch (err) {
          throw new Error(err?.code === 'credentials' ? 'Senha incorreta.' : (err?.message ?? 'Não consegui excluir a conta agora.'));
        }
      },
    });
    if (!done) return;
    app.settings.close();
    toast(required ? 'Conta excluída. Para voltar a usar o Pauta, crie uma nova conta.' : 'Conta excluída. Suas tarefas continuam neste aparelho.');
  }

  function section() {
    const s = cloud.session;
    const head = h('h3', {}, 'Conta e sincronização');
    if (!s) {
      return h('section', { class: 'st-section', id: 'st-conta' }, head,
        h('p', { class: 'muted' }, 'Sem conta, as tarefas ficam só neste aparelho. Com uma conta, as mesmas tarefas aparecem no celular, no notebook e no PC.'),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => open('signIn') }, icon('log-in', 16), 'Entrar'),
          h('button', { class: 'btn', type: 'button', onclick: () => open('signUp') }, icon('user-plus', 16), 'Criar conta')));
    }
    const st = sync.status;
    const ic = icon(STATUS_ICON[st.state] ?? 'cloud', 20);
    if (st.state === 'syncing') ic.classList.add('spin');
    return h('section', { class: 'st-section', id: 'st-conta' }, head,
      h('div', { class: `acct-card state-${st.state}` }, ic,
        h('div', { class: 'acct-text' }, h('strong', {}, s.email),
          h('span', { class: 'muted' }, `${STATUS_TEXT[st.state] ?? ''}${st.lastSyncAt && st.state === 'idle' ? ` · ${formatStamp(st.lastSyncAt)}` : ''}`))),
      st.error ? h('p', { class: 'status bad', role: 'status' }, st.error) : null,
      h('p', { class: 'muted' }, 'Suas tarefas são sincronizadas com a conta e também ficam salvas neste aparelho, então o Pauta funciona sem internet.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', type: 'button', disabled: st.state === 'syncing', onclick: () => sync.syncNow() }, icon('sync', 16), 'Sincronizar agora'),
        h('button', { class: 'btn', type: 'button', onclick: leave }, icon('log-out', 16), 'Sair deste aparelho')),
      h('div', { class: 'danger-zone' },
        h('button', { class: 'btn btn-danger-ghost', type: 'button', onclick: erase }, icon('trash', 16), 'Excluir minha conta')));
  }

  return { enabled: true, required, get gated() { return gateOn; }, start, sidebarItem, section, open };
}
