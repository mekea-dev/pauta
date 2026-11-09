// Arrastar a linha da tarefa (js/ui/swipe.js): a máquina do gesto, sem tela. A ligação com a linha foi conferida no navegador.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SWIPE, createSwipe, swipeThreshold } from '../js/ui/swipe.js';

/** Um gesto que começa em (100, 100) e anda para (100 + dx, 100 + dy) em vários passos, como um dedo de verdade. */
function drag(swipe, dx, dy = 0, { steps = 6, from = [100, 100] } = {}) {
  swipe.start(...from);
  let last = null;
  const crossings = [];
  for (let i = 1; i <= steps; i += 1) {
    last = swipe.move(from[0] + (dx * i) / steps, from[1] + (dy * i) / steps);
    if (last.crossed) crossings.push(i);
  }
  return { last, crossings };
}

test('limite para valer: 35% da largura da linha, nunca menos de 90 px nem mais de 140 px', () => {
  assert.equal(swipeThreshold(360), 126);
  assert.equal(swipeThreshold(200), 90, 'linha estreita: o mínimo');
  assert.equal(swipeThreshold(600), 140, 'linha larga: o máximo');
  assert.equal(swipeThreshold(400), 140);
  for (const ruim of [0, -5, NaN, undefined, null, Infinity]) assert.equal(swipeThreshold(ruim), 140, `largura inválida (${ruim}): cai no máximo`);
  assert.equal(SWIPE.slop, 10);
  assert.equal(createSwipe({ width: 360 }).limit, 126);
});

test('antes da folga de 10 px nada é decidido: um toque, mesmo com um tremorzinho, não é arrasto', () => {
  const s = createSwipe({ width: 360 });
  s.start(100, 100);
  for (const [x, y] of [[103, 101], [106, 99], [100, 108], [94, 100]]) {
    const v = s.move(x, y);
    assert.equal(v.mode, 'wait');
    assert.equal(v.offset, 0);
    assert.equal(v.armed, null);
  }
  assert.deepEqual(s.end(), { action: null, dragged: false });
  assert.equal(s.mode, 'idle');
});

test('movimento mais vertical que horizontal é rolagem da página: nada se mexe, nem depois, mesmo que o dedo vá para o lado', () => {
  const s = createSwipe({ width: 360 });
  s.start(100, 100);
  assert.equal(s.move(104, 118).mode, 'scroll');
  for (const x of [150, 260, 400]) {
    const v = s.move(x, 120);
    assert.equal(v.mode, 'scroll', 'o gesto continua sendo rolagem');
    assert.equal(v.offset, 0);
    assert.equal(v.armed, null);
  }
  assert.deepEqual(s.end(), { action: null, dragged: false });
});

test('na diagonal exata vale a rolagem (na dúvida, o dedo não arrasta a tarefa)', () => {
  const s = createSwipe({ width: 360 });
  s.start(0, 0);
  assert.equal(s.move(15, 15).mode, 'scroll');
});

test('arrasto na horizontal: a linha só começa a andar depois da folga (sem pulo) e acompanha o dedo até o limite', () => {
  const s = createSwipe({ width: 360 });
  s.start(100, 100);
  const logo = s.move(110, 101); // 10 px: decidiu que é arrasto, mas a linha ainda não andou
  assert.equal(logo.mode, 'drag');
  assert.equal(logo.distance, 0);
  assert.equal(logo.offset, 0);
  assert.equal(logo.side, null);
  const v = s.move(140, 103);
  assert.equal(v.distance, 30, '40 px do dedo menos os 10 da folga');
  assert.equal(v.offset, 30, 'até o limite a linha anda igual ao dedo');
  assert.equal(v.side, 'right');
  assert.equal(v.armed, null);
  assert.ok(v.progress > 0 && v.progress < 1);
  const esq = s.move(60, 98);
  assert.equal(esq.distance, -30);
  assert.equal(esq.side, 'left');
  assert.equal(esq.offset, -30);
});

test('passou do limite: fica "armado" naquele lado (e avisa uma vez só que cruzou, para a vibração)', () => {
  const s = createSwipe({ width: 360 }); // limite 126
  const { last, crossings } = drag(s, 10 + 126, 0, { steps: 14 });
  assert.equal(last.armed, 'right');
  assert.equal(last.progress, 1);
  assert.equal(crossings.length, 1, 'cruzou o limite uma vez');
  assert.equal(s.move(100 + 10 + 130, 100).crossed, false, 'continuar arrastando não "cruza" de novo');

  const quase = drag(createSwipe({ width: 360 }), 10 + 125);
  assert.equal(quase.last.armed, null, '1 px antes do limite ainda não vale');
  assert.equal(quase.crossings.length, 0);

  const esquerda = drag(createSwipe({ width: 360 }), -(10 + 126));
  assert.equal(esquerda.last.armed, 'left');
});

test('soltar: só vale se soltou armado; antes do limite a linha volta ao lugar', () => {
  const curto = createSwipe({ width: 360 });
  drag(curto, 10 + 100);
  assert.deepEqual(curto.end(), { action: null, dragged: true }, 'houve arrasto (o clique seguinte deve ser ignorado), mas nada acontece');

  const direita = createSwipe({ width: 360 });
  drag(direita, 10 + 140);
  assert.deepEqual(direita.end(), { action: 'right', dragged: true });

  const esquerda = createSwipe({ width: 360 });
  drag(esquerda, -(10 + 140));
  assert.deepEqual(esquerda.end(), { action: 'left', dragged: true });
});

test('arrastou além do limite e voltou antes de soltar: cancela (sem ação)', () => {
  const s = createSwipe({ width: 360 });
  drag(s, 10 + 150);
  assert.equal(s.move(100 + 10 + 40, 100).armed, null, 'voltou para antes do limite');
  assert.deepEqual(s.end(), { action: null, dragged: true });
});

test('o dedo pode passar para o outro lado no mesmo gesto: vale onde soltou', () => {
  const s = createSwipe({ width: 360 });
  s.start(200, 100);
  s.move(200 + 10 + 140, 100);
  assert.equal(s.move(200 + 10 + 140, 100).armed, 'right');
  const v = s.move(200 - 10 - 140, 100);
  assert.equal(v.armed, 'left');
  assert.equal(v.crossed, true, 'cruzou o limite do outro lado');
  assert.deepEqual(s.end(), { action: 'left', dragged: true });
});

test('o dedo volta para dentro da folga: a linha volta a 0 (nunca anda para o lado contrário)', () => {
  const s = createSwipe({ width: 360 });
  s.start(100, 100);
  s.move(130, 100);
  const v = s.move(104, 100); // dentro dos 10 px, do mesmo lado
  assert.equal(v.mode, 'drag');
  assert.equal(v.distance, 0);
  assert.equal(v.offset, 0);
  assert.equal(v.side, null);
});

test('depois do limite a linha anda mais devagar (efeito de elástico) e nunca passa da largura da linha', () => {
  const s = createSwipe({ width: 360 }); // limite 126
  s.start(0, 0);
  const v = s.move(10 + 226, 0); // 100 px além do limite
  assert.equal(v.distance, 226);
  assert.equal(v.offset, 126 + 100 * SWIPE.resistance);
  assert.ok(v.offset < v.distance);
  const longe = s.move(10 + 5000, 0);
  assert.equal(longe.offset, 360, 'no máximo a largura da linha');
  assert.equal(s.move(-10 - 5000, 0).offset, -360);
});

test('lado desligado: arrastar para lá não anda nem arma (a linha de repetição futura nem liga o gesto)', () => {
  const soEsquerda = createSwipe({ width: 360, canRight: false });
  const direita = drag(soEsquerda, 10 + 200);
  assert.equal(direita.last.offset, 0);
  assert.equal(direita.last.armed, null);
  assert.deepEqual(soEsquerda.end(), { action: null, dragged: true });
  const esquerda = drag(soEsquerda, -(10 + 140));
  assert.equal(esquerda.last.armed, 'left');
  assert.deepEqual(soEsquerda.end(), { action: 'left', dragged: true });

  const soDireita = createSwipe({ width: 360, canLeft: false });
  assert.equal(drag(soDireita, -(10 + 200)).last.armed, null);
});

test('cancelar (o sistema tomou o gesto): nada acontece, e o que vem depois é ignorado até um novo toque', () => {
  const s = createSwipe({ width: 360 });
  drag(s, 10 + 150);
  assert.deepEqual(s.cancel(), { action: null, dragged: true });
  const v = s.move(400, 100);
  assert.equal(v.mode, 'idle');
  assert.equal(v.offset, 0);
  assert.deepEqual(s.end(), { action: null, dragged: false });
  // um toque novo funciona do começo
  assert.equal(drag(s, 10 + 140).last.armed, 'right');
});

test('antes de qualquer toque, mover ou soltar não faz nada; cada toque começa do zero', () => {
  const s = createSwipe();
  assert.equal(s.mode, 'idle');
  assert.equal(s.move(50, 50).mode, 'idle');
  assert.deepEqual(s.end(), { action: null, dragged: false });

  drag(s, 10 + 140);
  assert.deepEqual(s.end(), { action: 'right', dragged: true });
  s.start(0, 0);
  assert.equal(s.move(5, 0).armed, null, 'o toque anterior não deixa nada para trás');
  assert.deepEqual(s.end(), { action: null, dragged: false });
});
