// Utilidades de texto compartilhadas (parser, busca, etiquetas).

/**
 * Minúsculas e sem acento, mantendo o MESMO comprimento do original
 * (cada caractere vira exatamente um caractere). Isso permite achar um trecho
 * no texto "dobrado" e recortar o trecho equivalente do texto original.
 */
export function fold(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const base = ch.normalize('NFD')[0] || ch;
    const low = base.toLowerCase();
    out += low.length === 1 ? low : base;
  }
  return out;
}

/** Minúsculas e sem acento, SEM garantia de mesmo comprimento. Mais rápido: serve para buscas. */
export const foldLoose = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** "1 tarefa" / "3 tarefas". */
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Remove quebras de linha/espaços repetidos e corta no limite. */
export function cleanLine(v, max) {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}
