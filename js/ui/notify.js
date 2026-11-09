// O que aparece quando um lembrete toca: um aviso dentro do app (se você está olhando) ou uma notificação do sistema.
import { ALARM_VIBRATION, alarmTag } from '../alarm.js';
import { toast } from './overlay.js';

/** Opções da notificação. O service worker (sw.js) monta as mesmas, com o mesmo `tag`, para um aviso não aparecer duas vezes. */
export function notificationOptions(entry) {
  return {
    body: entry.body ?? '',
    tag: entry.id,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    lang: 'pt-BR',
    data: { taskId: entry.taskId ?? null },
    ...(entry.dueAt ? { timestamp: entry.dueAt } : {}),
  };
}

/**
 * Opções da notificação de um ALARME: fica na tela até a pessoa tocar (computador e Android), chama de novo a cada toque do serviço
 * (`renotify`) e vibra (Android). Tocar nela abre o app na tela do alarme. O service worker (sw.js) monta as mesmas.
 */
export function alarmNotificationOptions(entry) {
  return {
    body: entry.body ?? '',
    tag: alarmTag(entry.id),
    renotify: true,
    requireInteraction: true,
    vibrate: ALARM_VIBRATION,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    lang: 'pt-BR',
    data: { taskId: entry.taskId ?? null, alarm: true, id: entry.id },
    ...(entry.dueAt ? { timestamp: entry.dueAt } : {}),
  };
}

export function createNotifier(app, env = globalThis) {
  const visible = () => env.document?.visibilityState === 'visible';

  function inApp(entry) {
    const open = entry.taskId && app.store.find(entry.taskId) ? { label: 'Abrir', onClick: () => app.editor.open(entry.taskId) } : null;
    toast(`Lembrete: ${entry.title}${entry.body ? ` · ${entry.body}` : ''}`, { action: open, timeout: 30000 });
    env.navigator?.vibrate?.([150, 80, 150]);
  }

  /** Notificação do sistema (aparece mesmo com a aba escondida). Devolve false se não deu (sem permissão ou sem service worker). */
  async function system(entry) {
    if (env.Notification?.permission !== 'granted') return false;
    const reg = await env.navigator?.serviceWorker?.getRegistration?.();
    if (!reg) return false;
    await reg.showNotification(entry.title, notificationOptions(entry));
    return true;
  }

  /** Notificação do alarme (aba escondida: a tela do alarme não é vista). Devolve false se não deu (sem permissão ou sem service worker). */
  async function alarm(entry) {
    if (env.Notification?.permission !== 'granted') return false;
    const reg = await env.navigator?.serviceWorker?.getRegistration?.();
    if (!reg) return false;
    await reg.showNotification(entry.title, alarmNotificationOptions(entry));
    return true;
  }

  /** Tira da tela as notificações deste alarme (a pessoa parou ou adiou aqui no app). */
  async function closeAlarm(id) {
    const reg = await env.navigator?.serviceWorker?.getRegistration?.();
    const open = await reg?.getNotifications?.({ tag: alarmTag(id) });
    for (const n of open ?? []) n.close();
  }

  return {
    inApp,
    system,
    alarm,
    closeAlarm,
    /** Mostra o aviso do jeito certo para o momento. Devolve true se apareceu para a pessoa. */
    async fire(entry) {
      if (visible()) {
        inApp(entry);
        return true;
      }
      try {
        return await system(entry);
      } catch {
        return false;
      }
    },
  };
}
