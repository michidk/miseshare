import type { RoomNotificationController, RoomNotificationKind } from '../types.js';

const notificationIcons: Record<RoomNotificationKind, string> = {
  message: '<path d="M20 15a3 3 0 0 1-3 3H9l-5 3v-6a3 3 0 0 1-1-2.2V7a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3v8Z"/>',
  joined: '<path d="M15 20v-1.5c0-2-1.8-3.5-4-3.5s-4 1.5-4 3.5V20M11 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM18 8v6M15 11h6"/>',
  left: '<path d="M15 20v-1.5c0-2-1.8-3.5-4-3.5s-4 1.5-4 3.5V20M11 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM15 11h6"/>',
};

export function buildRoomNotificationController(root: HTMLElement, storage: Storage = localStorage): RoomNotificationController {
  let enabled = readEnabled(storage);
  const controller: RoomNotificationController = {
    get enabled() { return enabled; },
    show({ kind, title, description }) {
      if (!enabled) return;
      const card = document.createElement('article');
      card.className = 'notification-card';
      card.dataset.kind = kind;
      card.innerHTML = `
        <span class="notification-card-icon"><svg viewBox="0 0 24 24" aria-hidden="true">${notificationIcons[kind]}</svg></span>
        <div class="notification-card-copy"><strong></strong><p></p></div>
        <button class="notification-card-close" type="button" aria-label="Dismiss notification"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>`;
      card.querySelector('strong')!.textContent = title;
      card.querySelector('p')!.textContent = description;
      const remove = () => {
        if (!card.isConnected || card.classList.contains('removing')) return;
        card.classList.add('removing');
        setTimeout(() => card.remove(), 180);
      };
      card.querySelector('button')?.addEventListener('click', remove);
      root.prepend(card);
      while (root.children.length > 4) root.lastElementChild?.remove();
      setTimeout(remove, 5_000);
    },
    toggle() {
      enabled = !enabled;
      try { storage.setItem('mise-card-notifications', enabled ? 'on' : 'off'); } catch {}
      if (!enabled) root.replaceChildren();
      controller.syncButtons();
      return enabled;
    },
    syncButtons(selector = '[data-card-notification-toggle]') {
      const action = enabled ? 'Turn off popup notifications' : 'Turn on popup notifications';
      const description = enabled
        ? 'On · New room activity appears as popup cards.'
        : 'Off · Click to show new activity as popup cards.';
      document.querySelectorAll<HTMLButtonElement>(selector).forEach((button) => {
        button.setAttribute('aria-pressed', String(enabled));
        button.setAttribute('aria-label', action);
        const help = button.querySelector<HTMLElement>('[data-card-notification-description]');
        if (help) help.textContent = description;
      });
    },
  };
  return controller;
}

function readEnabled(storage: Storage) {
  try { return storage.getItem('mise-card-notifications') !== 'off'; } catch { return true; }
}
