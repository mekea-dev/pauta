// Configurações: tema, semana, etiquetas, backup/importação, instalação e atalhos.
import { describeAiFailure } from '../ai.js';
import { APP_NAME, APP_VERSION } from '../config.js';
import { formatStamp } from '../dates.js';
import { backupFileName, exportJSON, mergeState, parseImport, toCSV } from '../io.js';
import { LABEL_COLORS, LABEL_COLOR_NAMES } from '../model.js';
import { counts } from '../query.js';
import { formatSpeechReport } from '../speech.js';
import { plural } from '../text.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { installActions } from './install.js';
import { choiceDialog, confirmDialog, toast } from './overlay.js';
import { SHORTCUTS } from './shortcuts.js';

const AI_TEST_SENTENCE = 'lembra de ligar pro dentista amanhã às três da tarde';

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export function createSettings(app) {
  const { store } = app;
  const dlg = h('dialog', { class: 'dialog settings', 'aria-labelledby': 'st-title' });
  document.body.append(dlg);
  let paletteFor = null; // id da etiqueta com a paleta de cores aberta
  let status = null; // { text, bad } mostrado na seção de dados
  let downOnBackdrop = false;
  dlg.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === dlg; });
  dlg.addEventListener('click', (e) => { if (e.target === dlg && downOnBackdrop) dlg.close(); });
  let alertsBusy = false;
  let alertsStatus = null; // { text, bad } resultado da última ação na seção de avisos
  let aiBusy = false;
  let aiStatus = null; // { text, bad } resultado do último teste da IA
  let aiSentence = ''; // a frase que a pessoa quer testar (vazia: a de exemplo)
  let micStatus = null; // { text } resultado de "Copiar relatório do microfone"
  let micText = null; // o relatório, para copiar à mão quando o aparelho não deixa copiar sozinho
  dlg.addEventListener('close', () => { paletteFor = null; status = null; alertsStatus = null; aiStatus = null; micStatus = null; micText = null; });
  app.alerts.onChange(() => { if (dlg.open) render(); });

  const say = (text, bad = false) => { status = { text, bad }; render(); };

  // ---------- seções ----------
  const seg = (options, value, onPick, label) => h('div', { class: 'seg', role: 'group', 'aria-label': label },
    options.map(([v, text, ic]) => h('button', { class: 'seg-btn', type: 'button', 'aria-pressed': v === value, onclick: () => onPick(v) }, ic ? icon(ic, 14) : null, text)));

  function prefsSection(settings) {
    return h('section', { class: 'st-section', id: 'st-prefs' },
      h('h3', {}, 'Aparência'),
      h('div', { class: 'st-row' }, h('span', {}, 'Tema'),
        seg([['auto', 'Automático', 'monitor'], ['light', 'Claro', 'sun'], ['dark', 'Escuro', 'moon']], settings.theme, (v) => app.setTheme(v), 'Tema')),
      h('div', { class: 'st-row' }, h('span', {}, 'A semana começa na'),
        seg([[1, 'Segunda'], [0, 'Domingo']], settings.weekStart, (v) => store.setSettings({ weekStart: v }), 'Primeiro dia da semana')),
      h('label', { class: 'st-row switch-row' }, h('span', {}, 'Mostrar tarefas concluídas na tela do dia'),
        h('input', { class: 'switch', type: 'checkbox', role: 'switch', checked: settings.showDone, onchange: (e) => store.setSettings({ showDone: e.target.checked }) })));
  }

  // ---------- avisos (lembretes) ----------
  /** Roda uma ação da seção de avisos mostrando "aguarde" e, no fim, o resultado em texto. */
  async function alertsAction(run) {
    if (alertsBusy) return;
    alertsBusy = true;
    alertsStatus = null;
    render();
    try {
      alertsStatus = await run();
    } catch (e) {
      alertsStatus = { text: `Não deu certo: ${e?.message ?? e}`, bad: true };
    }
    alertsBusy = false;
    render();
  }

  const enableResult = (r) => {
    if (r.ok) return { text: 'Avisos ligados neste aparelho. Eles chegam na hora certa, mesmo com o app fechado.' };
    switch (r.reason) {
      case 'denied': return { text: 'Você não permitiu os avisos. Libere nas configurações do aparelho e tente de novo.', bad: true };
      case 'dismissed': return { text: 'Nada mudou: o pedido de permissão foi fechado sem resposta.' };
      case 'unsupported': return { text: 'Este navegador não mostra avisos do sistema.', bad: true };
      case 'push': return { text: `Os avisos com o app aberto estão ligados, mas não consegui ligar os avisos com o app fechado: ${r.detail || 'erro desconhecido'}.`, bad: true };
      default: return { text: 'Os avisos com o app aberto estão ligados. Com o app fechado, este navegador não recebe avisos.' };
    }
  };

  function alertsSection() {
    const a = app.alerts.status();
    const on = a.permission === 'granted' && !a.muted;
    let text;
    if (a.permission === 'unsupported') text = 'Este navegador não mostra avisos do sistema. Com o app aberto, o lembrete aparece na tela. No iPhone, abra o Pauta pela Tela de Início (Compartilhar, depois Adicionar à Tela de Início) para receber também com o app fechado.';
    else if (a.permission === 'denied') text = 'Os avisos estão bloqueados. Libere nas configurações do aparelho (iPhone: Ajustes, Notificações, Pauta; computador: permissões do site, no navegador).';
    else if (a.muted) text = 'Desligados neste aparelho.';
    else if (a.permission === 'default') text = 'Desligados neste aparelho. Ligue para ser avisado antes das tarefas que têm lembrete.';
    else if (a.push === 'on') text = 'Ligados. O aviso chega na hora certa, mesmo com o app fechado.';
    else if (a.push === 'unsupported') text = 'Ligados, mas só com o app aberto: este navegador não recebe avisos com o app fechado. No iPhone, abra o Pauta pela Tela de Início.';
    else if (a.push === 'unconfigured') text = 'Ligados só com o app aberto: o serviço de lembretes ainda não está configurado (guia em docs/LEMBRETES.md).';
    else text = `Ligados só com o app aberto: não consegui ligar os avisos com o app fechado${a.detail ? ` (${a.detail})` : ''}. Toque em “Ligar de novo”.`;

    const btn = (label, onClick, { primary = false, iconName = 'bell' } = {}) => h('button', {
      class: `btn btn-sm${primary ? ' btn-primary' : ''}`, type: 'button', disabled: alertsBusy, onclick: onClick,
    }, icon(iconName, 15), label);

    const buttons = [];
    if (a.permission === 'default' || a.muted) buttons.push(btn('Ligar avisos', () => alertsAction(async () => enableResult(await app.alerts.enable())), { primary: true }));
    if (on && a.push === 'off') buttons.push(btn('Ligar de novo', () => alertsAction(async () => enableResult(await app.alerts.enable())), { primary: true }));
    if (on) buttons.push(btn('Desligar', () => alertsAction(async () => { await app.alerts.disable(); return { text: 'Avisos desligados neste aparelho.' }; }), { iconName: 'bell-off' }));
    return h('section', { class: 'st-section', id: 'st-avisos' },
      h('h3', {}, 'Avisos dos lembretes'),
      h('p', { class: 'muted' }, text),
      buttons.length ? h('div', { class: 'btn-row' }, buttons) : null,
      alertsStatus ? h('p', { class: `status${alertsStatus.bad ? ' bad' : ''}`, role: 'status' }, alertsStatus.text) : null,
      h('p', { class: 'muted' }, 'O serviço que dá o aviso com o app fechado só recebe o horário dos lembretes, nunca o título ou o conteúdo das suas tarefas.'),
      h('p', {}, h('b', {}, 'Alarme.'), ' Numa tarefa com data e hora, ligue “Tocar como alarme”. Com o app aberto ele toca (som e vibração) até você tocar em Parar ou Adiar. Com o app fechado ele chega como notificação que se repete a cada minuto, por 10 minutos; tocar nela abre a tela do alarme. O som depende do aparelho (volume, modo silencioso, Foco): confira aqui.'),
      h('div', { class: 'btn-row' }, btn('Ouvir o alarme', () => app.alarm.test(), { iconName: 'alarm-clock' })));
  }

  // ---------- entender a fala com IA ----------
  /** Manda uma frase de exemplo à IA e mostra o que ela entendeu (ou por que não deu): serve para conferir login, serviço e limite. */
  async function testAi() {
    if (aiBusy) return;
    aiBusy = true;
    aiStatus = null;
    render();
    const r = await app.ai.rewrite(aiSentence.trim() || AI_TEST_SENTENCE, { today: store.today(), now: new Date() });
    aiStatus = r.ok ? { text: `Funcionou. ${describeAiTest(r)}` } : { text: `Não funcionou: ${describeAiFailure(r.reason)}`, bad: true };
    aiBusy = false;
    render();
  }

  /** O que a IA entendeu, em palavras (só para o teste: o app confere a resposta de novo quando é uma frase de verdade). */
  function describeAiTest(r) {
    const quote = (s) => `“${s || '(nada)'}”`;
    if (r.acao === 'concluir') return `A IA entendeu que você concluiu a tarefa chamada ${quote(r.alvo)}.`;
    if (r.acao === 'excluir') return `A IA entendeu que você quer excluir a tarefa chamada ${quote(r.alvo)}.`;
    if (r.acao === 'alterar') return `A IA entendeu que você quer alterar a tarefa chamada ${quote(r.alvo)}: ${quote(r.texto)}.`;
    return `A IA entendeu como nova tarefa: ${quote(r.texto)}${r.descricao ? `; descrição: ${quote(r.descricao)}` : ''}.`;
  }

  function aiSection() {
    const s = app.ai.status();
    const usable = s.configured && s.loggedIn;
    const toggle = h('input', {
      class: 'switch', type: 'checkbox', role: 'switch', checked: s.on, disabled: !usable && !s.on, 'aria-label': 'Usar a IA para entender a fala neste aparelho',
      onchange: (e) => { app.ai.setOn(e.target.checked); aiStatus = null; render(); },
    });
    let note = null;
    if (!s.configured) note = 'O serviço da IA não está configurado neste app (veja docs/LEMBRETES.md).';
    else if (!s.loggedIn) note = 'Entre na sua conta para poder usar a IA: é o login que mostra ao serviço que é você.';
    else if (s.on && !s.online) note = 'Sem internet agora: sem a IA, o app entende a fala com as regras do aparelho.';
    return h('section', { class: 'st-section', id: 'st-ia' },
      h('h3', {}, 'Entender a fala com IA'),
      h('p', { class: 'muted' }, 'Ao falar uma tarefa, o Pauta entende a frase aqui no aparelho, por regras. Com a IA ligada (é o padrão), a frase falada (só o texto) também vai ao serviço do Pauta na Cloudflare, que usa uma IA para organizá-la: título resumido, anotações com os detalhes, dia, hora, lembrete; e para entender se você quer criar uma tarefa nova ou concluir, alterar ou excluir uma que já existe (“já paguei a conta de luz”). A IA só pode usar o que você disse: o que ela inventar é descartado. Quem acha a tarefa que você quis dizer é o seu aparelho: os títulos das suas tarefas não saem dele. O serviço não guarda a frase. Desligada, nada do que você fala sai do aparelho e a frase vira sempre uma tarefa nova.'),
      h('label', { class: 'st-row switch-row' }, h('span', {}, 'Usar a IA neste aparelho'), toggle),
      note ? h('p', { class: 'muted' }, note) : null,
      s.on && usable ? h('input', {
        class: 'input', type: 'text', maxlength: 300, value: aiSentence, placeholder: `Frase para testar (se vazio: “${AI_TEST_SENTENCE}”)`,
        'aria-label': 'Frase para testar a IA', oninput: (e) => { aiSentence = e.target.value; },
        onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); testAi(); } },
      }) : null,
      s.on && usable ? h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-sm', type: 'button', disabled: aiBusy, onclick: testAi }, icon('check', 15), aiBusy ? 'Testando…' : 'Testar a IA')) : null,
      aiStatus ? h('p', { class: `status${aiStatus.bad ? ' bad' : ''}`, role: 'status' }, aiStatus.text) : null,
      h('p', { class: 'muted' }, 'Se a IA falhar (sem internet, limite grátis do dia, serviço fora do ar) ou demorar, o app avisa e usa as regras do aparelho: a IA nunca é necessária.'));
  }

  // ---------- relatório do microfone ----------
  /** Copia o relatório do último uso do microfone (horários e códigos, nunca o que foi falado); se o aparelho não deixar, mostra o texto para copiar à mão. */
  async function copyMicReport() {
    const report = app.composer.speechReport();
    if (!report || !report.events?.length) {
      micStatus = { text: 'Ainda não há o que relatar: use o microfone do app e volte aqui.' };
      micText = null;
      render();
      return;
    }
    const text = formatSpeechReport(report, APP_VERSION);
    try {
      await navigator.clipboard.writeText(text);
      micStatus = { text: 'Relatório copiado. Cole numa mensagem para quem cuida do app.' };
      micText = null;
    } catch {
      micStatus = { text: 'Não consegui copiar sozinho: toque no texto abaixo, selecione tudo, copie e cole numa mensagem.' };
      micText = text;
    }
    render();
  }

  function micSection() {
    return h('section', { class: 'st-section', id: 'st-microfone' },
      h('h3', {}, 'Problemas com o microfone?'),
      h('p', { class: 'muted' }, 'Se o microfone do app travar ou não entender, toque em “Copiar relatório” logo depois e cole numa mensagem para quem cuida do app. O relatório tem só horários e códigos do que o microfone fez (como “começou a ouvir” e “terminou”), nunca o que você falou.'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-sm', type: 'button', onclick: copyMicReport }, icon('mic', 15), 'Copiar relatório do microfone')),
      micStatus ? h('p', { class: 'status', role: 'status' }, micStatus.text) : null,
      micText ? h('textarea', { class: 'input report-box', readonly: true, rows: 8, 'aria-label': 'Relatório do microfone', onfocus: (e) => e.target.select() }, micText) : null);
  }

  function labelRow(l, n) {
    const name = h('input', {
      class: 'input sm', type: 'text', value: l.name, maxlength: 40, 'aria-label': `Nome da etiqueta ${l.name}`,
      onchange: () => {
        const r = store.updateLabel(l.id, { name: name.value });
        if (!r.ok) { name.value = l.name; say(r.error, true); }
      },
      onkeydown: (e) => { if (e.key === 'Enter') name.blur(); },
    });
    return h('li', { class: 'label-row' },
      h('div', { class: 'label-line' },
        h('button', {
          class: `swatch lc-${l.color}`, type: 'button', 'aria-expanded': paletteFor === l.id, title: 'Mudar a cor', 'aria-label': `Cor da etiqueta ${l.name}: ${LABEL_COLOR_NAMES[l.color]}. Mudar`,
          onclick: () => { paletteFor = paletteFor === l.id ? null : l.id; render(); },
        }),
        name,
        h('span', { class: 'muted nowrap' }, plural(n, 'aberta', 'abertas')),
        h('button', {
          class: 'icon-btn sm', type: 'button', 'aria-label': `Excluir a etiqueta ${l.name}`, title: 'Excluir etiqueta',
          onclick: async () => {
            const ok = await confirmDialog({
              title: `Excluir “${l.name}”?`,
              message: n ? `Ela será tirada de ${plural(n, 'tarefa aberta', 'tarefas abertas')} (e das concluídas). As tarefas continuam existindo.` : 'Nenhuma tarefa aberta usa esta etiqueta.',
              confirmLabel: 'Excluir', danger: true,
            });
            if (ok) store.deleteLabel(l.id);
          },
        }, icon('trash', 15))),
      paletteFor === l.id
        ? h('div', { class: 'palette' }, LABEL_COLORS.map((col) => h('button', {
          class: `swatch lc-${col}${col === l.color ? ' is-selected' : ''}`, type: 'button', 'aria-label': LABEL_COLOR_NAMES[col], 'aria-pressed': col === l.color, title: LABEL_COLOR_NAMES[col],
          onclick: () => { store.updateLabel(l.id, { color: col }); paletteFor = null; render(); },
        })))
        : null);
  }

  function labelsSection(labels, c) {
    const newName = h('input', {
      class: 'input sm', type: 'text', maxlength: 40, placeholder: 'Nova etiqueta…', 'aria-label': 'Nome da nova etiqueta',
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } },
    });
    const add = () => {
      const r = store.addLabel(newName.value);
      if (!r.ok) return say(r.error, true);
      status = null;
      render();
      dlg.querySelector('.new-label .input')?.focus();
    };
    return h('section', { class: 'st-section', id: 'st-labels' },
      h('h3', {}, 'Etiquetas'),
      labels.length ? h('ul', { class: 'label-list' }, labels.map((l) => labelRow(l, c.byLabel.get(l.id) ?? 0))) : h('p', { class: 'muted' }, 'Você ainda não tem etiquetas.'),
      h('div', { class: 'new-label' }, newName, h('button', { class: 'btn btn-sm', type: 'button', onclick: add }, icon('plus', 15), 'Adicionar')));
  }

  function dataSection(settings) {
    const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: () => importFile(file.files[0], file) });
    return h('section', { class: 'st-section', id: 'st-data' },
      h('h3', {}, 'Seus dados'),
      h('p', { class: 'muted' }, app.cloud?.session
        ? 'Suas tarefas estão sincronizadas com a sua conta. Ainda assim, vale baixar um backup de vez em quando: é uma cópia sua, fora do serviço.'
        : 'As tarefas ficam salvas só neste navegador, neste aparelho. Para levar para outro lugar (ou se limpar os dados do navegador), use o backup.'),
      h('p', { class: 'muted' }, settings.lastBackupAt ? `Último backup: ${formatStamp(settings.lastBackupAt)}.` : 'Você ainda não fez backup.'),
      h('div', { class: 'btn-row' },
        h('button', {
          class: 'btn', type: 'button',
          onclick: () => {
            download(backupFileName('json'), exportJSON(store.state), 'application/json');
            store.setSettings({ lastBackupAt: new Date().toISOString() });
            say('Backup baixado. Guarde o arquivo em um lugar seguro.');
          },
        }, icon('download', 16), 'Baixar backup (JSON)'),
        h('button', { class: 'btn', type: 'button', onclick: () => file.click() }, icon('upload', 16), 'Importar backup…'),
        h('button', {
          class: 'btn', type: 'button',
          onclick: () => { download(backupFileName('csv'), toCSV(store.state), 'text/csv;charset=utf-8'); say('Planilha baixada (abre direto no Excel).'); },
        }, icon('download', 16), 'Baixar planilha (CSV)'),
        file),
      status ? h('p', { class: `status${status.bad ? ' bad' : ''}`, role: 'status' }, status.text) : null,
      h('div', { class: 'danger-zone' },
        h('button', {
          class: 'btn btn-danger-ghost', type: 'button',
          onclick: async () => {
            const ok = await confirmDialog({
              title: 'Apagar todas as tarefas?',
              message: 'Isso remove todas as tarefas e etiquetas deste navegador. Dá para desfazer logo em seguida, mas o ideal é baixar um backup antes.',
              confirmLabel: 'Apagar tudo', danger: true,
            });
            if (!ok) return;
            store.replaceAll({ tasks: [], labels: [] });
            const token = store.lastToken;
            dlg.close();
            toast('Tudo apagado', { action: { label: 'Desfazer', onClick: () => store.undo(token) }, timeout: 9000 });
          },
        }, icon('trash', 16), 'Apagar todas as tarefas')));
  }

  async function importFile(f, input) {
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { input.value = ''; return say('Arquivo grande demais (o limite é 20 MB).', true); }
    const parsed = parseImport(await f.text());
    input.value = '';
    if (!parsed.ok) return say(parsed.error, true);
    const { tasks, labels } = parsed.state;
    const choice = await choiceDialog({
      title: 'Importar backup',
      message: `O arquivo tem ${plural(tasks.length, 'tarefa', 'tarefas')} e ${plural(labels.length, 'etiqueta', 'etiquetas')}. Como você quer usar?`,
      defaultChoice: 'merge',
      choices: [
        { label: 'Cancelar', value: null },
        { label: 'Substituir tudo', value: 'replace', danger: true },
        { label: 'Mesclar com o que tenho', value: 'merge', primary: true },
      ],
    });
    if (!choice) return;
    if (choice === 'merge') {
      const r = mergeState(store.state, parsed.state);
      store.replaceAll(r.state);
      return say(`Mesclado: ${plural(r.added, 'tarefa nova', 'tarefas novas')} e ${plural(r.updated, 'atualizada', 'atualizadas')}.`);
    }
    store.replaceAll(parsed.state);
    return say(`Substituído: ${plural(tasks.length, 'tarefa carregada', 'tarefas carregadas')}.`);
  }

  function installSection() {
    return h('section', { class: 'st-section', id: 'st-install' },
      h('h3', {}, 'Instalar como aplicativo'),
      h('p', { class: 'muted' }, 'Abre em janela própria, funciona sem internet e fica à mão no menu iniciar ou na tela do celular.'),
      installActions(app, { onChange: render })); // botão, passo a passo do iPhone ou aviso de que já está instalado (js/ui/install.js)
  }

  function shortcutsSection() {
    return h('section', { class: 'st-section', id: 'st-shortcuts' },
      h('h3', {}, 'Atalhos de teclado'),
      h('dl', { class: 'shortcuts' }, SHORTCUTS.flatMap((s) => [
        h('dt', {}, s.keys.map((k) => (typeof k === 'string' ? h('kbd', {}, k) : h('kbd', { title: k.label, 'aria-label': k.label }, icon(k.icon, 14))))),
        h('dd', {}, s.label),
      ])));
  }

  // ---------- montagem ----------
  function render() {
    const { settings, labels, tasks } = store.state;
    const top = dlg.querySelector('.settings-scroll')?.scrollTop ?? 0;
    const c = counts(tasks, store.today());
    dlg.replaceChildren(h('div', { class: 'dialog-body settings-body' },
      h('header', { class: 'st-head' },
        h('h2', { id: 'st-title', class: 'dialog-title' }, 'Configurações'),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fechar', onclick: () => dlg.close() }, icon('x', 20))),
      h('div', { class: 'settings-scroll' },
        app.account.section(), prefsSection(settings), alertsSection(), aiSection(), micSection(), labelsSection(labels, c), dataSection(settings), installSection(), shortcutsSection(),
        h('p', { class: 'about muted' }, `${APP_NAME} v${APP_VERSION} · feito para rodar no GitHub Pages, sem servidor e sem rastreamento.`))));
    dlg.querySelector('.settings-scroll').scrollTop = top;
  }

  return {
    open(section) {
      render();
      app.alerts.refresh().catch(() => {}); // a situação dos avisos pode ter mudado (permissão dada nas configurações do aparelho)
      if (!dlg.open) dlg.showModal();
      if (section) dlg.querySelector(`#st-${section}`)?.scrollIntoView({ block: 'start' });
    },
    close() { if (dlg.open) dlg.close(); },
    refresh() { if (dlg.open) render(); },
  };
}
