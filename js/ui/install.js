// Instalar o Pauta como aplicativo. As Configurações e a tela de entrada (js/ui/account.js) mostram o mesmo convite; a decisão de
// O QUE oferecer mora só aqui:
//   - o navegador oferece instalar (app.installPrompt, guardado por js/main.js): um botão que abre o pedido dele;
//   - iPhone e iPad no navegador: o Safari não tem botão de instalar nem avisa nada, então vai o passo a passo;
//   - o navegador não oferece nada (janela anônima, Firefox, ou o Pauta já instalado e aberto numa aba): um botão "Como instalar",
//     que abre o passo a passo e um "Copiar endereço" (para colar numa janela normal). O site não consegue abrir a janela de
//     instalar por conta própria: quem libera é o navegador;
//   - já aberto como aplicativo, ou instalado agora há pouco: não há o que instalar.
import { APP_NAME } from '../config.js';
import { isIos } from '../speech.js';
import { h } from './dom.js';
import { icon } from './icons.js';

/** O passo a passo do iPhone e do iPad. */
export const IOS_STEPS = 'Toque em Compartilhar e depois em Adicionar à Tela de Início.';

/** Quem usa Chrome, Edge ou Firefox no iPhone: desde o iOS 16.4 eles também adicionam à Tela de Início, mas no iOS mais antigo só o Safari adiciona. */
export const IOS_OTHER_BROWSER = 'Se a opção não aparecer neste navegador, abra este endereço no Safari.';

/** O "Como instalar" da tela de entrada (o navegador não oferece o botão): uma linha por situação. */
export const HOW_TO_INSTALL = {
  computer: `No Chrome ou Edge, no computador: clique no ícone de instalar na barra de endereço, ou procure “Instalar ${APP_NAME}” no menu do navegador (os três pontos).`,
  android: 'No Chrome do Android: abra o menu (os três pontos) e toque em “Instalar app” ou “Adicionar à tela inicial”.',
  incognito: 'Janela anônima não instala: copie o endereço e abra numa janela normal.',
  installed: `Já instalou? Abra o ${APP_NAME} pelo ícone dele (barra de tarefas, menu Iniciar ou tela inicial).`,
};

/** O que as Configurações dizem quando o navegador não oferece o botão e também não é um iPhone ou iPad. */
const OTHER_HELP = `No Chrome ou Edge, use o ícone de instalar na barra de endereço. No iPhone (Safari): ${IOS_STEPS[0].toLowerCase()}${IOS_STEPS.slice(1)}`;

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

/** iPhone ou iPad num navegador que não é o Safari (o iOS marca Chrome, Edge, Firefox e Opera com CriOS, EdgiOS, FxiOS e OPiOS). */
export function isIosOtherBrowser(env = globalThis) {
  return isIos(env) && /CriOS|EdgiOS|FxiOS|OPiOS/.test(env.navigator?.userAgent ?? '');
}

/** O passo a passo do iPhone e do iPad; fora do Safari, com a saída pelo Safari. */
export function iosText(env = globalThis) {
  return isIosOtherBrowser(env) ? `${IOS_STEPS} ${IOS_OTHER_BROWSER}` : IOS_STEPS;
}

/** O endereço do Pauta para colar numa janela normal (sem o que vem depois do # nem o nome do arquivo). Vazio se não souber. */
export function installAddress(env = globalThis) {
  try {
    return new URL('./', env.location.href).href;
  } catch {
    return '';
  }
}

/** Copia o endereço do Pauta. Devolve { ok, url }: sem permissão ou sem área de transferência, `ok` é false e a tela mostra o endereço para copiar à mão. */
export async function copyAddress(env = globalThis) {
  const url = installAddress(env);
  if (!url) return { ok: false, url };
  try {
    await env.navigator.clipboard.writeText(url);
    return { ok: true, url };
  } catch {
    return { ok: false, url };
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
    case 'ios': return h('p', { class: 'muted' }, iosText(env));
    case 'installed': return h('p', { class: 'muted' }, `O ${APP_NAME} já está instalado neste aparelho.`);
    default: return h('p', { class: 'muted' }, OTHER_HELP);
  }
}

let sequence = 0; // para o botão "Como instalar" apontar para o painel dele (o `id` não pode repetir)

/** O botão "Como instalar" e o painel que ele abre e fecha (o passo a passo e o "Copiar endereço"). */
function howToInstall(env) {
  const id = `install-como-${(sequence += 1)}`;
  const status = h('span', { class: 'install-copy-status', role: 'status' });
  const address = h('input', { class: 'input install-address', type: 'text', readonly: true, hidden: true, 'aria-label': `Endereço do ${APP_NAME}`, onfocus: (e) => e.target.select() });
  const copy = h('button', {
    class: 'btn btn-sm', type: 'button',
    onclick: async () => {
      const r = await copyAddress(env);
      status.textContent = r.ok ? 'Endereço copiado. Cole numa janela normal do Chrome.' : 'Não consegui copiar sozinho: copie o endereço abaixo.';
      address.value = r.url;
      address.hidden = r.ok; // se o navegador não deixou copiar, o endereço aparece para copiar à mão
      if (!r.ok) {
        address.focus();
        address.select();
      }
    },
  }, icon('copy', 15), 'Copiar endereço');
  const panel = h('div', { class: 'install-note-panel', id, hidden: true },
    h('ul', { class: 'install-how' },
      h('li', {}, HOW_TO_INSTALL.computer),
      h('li', {}, HOW_TO_INSTALL.android),
      h('li', {}, HOW_TO_INSTALL.incognito, h('div', { class: 'install-copy' }, copy, status), address),
      h('li', {}, HOW_TO_INSTALL.installed)));
  const toggle = h('button', {
    class: 'btn btn-sm', type: 'button', 'aria-expanded': 'false', 'aria-controls': id,
    onclick: () => {
      const open = panel.hidden;
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
    },
  }, icon('info', 15), 'Como instalar');
  return { toggle, panel };
}

/**
 * Tela de entrada e janela de conta: um bloco discreto "Instalar o Pauta no seu aparelho" para o topo, acima do formulário.
 * Com o convite do navegador vai o botão "Instalar"; no iPhone e no iPad, o passo a passo; sem nada disso, o botão "Como instalar".
 * Devolve null só quando o Pauta já está instalado (aberto como aplicativo, ou instalado agora há pouco).
 */
export function installNote(app, { onChange, env = globalThis } = {}) {
  const kind = installKind(app, env);
  if (kind === 'installed') return null;
  const how = kind === 'other' ? howToInstall(env) : null;
  return h('div', { class: 'install-note' },
    icon('phone', 18),
    h('div', { class: 'install-note-text' },
      h('strong', {}, `Instalar o ${APP_NAME} no seu aparelho`),
      kind === 'ios' ? h('span', {}, iosText(env)) : null), // com o botão não precisa de mais texto: o bloco fica enxuto
    kind === 'prompt' ? installButton(app, { onChange, label: 'Instalar', small: true }) : how?.toggle,
    how?.panel);
}
