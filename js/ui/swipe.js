// Arrastar a linha de uma tarefa (celular): para a direita conclui (ou reabre), para a esquerda exclui.
//
// Só vale se a pessoa ARRASTAR de verdade e SOLTAR depois do limite: um toque, a rolagem da página (movimento vertical) e um arrasto
// curto não fazem nada, e soltar de volta aquém do limite cancela. Isso é de propósito, para não concluir nem excluir sem querer
// (e o aviso das ações ainda traz o "Desfazer"). Só toque e caneta; o mouse e o teclado continuam com os botões de sempre.
//
// O arquivo tem duas partes: a máquina do gesto (`createSwipe`, pura, sem DOM, testada no Node) e a ligação com a linha da tela
// (`attachSwipe`, usada em taskrow.js).
import { h, reducedMotion } from './dom.js';
import { icon } from './icons.js';

export const SWIPE = Object.freeze({
  slop: 10, // quanto o dedo anda (px) antes de decidir se é arrasto ou rolagem
  minDistance: 90, // o limite nunca é menor que isso (px)...
  maxDistance: 140, // ...nem maior que isso
  fraction: 0.35, // e, entre os dois, é essa fração da largura da linha
  resistance: 0.4, // depois do limite a linha anda só essa fração do que o dedo andou (parece "puxar um elástico")
});

/** Quanto é preciso arrastar (px) para valer: 35% da largura da linha, entre 90 e 140 px. */
export function swipeThreshold(width, cfg = SWIPE) {
  const w = Number.isFinite(width) && width > 0 ? width : cfg.maxDistance / cfg.fraction;
  return Math.round(Math.max(cfg.minDistance, Math.min(cfg.fraction * w, cfg.maxDistance))); // (em px inteiros)
}

/**
 * A máquina do gesto de uma linha. Quem usa passa as posições do dedo; ela diz o que fazer.
 *  - `start(x, y)` o dedo encostou; `move(x, y)` o dedo andou; `end()` o dedo saiu; `cancel()` o sistema tomou o gesto.
 *  - Nos primeiros `slop` px nada é decidido. Depois, se o movimento é mais horizontal que vertical, é um arrasto; senão é rolagem da
 *    página e o resto do gesto é ignorado.
 *  - No arrasto, `distance` é o quanto a pessoa arrastou DEPOIS da folga (com sinal: positivo = direita), `offset` é quanto a linha
 *    anda na tela (igual a `distance` até o limite, e mais "pesado" depois) e `armed` diz de que lado soltar valeria ('right' | 'left'
 *    | null). `crossed` é true só no movimento em que o limite foi atravessado (para a vibração).
 *  - `end()` devolve `{ action, dragged }`: `action` é 'right' | 'left' só se soltou armado; `dragged` diz se houve arrasto (para
 *    ignorar o clique que o navegador pode mandar logo depois).
 * @param {{ width?: number, slop?: number, canRight?: boolean, canLeft?: boolean, cfg?: object }} [options] `width`: largura da linha
 */
export function createSwipe({ width = 360, slop = SWIPE.slop, canRight = true, canLeft = true, cfg = SWIPE } = {}) {
  const limit = swipeThreshold(width, cfg);
  const maxOffset = Number.isFinite(width) && width > 0 ? width : cfg.maxDistance / cfg.fraction;
  let mode = 'idle'; // 'idle' (sem toque) | 'wait' (ainda não decidiu) | 'drag' | 'scroll' (rolagem: ignora o resto do gesto)
  let x0 = 0;
  let y0 = 0;
  let distance = 0;
  let armed = null;

  const offsetOf = (d) => {
    const a = Math.abs(d);
    const shown = a <= limit ? a : limit + (a - limit) * cfg.resistance;
    return (Math.sign(d) * Math.min(shown, maxOffset)) || 0; // (|| 0 tira o "-0")
  };
  const view = (crossed = false) => ({
    mode,
    distance,
    offset: offsetOf(distance),
    side: distance > 0 ? 'right' : distance < 0 ? 'left' : null,
    armed,
    progress: Math.min(Math.abs(distance) / limit, 1),
    crossed,
    limit,
  });
  const reset = () => {
    mode = 'idle';
    distance = 0;
    armed = null;
  };

  return {
    limit,
    get mode() { return mode; },
    start(x, y) {
      x0 = x;
      y0 = y;
      distance = 0;
      armed = null;
      mode = 'wait';
      return view();
    },
    move(x, y) {
      if (mode === 'idle' || mode === 'scroll') return view();
      const rx = x - x0;
      const ry = y - y0;
      if (mode === 'wait') {
        if (Math.max(Math.abs(rx), Math.abs(ry)) < slop) return view();
        if (Math.abs(rx) > Math.abs(ry)) {
          mode = 'drag';
        } else {
          mode = 'scroll'; // mais vertical (ou na diagonal exata): é rolagem da página
          return view();
        }
      }
      // a linha começa a andar só depois da folga: o gesto não "dá um pulo" na hora em que é decidido
      let d = (Math.sign(rx) * Math.max(0, Math.abs(rx) - slop)) || 0; // (|| 0 tira o "-0")
      if ((d > 0 && !canRight) || (d < 0 && !canLeft)) d = 0;
      distance = d;
      const before = armed;
      armed = Math.abs(d) >= limit ? (d > 0 ? 'right' : 'left') : null;
      return view(armed !== null && armed !== before);
    },
    end() {
      const dragged = mode === 'drag';
      const action = dragged ? armed : null;
      reset();
      return { action, dragged };
    },
    cancel() {
      const dragged = mode === 'drag';
      reset();
      return { action: null, dragged };
    },
  };
}

// ---------- a linha na tela ----------
// A tela é redesenhada de vez em quando (a sincronização, o relógio, outra mudança...) e a linha sob o dedo é trocada por outra igual.
// Por isso o gesto em andamento fica aqui, no módulo, e não dentro da linha: ele escuta o `document` e, se a linha foi trocada,
// passa a desenhar na nova (achada pelo `data-id`). Assim um redesenho no meio do arrasto não derruba o gesto.
const SLIDE_MS = 180; // a linha saindo da tela (ao valer) ou voltando ao lugar (ao cancelar)
const SUPPRESS_MS = 450; // depois de um arrasto, o clique que o navegador pode mandar é ignorado por esse tempo

let gesture = null; // o dedo em ação agora (um só)
const visual = new Map(); // id da tarefa -> estado visual de uma linha que está sendo arrastada, voltando ao lugar ou saindo da tela
let suppress = { key: null, until: 0 };
let guarded = false;

/** O clique que o navegador manda depois de um arrasto não pode abrir o editor nem marcar nada (só na linha que foi arrastada). */
function guardClicks() {
  if (guarded) return;
  guarded = true;
  document.addEventListener('click', (e) => {
    if (Date.now() >= suppress.until || e.target?.closest?.('.task')?.dataset?.id !== suppress.key) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
}

const makeBack = (kind, side) => {
  const label = h('span', { class: 'swipe-label' }, side.label);
  const el = h('div', { class: `swipe-bg is-${kind}`, 'aria-hidden': 'true' }, h('span', { class: 'swipe-cue' }, icon(side.icon, 20), label));
  return { kind, el, label, side, text: side.label };
};

/** Desenha o estado visual `g` na linha `g.li` (pode ser chamado de novo à vontade: se a linha foi trocada, refaz tudo nela). */
function show(g) {
  const li = g.li;
  li.classList.add('is-swiping');
  li.classList.toggle('is-settling', g.settling);
  li.style.setProperty('--swipe-x', `${g.offset}px`);
  if (!g.backs.length || g.backs[0].el.parentNode !== li) { // os fundos coloridos ficam atrás da linha: só aparecem onde ela já saiu
    for (const b of g.backs) b.el.remove();
    g.backs = [g.sides.right && makeBack('right', g.sides.right), g.sides.left && makeBack('left', g.sides.left)].filter(Boolean);
    li.prepend(...g.backs.map((b) => b.el));
  }
  for (const b of g.backs) {
    const active = g.side === b.kind;
    b.el.style.setProperty('--swipe-abs', active ? `${Math.abs(g.offset)}px` : '0px');
    b.el.style.setProperty('--swipe-progress', active ? String(g.progress) : '0');
    b.el.classList.toggle('is-armed', active && g.armed);
    const text = active && g.armed ? b.side.armedLabel : b.side.label;
    if (text !== b.text) {
      b.text = text;
      b.label.textContent = text;
    }
  }
}

/** A linha de `g` agora: a mesma de antes, ou a que a substituiu num redesenho (ou null, se a tarefa saiu da tela). */
function rowOf(g) {
  if (g.li.isConnected) return g.li;
  const next = document.querySelector(`.task[data-id="${String(g.key).replace(/["\\]/g, '\\$&')}"]`);
  if (!next) return null;
  g.li = next;
  g.width = next.getBoundingClientRect().width || g.width;
  if (g.shown) show(g);
  return next;
}

/** Tira tudo o que o arrasto pôs na linha. */
function clean(g) {
  clearTimeout(g.timer);
  const li = rowOf(g) ?? g.li;
  for (const b of g.backs) b.el.remove();
  g.backs = [];
  li.classList.remove('is-swiping', 'is-settling');
  li.style.removeProperty('--swipe-x');
  g.shown = false;
  if (visual.get(g.key) === g) visual.delete(g.key);
}

/** Anima a linha até `offset` (e o fundo do lado `side` até o mesmo tamanho) e chama `done` quando acabar. */
function slide(g, offset, side, done) {
  Object.assign(g, { offset, side, progress: side ? 1 : 0, settling: true, shown: true });
  if (rowOf(g)) show(g);
  clearTimeout(g.timer);
  if (reducedMotion() || !g.li.isConnected) done();
  else g.timer = setTimeout(done, SLIDE_MS);
}

function listen(on) {
  const fn = on ? 'addEventListener' : 'removeEventListener';
  document[fn]('pointermove', onMove);
  document[fn]('pointerup', onEnd);
  document[fn]('pointercancel', onEnd);
}

/** Larga o gesto em andamento como se o dedo tivesse sido cancelado (a linha volta ao lugar). */
function abandon(g) {
  gesture = null;
  listen(false);
  g.tracker.cancel();
  if (!g.shown) return;
  visual.set(g.key, g);
  slide(g, 0, null, () => clean(g));
}

function start(li, sides, e) {
  if ((e.pointerType !== 'touch' && e.pointerType !== 'pen') || !e.isPrimary || (e.button ?? 0) !== 0) return; // só toque (ou caneta), com um dedo
  if (gesture) abandon(gesture); // um novo dedo "primário" só aparece depois que o anterior saiu: o gesto antigo ficou para trás
  const key = li.dataset.id;
  if (!key) return;
  const old = visual.get(key);
  if (old?.out) return; // a ação desta linha já foi pedida: ela está saindo da tela
  if (old) clean(old); // ainda estava voltando ao lugar: este toque recomeça do zero
  const width = li.getBoundingClientRect().width;
  const tracker = createSwipe({ width, canRight: Boolean(sides.right), canLeft: Boolean(sides.left) });
  tracker.start(e.clientX, e.clientY);
  gesture = { key, li, sides, width, tracker, pointerId: e.pointerId, backs: [], offset: 0, side: null, armed: false, progress: 0, settling: false, shown: false, out: false, timer: 0 };
  listen(true);
}

function onMove(e) {
  const g = gesture;
  if (!g || e.pointerId !== g.pointerId) return;
  const v = g.tracker.move(e.clientX, e.clientY);
  if (v.mode !== 'drag') return; // ainda esperando decidir, ou é rolagem da página
  if (!rowOf(g)) { // a tarefa saiu da tela no meio do arrasto (apagada em outro aparelho, por exemplo): larga o gesto
    gesture = null;
    listen(false);
    return;
  }
  Object.assign(g, { offset: v.offset, side: v.side, armed: Boolean(v.armed), progress: v.progress, settling: false, shown: true });
  show(g);
  if (v.crossed) {
    try { navigator.vibrate?.(10); } catch { /* sem vibração neste aparelho */ }
  }
}

function onEnd(e) {
  const g = gesture;
  if (!g || e.pointerId !== g.pointerId) return;
  gesture = null;
  listen(false);
  const { action, dragged } = e.type === 'pointerup' ? g.tracker.end() : g.tracker.cancel();
  if (!dragged) return; // foi só um toque (ou rolagem): a linha nem foi mexida
  suppress = { key: g.key, until: Date.now() + SUPPRESS_MS };
  visual.set(g.key, g);
  if (!action) { // soltou antes do limite: volta ao lugar
    slide(g, 0, null, () => clean(g));
    return;
  }
  g.out = true; // a ação vale: a linha sai da tela e então a ação é feita (com o aviso e o "Desfazer" de sempre)
  const side = action === 'right' ? g.sides.right : g.sides.left;
  const run = () => {
    try {
      side.run();
    } finally {
      g.timer = setTimeout(() => clean(g), 350); // se a ação não redesenhou a lista (a linha continua aqui), volta ao normal
    }
  };
  slide(g, action === 'right' ? g.width : -g.width, action, run);
}

/**
 * Liga o gesto de arrastar a uma linha (`li`, com `data-id`). Cada lado é `{ label, armedLabel, icon, run }` ou null (lado desligado):
 * `label` aparece enquanto arrasta, `armedLabel` depois de passar do limite, `icon` é o nome do ícone e `run` a ação.
 */
export function attachSwipe(li, { right = null, left = null } = {}) {
  if (!right && !left) return;
  li.classList.add('is-swipeable'); // (css: touch-action que deixa só a rolagem vertical com o navegador)
  guardClicks();
  li.addEventListener('pointerdown', (e) => start(li, { right, left }, e));
}
