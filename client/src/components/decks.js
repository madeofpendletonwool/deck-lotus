import api from '../services/api.js';
import { showLoading, hideLoading, formatDate, showError, showToast } from '../utils/ui.js';

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
      showLoading();
      modal.classList.add('hidden');
      await api.createDeck(name, format, '');
      await loadDecks();
      hideLoading();
    } catch (error) {
      hideLoading();
      showError('Failed to create deck: ' + error.message);
    }
  });

  // Handle cancel
  document.getElementById('cancel-new-deck').addEventListener('click', () => {
    modal.classList.add('hidden');
  });
}

async function loadDecks() {
  try {
    showLoading();
    const result = await api.getDecks();
    decks = result.decks;
    renderDecks();
    hideLoading();
  } catch (error) {
    hideLoading();
    showToast('Failed to load decks: ' + error.message, 'error');
  }
}

function renderDecks() {
  const decksList = document.getElementById('decks-list');

  if (decks.length === 0) {
    decksList.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: var(--text-secondary);">
        <h3>No decks yet</h3>
        <p>Click "New Deck" to create your first deck!</p>
      </div>
    `;
    return;
  }

  decksList.innerHTML = decks.map(deck => {
    // Use art_crop version of the image for better background display
    const backgroundImage = deck.preview_image
      ? deck.preview_image.replace('/normal/', '/art_crop/')
      : null;

    const backgroundStyle = backgroundImage
      ? `background: linear-gradient(to bottom, rgba(0,0,0,0.7), rgba(0,0,0,0.9)), url('${backgroundImage}') center/cover no-repeat;`
      : '';

    return `
      <div class="deck-card" data-deck-id="${deck.id}" style="${backgroundStyle}">
        <div class="deck-card-header">
          <div>
            <h3>${deck.name}</h3>
            ${deck.format ? `<span class="deck-format">${deck.format}</span>` : ''}
          </div>
        </div>
        <div class="deck-card-stats">
          <span>Main: ${deck.mainboard_count || 0} cards</span>
          <span>Side: ${deck.sideboard_count || 0} cards</span>
        </div>
        <div class="deck-card-actions">
          <button class="btn btn-primary btn-edit" data-deck-id="${deck.id}">Edit</button>
          <button class="btn btn-danger btn-delete" data-deck-id="${deck.id}">Delete</button>
        </div>
      </div>
    `;
  }).join('');

  // Add event listeners
  decksList.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const deckId = btn.dataset.deckId;
      openDeckBuilder(deckId);
    });
  });

  decksList.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const deckId = btn.dataset.deckId;

      if (confirm('Are you sure you want to delete this deck?')) {
        try {
          showLoading();
          await api.deleteDeck(deckId);
          await loadDecks();
          hideLoading();
          showToast('Deck deleted', 'success');
        } catch (error) {
          hideLoading();
          showToast('Failed to delete deck: ' + error.message, 'error');
        }
      }
    });
  });

  decksList.querySelectorAll('.deck-card').forEach(card => {
    card.addEventListener('click', () => {
      const deckId = card.dataset.deckId;
      openDeckBuilder(deckId);
    });
  });
}

function openDeckBuilder(deckId) {
  // Dispatch event to open deck builder
  window.dispatchEvent(new CustomEvent('open-deck', { detail: { deckId } }));
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

      // Reload decks and open the imported deck
      await loadDecks();

      if (result.deck && result.deck.id) {
        setTimeout(() => {
          openDeckBuilder(result.deck.id);
        }, 500);
      }
    } catch (error) {
      hideLoading();
      modal.classList.remove('hidden');
      showToast('Failed to import deck: ' + error.message, 'error');
    }
  };
}
