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

// Setup modal close handlers
document.querySelector('.modal-close')?.addEventListener('click', hideModal);
document.getElementById('modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'modal') {
    hideModal();
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
 * Show toast notification
 */
export function showToast(message, type = 'success', duration = 3000) {
  // Create toast container if it doesn't exist
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      display: flex;
      flex-direction: column;
      gap: 10px;
    `;
    document.body.appendChild(container);
  }

  // Create toast
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.style.cssText = `
    padding: 12px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    color: white;
    font-size: 14px;
    font-weight: 500;
    min-width: 200px;
    max-width: 400px;
    animation: slideIn 0.3s ease-out;
    cursor: pointer;
    transition: opacity 0.3s;
  `;

  // Set background color based on type
  const colors = {
    success: '#10b981',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6'
  };
  toast.style.backgroundColor = colors[type] || colors.info;

  toast.textContent = message;

  // Add click to dismiss
  toast.addEventListener('click', () => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  });

  // Add toast to container
  container.appendChild(toast);

  // Auto remove after duration
  if (duration) {
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
}

// Add CSS animation
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(400px);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
`;
document.head.appendChild(style);
