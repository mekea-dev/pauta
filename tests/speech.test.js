// Microfone: o reconhecimento de voz do navegador, aqui trocado por um de mentira que o teste "fala" por ele.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpeech, createSpeechMemory, describeSpeechError, isIosHomeScreenApp } from '../js/speech.js';

const PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const DIA = 86400000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `mute`: o navegador "mudo" (existe, aceita start, mas nunca dá sinal de vida nem termina: o que se teme no app do iPhone).
 * `startOk`: quantos `start()` funcionam (os seguintes falham, como quando o navegador ainda não terminou a rodada anterior).
 */
function fakeEnv({ ua = PC, standalone = false, displayStandalone = false, withApi = true, startThrows = false, ctorThrows = false, mute = false, startOk = Infinity } = {}) {
  const made = [];
  class Recognition {
    constructor() {
      if (ctorThrows) throw new Error('boom');
      this.starts = 0;
      made.push(this);
    }
    start() {
      if (startThrows || this.starts >= startOk) throw new Error('InvalidStateError');
      this.starts += 1;
      this.started = true;
    }
    stop() { this.stopped = true; if (!mute) this.onend?.(); } // parar entrega o que foi ouvido e termina
    abort() { this.aborted = true; if (!mute) this.onend?.(); }
    /** Cada parte: { text, final, confidence }. Uma rodada nova do navegador começa com a lista de trechos vazia. */
    say(...parts) {
      this.onresult?.({ results: parts.map(({ text, final, confidence }) => Object.assign([{ transcript: text, confidence }], { isFinal: final })) });
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
  const log = { interim: [], final: [], info: [], errors: [], ended: 0, endInfo: null };
  const ok = speech.start({
    onInterim: (t) => log.interim.push(t),
    onFinal: (t, info) => { log.final.push(t); log.info.push(info); },
    onError: (c) => log.errors.push(c),
    onEnd: (info) => { log.ended += 1; log.endInfo = info; },
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

test('ouve em português, mostra o que vem chegando e só entrega o texto final quando a pessoa manda parar', () => {
  const { env, made } = fakeEnv();
  const speech = createSpeech(env);
  const { ok, log } = listen(speech);
  assert.equal(ok, true);
  assert.equal(speech.listening, true);
  const rec = made[0];
  assert.equal(rec.lang, 'pt-BR');
  assert.equal(rec.interimResults, true);
  assert.equal(rec.continuous, true, 'não para no primeiro silêncio');
  rec.say({ text: 'crie uma tarefa', final: false });
  rec.say({ text: 'crie uma tarefa pagar boleto', final: false });
  rec.say({ text: 'crie uma tarefa pagar boleto dia 10', final: true });
  assert.deepEqual(log.interim, ['crie uma tarefa', 'crie uma tarefa pagar boleto', 'crie uma tarefa pagar boleto dia 10']);
  assert.deepEqual(log.final, [], 'o final só vem quando a pessoa manda parar');
  assert.equal(speech.listening, true);
  speech.stop();
  assert.deepEqual(log.final, ['crie uma tarefa pagar boleto dia 10']);
  assert.equal(log.ended, 1);
  assert.deepEqual(log.endInfo, { text: 'crie uma tarefa pagar boleto dia 10', failed: false, canceled: false });
  assert.equal(speech.listening, false);
});

test('junta as partes (o que já está firme e o que ainda pode mudar)', () => {
  const { env, made } = fakeEnv();
  const speech = createSpeech(env);
  const { log } = listen(speech);
  made[0].say({ text: 'pagar boleto ', final: true }, { text: 'amanhã', final: false });
  speech.stop();
  assert.deepEqual(log.final, ['pagar boleto amanhã']);
});

test('parar no meio entrega o que foi ouvido; cancelar não entrega nada', () => {
  const a = fakeEnv();
  const sa = createSpeech(a.env);
  const parar = listen(sa);
  a.made[0].say({ text: 'comprar pão', final: false });
  sa.stop();
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

test('parar sem ter ouvido nada: termina sem texto, sem erro, e o fim avisa que não veio texto', () => {
  const { env } = fakeEnv();
  const speech = createSpeech(env);
  const { log } = listen(speech);
  speech.stop();
  assert.deepEqual(log.final, []);
  assert.deepEqual(log.errors, []);
  assert.equal(log.ended, 1);
  assert.deepEqual(log.endInfo, { text: '', failed: false, canceled: false });
});

// ---------- ouvir até a pessoa mandar parar ----------
test('o navegador termina sozinho numa pausa: o app volta a ouvir e junta o que veio antes com o que vem depois', async () => {
  const { env, made } = fakeEnv();
  const speech = createSpeech(env, { restartMs: 5 });
  const { log } = listen(speech);
  const rec = made[0];
  rec.onstart();
  rec.say({ text: 'comprar pão', final: true });
  rec.onend(); // silêncio: o navegador encerrou a rodada
  assert.equal(speech.listening, true, 'continua ouvindo');
  assert.deepEqual(log.final, []);
  await sleep(40);
  assert.equal(rec.starts, 2, 'começou uma nova rodada');
  rec.say({ text: 'e leite', final: false }); // a nova rodada começa com a lista de trechos vazia
  assert.equal(log.interim.at(-1), 'comprar pão e leite');
  speech.stop();
  assert.deepEqual(log.final, ['comprar pão e leite']);
  assert.equal(log.ended, 1);
});

test('mandar parar entre uma rodada e outra termina na hora, com tudo o que foi ouvido', async () => {
  const { env, made } = fakeEnv();
  const speech = createSpeech(env, { restartMs: 500 });
  const { log } = listen(speech);
  made[0].say({ text: 'ligar para o João', final: true });
  made[0].onend();
  assert.equal(speech.listening, true);
  speech.stop(); // a próxima rodada ainda nem começou
  assert.deepEqual(log.final, ['ligar para o João']);
  assert.equal(speech.listening, false);
  assert.equal(made[0].starts, 1, 'não chegou a começar outra rodada');
  await sleep(10);
  assert.equal(log.ended, 1);
});

test('cancelar entre uma rodada e outra também termina na hora, sem entregar nada', () => {
  const { env, made } = fakeEnv();
  const speech = createSpeech(env, { restartMs: 500 });
  const { log } = listen(speech);
  made[0].say({ text: 'ligar para o João', final: true });
  made[0].onend();
  speech.cancel();
  assert.deepEqual(log.final, []);
  assert.equal(log.ended, 1);
  assert.equal(log.endInfo.canceled, true);
  assert.equal(speech.listening, false);
});

test('"não ouvi nada" (no-speech) numa pausa não é erro: o app segue ouvindo', async () => {
  const { env, made } = fakeEnv();
  const speech = createSpeech(env, { restartMs: 5, quickEndMs: 0 });
  const { log } = listen(speech);
  made[0].onstart();
  made[0].onerror({ error: 'no-speech' });
  made[0].onend();
  await sleep(40);
  assert.deepEqual(log.errors, []);
  assert.equal(speech.listening, true);
  assert.equal(made[0].starts, 2);
  speech.cancel();
});

test('sem ouvir nenhuma palavra por muito tempo, o app para sozinho (o microfone não fica aberto à toa)', async () => {
  const { env, made } = fakeEnv();
  const speech = createSpeech(env, { idleMs: 20 });
  const { log } = listen(speech);
  made[0].onstart();
  await sleep(70);
  assert.equal(made[0].stopped, true);
  assert.equal(log.ended, 1);
  assert.deepEqual(log.endInfo, { text: '', failed: false, canceled: false }, 'terminou sem texto: a tela avisa que não ouviu nada');
  assert.equal(speech.listening, false);
});

test('cada palavra ouvida zera a espera: quem fala devagar não é cortado', async () => {
  const { env, made } = fakeEnv();
  const speech = createSpeech(env, { idleMs: 120 });
  const { log } = listen(speech);
  made[0].onstart();
  for (const text of ['comprar', 'comprar pão', 'comprar pão e leite']) {
    await sleep(50);
    made[0].say({ text, final: false });
  }
  assert.equal(speech.listening, true, 'foram 150 ms no total, mas nunca 120 ms seguidos sem palavra');
  speech.stop();
  assert.deepEqual(log.final, ['comprar pão e leite']);
});

test('rodadas que acabam na hora, sem ouvir nada, de novo e de novo: o app desiste (não fica num laço)', async () => {
  const { env, made } = fakeEnv();
  const speech = createSpeech(env, { restartMs: 2, quickEndMs: 10000 });
  const { log } = listen(speech);
  for (let i = 0; i < 4; i += 1) {
    made[0].onend();
    await sleep(25);
  }
  assert.equal(made[0].starts, 4, 'a primeira rodada mais três tentativas');
  assert.deepEqual(log.errors, ['service-not-allowed'], 'nunca deu sinal de vida: é recusa do navegador');
  assert.equal(log.ended, 1);
  assert.equal(speech.listening, false);
  assert.equal(speech.blocked, true);
});

test('se o navegador não deixa começar a rodada seguinte, o app desiste com um erro (em vez de ficar "ouvindo" sem ouvir)', async () => {
  const { env, made } = fakeEnv({ startOk: 1 });
  const speech = createSpeech(env, { restartMs: 2 });
  const { log } = listen(speech);
  made[0].onstart();
  made[0].say({ text: 'comprar pão', final: true });
  made[0].onend();
  await sleep(60);
  assert.deepEqual(log.errors, ['unknown']);
  assert.equal(log.ended, 1);
  assert.equal(speech.listening, false);
  assert.deepEqual(log.final, [], 'com erro, não entrega: o texto já estava no campo e a pessoa decide');
});

test('Android repete tudo a cada trecho ("oi", "oi tudo", "oi tudo bem"): fica só o mais completo', () => {
  const { env, made } = fakeEnv();
  const speech = createSpeech(env);
  const { log } = listen(speech);
  made[0].say({ text: 'comprar', final: true }, { text: 'comprar pão', final: true }, { text: 'Comprar pão e leite', final: false });
  speech.stop();
  assert.deepEqual(log.final, ['Comprar pão e leite']);
});

test('confiança: média do que o navegador informou; 0 ou ausente = não informa (vira null)', () => {
  const a = fakeEnv();
  const sa = createSpeech(a.env);
  const la = listen(sa);
  a.made[0].say({ text: 'comprar pão', final: true, confidence: 0.9 }, { text: 'amanhã', final: true, confidence: 0.5 });
  sa.stop();
  assert.equal(la.log.info[0].confidence.toFixed(2), '0.70');

  const b = fakeEnv();
  const sb = createSpeech(b.env);
  const lb = listen(sb);
  b.made[0].say({ text: 'comprar pão', final: true, confidence: 0 });
  sb.stop();
  assert.equal(lb.log.info[0].confidence, null, 'confiança 0 quer dizer "o navegador não informa": não é "baixa", é "não sei"');
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

test('limite de tempo total: passou do máximo, o app para sozinho e entrega o que ouviu', async () => {
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
