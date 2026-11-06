// Microfone: o reconhecimento de voz do navegador, aqui trocado por um de mentira que o teste "fala" por ele.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpeech, createSpeechMemory, describeSpeechError, isIosHomeScreenApp } from '../js/speech.js';

const PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const DIA = 86400000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** `mute`: o navegador "mudo" (existe, aceita start, mas nunca dá sinal de vida nem termina: o que se teme no app do iPhone). */
function fakeEnv({ ua = PC, standalone = false, displayStandalone = false, withApi = true, startThrows = false, ctorThrows = false, mute = false } = {}) {
  const made = [];
  class Recognition {
    constructor() {
      if (ctorThrows) throw new Error('boom');
      made.push(this);
    }
    start() { if (startThrows) throw new Error('InvalidStateError'); this.started = true; }
    stop() { this.stopped = true; if (!mute) this.onend?.(); } // parar entrega o que foi ouvido e termina
    abort() { this.aborted = true; if (!mute) this.onend?.(); }
    /** Cada parte: { text, final }. */
    say(...parts) {
      this.onresult?.({ results: parts.map(({ text, final }) => Object.assign([{ transcript: text }], { isFinal: final })) });
    }
  }
  const env = { navigator: { userAgent: ua, platform: 'Win32', maxTouchPoints: 0, standalone }, matchMedia: () => ({ matches: displayStandalone }) };
  if (withApi) env.webkitSpeechRecognition = Recognition;
  return { env, made };
}

const fakeStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
};

const listen = (speech) => {
  const log = { interim: [], final: [], errors: [], ended: 0 };
  const ok = speech.start({
    onInterim: (t) => log.interim.push(t), onFinal: (t) => log.final.push(t), onError: (c) => log.errors.push(c), onEnd: () => { log.ended += 1; },
  });
  return { ok, log };
};

/** O navegador avisa um erro e termina (como os de verdade fazem). */
const refuse = (rec, code) => {
  rec.onerror({ error: code });
  rec.onend();
};

test('usable: precisa da API; no app da Tela de Início do iPhone ele tenta mesmo assim', () => {
  assert.equal(createSpeech(fakeEnv().env).usable, true);
  assert.equal(createSpeech(fakeEnv({ withApi: false }).env).usable, false, 'Firefox: sem API');
  assert.equal(createSpeech(fakeEnv({ withApi: false }).env).blocked, false, 'sem API não é "recusou"');
  assert.equal(createSpeech(fakeEnv({ ua: IPHONE }).env).usable, true, 'Safari do iPhone numa aba comum');
  assert.equal(createSpeech(fakeEnv({ ua: IPHONE, standalone: true }).env).usable, true, 'app da Tela de Início: tenta (o iOS pode ter liberado)');
  assert.equal(createSpeech(fakeEnv({ ua: IPHONE, displayStandalone: true }).env).usable, true, 'idem, pelo display-mode');
  assert.equal(createSpeech(fakeEnv({ displayStandalone: true }).env).usable, true, 'Chrome instalado (Android, computador)');
});

test('isIosHomeScreenApp: só iPhone ou iPad com o app aberto pela Tela de Início', () => {
  assert.equal(isIosHomeScreenApp(fakeEnv({ ua: IPHONE, standalone: true }).env), true);
  assert.equal(isIosHomeScreenApp(fakeEnv({ ua: IPHONE, displayStandalone: true }).env), true);
  assert.equal(isIosHomeScreenApp(fakeEnv({ ua: IPHONE }).env), false, 'aba comum do Safari');
  assert.equal(isIosHomeScreenApp(fakeEnv({ displayStandalone: true }).env), false, 'Chrome instalado no computador');
  assert.equal(isIosHomeScreenApp({ navigator: { userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5, standalone: true } }), true, 'iPad que se apresenta como Mac');
  assert.equal(isIosHomeScreenApp({ navigator: { userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 0, standalone: true } }), false, 'Mac de verdade');
});

test('ouve em português, mostra o que vem chegando e entrega o texto final uma vez só', () => {
  const { env, made } = fakeEnv();
  const speech = createSpeech(env);
  const { ok, log } = listen(speech);
  assert.equal(ok, true);
  assert.equal(speech.listening, true);
  const rec = made[0];
  assert.equal(rec.lang, 'pt-BR');
  assert.equal(rec.interimResults, true);
  assert.equal(rec.continuous, false);
  rec.say({ text: 'crie uma tarefa', final: false });
  rec.say({ text: 'crie uma tarefa pagar boleto', final: false });
  rec.say({ text: 'crie uma tarefa pagar boleto dia 10', final: true });
  assert.deepEqual(log.interim, ['crie uma tarefa', 'crie uma tarefa pagar boleto', 'crie uma tarefa pagar boleto dia 10']);
  assert.deepEqual(log.final, [], 'o final só vem quando o reconhecimento termina');
  rec.stop();
  assert.deepEqual(log.final, ['crie uma tarefa pagar boleto dia 10']);
  assert.equal(log.ended, 1);
  assert.equal(speech.listening, false);
});

test('junta as partes (o que já está firme e o que ainda pode mudar)', () => {
  const { env, made } = fakeEnv();
  const { log } = listen(createSpeech(env));
  made[0].say({ text: 'pagar boleto ', final: true }, { text: 'amanhã', final: false });
  made[0].stop();
  assert.deepEqual(log.final, ['pagar boleto amanhã']);
});

test('parar no meio entrega o que foi ouvido; cancelar não entrega nada', () => {
  const a = fakeEnv();
  const parar = listen(createSpeech(a.env));
  a.made[0].say({ text: 'comprar pão', final: false });
  a.made[0].stop();
  assert.deepEqual(parar.log.final, ['comprar pão']);

  const b = fakeEnv();
  const speech = createSpeech(b.env);
  const cancelar = listen(speech);
  b.made[0].say({ text: 'comprar pão', final: false });
  speech.cancel();
  assert.equal(b.made[0].aborted, true);
  assert.deepEqual(cancelar.log.final, []);
  assert.deepEqual(cancelar.log.interim, ['comprar pão']);
  assert.equal(cancelar.log.ended, 1, 'o fim sempre é avisado, para a tela voltar ao normal');
  assert.equal(speech.listening, false);
});

test('erro passageiro: avisa o código, não entrega texto, avisa o fim e não bloqueia o microfone', () => {
  const { env, made } = fakeEnv();
  const speech = createSpeech(env);
  const { log } = listen(speech);
  made[0].say({ text: 'algo', final: true });
  refuse(made[0], 'network');
  assert.deepEqual(log.errors, ['network']);
  assert.deepEqual(log.final, []);
  assert.equal(log.ended, 1);
  assert.equal(speech.usable, true);
});

test('silêncio total: termina sem texto e sem entregar nada', () => {
  const { env, made } = fakeEnv();
  const { log } = listen(createSpeech(env));
  made[0].onend();
  assert.deepEqual(log.final, []);
  assert.deepEqual(log.errors, []);
  assert.equal(log.ended, 1);
});

test('não começa duas vezes; se o navegador recusar o start, devolve false (sem bloquear); se nem criar o reconhecimento, bloqueia', () => {
  const { env } = fakeEnv();
  const speech = createSpeech(env);
  assert.equal(listen(speech).ok, true);
  assert.equal(listen(speech).ok, false, 'já está ouvindo');
  const recusa = createSpeech(fakeEnv({ startThrows: true }).env);
  assert.equal(listen(recusa).ok, false);
  assert.equal(recusa.listening, false);
  assert.equal(recusa.usable, true, 'um start que falhou não conta como "recusou"');
  assert.equal(listen(createSpeech(fakeEnv({ withApi: false }).env)).ok, false);
  const quebrado = createSpeech(fakeEnv({ ctorThrows: true }).env);
  assert.equal(listen(quebrado).ok, false);
  assert.equal(quebrado.blocked, true, 'a API existe mas nem cria o reconhecimento: não adianta insistir');
});

test('mensagens dos erros: cancelar não é erro; bloqueio e serviço indisponível levam ao teclado', () => {
  assert.equal(describeSpeechError('aborted'), null);
  for (const code of ['not-allowed', 'service-not-allowed', 'language-not-supported']) assert.equal(describeSpeechError(code).fatal, true, code);
  for (const code of ['no-speech', 'network', 'audio-capture', 'qualquer-outro']) assert.equal(describeSpeechError(code).fatal, false, code);
  assert.match(describeSpeechError('no-speech').text, /Não ouvi/);
  assert.match(describeSpeechError('qualquer-outro').text, /Tente de novo/);
});

// ---------- o navegador recusa (o que se espera no app da Tela de Início do iPhone) ----------
test('recusa do navegador: o app não insiste; "reset" deixa tentar de novo', () => {
  const { env, made } = fakeEnv({ ua: IPHONE, standalone: true });
  const speech = createSpeech(env);
  const { log } = listen(speech);
  refuse(made[0], 'service-not-allowed');
  assert.deepEqual(log.errors, ['service-not-allowed']);
  assert.equal(speech.usable, false);
  assert.equal(speech.blocked, true);
  speech.reset();
  assert.equal(speech.usable, true);
  assert.equal(speech.blocked, false);
});

test('a recusa fica lembrada no aparelho por 7 dias (vale para a próxima abertura do app) e depois o app tenta de novo', () => {
  const storage = fakeStorage();
  let clock = 1_000_000;
  const options = () => ({ memory: createSpeechMemory(storage), now: () => clock });
  const a = fakeEnv({ ua: IPHONE, standalone: true });
  listen(createSpeech(a.env, options()));
  refuse(a.made[0], 'service-not-allowed');
  assert.equal(JSON.parse(storage.getItem('pauta:voz')).code, 'service-not-allowed');

  const reaberto = createSpeech(fakeEnv({ ua: IPHONE, standalone: true }).env, options()); // o app foi fechado e aberto de novo
  assert.equal(reaberto.usable, false);
  assert.equal(reaberto.blocked, true);
  clock += 6 * DIA;
  assert.equal(reaberto.usable, false, 'ainda dentro dos 7 dias');
  clock += 2 * DIA;
  assert.equal(reaberto.usable, true, 'passou o prazo: tenta de novo (o iOS pode ter liberado)');
  clock = 0; // relógio mudado para trás: o que foi anotado "no futuro" não vale
  assert.equal(reaberto.usable, true);

  clock = 1_000_000;
  storage.setItem('pauta:voz', JSON.stringify({ at: clock, code: 'service-not-allowed' }));
  assert.equal(reaberto.usable, false);
  reaberto.reset();
  assert.equal(createSpeech(fakeEnv().env, options()).usable, true, 'reset apaga a lembrança do aparelho');
});

test('"não permitido": no computador é escolha da pessoa (não vira bloqueio); no app do iPhone é limite do sistema; idioma sem suporte vale em qualquer lugar', () => {
  const pc = fakeEnv();
  const a = createSpeech(pc.env);
  listen(a);
  refuse(pc.made[0], 'not-allowed');
  assert.equal(a.usable, true);

  const phone = fakeEnv({ ua: IPHONE, standalone: true });
  const b = createSpeech(phone.env);
  listen(b);
  refuse(phone.made[0], 'not-allowed');
  assert.equal(b.usable, false);

  const lang = fakeEnv();
  const c = createSpeech(lang.env);
  listen(c);
  refuse(lang.made[0], 'language-not-supported');
  assert.equal(c.usable, false);
});

test('"aborted" que ninguém pediu: antes de qualquer sinal de vida é recusa do navegador; depois, falha passageira; cancelar nosso não é erro', () => {
  const a = fakeEnv();
  const sa = createSpeech(a.env);
  const la = listen(sa);
  refuse(a.made[0], 'aborted');
  assert.deepEqual(la.log.errors, ['service-not-allowed']);
  assert.equal(sa.blocked, true);

  const b = fakeEnv();
  const sb = createSpeech(b.env);
  const lb = listen(sb);
  b.made[0].onstart();
  refuse(b.made[0], 'aborted');
  assert.deepEqual(lb.log.errors, ['unknown']);
  assert.equal(sb.usable, true);

  const c = fakeEnv();
  const sc = createSpeech(c.env);
  const lc = listen(sc);
  sc.cancel();
  c.made[0].onerror({ error: 'aborted' }); // o navegador também costuma avisar "aborted" depois de um cancelamento
  assert.deepEqual(lc.log.errors, []);
  assert.equal(sc.usable, true);
});

// ---------- o navegador fica mudo ----------
test('navegador mudo: pediram para parar e ele nunca deu sinal de vida -> o app termina por ele e avisa que não funciona aqui', async () => {
  const { env, made } = fakeEnv({ mute: true });
  const speech = createSpeech(env, { stopGraceMs: 15 });
  const { log } = listen(speech);
  assert.equal(speech.listening, true);
  speech.stop();
  assert.equal(speech.listening, true, 'espera um pouco antes de desistir');
  await sleep(60);
  assert.deepEqual(log.errors, ['service-not-allowed']);
  assert.equal(log.ended, 1);
  assert.equal(speech.listening, false);
  assert.equal(speech.blocked, true);
  assert.equal(made[0].aborted, true);
});

test('navegador que ouviu mas não terminou: entrega o que ouviu depois da espera, sem erro e sem bloquear', async () => {
  const { env, made } = fakeEnv({ mute: true });
  const speech = createSpeech(env, { stopGraceMs: 15 });
  const { log } = listen(speech);
  made[0].onstart();
  made[0].say({ text: 'comprar pão', final: false });
  speech.stop();
  await sleep(60);
  assert.deepEqual(log.final, ['comprar pão']);
  assert.deepEqual(log.errors, []);
  assert.equal(log.ended, 1);
  assert.equal(speech.usable, true);
});

test('cancelar com o navegador mudo também termina, sem entregar nada nem acusar erro', async () => {
  const { env } = fakeEnv({ mute: true });
  const speech = createSpeech(env, { stopGraceMs: 15 });
  const { log } = listen(speech);
  speech.cancel();
  await sleep(60);
  assert.deepEqual(log.final, []);
  assert.deepEqual(log.errors, []);
  assert.equal(log.ended, 1);
  assert.equal(speech.listening, false);
  assert.equal(speech.usable, true);
});

test('limite de tempo: ninguém dita uma tarefa por 30 segundos; passou do limite, o app para sozinho e entrega o que ouviu', async () => {
  const { env, made } = fakeEnv();
  const speech = createSpeech(env, { maxListenMs: 15 });
  const { log } = listen(speech);
  made[0].onstart();
  made[0].say({ text: 'ligar para o João', final: false });
  await sleep(60);
  assert.equal(made[0].stopped, true);
  assert.deepEqual(log.final, ['ligar para o João']);
  assert.equal(speech.listening, false);
});

// ---------- a lembrança no aparelho ----------
test('memória da recusa: grava e lê no armazenamento do aparelho; lixo ou armazenamento quebrado não derrubam nada', () => {
  const storage = fakeStorage();
  const memory = createSpeechMemory(storage);
  assert.equal(memory.get(), null);
  memory.set({ at: 5, code: 'service-not-allowed' });
  assert.deepEqual(memory.get(), { at: 5, code: 'service-not-allowed' });
  memory.clear();
  assert.equal(memory.get(), null);
  storage.setItem('pauta:voz', '{lixo');
  assert.equal(memory.get(), null);
  storage.setItem('pauta:voz', JSON.stringify({ at: 'ontem' }));
  assert.equal(memory.get(), null);

  const quebrado = createSpeechMemory({ getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); } });
  assert.equal(quebrado.get(), null);
  quebrado.set({ at: 1, code: 'x' });
  quebrado.clear();

  // sem onde guardar, a recusa ainda vale enquanto o app está aberto
  const { env, made } = fakeEnv({ ua: IPHONE, standalone: true });
  const speech = createSpeech(env, { memory: quebrado });
  listen(speech);
  refuse(made[0], 'service-not-allowed');
  assert.equal(speech.usable, false);
});
