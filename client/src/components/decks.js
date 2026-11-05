import api from '../services/api.js';
import { showLoading, hideLoading, showToast, confirmDialog } from '../utils/ui.js';

let decks = [];

export function setupDecks() {
  const newDeckBtn = document.getElementById('new-deck-btn');
  const importDeckBtn = document.getElementById('import-deck-btn');

  newDeckBtn.addEventListener('click', () => {
    showNewDeckModal();
  });

  importDeckBtn.addEventListener('click', () => {
    showImportModal();
  });

  // Load decks when page is shown
  window.addEventListener('page:decks', loadDecks);
}

function showNewDeckModal() {
  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modal-body');

  modalBody.innerHTML = `
    <h2>Create New Deck</h2>
    <form id="new-deck-form" style="margin-top: 1.5rem;">
      <div class="form-group">
        <label for="new-deck-name">Deck Name</label>
        <input type="text" id="new-deck-name" required autofocus>
      </div>
      <div class="form-group">
        <label for="new-deck-format">Format (Optional)</label>
        <select id="new-deck-format">
          <option value="">Select Format</option>
          <option value="standard">Standard</option>
          <option value="modern">Modern</option>
          <option value="commander">Commander</option>
          <option value="legacy">Legacy</option>
          <option value="vintage">Vintage</option>
          <option value="pauper">Pauper</option>
        </select>
      </div>
      <div style="display: flex; gap: 0.5rem; margin-top: 1.5rem;">
        <button type="submit" class="btn btn-primary" style="flex: 1;">Create Deck</button>
        <button type="button" class="btn btn-secondary" id="cancel-new-deck">Cancel</button>
      </div>
    </form>
  `;

  modal.classList.remove('hidden');

  // Handle form submission
  document.getElementById('new-deck-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('new-deck-name').value;
    const format = document.getElementById('new-deck-format').value;

    try {
      modal.classList.add('hidden');
      const result = await api.createDeck(name, format, '');
      if (result.deck?.id) {
        openDeckBuilder(result.deck.id); // A new deck is empty, so go straight to adding cards
      } else {
        await loadDecks();
      }
    } catch (error) {
      showToast('Failed to create deck: ' + error.message, 'error');
    }
  });

  // Handle cancel
  document.getElementById('cancel-new-deck').addEventListener('click', () => {
    modal.classList.add('hidden');
  });
}

async function loadDecks() {
  const decksList = document.getElementById('decks-list');
  decksList.classList.add('is-loading');
  try {
    const result = await api.getDecks();
    decks = result.decks;
    renderDecks();
  } catch (error) {
    showToast('Failed to load decks: ' + error.message, 'error');
  } finally {
    decksList.classList.remove('is-loading');
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

function renderDecks() {
  const decksList = document.getElementById('decks-list');

  if (decks.length === 0) {
    decksList.innerHTML = `
      <div class="grid-message">
        <i class="ph ph-cards"></i>
        <h3>No decks yet</h3>
        <p>Create one from scratch, or import a list from another site.</p>
      </div>
    `;
    return;
  }

  decksList.innerHTML = decks.map(deck => {
    const art = deck.preview_image ? deck.preview_image.replace('/normal/', '/art_crop/') : null;
    const sideboard = deck.sideboard_count ? ` + ${deck.sideboard_count} side` : '';

    return `
      <article class="deck-card" data-deck-id="${deck.id}">
        <a class="deck-card-link" href="/decks/${deck.id}">
          <div class="deck-card-art">
            ${art ? `<img src="${art}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : '<i class="ph ph-cards"></i>'}
          </div>
          <div class="deck-card-body">
            <h3>${escapeHtml(deck.name)}</h3>
            <div class="deck-card-stats">
              ${deck.format ? `<span class="deck-format">${escapeHtml(deck.format)}</span>` : ''}
              <span>${deck.mainboard_count || 0} cards${sideboard}</span>
            </div>
          </div>
        </a>
        <button class="icon-btn btn-delete" data-deck-id="${deck.id}" title="Delete deck" aria-label="Delete ${escapeHtml(deck.name)}">
          <i class="ph ph-trash"></i>
        </button>
      </article>
    `;
  }).join('');

  decksList.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Delete deck?',
        message: 'This permanently deletes the deck and its contents.',
        confirmText: 'Delete',
        danger: true,
      });
      if (ok) {
        try {
          await api.deleteDeck(btn.dataset.deckId);
          await loadDecks();
          showToast('Deck deleted', 'success');
        } catch (error) {
          showToast('Failed to delete deck: ' + error.message, 'error');
        }
      }
    });
  });

  decksList.querySelectorAll('.deck-card-link').forEach(link => {
    link.addEventListener('click', (e) => {
      // Let the browser handle open-in-new-tab and friends.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      openDeckBuilder(link.closest('.deck-card').dataset.deckId);
    });
  });
}

function openDeckBuilder(deckId) {
  window.dispatchEvent(new CustomEvent('navigate', { detail: { path: `/decks/${deckId}` } }));
}

function showImportModal() {
  const modal = document.getElementById('import-deck-modal');
  modal.classList.remove('hidden');

  // Clear form
  document.getElementById('import-deck-name').value = '';
  document.getElementById('import-deck-format').value = '';
  document.getElementById('import-deck-list').value = '';

  // Handle close
  document.getElementById('import-modal-close').onclick = () => {
    modal.classList.add('hidden');
  };

  document.getElementById('cancel-import').onclick = () => {
    modal.classList.add('hidden');
  };

  // Handle form submission
  const form = document.getElementById('import-deck-form');
  form.onsubmit = async (e) => {
    e.preventDefault();

    const name = document.getElementById('import-deck-name').value;
    const format = document.getElementById('import-deck-format').value;
    const deckList = document.getElementById('import-deck-list').value;

    try {
      showLoading();
      modal.classList.add('hidden');

      const result = await api.importDeck(name, format, deckList);

      hideLoading();
      showToast(`Successfully imported ${result.imported} cards!`, 'success', 3000);

      if (result.deck?.id) {
        openDeckBuilder(result.deck.id);
      } else {
        await loadDecks();
      }
    } catch (error) {
      hideLoading();
      modal.classList.remove('hidden');
      showToast('Failed to import deck: ' + error.message, 'error');
    }
  };
}
