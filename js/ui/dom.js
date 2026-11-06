// Ajudantes para montar a tela. Nada que a pessoa digita vira HTML: tudo entra como texto.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (k.startsWith('aria-')) {
        if (v !== undefined && v !== null) el.setAttribute(k, String(v));
        continue;
      }
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.length > 2 && k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else if (k in el && !k.includes('-')) el[k] = v;
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const qs = (sel, root = document) => root.querySelector(sel);
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const isTouch = () => matchMedia('(pointer: coarse)').matches;
export const clip = (s, n = 60) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
