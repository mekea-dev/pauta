// Entende o jeito FALADO de pedir uma tarefa e devolve o texto "limpo" que o analisador (parser.js) já sabe ler.
//   "Quero que crie uma tarefa com título pagar boleto com prazo para dia 10 às 16 horas"
//     -> "Pagar boleto dia 10 às 16 horas"
// Serve para o que sai do microfone do app e também para o que o ditado do teclado (iPhone) escreve no campo.
// Cuidado central: NÃO comer títulos legítimos. "Criar relatório mensal" ou "Agendar dentista" continuam como estão;
// só se tira o pedido quando ele é inequívoco (tem "tarefa"/"lembrete"..., ou começa com "quero que", "por favor", "me lembre de").
import { fold } from './text.js';

const NUMBER_WORDS = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19,
};
const TENS = { vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50 };
const UNITS_SRC = 'um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove';
// as palavras mais longas primeiro, para "dezesseis" não casar como "dez"
const NUM_SRC = `(?:(?:${Object.keys(TENS).join('|')})(?:\\s+e\\s+(?:${UNITS_SRC}))?|${Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length).join('|')})`;
const MINUTES_SRC = '(?:meia|quinze|trinta|quarenta e cinco)';
const MINUTES = { meia: 30, quinze: 15, trinta: 30, 'quarenta e cinco': 45 };
const END = '(?=$|[\\s.,;:!?])';

/** "vinte e tres" -> 23. Aceita só o que NUM_SRC reconhece. */
function wordsToInt(words) {
  return words.split(/\s+e\s+/).reduce((sum, w) => sum + (TENS[w] ?? NUMBER_WORDS[w] ?? 0), 0);
}

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Troca trechos do texto casando com `re` num texto "dobrado" (minúsculas, sem acento, mesmo comprimento),
 * mas devolvendo o texto ORIGINAL em volta. `replace(m, original)` devolve o texto novo.
 */
function sub(text, re, replace) {
  const folded = fold(text);
  let out = '';
  let pos = 0;
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(folded))) {
    out += text.slice(pos, m.index) + replace(m, text);
    pos = m.index + m[0].length;
    if (m[0] === '') re.lastIndex += 1;
  }
  return out + text.slice(pos);
}

// ---------- o pedido no começo da frase ----------
const POLITE = '(?:(?:oi|ola|ei|entao|pauta)[,\\s]+)*(?:(?:eu\\s+)?(?:quero|queria|gostaria|preciso|desejo)(?:\\s+de)?\\s+que(?:\\s+voce)?|(?:voce\\s+)?(?:pode|poderia|consegue)|por favor|pf)[,\\s]+';
const VERB = '(?:crie|criar|cria|adicione|adicionar|adiciona|anote|anotar|anota|registre|registrar|registra|cadastre|cadastrar|cadastra|coloque|colocar|coloca|insira|inserir|agende|agendar|agenda|marque|marcar|marca|faca|fazer|faz)';
const NOUN = '(?:tarefa|tarefinha|lembrete|compromisso|atividade|anotacao|evento)';
const CONNECT = '(?:\\s+(?:com\\s+(?:o\\s+)?(?:titulo|nome|descricao)(?:\\s+de)?|chamad[ao]|intitulad[ao]|que\\s+se\\s+chama|de\\s+titulo|sobre|para|pra|de)|\\s*:)?';
const COMMAND = new RegExp(`^(${POLITE})?${VERB}\\s+(?:(?:uma?|a|o|esta|essa)\\s+)?(?:nova\\s+|novo\\s+)?(${NOUN})?${CONNECT}\\s*`);
// "me avise 15 minutos antes" é o lembrete (parser.js), não o pedido: não pode ser engolido aqui
const NOT_A_REMINDER = `(?!\\s+(?:\\d+|${UNITS_SRC}|meia|meio)\\s*(?:min|hora|hs?\\b|hrs?\\b|dia))`;
const REMEMBER = new RegExp(`^(?:${POLITE})?(?:me\\s+(?:lembre|lembra|avise|avisa)${NOT_A_REMINDER}|lembre-me|lembra-me|nao\\s+(?:me\\s+)?deixe\\s+(?:eu\\s+)?esquecer)\\s+(?:de|que|para|pra)?\\s*`);

function stripCommand(text) {
  const f = fold(text);
  const remember = REMEMBER.exec(f);
  if (remember) return text.slice(remember[0].length);
  const command = COMMAND.exec(f);
  // sem "quero que"/"por favor" no começo, só vale se disser o que é ("uma tarefa", "um lembrete"): "Criar relatório" é título
  if (command && (command[1] || command[2])) return text.slice(command[0].length);
  return text;
}

/** "com prazo para dia 10" -> "dia 10"; "com horário às 16" -> "às 16". */
function stripLeadIns(text) {
  return sub(text, /(^|\s)com\s+(?:o\s+)?(?:prazo|data|vencimento|horario|hora)(?:\s+(?:de|para|pra|em|ate|no|na))?(?=\s|$)/g, (m) => m[1]);
}

/** Números por extenso só onde o contexto deixa claro que é data ou hora: "dia vinte", "às quatro e meia da tarde". */
function spellOutNumbers(text) {
  let t = text;
  t = sub(t, new RegExp(`(^|\\s)dia\\s+(${NUM_SRC})${END}`, 'g'), (m) => `${m[1]}dia ${wordsToInt(m[2])}`);
  const dayPart = '(?:manha|tarde|noite|madrugada)';
  const PREP = '(as|a|pelas|ate as|por volta das)';
  const prep = (m, orig) => orig.slice(m.index, m.index + m[1].length + m[2].length); // "às", com o acento original
  // "meio dia e meia" -> 12:30
  t = sub(t, new RegExp(`(^|\\s)meio[- ]dia\\s+e\\s+(${MINUTES_SRC})${END}`, 'g'), (m) => `${m[1]}12:${pad2(MINUTES[m[2]])}`);
  // "quatro da tarde", "quatro e meia da tarde" (a parte do dia já deixa claro que é hora)
  t = sub(t, new RegExp(`(^|\\s)(${NUM_SRC})(?:\\s+e\\s+(${MINUTES_SRC}))?(?=\\s+da\\s+${dayPart}\\b)`, 'g'),
    (m) => `${m[1]}${wordsToInt(m[2])}${m[3] ? `:${pad2(MINUTES[m[3]])}` : ''}`);
  // "às dezesseis horas", "às quatro e meia horas": precisa da preposição para não mexer em "duas horas de estudo"
  t = sub(t, new RegExp(`(^|\\s)${PREP}\\s+(${NUM_SRC})(?:\\s+e\\s+(${MINUTES_SRC}))?(?=\\s+(?:horas?\\b|h\\b))`, 'g'),
    (m, orig) => `${prep(m, orig)} ${wordsToInt(m[3])}${m[4] ? `:${pad2(MINUTES[m[4]])}` : ''}`);
  // "às quatro e meia", "às quinze e quinze" (os minutos deixam claro que é hora)
  t = sub(t, new RegExp(`(^|\\s)${PREP}\\s+(${NUM_SRC})\\s+e\\s+(${MINUTES_SRC})${END}`, 'g'),
    (m, orig) => `${prep(m, orig)} ${wordsToInt(m[3])}:${pad2(MINUTES[m[4]])}`);
  // "às 16 e meia", "às 9 e quinze" (já em dígitos)
  t = sub(t, new RegExp(`(^|\\s)${PREP}\\s+(\\d{1,2})\\s+e\\s+(${MINUTES_SRC})${END}`, 'g'),
    (m, orig) => `${prep(m, orig)} ${m[3]}:${pad2(MINUTES[m[4]])}`);
  return t;
}

/** "com prioridade alta", "prioridade urgente", "marque como urgente" -> "!alta"... */
function spellOutPriority(text) {
  const WORD = '(urgente|alta|media|baixa)';
  let t = sub(text, new RegExp(`(^|\\s)(?:com\\s+)?prioridade\\s+${WORD}${END}`, 'g'), (m) => `${m[1]}!${m[2]}`);
  t = sub(t, new RegExp(`(^|\\s)${WORD}\\s+prioridade${END}`, 'g'), (m) => `${m[1]}!${m[2]}`);
  t = sub(t, new RegExp(`(^|\\s)(?:marque|marcar|coloque|colocar|deixe|deixar)\\s+(?:como\\s+)?${WORD}${END}`, 'g'), (m) => `${m[1]}!${m[2]}`);
  return t;
}

/** "com a etiqueta trabalho" -> "#trabalho" (uma palavra só). */
function spellOutLabel(text) {
  return sub(text, /(^|\s)(?:com\s+)?(?:a\s+)?etiqueta\s+([a-z0-9_-]+)(?=$|[\s.,;:!?])/dg, (m, orig) => {
    const [start, end] = m.indices[2];
    return `${m[1]}#${orig.slice(start, end)}`;
  });
}

const upperFirst = (s) => (s ? s[0].toLocaleUpperCase('pt-BR') + s.slice(1) : s);

/**
 * @param {string} input o que a pessoa falou (ou ditou no teclado)
 * @returns {string} o texto sem o "pedido" e com data, hora, prioridade e etiqueta no formato que o parser entende
 */
export function normalizeSpoken(input) {
  const original = String(input ?? '').replace(/\s+/g, ' ').trim();
  if (!original) return '';
  let t = original;
  const stripped = stripCommand(t);
  t = stripped;
  t = stripLeadIns(t);
  t = spellOutNumbers(t);
  t = spellOutPriority(t);
  t = spellOutLabel(t);
  t = t.replace(/\s*,?\s*por favor[.!]*\s*$/i, '').replace(/[\s.!]+$/g, '').replace(/\s+/g, ' ').trim();
  // o ditado põe maiúscula no começo do PEDIDO; sem o pedido, o título deve começar com maiúscula
  if (stripped !== original) t = upperFirst(t);
  return t;
}

/** Primeira letra maiúscula, para títulos que vieram da fala. */
export const capitalizeTitle = upperFirst;
