// Instalar o Pauta como aplicativo. As Configurações e a tela de entrada (js/ui/account.js) mostram o mesmo convite; a decisão de
// O QUE oferecer mora só aqui:
//   - o navegador oferece instalar (app.installPrompt, guardado por js/main.js): um botão que abre o pedido dele;
//   - iPhone e iPad no navegador: o Safari não tem botão de instalar nem avisa nada, então vai o passo a passo;
//   - o navegador não oferece nada (janela anônima, Firefox, ou o Pauta já instalado e aberto numa aba): uma dica de como instalar;
//   - já aberto como aplicativo, ou instalado agora há pouco: não há o que instalar.
import { APP_NAME } from '../config.js';
import { isIos } from '../speech.js';
import { h } from './dom.js';
import { icon } from './icons.js';

/** O passo a passo do iPhone e do iPad. */
export const IOS_STEPS = 'Toque em Compartilhar e depois em Adicionar à Tela de Início.';

const CHROME_EDGE = 'No Chrome ou Edge, use o ícone de instalar na barra de endereço';

/** A dica da tela de entrada quando o navegador não oferece o botão (e não é iPhone nem iPad). O Chrome não instala em janela anônima. */
export const BROWSER_HELP = `${CHROME_EDGE}, numa janela normal (não anônima).`;

/** O que as Configurações dizem nesse mesmo caso (junto com o passo a passo do iPhone, que a pessoa pode estar lendo para outro aparelho). */
const OTHER_HELP = `${CHROME_EDGE}. No iPhone (Safari): ${IOS_STEPS[0].toLowerCase()}${IOS_STEPS.slice(1)}`;

/** O Pauta foi aberto como aplicativo (pelo ícone, sem a barra do navegador)? `navigator.standalone` é do iPhone e do iPad. */
export function isStandalone(env = globalThis) {
  return env.navigator?.standalone === true || env.matchMedia?.('(display-mode: standalone)')?.matches === true;
}

/**
 * O que dá para oferecer agora: 'installed' (já é aplicativo), 'prompt' (o navegador oferece), 'ios' (o passo a passo) ou 'other'.
 * `app.installed` é marcado quando a pessoa aceita o pedido (`installNow`) e por js/main.js quando o navegador avisa que a
 * instalação terminou (`appinstalled`, que também vem de quem instala pelo ícone da barra de endereço): a aba continua aberta
 * e não deve voltar a pedir para instalar.
 */
export function installKind(app, env = globalThis) {
  if (isStandalone(env) || app.installed) return 'installed';
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
    const outcome = (await ev.userChoice)?.outcome ?? null;
    if (outcome === 'accepted') app.installed = true; // o `appinstalled` vem logo depois; até lá a tela já não pede de novo
    return outcome;
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
    case 'installed': return h('p', { class: 'muted' }, `O ${APP_NAME} já está instalado neste aparelho.`);
    default: return h('p', { class: 'muted' }, OTHER_HELP);
  }
}

/**
 * Tela de entrada e janela de conta: um bloco discreto "Instalar o Pauta no seu aparelho" para o topo, acima do formulário.
 * Com o convite do navegador vai o botão; no iPhone e no iPad, o passo a passo; sem nada disso, a dica de como instalar.
 * Devolve null só quando o Pauta já está instalado (aberto como aplicativo, ou instalado agora há pouco).
 */
export function installNote(app, { onChange, env = globalThis } = {}) {
  const kind = installKind(app, env);
  if (kind === 'installed') return null;
  const text = kind === 'ios' ? IOS_STEPS : kind === 'other' ? BROWSER_HELP : null; // com o botão não precisa de mais texto: o bloco fica enxuto
  return h('div', { class: 'install-note' },
    icon('phone', 18),
    h('div', { class: 'install-note-text' },
      h('strong', {}, `Instalar o ${APP_NAME} no seu aparelho`),
      text ? h('span', {}, text) : null),
    kind === 'prompt' ? installButton(app, { onChange, label: 'Instalar', small: true }) : null);
}
