// Instalar o Pauta como aplicativo. As Configurações e a tela de entrada (js/ui/account.js) mostram o mesmo convite; a decisão de
// O QUE oferecer mora só aqui:
//   - o navegador oferece instalar (app.installPrompt, guardado por js/main.js): um botão que abre o pedido dele;
//   - iPhone e iPad no navegador: o Safari não tem botão de instalar nem avisa nada, então vai o passo a passo;
//   - já aberto como aplicativo: não há o que instalar.
import { APP_NAME } from '../config.js';
import { isIos } from '../speech.js';
import { h } from './dom.js';
import { icon } from './icons.js';

/** O passo a passo do iPhone e do iPad. */
export const IOS_STEPS = 'Toque em Compartilhar e depois em Adicionar à Tela de Início.';

/** O que as Configurações dizem quando o navegador não oferece o botão e também não é um iPhone ou iPad. */
const OTHER_HELP = `No Chrome ou Edge, use o ícone de instalar na barra de endereço. No iPhone (Safari): ${IOS_STEPS[0].toLowerCase()}${IOS_STEPS.slice(1)}`;

/** O Pauta foi aberto como aplicativo (pelo ícone, sem a barra do navegador)? `navigator.standalone` é do iPhone e do iPad. */
export function isStandalone(env = globalThis) {
  return env.navigator?.standalone === true || env.matchMedia?.('(display-mode: standalone)')?.matches === true;
}

/** O que dá para oferecer agora: 'installed' (já é aplicativo), 'prompt' (o navegador oferece), 'ios' (o passo a passo) ou 'other'. */
export function installKind(app, env = globalThis) {
  if (isStandalone(env)) return 'installed';
  if (app.installPrompt) return 'prompt';
  return isIos(env) ? 'ios' : 'other';
}

/**
 * Abre o pedido de instalar do navegador (o mesmo para quem toca em "Instalar" nas Configurações ou na tela de entrada).
 * Devolve 'accepted', 'dismissed' ou null (não havia pedido ou o navegador não o abriu). Cada pedido só vale uma vez:
 * no fim, `app.installPrompt` volta a ficar vazio e quem chamou redesenha a tela.
 */
export async function installNow(app) {
  const ev = app.installPrompt;
  if (!ev) return null;
  try {
    Promise.resolve(ev.prompt()).catch(() => {}); // precisa ser chamado direto do toque da pessoa
    return (await ev.userChoice)?.outcome ?? null;
  } catch {
    return null;
  } finally {
    if (app.installPrompt === ev) app.installPrompt = null;
  }
}

function installButton(app, { onChange, label, small }) {
  const btn = h('button', {
    class: `btn btn-primary${small ? ' btn-sm' : ''}`, type: 'button',
    onclick: async () => {
      btn.disabled = true; // um toque só: o pedido do navegador não abre duas vezes
      await installNow(app);
      btn.disabled = false;
      onChange?.();
    },
  }, icon('phone', small ? 15 : 16), label);
  return btn;
}

/**
 * Configurações: o que vai logo abaixo da explicação da seção "Instalar como aplicativo". Sempre devolve algo.
 * `onChange`: roda depois do pedido do navegador (a seção se desenha de novo).
 */
export function installActions(app, { onChange, env = globalThis } = {}) {
  switch (installKind(app, env)) {
    case 'prompt': return installButton(app, { onChange, label: `Instalar o ${APP_NAME}`, small: false });
    case 'ios': return h('p', { class: 'muted' }, IOS_STEPS);
    case 'installed': return h('p', { class: 'muted' }, `Você já está usando o ${APP_NAME} como aplicativo.`);
    default: return h('p', { class: 'muted' }, OTHER_HELP);
  }
}

/**
 * Tela de entrada e janela de conta: um bloco discreto "Instalar o Pauta no seu aparelho" para o topo, acima do formulário.
 * Devolve null quando não há o que oferecer (já é aplicativo, ou este navegador não tem como instalar daqui).
 */
export function installNote(app, { onChange, env = globalThis } = {}) {
  const kind = installKind(app, env);
  if (kind !== 'prompt' && kind !== 'ios') return null;
  return h('div', { class: 'install-note' },
    icon('phone', 18),
    h('div', { class: 'install-note-text' },
      h('strong', {}, `Instalar o ${APP_NAME} no seu aparelho`),
      kind === 'ios' ? h('span', {}, IOS_STEPS) : null), // com o botão não precisa de mais texto: o bloco fica enxuto
    kind === 'prompt' ? installButton(app, { onChange, label: 'Instalar', small: true }) : null);
}
