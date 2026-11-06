// Ponto de entrada: carrega os dados, liga as peças e desenha a tela.
import { STORAGE_KEY, THEME_KEY } from './config.js';
import { isValidDate, todayISO } from './dates.js';
import { createAlerts, createMirror } from './alerts.js';
import { sanitizeState, seedState } from './model.js';
import { getStorage, loadState, saveState } from './persist.js';
import { createPush } from './push.js';
import { PUSH } from './push-config.js';
import { createStore } from './store.js';
import { CLOUD, cloudEnabled } from './cloud/config.js';
import { SESSION_KEY, createCloud } from './cloud/firebase.js';
import { createSync } from './cloud/sync.js';
import { createAccountUI } from './ui/account.js';
import { createActions } from './ui/actions.js';
import { createComposer } from './ui/composer.js';
import { h, isTouch, qs } from './ui/dom.js';
import { createEditor } from './ui/editor.js';
import { createNotifier } from './ui/notify.js';
import { initToasts, toast } from './ui/overlay.js';
import { createSettings } from './ui/settings.js';
import { installShortcuts } from './ui/shortcuts.js';
import { renderSidebar } from './ui/sidebar.js';
import { createTopbar } from './ui/topbar.js';
import { renderView } from './ui/views.js';

// ---------- dados ----------
const storage = getStorage();
const loaded = loadState(storage);
const store = createStore(loaded.state ?? seedState(todayISO()));
if (!loaded.state) saveState(storage, store.state);

// ---------- rotas (#/hoje, #/dia/2026-11-06, #/calendario/2026-11, #/etiqueta/<id>...) ----------
function parseRoute(hash) {
  const [name, a] = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  switch (name) {
    case 'dia': return { name: 'day', date: isValidDate(a) ? a : null };
    case 'proximos': return { name: 'upcoming' };
    case 'pendentes': return { name: 'overdue' };
    case 'calendario': {
      const m = /^(\d{4})-(\d{2})$/.exec(a ?? '');
      const now = new Date();
      const month = m ? Number(m[2]) : now.getMonth() + 1;
      return { name: 'month', year: m ? Number(m[1]) : now.getFullYear(), month: month >= 1 && month <= 12 ? month : now.getMonth() + 1 };
    }
    case 'sem-data': return { name: 'inbox' };
    case 'concluidas': return { name: 'done' };
    case 'etiqueta': return { name: 'label', id: a ?? '' };
    case 'prioridade': return { name: 'priority', value: [1, 2, 3, 4].includes(Number(a)) ? Number(a) : 4 };
    default: return { name: 'day', date: null };
  }
}

// ---------- o objeto compartilhado entre as telas ----------
const app = {
  store,
  storage,
  installPrompt: null,
  ui: { route: parseRoute(location.hash), search: '', searchOpen: false, expanded: new Set(), doneOpen: true, doneLimit: 200, flashId: null },
  go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  },
  render,
  focusComposer() {
    window.scrollTo({ top: 0 });
    app.composer.focus();
  },
  toggleSidebar(open) {
    document.body.classList.toggle('sidebar-open', open);
    qs('#scrim').hidden = !open;
    if (open) qs('#sidebar .nav-item')?.focus();
  },
  setTheme(theme) {
    store.setSettings({ theme });
    try {
      if (theme === 'auto') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, theme);
    } catch { /* sem armazenamento: o tema vale só nesta sessão */ }
  },
  /** Tema que está valendo agora (o "automático" segue o sistema). */
  effectiveTheme() {
    const t = store.state.settings.theme;
    return t === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t;
  },
  toggleTheme() {
    app.setTheme(app.effectiveTheme() === 'dark' ? 'light' : 'dark');
  },
};
app.actions = createActions(app);
// conta na nuvem (opcional): só existe se js/cloud/config.js estiver preenchido
app.cloudConfig = CLOUD;
app.cloud = cloudEnabled() ? createCloud({ config: CLOUD, storage }) : null;
app.sync = app.cloud ? createSync({ store, cloud: app.cloud, config: CLOUD }) : null;
app.account = createAccountUI(app);
// lembretes: avisa na hora certa (com o app aberto, aqui; com o app fechado, pelo serviço de lembretes + sw.js). A escolha de
// ligar ou desligar vale só para este aparelho (por isso fica fora dos dados que vão para a nuvem).
const ALERTS_PREF = 'pauta:avisos';
app.alerts = createAlerts({
  store,
  mirror: createMirror(),
  push: createPush({ workerUrl: PUSH.workerUrl }),
  notify: createNotifier(app),
  prefs: {
    get() {
      try {
        const v = storage.getItem(ALERTS_PREF);
        return v === 'on' || v === 'off' ? v : null;
      } catch {
        return null;
      }
    },
    set(v) {
      try { storage.setItem(ALERTS_PREF, v); } catch { /* sem armazenamento: vale só nesta sessão */ }
    },
  },
});
app.editor = createEditor(app);
app.settings = createSettings(app);
app.composer = createComposer(app);
app.topbar = createTopbar(app);

// ---------- esqueleto da página ----------
const sidebarEl = qs('#sidebar');
const viewEl = qs('#view');
const fab = qs('#fab');
initToasts(qs('#toasts'));
qs('#topbar').replaceWith(app.topbar.el);
app.topbar.el.id = 'topbar';
qs('#composer').replaceWith(app.composer.el);

const THEME_COLORS = { light: '#f4f5f9', dark: '#0f1117' };
function applyTheme() {
  const t = store.state.settings.theme;
  const root = document.documentElement;
  if (t === 'light' || t === 'dark') root.dataset.theme = t;
  else delete root.dataset.theme;
  // cor da barra do navegador no celular
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    const media = m.getAttribute('media') ?? '';
    m.setAttribute('content', t === 'auto' ? (media.includes('dark') ? THEME_COLORS.dark : THEME_COLORS.light) : THEME_COLORS[t]);
  }
}

function composerContext() {
  const { route, search } = app.ui;
  const today = store.today();
  if (search.trim()) return { hidden: true };
  switch (route.name) {
    // vendo um dia futuro, a tarefa cai nele; vendo um dia passado, cai em hoje (senão já nasceria atrasada)
    case 'day': return { date: route.date && route.date > today ? route.date : today };
    case 'upcoming': case 'month': return { date: today };
    case 'inbox': return {};
    case 'label': return { labelId: route.id };
    case 'priority': return { priority: route.value };
    default: return { hidden: true };
  }
}

// guarda e devolve o foco quando a lista é redesenhada (para o teclado não "perder o lugar")
function captureFocus() {
  const a = document.activeElement;
  const row = a?.closest?.('.task');
  if (!row || !viewEl.contains(a)) return null;
  return { id: row.dataset.id, role: a === row ? null : a.dataset.role ?? null };
}
function restoreFocus(f) {
  if (!f) return;
  const row = viewEl.querySelector(`.task[data-id="${CSS.escape(f.id)}"]`);
  if (!row) return;
  const el = f.role ? row.querySelector(`[data-role="${CSS.escape(f.role)}"]`) ?? row : row;
  el.focus({ preventScroll: true });
}

function paint() {
  if (app.account.gated) return; // a tela de entrada está na frente: não desenha tarefa nenhuma por trás
  const focus = captureFocus();
  applyTheme();
  document.body.dataset.route = app.ui.search.trim() ? 'search' : app.ui.route.name;
  sidebarEl.replaceChildren(...renderSidebar(app));
  app.topbar.render();
  app.composer.setContext(composerContext());
  viewEl.replaceChildren(...renderView(app));
  restoreFocus(focus);
  fab.hidden = app.composer.el.hidden;
  document.title = `${qs('.title', app.topbar.el).textContent} · Pauta`;
  app.settings.refresh();
}

// Junta várias mudanças seguidas em um único desenho. O setTimeout garante o desenho mesmo quando o
// navegador pausa o requestAnimationFrame (aba aberta em segundo plano).
let scheduled = false;
function render() {
  if (scheduled) return;
  scheduled = true;
  const run = () => {
    if (!scheduled) return;
    scheduled = false;
    paint();
  };
  requestAnimationFrame(run);
  setTimeout(run, 60);
}

// ---------- reações ----------
store.subscribe((state, meta) => {
  render();
  if (!meta.external) scheduleSave();
});

addEventListener('hashchange', () => {
  app.ui.route = parseRoute(location.hash);
  app.ui.search = '';
  app.ui.searchOpen = false;
  app.toggleSidebar(false);
  window.scrollTo({ top: 0 });
  render();
  openTaskFromHash();
});

// Tocou numa notificação: o service worker abre o app em #/tarefa/<id> (ou manda uma mensagem se o app já estava aberto).
function openTask(id) {
  if (!id) return;
  if (store.find(id)) app.editor.open(id);
  else toast('Essa tarefa não existe mais neste aparelho.');
}
function openTaskFromHash() {
  const m = /^#\/tarefa\/([^/]+)/.exec(location.hash);
  if (!m || app.account.gated) return;
  const id = decodeURIComponent(m[1]);
  history.replaceState(null, '', `${location.pathname}${location.search}#/`); // não reabre ao recarregar
  app.ui.route = parseRoute('#/');
  render();
  openTask(id);
}
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'abrir-tarefa') openTask(e.data.id);
});

qs('#scrim').addEventListener('click', () => app.toggleSidebar(false));
sidebarEl.addEventListener('click', (e) => { if (e.target.closest('a, button')) app.toggleSidebar(false); });
fab.addEventListener('click', () => app.focusComposer());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('sidebar-open')) app.toggleSidebar(false);
});
installShortcuts(app);
// o sistema trocou entre claro e escuro: atualiza o ícone do botão de tema
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => render());

// salvar com um pequeno atraso e sempre ao sair da página
let saveTimer = 0;
let warned = false;
function flushSave() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  if (saveState(storage, store.state) || warned) return;
  warned = true;
  toast('Não consegui salvar neste navegador (armazenamento cheio ou bloqueado). Baixe um backup em Configurações.', { tone: 'danger', timeout: 15000 });
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 250);
}
addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSave();
  else render(); // pode ter virado o dia enquanto estava em segundo plano
});

// outra aba do mesmo navegador mexeu nos dados
addEventListener('storage', (e) => {
  if (e.key !== STORAGE_KEY || !e.newValue) return;
  try {
    const next = sanitizeState(JSON.parse(e.newValue));
    if (next) store.loadExternal(next);
  } catch { /* ignora conteúdo inválido */ }
});

// virou a meia-noite com o app aberto
let lastDay = store.today();
setInterval(() => {
  const d = store.today();
  if (d !== lastDay) { lastDay = d; render(); }
}, 30000);

// instalar como app
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); app.installPrompt = e; app.settings.refresh(); });
addEventListener('appinstalled', () => { app.installPrompt = null; app.settings.refresh(); toast('Pauta instalado!'); });

// sincronização entre aparelhos (só com conta)
if (app.cloud) {
  const { cloud, sync } = app;
  sync.onChange(() => render());
  cloud.onChange(() => render());
  // qualquer mudança feita aqui agenda um envio (vários seguidos viram um só)
  let lastRev = store.rev;
  store.subscribe(() => {
    if (store.rev === lastRev) return;
    lastRev = store.rev;
    if (cloud.session) sync.scheduleSoon(3000);
  });
  // buscar o que mudou em outros aparelhos: ao voltar para a aba, ao voltar a internet e a cada 90 s
  const poke = (ms) => { if (cloud.session && document.visibilityState === 'visible') sync.scheduleSoon(ms); };
  document.addEventListener('visibilitychange', () => poke(400));
  addEventListener('online', () => poke(400));
  setInterval(() => poke(0), 90000);
  // outra aba entrou ou saiu da conta
  addEventListener('storage', (e) => { if (e.key === SESSION_KEY) cloud.reloadSession(); });
  if (cloud.session) {
    const owner = store.state.owner;
    if (owner !== cloud.session.uid) {
      if (owner) store.resetForAccount(cloud.session.uid); // dados de outra conta: nunca misturar
      else store.setOwner(cloud.session.uid);
    }
    sync.scheduleSoon(600);
  }
}

// avisos de início
if (storage.isMemory) {
  qs('#notice').append(h('div', { class: 'notice bad', role: 'alert' },
    'Seu navegador está bloqueando o armazenamento: as tarefas não serão guardadas ao fechar esta página. Use “Baixar backup” nas Configurações.'));
}
if (loaded.error === 'corrupt') {
  toast('Os dados salvos estavam corrompidos. Uma cópia foi guardada no navegador e o app começou do zero.', { tone: 'danger', timeout: 15000 });
}

// service worker (funcionar sem internet)
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
}

applyTheme();
app.ui.route = parseRoute(location.hash);
app.account.start(); // login obrigatório: sem sessão, a tela de entrada vem antes de qualquer tarefa
paint(); // primeiro desenho na hora, sem esperar o próximo quadro
openTaskFromHash();
if (!isTouch() && !app.account.gated) setTimeout(() => app.composer.focus(), 0);
app.alerts.start().catch(() => {}); // lembretes: nunca podem impedir o app de abrir
