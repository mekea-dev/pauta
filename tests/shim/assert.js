// Subconjunto de `node:assert/strict` para rodar os mesmos testes no navegador.
class AssertionError extends Error {}

const show = (v) => {
  try {
    return JSON.stringify(v, (k, x) => (x instanceof Map ? { Map: [...x] } : x instanceof Set ? { Set: [...x] } : x));
  } catch {
    return String(v);
  }
};

function deepEq(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (a instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof Map) return a.size === b.size && [...a].every(([k, v]) => b.has(k) && deepEq(v, b.get(k)));
  if (a instanceof Set) return a.size === b.size && [...a].every((v) => b.has(v));
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEq(a[k], b[k]));
}

function assert(value, message) {
  if (!value) throw new AssertionError(message ?? 'esperado um valor verdadeiro');
}
assert.ok = assert;
assert.equal = (a, b, message) => {
  if (!Object.is(a, b)) throw new AssertionError(message ?? `esperado ${show(b)}, recebido ${show(a)}`);
};
assert.notEqual = (a, b, message) => {
  if (Object.is(a, b)) throw new AssertionError(message ?? `esperado algo diferente de ${show(b)}`);
};
assert.deepEqual = (a, b, message) => {
  if (!deepEq(a, b)) throw new AssertionError(message ?? `esperado ${show(b)}, recebido ${show(a)}`);
};
assert.notDeepEqual = (a, b, message) => {
  if (deepEq(a, b)) throw new AssertionError(message ?? `esperado valores diferentes: ${show(a)}`);
};
assert.match = (s, re, message) => {
  if (!re.test(s)) throw new AssertionError(message ?? `${show(s)} não casa com ${re}`);
};
assert.throws = (fn, expected) => {
  try {
    fn();
  } catch (e) {
    if (expected instanceof RegExp && !expected.test(String(e?.message ?? e))) throw new AssertionError(`erro inesperado: ${e?.message}`);
    return;
  }
  throw new AssertionError('esperava que lançasse um erro');
};

/** Como o assert.rejects do Node: a promessa precisa falhar; `expected` pode ser RegExp, objeto de propriedades ou função. */
assert.rejects = async (promiseOrFn, expected) => {
  try {
    await (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn);
  } catch (e) {
    if (expected instanceof RegExp) {
      if (!expected.test(String(e?.message ?? e))) throw new AssertionError(`erro inesperado: ${e?.message}`);
    } else if (expected && typeof expected === 'object') {
      for (const [k, v] of Object.entries(expected)) {
        if (!deepEq(e?.[k], v)) throw new AssertionError(`propriedade ${k}: esperado ${show(v)}, recebido ${show(e?.[k])}`);
      }
    } else if (typeof expected === 'function' && expected(e) !== true) {
      throw new AssertionError('o erro não passou na validação');
    }
    return;
  }
  throw new AssertionError('esperava que a promessa fosse rejeitada');
};

export default assert;
