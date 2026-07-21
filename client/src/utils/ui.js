export function showLoading() {
  document.getElementById('loading').classList.remove('hidden');
}

export function hideLoading() {
  document.getElementById('loading').classList.add('hidden');
}

export function showError(message, container = 'auth-error') {
  const errorEl = document.getElementById(container);
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');

    setTimeout(() => {
      errorEl.classList.add('hidden');
    }, 5000);
  }
}

export function showModal(title, content) {
  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modal-body');

  modalBody.innerHTML = `
    <h2>${title}</h2>
    <div>${content}</div>
  `;

  modal.classList.remove('hidden');
}

export function hideModal() {
  document.getElementById('modal').classList.add('hidden');
}

/**
 * Generic show/hide for any modal or drawer element by id.
 * Centralizes what components used to do ad-hoc with classList.
 */
export function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
  return el;
}

export function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
  return el;
}

export const openDrawer = openModal;
export const closeDrawer = closeModal;

/* ------------------------------------------------------------------
   Global overlay behavior: Esc + backdrop click + close buttons.
   Applies to every .modal and .drawer without per-component wiring.
------------------------------------------------------------------ */
function closeTopLayer() {
  // Overlays without data-persist can be dismissed with Esc/backdrop.
  const layers = document.querySelectorAll(
    '.modal:not(.hidden):not([data-persist]), .drawer:not(.hidden):not([data-persist])'
  );
  const top = layers[layers.length - 1];
  if (top) top.classList.add('hidden');
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeTopLayer();
});

document.addEventListener('click', (e) => {
  // Any close button inside an overlay closes its overlay (always allowed)
  const closer = e.target.closest('.modal-close, .drawer-close, [data-close]');
  if (closer) {
    const layer = closer.closest('.modal, .drawer');
    if (layer) {
      layer.classList.add('hidden');
      return;
    }
  }
  // Backdrop click (the overlay element itself, not its content)
  if (
    (e.target.classList.contains('modal') || e.target.classList.contains('drawer')) &&
    !e.target.hasAttribute('data-persist')
  ) {
    e.target.classList.add('hidden');
  }
});

export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

export function formatMana(manaCost) {
  if (!manaCost) return '';

  // Convert mana cost to mana font icons
  // {W} -> <i class="ms ms-w"></i>
  return manaCost.replace(/\{([^}]+)\}/g, (match, symbol) => {
    const sym = symbol.toLowerCase()
      .replace('/', '')  // Handle split mana
      .replace('p', 'p'); // Phyrexian mana

    // Handle special cases
    if (symbol.includes('/')) {
      // Split mana like {W/U}
      const parts = symbol.split('/');
      return `<i class="ms ms-${parts[0].toLowerCase()}${parts[1].toLowerCase()} ms-split"></i>`;
    }

    return `<i class="ms ms-${sym} ms-cost"></i>`;
  });
}

export function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString();
}

export function formatOracleText(text) {
  if (!text) return '';
  // Replace both actual newlines and escaped \n with <br>
  return text.replace(/\\n/g, '<br>').replace(/\n/g, '<br>');
}

/**
 * Show toast notification (styled via .toast CSS classes + Phosphor icon).
 * Signature is unchanged so existing call sites keep working.
 */
export function showToast(message, type = 'success', duration = 3000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const icons = {
    success: 'ph-check-circle',
    error: 'ph-x-circle',
    warning: 'ph-warning',
    info: 'ph-info',
  };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icon = document.createElement('i');
  icon.className = `ph-fill ${icons[type] || icons.info}`;
  const text = document.createElement('span');
  text.textContent = message;
  toast.append(icon, text);

  const dismiss = () => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 250);
  };
  toast.addEventListener('click', dismiss);
  container.appendChild(toast);

  if (duration) setTimeout(dismiss, duration);
}

/**
 * Styled confirmation dialog — a drop-in replacement for native confirm().
 * Returns a Promise<boolean>.
 */
export function confirmDialog({
  title = 'Are you sure?',
  message = '',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  danger = false,
  icon,
} = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal';
    const iconName = icon || (danger ? 'ph-warning' : 'ph-question');
    overlay.innerHTML = `
      <div class="modal-content modal-sm confirm-dialog ${danger ? 'confirm-danger' : ''}">
        <div class="confirm-icon"><i class="ph-fill ${iconName}"></i></div>
        <h2>${title}</h2>
        ${message ? `<p>${message}</p>` : ''}
        <div class="modal-footer">
          <button class="btn btn-ghost" data-act="cancel">${cancelText}</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${confirmText}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const done = (val) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    overlay.querySelector('[data-act="ok"]').addEventListener('click', () => done(true));
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => done(false));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) done(false);
    });
    const onKey = (e) => {
      if (e.key === 'Escape') done(false);
      else if (e.key === 'Enter') done(true);
    };
    document.addEventListener('keydown', onKey);
    overlay.querySelector('[data-act="ok"]').focus();
  });
}

/**
 * Anchored popover. Pass an anchor element and a content element; returns
 * { el, close }. Closes on outside-click or Esc. Reuses .popover styling.
 */
export function popover(anchorEl, contentEl, { align = 'left', gap = 6 } = {}) {
  const pop = document.createElement('div');
  pop.className = 'popover';
  pop.appendChild(contentEl);
  document.body.appendChild(pop);

  const r = anchorEl.getBoundingClientRect();
  pop.style.top = `${r.bottom + window.scrollY + gap}px`;
  const rawLeft = align === 'right'
    ? r.right + window.scrollX - pop.offsetWidth
    : r.left + window.scrollX;
  const maxLeft = window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 8;
  pop.style.left = `${Math.max(8, Math.min(rawLeft, maxLeft))}px`;

  const close = () => {
    pop.remove();
    document.removeEventListener('mousedown', onDoc, true);
    document.removeEventListener('keydown', onKey);
  };
  const onDoc = (e) => {
    if (!pop.contains(e.target) && !anchorEl.contains(e.target)) close();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  setTimeout(() => {
    document.addEventListener('mousedown', onDoc, true);
    document.addEventListener('keydown', onKey);
  }, 0);

  return { el: pop, close };
}
