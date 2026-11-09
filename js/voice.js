// Entende o jeito FALADO de pedir uma tarefa. Faz o que uma pessoa faria ao ouvir: tira o "pedido" e as hesitações, junta o que foi dito
// em uma tarefa bem escrita e avisa quando alguma parte não ficou clara.
//   "Quero que crie uma tarefa com título pagar boleto com prazo para dia 10 às 16 horas"
//     -> título "Pagar boleto", dia 10, 16:00
// Serve para o que sai do microfone do app e também para o que o ditado do teclado (iPhone) escreve no campo.
//
// Duas camadas:
//   normalizeSpoken(texto)   limpa a fala e devolve um texto no formato que o analisador (parser.js) já sabe ler.
//   interpretSpoken(texto)   usa a de cima + o analisador e devolve a tarefa entendida e uma lista de dúvidas (`issues`). Sem dúvida
//                            (`clear`), a tarefa pode ser criada direto; com dúvida, o app abre o editor com o que entendeu.
//
// Cuidado central: NÃO comer títulos legítimos. "Criar relatório mensal" ou "Agendar dentista" continuam como estão;
// só se tira o pedido quando ele é inequívoco (tem "tarefa"/"lembrete"..., ou começa com "quero que", "por favor", "me lembre de").
// Tudo roda no aparelho: nada do que a pessoa fala é enviado para fora.
import { todayISO } from './dates.js';
import { parseQuickAdd } from './parser.js';
import { fold } from './text.js';

const NUMBER_WORDS = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19,
};
const TENS = { vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50 };
const UNITS_SRC = 'um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove';
// as palavras mais longas primeiro, para "dezesseis" não casar como "dez"
const NUM_SRC = `(?:(?:${Object.keys(TENS).join('|')})(?:\\s+e\\s+(?:${UNITS_SRC}))?|${Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length).join('|')})`;
// minutos ditos depois da hora: "quatro e meia", "quatro e vinte", "quatro e vinte e cinco" (de 5 em 5, como se fala)
const MINUTES_SRC = '(?:meia|cinco|dez|quinze|vinte(?:\\s+e\\s+cinco)?|trinta(?:\\s+e\\s+cinco)?|quarenta(?:\\s+e\\s+cinco)?|cinquenta(?:\\s+e\\s+cinco)?)';
const MINUTES = { meia: 30 };
const END = '(?=$|[\\s.,;:!?])';

/** "vinte e tres" -> 23. Aceita só o que NUM_SRC reconhece. */
function wordsToInt(words) {
  return words.split(/\s+e\s+/).reduce((sum, w) => sum + (TENS[w] ?? NUMBER_WORDS[w] ?? 0), 0);
}
/** Minutos por extenso: "meia" -> 30, "vinte e cinco" -> 25. */
const minutesOf = (words) => MINUTES[words] ?? wordsToInt(words);

const pad2 = (n) => String(n).padStart(2, '0');
const upperFirst = (s) => (s ? s[0].toLocaleUpperCase('pt-BR') + s.slice(1) : s);

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

/** Tira do começo do texto o que `re` (escrita para o texto dobrado) casa. */
function cutHead(text, re) {
  const m = re.exec(fold(text));
  return m ? text.slice(m[0].length) : text;
}

/** Tira do fim do texto o que `re` (escrita para o texto dobrado) casa. */
function cutTail(text, re) {
  const m = re.exec(fold(text));
  return m ? text.slice(0, m.index) : text;
}

// ---------- hesitações ----------
/**
 * "hum", "ahn", "éééé" e palavras repetidas ("o o dentista", "pagar pagar o boleto": a gagueira que o reconhecimento escreve).
 * A fala escrita tem disso; a tarefa não.
 */
function dropHesitations(text) {
  let t = sub(text, /(^|[\s,.;])(?:h+u*m+|u+h+m*|a+h+n+|a+h+|e+h+|a+ham|e{3,})(?=$|[\s,.;:!?])[,.;]?/g, (m) => (m[1] ? ' ' : ''));
  t = t.replace(/(^|\s)([^\s\d,.;:!?]{1,15})(?:\s+\2)+(?=$|[\s,.;:!?])/giu, '$1$2');
  return t.replace(/\s+/g, ' ').trim();
}

// ---------- o pedido no começo da frase ----------
const VERB = '(?:crie|criar|cria|adicione|adicionar|adiciona|anote|anotar|anota|registre|registrar|registra|cadastre|cadastrar|cadastra|coloque|colocar|coloca|insira|inserir|agende|agendar|agenda|marque|marcar|marca|faca|fazer|faz)';
// o verbo no IMPERATIVO sozinho ("anota comprar leite"): quem dita um título usa o infinitivo ("Anotar ideias"), então isto é pedido
const IMPERATIVE = '(?:crie|cria|adicione|adiciona|anote|anota|registre|registra|cadastre|cadastra|insira|insere)';
const NOUN = '(?:tarefa|tarefinha|lembrete|compromisso|atividade|anotacao|evento)';
const CONNECT_WORDS = '(?:com\\s+(?:o\\s+)?(?:titulo|nome|descricao)(?:\\s+de)?|chamad[ao]|intitulad[ao]|que\\s+se\\s+chama|de\\s+titulo|sobre|para|pra|de)';
const CONNECT = `(?:\\s+${CONNECT_WORDS}|\\s*:)?`;
const FOR_ME = '(?:\\s+(?:ai|ae))?(?:\\s+(?:pra|para)\\s+(?:mim|eu))?'; // "cria aí uma tarefa pra mim"
const POLITE = '(?:(?:oi|ola|ei|entao|pauta)[,\\s]+)*(?:(?:eu\\s+)?(?:quero|queria|gostaria|preciso|desejo)(?:\\s+de)?\\s+que(?:\\s+voce)?|(?:voce\\s+)?(?:pode|poderia|consegue)|por favor|pf)[,\\s]+';
const COMMAND = new RegExp(`^(${POLITE})?${VERB}${FOR_ME}\\s+(?:(?:uma?|a|o|esta|essa)\\s+)?(?:nova\\s+|novo\\s+)?(${NOUN})?(?:\\s+(?:pra|para)\\s+mim)?${CONNECT}\\s*`);
const BARE_COMMAND = new RegExp(`^${IMPERATIVE}${FOR_ME}\\s+(?:(?:uma?|a|o)\\s+)?(?:nova\\s+|novo\\s+)?(?:${NOUN}${CONNECT}\\s*)?`);
// "quero criar uma tarefa pagar boleto": com "preciso/quero" sem o "que", só vale se disser o que é (a tarefa): "Preciso fazer compras" é título
const NEED_COMMAND = new RegExp(`^(?:eu\\s+)?(?:quero|queria|gostaria\\s+de|preciso|desejo|vou\\s+querer)\\s+${VERB}${FOR_ME}\\s+(?:(?:uma?|a|o)\\s+)?(?:nova\\s+|novo\\s+)?${NOUN}${CONNECT}\\s*`);
// um verbo no infinitivo: "pagar", "comer", "partir", "supor" (e os curtos "ir", "ver", "ter"...)
const INFINITIVE = '(?:ir|ver|ter|ser|dar|ler|vir|[a-z]{2,}(?:ar|er|ir|or))(?=$|[\\s,.;:!?])';
// "nova tarefa pagar boleto", "tarefa: pagar boleto", "uma tarefa de estudar inglês", "lembrete reunião com a equipe"...
// Cuidado: "tarefa de casa" é título. Sem "uma" na frente, "tarefa/lembrete" só é pedido quando o resto não começa por "de/da/em..."
const NOT_A_CONNECTOR = '(?![0-9]|(?:de|da|do|das|dos|em|no|na|nos|nas|ao|aos|com|sem|para|pra|por|e|que|a|o|as|os)\\b)';
const NOUN_NEW = new RegExp(`^(?:uma?\\s+)?(?:nova|novo)\\s+${NOUN}${CONNECT}\\s*`);
const REQUEST_NOUNS = [
  new RegExp(`^(?:uma?\\s+)?${NOUN}\\s*:\\s*`), // "tarefa: pagar boleto"
  new RegExp(`^(?:uma?\\s+)?${NOUN}\\s+(?:chamad[ao]|intitulad[ao]|que\\s+se\\s+chama|de\\s+titulo|com\\s+(?:o\\s+)?(?:titulo|nome|descricao)(?:\\s+de)?)\\s+`),
  /^uma?\s+(?:tarefa|lembrete)(?:\s+(?:de|para|pra|sobre|que))?\s+/, // "uma tarefa estudar inglês", "um lembrete para pagar": com "uma/um" é o pedido
  new RegExp(`^(?:tarefa|lembrete)\\s+${NOT_A_CONNECTOR}`), // "lembrete reunião com a equipe", "tarefa dentista"
  new RegExp(`^(?:tarefa|lembrete)\\s+(?:de|para|pra|sobre|que)\\s+(?=${INFINITIVE})`), // "tarefa de estudar inglês"
  /^lembrete\s+(?:de|para|pra|sobre)\s+/, // "lembrete de reunião"
];
// "me avise 15 minutos antes" é o lembrete (parser.js), não o pedido: não pode ser engolido aqui
const NOT_A_REMINDER = `(?!\\s+(?:\\d+|${UNITS_SRC}|meia|meio)\\s*(?:min|hora|hs?\\b|hrs?\\b|dia))`;
const REMEMBER = new RegExp(`^(?:${POLITE})?(?:me\\s+(?:lembre|lembra|avise|avisa)${NOT_A_REMINDER}|lembre-me|lembra-me|nao\\s+(?:me\\s+)?deixe\\s+(?:eu\\s+)?esquecer)\\s+(?:de|que|para|pra)?\\s*`);

// "então, cria uma tarefa...", "bom, preciso...": conversa antes do pedido (só sai quando o pedido vem logo depois)
const REQUEST_AHEAD = '(?=(?:eu\\s+)?(?:quero|queria|gostaria|preciso|tenho|devo|vou|cri[ae]\\b|criar|adicion|anot|regist|cadastr|colo[cq]|insir|agend|marc|faz\\b|fazer|me\\s+(?:lembr|avis)|lembr|nao\\s+(?:me\\s+)?(?:esquec|deix)|pode\\b|poderia|consegue|por\\s+favor|uma?\\s+(?:nova\\s+)?(?:tarefa|lembrete)))';
const LEAD_TALK = new RegExp(`^(?:(?:ah|eh|ahn|hum|e|entao|bom|bem|olha|ola|oi|ok|ta|certo|beleza|pronto|assim|tipo|pois|ai|bora|opa|ei|pauta)[,.\\s]+)+${REQUEST_AHEAD}`);

// "preciso comprar", "tenho que ligar", "vou levar", "lembrar de pagar": a intenção vira o verbo no infinitivo ("Comprar...")
// ("preciso é ligar": o "é" é só ênfase)
const INTENT = new RegExp(`^(?:eu\\s+)?(?:preciso|precisamos|tenho\\s+(?:que|de)|devo|vou|quero|queria|gostaria\\s+de|nao\\s+(?:me\\s+)?(?:posso\\s+)?esquecer\\s+de|nao\\s+deixar\\s+de|lembrar\\s+(?:de|que|para)|para\\s+eu\\s+lembrar\\s+de)\\s+(?:e\\s+)?(?=${INFINITIVE})`);
// "cria uma tarefa é pagar o aluguel": o "é" no começo é hesitação
const FILLER_LEAD = new RegExp(`^(?:e|eh|ah)[,.\\s]+(?=${INFINITIVE})`);
// "para eu ir ao mercado" -> "ir ao mercado"
const SUBJECT = new RegExp(`^eu\\s+(?=${INFINITIVE})`);
// "tenho reunião com o cliente", "vou ter dentista": quem tem o compromisso não faz parte do título ("tenho que..." é a intenção, acima)
const HAVE = /^(?:(?:eu\s+)?(?:tenho|temos)\s+(?!que\b|de\b)|(?:eu\s+)?(?:vou|vai|vamos)\s+ter\s+)/;

function stripCommand(text) {
  const f = fold(text);
  const remember = REMEMBER.exec(f);
  if (remember) return text.slice(remember[0].length);
  const command = COMMAND.exec(f);
  // sem "quero que"/"por favor" no começo, só vale se disser o que é ("uma tarefa", "um lembrete"): "Criar relatório" é título
  if (command && (command[1] || command[2])) return text.slice(command[0].length);
  for (const re of [NEED_COMMAND, BARE_COMMAND, NOUN_NEW, ...REQUEST_NOUNS]) {
    const m = re.exec(f);
    if (m) return text.slice(m[0].length);
  }
  return text;
}

/** "com prazo para dia 10" -> "dia 10"; "com horário às 16" -> "às 16". */
function stripLeadIns(text) {
  return sub(text, /(^|\s)com\s+(?:o\s+)?(?:prazo|data|vencimento|horario|hora)(?:\s+(?:de|para|pra|em|ate|no|na))?(?=\s|$)/g, (m) => m[1]);
}

/** Números por extenso só onde o contexto deixa claro que é data ou hora: "dia vinte", "às quatro e meia da tarde". */
function spellOutNumbers(text) {
  let t = text;
  // "me avise quinze minutos antes", "lembrete vinte e cinco minutos antes": o número do lembrete vira dígito (o parser só lê até "dez" por extenso)
  t = sub(t, new RegExp(`(^|\\s)((?:me\\s+)?(?:avis[ae]r?|lembr[ae]r?|alert[ae]r?|notific[ae]r?|lembrete|alarme|despertador|aviso|alerta)(?:-me)?(?:\\s+(?:de|com|em|para|por))?)\\s+(${NUM_SRC})(?=\\s+(?:minutos?|mins?|horas?|hs?|dias?)\\s+(?:de\\s+)?(?:antes|antecedencia))`, 'g'),
    (m, orig) => `${m[1]}${orig.slice(m.index + m[1].length, m.index + m[1].length + m[2].length)} ${wordsToInt(m[3])}`);
  t = sub(t, /(^|\s)dia\s+primeiro(?=$|[\s.,;:!?])/g, (m) => `${m[1]}dia 1`);
  t = sub(t, new RegExp(`(^|\\s)dia\\s+(${NUM_SRC})${END}`, 'g'), (m) => `${m[1]}dia ${wordsToInt(m[2])}`);
  const dayPart = '(?:manha|tarde|noite|madrugada)';
  const PREP = '(as|a|pelas|ate as|por volta das)';
  // "às", com o acento original ("à uma hora", no singular, vira "às 1": o analisador só conhece "às")
  const prep = (m, orig) => {
    const word = orig.slice(m.index + m[1].length, m.index + m[1].length + m[2].length);
    return `${m[1]}${word === 'à' ? 'às' : word}`;
  };
  // "meio dia e meia" -> 12:30
  t = sub(t, new RegExp(`(^|\\s)meio[- ]dia\\s+e\\s+(${MINUTES_SRC})${END}`, 'g'), (m) => `${m[1]}12:${pad2(minutesOf(m[2]))}`);
  // "quatro da tarde", "quatro e meia da tarde" (a parte do dia já deixa claro que é hora)
  t = sub(t, new RegExp(`(^|\\s)(${NUM_SRC})(?:\\s+e\\s+(${MINUTES_SRC}))?(?=\\s+da\\s+${dayPart}\\b)`, 'g'),
    (m) => `${m[1]}${wordsToInt(m[2])}${m[3] ? `:${pad2(minutesOf(m[3]))}` : ''}`);
  // "às dezesseis horas", "às quatro e meia horas": precisa da preposição para não mexer em "duas horas de estudo"
  t = sub(t, new RegExp(`(^|\\s)${PREP}\\s+(${NUM_SRC})(?:\\s+e\\s+(${MINUTES_SRC}))?(?=\\s+(?:horas?\\b|h\\b))`, 'g'),
    (m, orig) => `${prep(m, orig)} ${wordsToInt(m[3])}${m[4] ? `:${pad2(minutesOf(m[4]))}` : ''}`);
  // "às quatro e meia", "às quatro e vinte", "às quinze e quinze" (os minutos deixam claro que é hora)
  t = sub(t, new RegExp(`(^|\\s)${PREP}\\s+(${NUM_SRC})\\s+e\\s+(${MINUTES_SRC})${END}`, 'g'),
    (m, orig) => `${prep(m, orig)} ${wordsToInt(m[3])}:${pad2(minutesOf(m[4]))}`);
  // "às 16 e meia", "às 9 e quinze", "às 16 e vinte" (já em dígitos)
  t = sub(t, new RegExp(`(^|\\s)${PREP}\\s+(\\d{1,2})\\s+e\\s+(${MINUTES_SRC})${END}`, 'g'),
    (m, orig) => `${prep(m, orig)} ${m[3]}:${pad2(minutesOf(m[4]))}`);
  // "às 16 e 30", "às 9 e 05" (minutos também em dígitos, sempre com dois algarismos)
  t = sub(t, new RegExp(`(^|\\s)${PREP}\\s+(\\d{1,2})\\s+e\\s+([0-5]\\d)${END}`, 'g'),
    (m, orig) => `${prep(m, orig)} ${m[3]}:${m[4]}`);
  // "às oito", "às dez": o acento de "às" é o que diz que é hora ("as oito pessoas" não é); sem "horas" nem minutos, só vale até 23
  t = sub(t, new RegExp(`(^|\\s)(as|a|pelas|por volta das)\\s+(${NUM_SRC})${END}`, 'g'), (m, orig) => {
    const word = orig.slice(m.index + m[1].length, m.index + m[1].length + m[2].length);
    const hours = wordsToInt(m[3]);
    const isTime = (m[2] === 'as' || m[2] === 'a' ? /^à/i.test(word) : true) && hours <= 23;
    return isTime ? `${m[1]}${word === 'à' ? 'às' : word} ${hours}` : orig.slice(m.index, m.index + m[0].length);
  });
  return t;
}

/**
 * "daqui a 20 minutos", "em duas horas", "dentro de meia hora" -> "hoje às 09:20" (ou o dia, se passar da meia-noite).
 * Precisa saber que horas são agora; sem isso, deixa o texto como está.
 */
function spellOutRelative(text, now) {
  const DUR = '(?:daqui\\s+a|dentro\\s+de|em)';
  const toClock = (minutes) => {
    const at = new Date(now.getTime() + minutes * 60000);
    const day = todayISO(at) === todayISO(now) ? 'hoje' : todayISO(at);
    return `${day} às ${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
  };
  let t = sub(text, new RegExp(`(^|\\s)${DUR}\\s+meia\\s+hora${END}`, 'g'), (m) => `${m[1]}${toClock(30)}`);
  t = sub(t, new RegExp(`(^|\\s)${DUR}\\s+(\\d{1,3}|${NUM_SRC})\\s*(minutos?|mins?|horas?|hs?)(\\s+e\\s+meia)?${END}`, 'g'), (m, orig) => {
    const n = /^\d+$/.test(m[2]) ? Number(m[2]) : wordsToInt(m[2]);
    const minutes = /^h/.test(m[3]) ? n * 60 + (m[4] ? 30 : 0) : n;
    return minutes >= 1 && minutes <= 24 * 60 ? `${m[1]}${toClock(minutes)}` : orig.slice(m.index, m.index + m[0].length);
  });
  return t;
}

/** "com prioridade alta", "prioridade urgente", "marque como urgente", "é urgente" -> "!alta", "!urgente"... */
function spellOutPriority(text) {
  const WORD = '(urgente|alta|media|baixa)';
  let t = sub(text, new RegExp(`(^|\\s)(?:com\\s+)?prioridade\\s+${WORD}${END}`, 'g'), (m) => `${m[1]}!${m[2]}`);
  t = sub(t, new RegExp(`(^|\\s)${WORD}\\s+prioridade${END}`, 'g'), (m) => `${m[1]}!${m[2]}`);
  t = sub(t, new RegExp(`(^|\\s)(?:marque|marcar|coloque|colocar|deixe|deixar)\\s+(?:como\\s+)?${WORD}${END}`, 'g'), (m) => `${m[1]}!${m[2]}`);
  // "é urgente", "com urgência" e "urgente" no fim da frase ("ligar para o contador urgente")
  t = sub(t, /(^|\s)(?:e|eh)\s+urgente(?=$|[\s.,;:!?])/g, (m) => `${m[1]}!urgente`);
  t = sub(t, /(^|\s)com\s+urgencia(?=$|[\s.,;:!?])/g, (m) => `${m[1]}!urgente`);
  t = sub(t, /(^|\s)urgente[\s.!]*$/g, (m) => `${m[1]}!urgente`);
  return t;
}

/** "com a etiqueta trabalho" -> "#trabalho" (uma palavra só). */
function spellOutLabel(text) {
  return sub(text, /(^|\s)(?:com\s+)?(?:a\s+)?etiqueta\s+([a-z0-9_-]+)(?=$|[\s.,;:!?])/dg, (m, orig) => {
    const [start, end] = m.indices[2];
    return `${m[1]}#${orig.slice(start, end)}`;
  });
}

// ---------- quando a pessoa se corrige ----------
// "às 16, quer dizer, às 17" -> "às 17": vale o que foi dito por último. Só para data, hora, prioridade e lembrete (onde dá para ter certeza
// do que foi substituído). Correção do título ("pagar o boleto, quer dizer, pagar a fatura") não é adivinhada: vira dúvida (interpretSpoken).
// "não" sozinho ("às 16, não, às 17") também corrige, mas só quando o que vem logo depois é a mesma coisa de novo (veja `bare`)
const CORRECTION = /(?:^|[\s,.;])(?:quer\s+dizer|ou\s+melhor|melhor\s+dizendo|na\s+verdade|corrigindo|errei|digo|perdao|desculpa|alias|nao)(?=$|[\s,.;:!?])[\s,.;:]*/g;
const CORRECTABLE = ['date', 'time', 'priority', 'remind'];

/**
 * Tira de `before` o que `after` repete (a data, a hora...). Devolve o texto junto ou null se nada foi substituído.
 * `bare`: o marcador foi só "não". Aí só vale se `after` COMEÇA pela data/hora/prioridade nova ("não, às 17"), senão
 * "a reunião é sexta, não vou poder ir" viraria uma correção.
 */
function dropReplaced(before, after, bare = false) {
  const older = parseQuickAdd(before.normalize('NFC'));
  const newer = parseQuickAdd(after.normalize('NFC'));
  const lead = after.normalize('NFC').trimStart();
  let out = before.normalize('NFC');
  let replaced = false;
  for (const kind of CORRECTABLE) {
    const now = newer.tokens.find((tk) => tk.type === kind && !tk.derived && tk.text);
    if (!now || (bare && !lead.startsWith(now.text))) continue;
    const old = [...older.tokens].reverse().find((tk) => tk.type === kind && !tk.derived && tk.text);
    if (!old) continue;
    const at = out.lastIndexOf(old.text);
    if (at < 0) continue;
    out = out.slice(0, at) + out.slice(at + old.text.length);
    replaced = true;
  }
  return replaced ? `${out} ${after}`.replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim() : null;
}

function settleCorrections(text) {
  let t = text;
  let from = 0;
  for (let guard = 0; guard < 5; guard++) {
    CORRECTION.lastIndex = from;
    const m = CORRECTION.exec(fold(t));
    if (!m) break;
    const merged = dropReplaced(t.slice(0, m.index), t.slice(m.index + m[0].length), /\bnao\b/.test(m[0]));
    if (merged === null) {
      from = m.index + m[0].length; // este "digo", "na verdade"... não corrige nada que dê para identificar: segue adiante
    } else {
      t = merged;
      from = 0;
    }
  }
  return t;
}

/** O trabalho de normalizeSpoken, dizendo também se o "pedido" ou alguma conversa foi tirado do começo (`changed`). */
function normalizeWithInfo(input, { now = null } = {}) {
  const original = String(input ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!original) return { text: '', changed: false };
  let t = dropHesitations(original);
  t = cutHead(t, LEAD_TALK);
  t = stripCommand(t);
  t = cutHead(t, FILLER_LEAD);
  t = cutHead(t, INTENT);
  t = cutHead(t, SUBJECT);
  t = cutHead(t, HAVE);
  const changed = t !== original;
  t = stripLeadIns(t);
  if (now instanceof Date && !Number.isNaN(now.getTime())) t = spellOutRelative(t, now);
  t = spellOutNumbers(t);
  t = spellOutPriority(t);
  t = spellOutLabel(t);
  t = settleCorrections(t);
  t = t.replace(/\s*,?\s*por favor[.!]*\s*$/i, '').replace(/[\s.!]+$/g, '').replace(/\s+/g, ' ').trim();
  // o ditado põe maiúscula no começo do PEDIDO; sem o pedido, o título deve começar com maiúscula
  if (changed) t = upperFirst(t);
  return { text: t, changed };
}

/**
 * @param {string} input o que a pessoa falou (ou ditou no teclado)
 * @param {{ now?: Date }} [options] `now`: a hora de agora; com ela, "daqui a 20 minutos" vira uma hora marcada
 * @returns {string} o texto sem o "pedido" e sem hesitações, com data, hora, prioridade e etiqueta no formato que o parser entende
 */
export function normalizeSpoken(input, options) {
  return normalizeWithInfo(input, options).text;
}

/** Primeira letra maiúscula, para títulos que vieram da fala. */
export const capitalizeTitle = upperFirst;

// ---------- o que foi entendido, e o que ficou em dúvida ----------
// só o que nunca termina um título de verdade ("pronto", "beleza" e "ok" podem: "Deixar tudo pronto", "Salão de beleza")
const TRAIL_TALK = /(?:[\s,]+(?:ne|ta|ta bom|valeu|obrigad[oa]|entao|ai|por favor|pf))+[.!?]*$/;
const LEAD_TITLE_TALK = new RegExp(`^(?:ah|eh|ahn|hum|entao|olha|bom|ok|ta|certo|beleza|pronto|tipo|assim|pois|ai)(?:[,.]\\s*|\\s+(?=${INFINITIVE}))`);
const STOPWORDS = new Set(['a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das', 'para', 'pra', 'pro', 'que', 'e', 'com', 'em', 'no', 'na', 'nos', 'nas', 'ao', 'aos', 'por', 'se', 'me', 'te', 'eu', 'voce', 'ai', 'la', 'ali', 'mais', 'ou']);
// palavras que só dizem "uma tarefa" sem dizer qual
const GENERIC = new Set(['tarefa', 'tarefas', 'lembrete', 'lembretes', 'compromisso', 'compromissos', 'atividade', 'evento', 'anotacao', 'titulo', 'nome', 'descricao', 'coisa', 'coisas', 'algo', 'nada', 'isso', 'aquilo']);
// ponta de frase do pedido que sobra na frente do título depois de tirar o pedido: "para consulta no médico", "a reunião"
const DANGLING = /^(?:para|pra|de|do|da|dos|das|sobre|que)\s+(?=\S)/;
const ARTICLE = /^(?:a|o|as|os)\s+(?=\S)/;
const MONTHS_SRC = '(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)';
// sobras de data ou hora no título = o analisador não conseguiu ler (dia 32, "31 de abril", "às 25 horas")
const LEFT_DATE = new RegExp(`(?:^|\\s)(?:dia\\s+)?\\d{1,2}\\s+de\\s+${MONTHS_SRC}\\b|(?:^|\\s)dia\\s+\\d{1,2}\\b|(?:^|\\s)\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?(?=$|[\\s.,;])`);
const LEFT_TIME = /(?:^|\s)(?:às\s+\d|as\s+\d{1,2}\s*(?:h|horas?)\b)/i;
const CORRECTION_LEFT = /\b(?:quer dizer|ou melhor|melhor dizendo|na verdade|corrigindo)\b/;
// "me avise ... antes" que sobrou no título: o analisador não conseguiu ler (90 dias antes passa do máximo, por exemplo)
const LEFT_REMIND = /\b(?:me\s+(?:avis|lembr)[ae]r?|lembrete|alarme|despertador)\b.{0,40}\b(?:minutos?|mins?|horas?|dias?)\b.{0,15}\bantes\b/;
const LOW_CONFIDENCE = 0.45; // abaixo disso (e acima de 0, que significa "o navegador não informa"), o reconhecimento não tinha certeza

/**
 * O título depois de limpo: sem sobras de conversa no começo e no fim, sem palavras repetidas, com maiúscula.
 * `afterRequest`: o pedido ("crie uma tarefa...") foi tirado do começo, então uma preposição ou artigo solto na frente é resto dele.
 */
function tidyTitle(title, afterRequest) {
  let t = dropHesitations(String(title ?? ''));
  t = cutTail(t, TRAIL_TALK);
  t = cutHead(t, LEAD_TITLE_TALK);
  t = t.replace(/^[\s,;:.\-–—]+|[\s,;:\-–—]+$/g, '').trim();
  if (afterRequest) {
    t = cutHead(t, DANGLING);
    t = cutHead(t, ARTICLE);
  }
  return upperFirst(t);
}

/** O título não diz nada ("a tarefa", "um lembrete")? Um título curto como "X" ou "Ana" é título, não dúvida. */
function isVague(title) {
  const words = fold(title).split(/[^a-z0-9]+/).filter((w) => w && !STOPWORDS.has(w));
  return words.length === 0 || words.every((w) => GENERIC.has(w));
}

/**
 * Lê o que foi falado como uma tarefa e diz se ficou claro.
 * @param {string} heard o que a pessoa falou (ou ditou)
 * @param {object} [options]
 * @param {string} [options.today]         dia de hoje (AAAA-MM-DD)
 * @param {Date}   [options.now]           a hora de agora (para saber se "às 9" de hoje já passou)
 * @param {number} [options.weekStart]
 * @param {object} [options.ignore]        trechos que a pessoa mandou não reconhecer (o X dos selos do campo)
 * @param {number|null} [options.confidence]  confiança do reconhecimento de voz (0 a 1), se o navegador informou
 * @param {string|null} [options.defaultDate] dia em que a tarefa cai quando a frase não diz (o dia aberto na tela)
 * @returns o resultado do analisador (title, date, time, remind, priority, labels, recurrence, tokens) mais:
 *   `issues` ([{ code, text }]: o que não ficou claro), `clear` (sem dúvida: pode criar direto), `heard` e `effectiveDate`
 *   (o dia da tarefa, contando o dia aberto na tela e "hora sem dia = hoje")
 */
export function interpretSpoken(heard, { today = todayISO(), now = new Date(), weekStart = 1, ignore = {}, confidence = null, defaultDate = null } = {}) {
  const { text, changed } = normalizeWithInfo(heard, { now });
  const parsed = parseQuickAdd(text, { today, weekStart, ignore });
  const title = tidyTitle(parsed.title, changed);
  const f = fold(title);
  const issues = [];
  const add = (code, text) => issues.push({ code, text });

  if (!title) add('no-title', 'Não entendi qual é o título.');
  else if (isVague(title)) add('vague-title', 'O título ficou vago: escreva o que é a tarefa.');
  if (title && LEFT_DATE.test(f)) add('bad-date', 'Sobrou uma data que não consegui entender: confira o dia.');
  if (title && LEFT_TIME.test(title)) add('bad-time', 'Sobrou uma hora que não consegui entender: confira a hora.');
  if (title && CORRECTION_LEFT.test(f)) add('correction', 'Você se corrigiu no meio da frase: confira o título.');
  if (title && LEFT_REMIND.test(f)) add('bad-remind', 'Não entendi o aviso do lembrete (o máximo é 7 dias antes): confira.');

  const effectiveDate = parsed.date ?? defaultDate ?? (parsed.time ? today : null);
  if (parsed.time && !parsed.date && effectiveDate === today) {
    // hora sem dia vale hoje; se hoje essa hora já passou, a pessoa provavelmente quis outro dia
    const clock = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
    if (parsed.time < clock) add('time-passed', 'Essa hora de hoje já passou: confira o dia.');
  }
  if (parsed.remind !== null && parsed.remind !== undefined && !parsed.time) add('remind-needs-time', 'Faltou a hora para o lembrete que você pediu.');
  if (typeof confidence === 'number' && confidence > 0 && confidence < LOW_CONFIDENCE) add('low-confidence', 'Não ouvi com clareza: confira o que foi entendido.');

  return { ...parsed, title, issues, clear: issues.length === 0, heard: String(heard ?? '').trim(), effectiveDate };
}
