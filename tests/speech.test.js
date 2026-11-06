// Microfone: o reconhecimento de voz do navegador, aqui trocado por um de mentira que o teste "fala" por ele.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpeech, describeSpeechError, isIosHomeScreenApp } from '../js/speech.js';

const PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';

function fakeEnv({ ua = PC, standalone = false, displayStandalone = false, withApi = true, startThrows = false } = {}) {
  const made = [];
  class Recognition {
    constructor() { made.push(this); }
    start() { if (startThrows) throw new Error('InvalidStateError'); this.started = true; }
    stop() { this.stopped = true; this.onend?.(); } // parar entrega o que foi ouvido e termina
    abort() { this.aborted = true; this.onend?.(); }
    /** Cada parte: { text, final }. */
    say(...parts) {
      this.onresult?.({ results: parts.map(({ text, final }) => Object.assign([{ transcript: text }], { isFinal: final })) });
    }
  }
  const env = { navigator: { userAgent: ua, platform: 'Win32', maxTouchPoints: 0, standalone }, matchMedia: () => ({ matches: displayStandalone }) };
  if (withApi) env.webkitSpeechRecognition = Recognition;
  return { env, made };
}

const listen = (speech) => {
  const log = { interim: [], final: [], errors: [], ended: 0 };
  const ok = speech.start({
    onInterim: (t) => log.interim.push(t), onFinal: (t) => log.final.push(t), onError: (c) => log.errors.push(c), onEnd: () => { log.ended += 1; },
  });
  return { ok, log };
};

test('usable: precisa da API e não vale no app da Tela de Início do iPhone', () => {
  assert.equal(createSpeech(fakeEnv().env).usable, true);
  assert.equal(createSpeech(fakeEnv({ withApi: false }).env).usable, false, 'Firefox: sem API');
  assert.equal(createSpeech(fakeEnv({ ua: IPHONE }).env).usable, true, 'Safari do iPhone numa aba comum funciona');
  assert.equal(createSpeech(fakeEnv({ ua: IPHONE, standalone: true }).env).usable, false, 'iPhone, app da Tela de Início');
  assert.equal(createSpeech(fakeEnv({ ua: IPHONE, displayStandalone: true }).env).usable, false, 'idem, pelo display-mode');
  assert.equal(createSpeech(fakeEnv({ displayStandalone: true }).env).usable, true, 'Chrome instalado (Android, computador) funciona');
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

test('erro: avisa o código, não entrega texto e ainda assim avisa o fim', () => {
  const { env, made } = fakeEnv();
  const { log } = listen(createSpeech(env));
  made[0].say({ text: 'algo', final: true });
  made[0].onerror({ error: 'network' });
  made[0].onend();
  assert.deepEqual(log.errors, ['network']);
  assert.deepEqual(log.final, []);
  assert.equal(log.ended, 1);
});

test('silêncio total: termina sem texto e sem entregar nada', () => {
  const { env, made } = fakeEnv();
  const { log } = listen(createSpeech(env));
  made[0].onend();
  assert.deepEqual(log.final, []);
  assert.equal(log.ended, 1);
});

test('não começa duas vezes, e devolve false se o navegador recusar', () => {
  const { env } = fakeEnv();
  const speech = createSpeech(env);
  assert.equal(listen(speech).ok, true);
  assert.equal(listen(speech).ok, false, 'já está ouvindo');
  const recusa = createSpeech(fakeEnv({ startThrows: true }).env);
  assert.equal(listen(recusa).ok, false);
  assert.equal(recusa.listening, false);
  assert.equal(listen(createSpeech(fakeEnv({ withApi: false }).env)).ok, false);
});

test('mensagens dos erros: cancelar não é erro; bloqueio e serviço indisponível levam ao teclado', () => {
  assert.equal(describeSpeechError('aborted'), null);
  for (const code of ['not-allowed', 'service-not-allowed', 'language-not-supported']) assert.equal(describeSpeechError(code).fatal, true, code);
  for (const code of ['no-speech', 'network', 'audio-capture', 'qualquer-outro']) assert.equal(describeSpeechError(code).fatal, false, code);
  assert.match(describeSpeechError('no-speech').text, /Não ouvi/);
  assert.match(describeSpeechError('qualquer-outro').text, /Tente de novo/);
});
