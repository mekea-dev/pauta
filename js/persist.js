// Salvar e carregar no armazenamento do navegador (localStorage), sem nunca quebrar o app:
// se o navegador bloquear o armazenamento, usamos memória e avisamos a pessoa.
import { STORAGE_KEY } from './config.js';
import { sanitizeState } from './model.js';

export function memoryStorage() {
  const m = new Map();
  return {
    isMemory: true,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

export function getStorage(win = globalThis) {
  try {
    const s = win.localStorage;
    const probe = '__pauta_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return memoryStorage();
  }
}

/** { state } | { state: null } (nada salvo) | { state: null, error: 'corrupt' | 'storage' } */
export function loadState(storage) {
  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { state: null, error: 'storage' };
  }
  if (raw == null) return { state: null };
  try {
    const state = sanitizeState(JSON.parse(raw));
    if (!state) throw new Error('formato inválido');
    return { state };
  } catch {
    // não perder nada: guarda uma cópia do texto original antes de começar de novo
    try { storage.setItem(`${STORAGE_KEY}:corrompido:${Date.now()}`, raw); } catch { /* sem espaço: segue sem a cópia */ }
    return { state: null, error: 'corrupt' };
  }
}

export function saveState(storage, state) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
