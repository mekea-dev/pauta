// Atalhos de teclado. Só valem quando você não está digitando e não há janela aberta.
import { addDays } from '../dates.js';

export const SHORTCUTS = [
  { keys: ['N'], label: 'Nova tarefa (vai para o campo de adicionar)' },
  { keys: ['/'], label: 'Buscar' },
  { keys: ['T'], label: 'Ir para hoje' },
  { keys: [{ icon: 'chevron-left', label: 'Seta para a esquerda' }, { icon: 'chevron-right', label: 'Seta para a direita' }], label: 'Dia anterior ou seguinte (no calendário: mês)' },
  { keys: ['J', 'K'], label: 'Descer ou subir entre as tarefas' },
  { keys: ['X'], label: 'Concluir ou reabrir a tarefa selecionada' },
  { keys: ['E'], label: 'Editar a tarefa selecionada (ou Enter)' },
  { keys: ['Delete'], label: 'Excluir a tarefa selecionada' },
  { keys: ['Ctrl', 'Z'], label: 'Desfazer a última ação' },
  { keys: ['?'], label: 'Mostrar esta lista' },
  { keys: ['Esc'], label: 'Fechar janelas e menus' },
];

export function installShortcuts(app) {
  const { store, ui } = app;

  const rows = () => [...document.querySelectorAll('#view .task:not(.is-ghost)')];
  const currentRow = () => document.activeElement?.closest?.('.task') ?? null;

  function moveFocus(delta) {
    const list = rows();
    if (!list.length) return;
    const cur = currentRow();
    const i = cur ? list.indexOf(cur) : delta > 0 ? -1 : list.length;
    list[Math.min(list.length - 1, Math.max(0, i + delta))].focus();
  }

  function shiftRoute(delta) {
    const r = ui.route;
    if (r.name === 'day') {
      const d = addDays(r.date ?? store.today(), delta);
      app.go(d === store.today() ? '#/hoje' : `#/dia/${d}`);
    } else if (r.name === 'month') {
      const d = new Date(r.year, r.month - 1 + delta, 1);
      app.go(`#/calendario/${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.isComposing) return;
    const typing = e.target.closest?.('input, textarea, select, [contenteditable="true"]');
    const modal = document.querySelector('dialog[open]');

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      if (typing || modal || !store.canUndo) return;
      e.preventDefault();
      store.undo();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || typing || modal) return;

    const row = currentRow();
    switch (e.key) {
      case 'n': case 'N': e.preventDefault(); app.focusComposer(); break;
      case '/': e.preventDefault(); app.topbar.focusSearch(); break;
      case 't': case 'T': app.go('#/hoje'); break;
      case '?': e.preventDefault(); app.settings.open('shortcuts'); break;
      case 'ArrowLeft': shiftRoute(-1); break;
      case 'ArrowRight': shiftRoute(1); break;
      case 'j': case 'J': moveFocus(1); break;
      case 'k': case 'K': moveFocus(-1); break;
      case 'ArrowDown': if (row) { e.preventDefault(); moveFocus(1); } break;
      case 'ArrowUp': if (row) { e.preventDefault(); moveFocus(-1); } break;
      case 'x': case 'X': row?.querySelector('.check')?.click(); break;
      case 'e': case 'E': if (row) app.editor.open(row.dataset.id); break;
      case 'Enter': if (row && e.target === row) app.editor.open(row.dataset.id); break;
      case 'Delete': if (row) { e.preventDefault(); const next = row.nextElementSibling ?? row.previousElementSibling; app.actions.remove(row.dataset.id); next?.focus(); } break;
      default: break;
    }
  });
}
