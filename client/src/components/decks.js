import api from '../services/api.js';
import { showLoading, hideLoading, showToast, confirmDialog } from '../utils/ui.js';
import { formatOptionsHtml, fillFormatSelect } from '../utils/formatUi.js';
import { formatLabel, isCubeFormat, CUBE_CARD_POOLS, DEFAULT_CUBE_SETTINGS } from '../../../shared/formats.js';
import { filterDecks, formatsInUse, DECK_SORTS } from '../utils/deckList.js';

let decks = [];
let kindFilter = 'all';
let deckSort = 'updated';
let formatFilter = '';
let deckQuery = '';
try {
  kindFilter = localStorage.getItem('decksKindFilter') || 'all';
  deckSort = localStorage.getItem('decksSort') || 'updated';
} catch {
  // Remembering the filter is only a convenience
}

export function setupDecks() {
  const newDeckBtn = document.getElementById('new-deck-btn');
  const importDeckBtn = document.getElementById('import-deck-btn');

  newDeckBtn.addEventListener('click', () => {
    showNewDeckModal();
  });

  importDeckBtn.addEventListener('click', () => {
    showImportModal();
  });

  document.getElementById('new-cube-btn').addEventListener('click', showNewCubeModal);

  document.querySelectorAll('.decks-filter-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.kind === kindFilter);
    btn.addEventListener('click', () => {
      kindFilter = btn.dataset.kind;
      try {
        localStorage.setItem('decksKindFilter', kindFilter);
      } catch {
        // see above
      }
      document.querySelectorAll('.decks-filter-btn').forEach((b) => b.classList.toggle('active', b === btn));
      renderDecks();
    });
  });

  const sortSelect = document.getElementById('decks-sort');
  sortSelect.innerHTML = DECK_SORTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  sortSelect.value = DECK_SORTS.some(([v]) => v === deckSort) ? deckSort : 'updated';
  sortSelect.addEventListener('change', () => {
    deckSort = sortSelect.value;
    try {
      localStorage.setItem('decksSort', deckSort);
    } catch {
      // see above
    }
    renderDecks();
  });
  // The format filter isn't remembered: coming back to a page that hides most decks is confusing
  document.getElementById('decks-format').addEventListener('change', (e) => {
    formatFilter = e.target.value;
    renderDecks();
  });
  document.getElementById('decks-search').addEventListener('input', (e) => {
    deckQuery = e.target.value;
    renderDecks();
  });

  fillFormatSelect(document.getElementById('import-deck-format'), { noneLabel: 'No format' });

  // Load decks when page is shown
  window.addEventListener('page:decks', loadDecks);
}

function showNewCubeModal() {
  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modal-body');
  const sizes = [[180, 'Small (180)'], [360, 'Standard (360)'], [450, 'Large (450)'], [540, 'Large (540)'], [720, 'Huge (720)']];

  modalBody.innerHTML = `
    <h2>New cube</h2>
    <form id="new-cube-form" style="margin-top: 1.5rem;">
      <div class="form-group">
        <label for="new-cube-name">Name</label>
        <input type="text" id="new-cube-name" required autofocus placeholder="My vintage cube">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="new-cube-size">Target size</label>
          <select id="new-cube-size">${sizes.map(([n, label]) => `<option value="${n}" ${n === 360 ? 'selected' : ''}>${label}</option>`).join('')}</select>
        </div>
        <div class="form-group">
          <label for="new-cube-pool">Card pool</label>
          <select id="new-cube-pool">${CUBE_CARD_POOLS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('')}</select>
        </div>
      </div>
      <label class="checkbox-row"><input type="checkbox" id="new-cube-singleton" checked> Singleton</label>
      <p class="modal-lede">Draft settings (players, packs, pack size) default to 8 × 3 × 15 and can be changed any time in Cube settings. To bring over a cube from CubeCobra, use Import Deck with its CSV export.</p>
      <div style="display: flex; gap: 0.5rem; margin-top: 1.5rem;">
        <button type="submit" class="btn btn-primary" style="flex: 1;">Create Cube</button>
        <button type="button" class="btn btn-secondary" data-close>Cancel</button>
      </div>
    </form>
  `;
  modal.classList.remove('hidden');

  document.getElementById('new-cube-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('new-cube-name').value.trim();
    const settings = {
      ...DEFAULT_CUBE_SETTINGS,
      targetSize: Number(document.getElementById('new-cube-size').value),
      cardPool: document.getElementById('new-cube-pool').value,
      singleton: document.getElementById('new-cube-singleton').checked,
    };
    try {
      modal.classList.add('hidden');
      const result = await api.createDeck(name, 'cube', '', settings);
      if (result.deck?.id) openDeckBuilder(result.deck.id);
      else await loadDecks();
    } catch (error) {
      showToast('Failed to create cube: ' + error.message, 'error');
    }
  });
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
        <select id="new-deck-format">${formatOptionsHtml({ noneLabel: 'No format', includeCube: false })}</select>
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

/** Only the formats your decks use, with All first. Hidden when every deck has the same one. */
function renderFormatFilter() {
  const select = document.getElementById('decks-format');
  const formats = formatsInUse(decks)
    .map((f) => [f, f === 'none' ? 'No format' : formatLabel(f)])
    .sort((a, b) => a[1].localeCompare(b[1]));
  if (formatFilter && !formats.some(([f]) => f === formatFilter)) formatFilter = '';
  select.innerHTML = `<option value="">All formats</option>${formats.map(([f, l]) => `<option value="${escapeHtml(f)}">${escapeHtml(l)}</option>`).join('')}`;
  select.value = formatFilter;
  select.classList.toggle('hidden', formats.length < 2);
}

function renderDecks() {
  const decksList = document.getElementById('decks-list');

  renderFormatFilter();
  const shown = filterDecks(decks, { kind: kindFilter, format: formatFilter, query: deckQuery, sort: deckSort, formatLabel });
  document.getElementById('decks-filter')?.classList.toggle('hidden', !decks.some((d) => isCubeFormat(d.format)) && kindFilter === 'all');

  if (shown.length === 0 && decks.length && (formatFilter || deckQuery.trim())) {
    decksList.innerHTML = `
      <div class="grid-message">
        <i class="ph ph-magnifying-glass"></i>
        <h3>No matches</h3>
        <p>Nothing here matches that search or format.</p>
      </div>
    `;
    return;
  }

  if (shown.length === 0) {
    const cubes = kindFilter === 'cubes';
    decksList.innerHTML = `
      <div class="grid-message">
        <i class="ph ${cubes ? 'ph-cube' : 'ph-cards'}"></i>
        <h3>${cubes ? 'No cubes yet' : 'No decks yet'}</h3>
        <p>${cubes ? 'Start one with New Cube, or import a CubeCobra CSV.' : 'Create one from scratch, or import a list from another site.'}</p>
      </div>
    `;
    return;
  }

  decksList.innerHTML = shown.map(deck => {
    const art = deck.preview_image ? deck.preview_image.replace('/normal/', '/art_crop/') : null;
    const cube = isCubeFormat(deck.format);
    const sideboard = !cube && deck.sideboard_count ? ` + ${deck.sideboard_count} side` : '';
    let target = null;
    try {
      target = cube ? JSON.parse(deck.settings || '{}').targetSize : null;
    } catch {
      target = null;
    }

    return `
      <article class="deck-card" data-deck-id="${deck.id}">
        <a class="deck-card-link" href="/decks/${deck.id}">
          <div class="deck-card-art">
            ${art ? `<img src="${art}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : '<i class="ph ph-cards"></i>'}
          </div>
          <div class="deck-card-body">
            <h3>${escapeHtml(deck.name)}</h3>
            <div class="deck-card-stats">
              ${deck.format ? `<span class="deck-format">${cube ? '<i class="ph ph-cube"></i> ' : ''}${escapeHtml(formatLabel(deck.format))}</span>` : ''}
              <span>${deck.mainboard_count || 0}${target ? ` / ${target}` : ''} cards${sideboard}</span>
              ${deck.total_price > 0 ? `<span class="deck-card-value" title="Estimated value">$${Number(deck.total_price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>` : ''}
            </div>
          </div>
        </a>
        <button class="icon-btn btn-delete" data-deck-id="${deck.id}" title="Delete ${cube ? 'cube' : 'deck'}" aria-label="Delete ${escapeHtml(deck.name)}">
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
    let format = document.getElementById('import-deck-format').value;
    const deckList = document.getElementById('import-deck-list').value;
    // A CubeCobra export is a cube even if no format was picked
    if (!format && /color category/i.test(deckList.split('\n')[0] || '')) format = 'cube';

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
