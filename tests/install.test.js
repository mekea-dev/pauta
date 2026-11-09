// O convite para instalar o Pauta (js/ui/install.js): o que oferecer em cada aparelho e o pedido de instalar do navegador.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HOW_TO_INSTALL, IOS_STEPS, copyAddress, installAddress, installKind, installNow, iosText, isIosOtherBrowser, isStandalone } from '../js/ui/install.js';

const PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mozilla/5.0 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1';
const env = ({ ua = PC, standalone = false, displayStandalone = false, platform = 'Win32', touch = 0 } = {}) => ({
  navigator: { userAgent: ua, platform, maxTouchPoints: touch, standalone },
  matchMedia: () => ({ matches: displayStandalone }),
});

test('já aberto como aplicativo (iPhone ou navegador): não há o que instalar', () => {
  assert.equal(isStandalone(env({ standalone: true })), true);
  assert.equal(isStandalone(env({ displayStandalone: true })), true);
  assert.equal(isStandalone(env()), false);
  assert.equal(installKind({ installPrompt: {} }, env({ displayStandalone: true })), 'installed', 'mesmo que o navegador ainda guarde o pedido');
  assert.equal(installKind({}, env({ ua: IPHONE, standalone: true })), 'installed');
});

test('o navegador oferece instalar: botão ("prompt"); iPhone e iPad no Safari: passo a passo ("ios"); o resto: "other"', () => {
  assert.equal(installKind({ installPrompt: { prompt() {} } }, env()), 'prompt');
  assert.equal(installKind({}, env({ ua: IPHONE })), 'ios');
  assert.equal(installKind({}, env({ ua: 'Macintosh', platform: 'MacIntel', touch: 5 })), 'ios', 'iPad que se apresenta como Mac');
  assert.equal(installKind({}, env()), 'other', 'computador sem o convite do navegador');
  assert.match(IOS_STEPS, /Compartilhar/);
  assert.match(IOS_STEPS, /Adicionar à Tela de Início/);
  // sem convite nem iPhone (janela anônima, Firefox...) a tela de entrada tem o botão "Como instalar", com o passo a passo
  assert.match(HOW_TO_INSTALL.computer, /barra de endereço/);
  assert.match(HOW_TO_INSTALL.android, /Instalar app/);
  assert.match(HOW_TO_INSTALL.incognito, /anônima/);
  assert.match(HOW_TO_INSTALL.incognito, /janela normal/);
  assert.match(HOW_TO_INSTALL.installed, /ícone/);
  // instalou nesta aba (a aba continua aberta): não volta a pedir, nem com um convite antigo guardado
  assert.equal(installKind({ installed: true }, env()), 'installed');
  assert.equal(installKind({ installed: true, installPrompt: { prompt() {} } }, env()), 'installed');
});

test('iPhone com Chrome, Edge ou Firefox: o mesmo passo a passo, mais a saída pelo Safari (no iOS mais antigo só o Safari adiciona à Tela de Início)', () => {
  const chrome = env({ ua: IPHONE_CHROME });
  assert.equal(installKind({}, chrome), 'ios', 'no iOS todo navegador usa o motor do Safari e nenhum recebe o convite do navegador');
  assert.equal(isIosOtherBrowser(chrome), true);
  for (const marca of ['EdgiOS/130.0', 'FxiOS/130.0', 'OPiOS/16.0']) assert.equal(isIosOtherBrowser(env({ ua: `${IPHONE} ${marca}` })), true, marca);
  assert.equal(isIosOtherBrowser(env({ ua: IPHONE })), false, 'Safari');
  assert.equal(isIosOtherBrowser(env()), false, 'Chrome no computador não é iPhone');
  assert.equal(iosText(env({ ua: IPHONE })), IOS_STEPS, 'no Safari, só o passo a passo');
  assert.match(iosText(chrome), /Adicionar à Tela de Início/);
  assert.match(iosText(chrome), /Safari/);
});

test('copiar o endereço: sem o que vem depois do # e sem o nome do arquivo; se o navegador não deixa copiar, devolve o endereço para copiar à mão', async () => {
  const noAr = { location: { href: 'https://mekea-dev.github.io/pauta/#/dia/2026-11-09' } };
  const url = 'https://mekea-dev.github.io/pauta/';
  assert.equal(installAddress(noAr), url);
  assert.equal(installAddress({ location: { href: 'http://localhost:8789/index.html?x=1#/hoje' } }), 'http://localhost:8789/');
  assert.equal(installAddress({}), '', 'sem endereço, não inventa um');

  let copiado = null;
  const ok = { ...noAr, navigator: { clipboard: { writeText: async (texto) => { copiado = texto; } } } };
  assert.deepEqual(await copyAddress(ok), { ok: true, url });
  assert.equal(copiado, url);

  const nega = { ...noAr, navigator: { clipboard: { writeText: async () => { throw new Error('negado'); } } } };
  assert.deepEqual(await copyAddress(nega), { ok: false, url });
  assert.deepEqual(await copyAddress({ ...noAr, navigator: {} }), { ok: false, url }, 'sem área de transferência (página sem https)');
  copiado = null;
  assert.deepEqual(await copyAddress({ navigator: ok.navigator }), { ok: false, url: '' }, 'sem endereço, não copia nada');
  assert.equal(copiado, null);
});

test('instalar: abre o pedido do navegador uma vez, devolve a escolha e esvazia o pedido (ele só vale uma vez)', async () => {
  let abriu = 0;
  const app = { installPrompt: { prompt() { abriu += 1; return Promise.resolve(); }, userChoice: Promise.resolve({ outcome: 'accepted' }) } };
  assert.equal(await installNow(app), 'accepted');
  assert.equal(abriu, 1);
  assert.equal(app.installPrompt, null);
  assert.equal(app.installed, true, 'aceitou: a tela já não pede de novo, antes mesmo do appinstalled');
  assert.equal(await installNow(app), null, 'sem pedido guardado, não faz nada');
  assert.equal(abriu, 1);

  const recusou = { installPrompt: { prompt() {}, userChoice: Promise.resolve({ outcome: 'dismissed' }) } };
  assert.equal(await installNow(recusou), 'dismissed');
  assert.equal(recusou.installPrompt, null);
  assert.notEqual(recusou.installed, true, 'recusar não é instalar: a dica volta');
});

test('instalar: um pedido que dá erro não derruba nada e também é descartado', async () => {
  const quebrado = { installPrompt: { prompt() { throw new Error('boom'); }, userChoice: Promise.resolve({}) } };
  assert.equal(await installNow(quebrado), null);
  assert.equal(quebrado.installPrompt, null);
  assert.notEqual(quebrado.installed, true);
  const rejeita = { installPrompt: { prompt() { return Promise.reject(new Error('já usado')); }, userChoice: Promise.reject(new Error('já usado')) } };
  assert.equal(await installNow(rejeita), null);
  assert.equal(rejeita.installPrompt, null);
});
