// O convite para instalar o Pauta (js/ui/install.js): o que oferecer em cada aparelho e o pedido de instalar do navegador.
import test from 'node:test';
import assert from 'node:assert/strict';
import { IOS_STEPS, installKind, installNow, isStandalone } from '../js/ui/install.js';

const PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mozilla/5.0 Mobile/15E148 Safari/604.1';
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
});

test('instalar: abre o pedido do navegador uma vez, devolve a escolha e esvazia o pedido (ele só vale uma vez)', async () => {
  let abriu = 0;
  const app = { installPrompt: { prompt() { abriu += 1; return Promise.resolve(); }, userChoice: Promise.resolve({ outcome: 'accepted' }) } };
  assert.equal(await installNow(app), 'accepted');
  assert.equal(abriu, 1);
  assert.equal(app.installPrompt, null);
  assert.equal(await installNow(app), null, 'sem pedido guardado, não faz nada');
  assert.equal(abriu, 1);

  const recusou = { installPrompt: { prompt() {}, userChoice: Promise.resolve({ outcome: 'dismissed' }) } };
  assert.equal(await installNow(recusou), 'dismissed');
  assert.equal(recusou.installPrompt, null);
});

test('instalar: um pedido que dá erro não derruba nada e também é descartado', async () => {
  const quebrado = { installPrompt: { prompt() { throw new Error('boom'); }, userChoice: Promise.resolve({}) } };
  assert.equal(await installNow(quebrado), null);
  assert.equal(quebrado.installPrompt, null);
  const rejeita = { installPrompt: { prompt() { return Promise.reject(new Error('já usado')); }, userChoice: Promise.reject(new Error('já usado')) } };
  assert.equal(await installNow(rejeita), null);
  assert.equal(rejeita.installPrompt, null);
});
