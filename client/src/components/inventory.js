import api from '../services/api.js';
import { showLoading, hideLoading, formatMana, showToast, showError } from '../utils/ui.js';
import { showCardDetail } from './cards.js';

let inventoryData = null;
let currentPage = 1;
let totalPages = 1;
let viewMode = 'grid'; // 'grid' or 'list'
let filters = {
  name: '',
  colors: [],
  type: 'all',
  sort: 'name',
  availability: 'all',
};
let searchTimeout = null;
let quickSearchTimeout = null;
let selectedCards = new Set(); // Track selected card IDs for multi-select
let selectMode = false; // Whether multi-select mode is active

export function setupInventory() {
  // Load inventory data when page is shown
  window.addEventListener('page:inventory', loadInventoryData);

  // Setup filter listeners
  setupFilterListeners();

  // Setup bulk add modal
  setupBulkAddModal();

  // Setup quick search
  setupQuickSearch();

  // Setup view toggle
  setupViewToggle();

  // Setup pagination
  setupPagination();

  // Setup bulk actions
  setupBulkActions();
}

function setupFilterListeners() {
  // Name search with debounce
  const searchInput = document.getElementById('inventory-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      if (searchTimeout) clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        filters.name = e.target.value;
        currentPage = 1;
        loadInventoryData();
      }, 300);
    });
  }

  // Sort
  const sortSelect = document.getElementById('inventory-sort');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      filters.sort = e.target.value;
      currentPage = 1;
      loadInventoryData();
    });
  }

  // Type
  const typeSelect = document.getElementById('inventory-type');
  if (typeSelect) {
    typeSelect.addEventListener('change', (e) => {
      filters.type = e.target.value;
      currentPage = 1;
      loadInventoryData();
    });
  }

  // Availability
  const availabilitySelect = document.getElementById('inventory-availability');
  if (availabilitySelect) {
    availabilitySelect.addEventListener('change', (e) => {
      filters.availability = e.target.value;
      currentPage = 1;
      loadInventoryData();
    });
  }

  // Color checkboxes
  const colorCheckboxes = document.querySelectorAll('#inventory-colors input[type="checkbox"]');
  colorCheckboxes.forEach(checkbox => {
    checkbox.addEventListener('change', () => {
      filters.colors = Array.from(document.querySelectorAll('#inventory-colors input[type="checkbox"]:checked'))
        .map(cb => cb.value);
      currentPage = 1;
      loadInventoryData();
    });
  });
}

function setupViewToggle() {
  const gridBtn = document.getElementById('inventory-grid-view-btn');
  const listBtn = document.getElementById('inventory-list-view-btn');

  if (gridBtn) {
    gridBtn.addEventListener('click', () => {
      viewMode = 'grid';
      gridBtn.classList.add('active');
      listBtn?.classList.remove('active');
      renderInventory();
    });
  }

  if (listBtn) {
    listBtn.addEventListener('click', () => {
      viewMode = 'list';
      listBtn.classList.add('active');
      gridBtn?.classList.remove('active');
      renderInventory();
    });
  }
}

function setupPagination() {
  const prevBtn = document.getElementById('inventory-prev-page');
  const nextBtn = document.getElementById('inventory-next-page');

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage--;
        loadInventoryData();
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (currentPage < totalPages) {
        currentPage++;
        loadInventoryData();
      }
    });
  }
}

let activePrintingFlyout = null; // Track active flyout

function setupQuickSearch() {
  const searchInput = document.getElementById('inventory-quick-search');
  const resultsContainer = document.getElementById('inventory-quick-results');

  if (!searchInput || !resultsContainer) return;

  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();

    if (quickSearchTimeout) clearTimeout(quickSearchTimeout);

    if (query.length < 2) {
      resultsContainer.classList.add('hidden');
      resultsContainer.innerHTML = '';
      closePrintingFlyout();
      return;
    }

    quickSearchTimeout = setTimeout(async () => {
      try {
        // Use the general card search - it groups by unique card names
        const result = await api.searchCards(query, 15);
        // Deduplicate by card name (in case API returns multiple printings)
        const uniqueCards = deduplicateCardsByName(result.cards);
        renderQuickSearchResults(uniqueCards);
      } catch (error) {
        console.error('Quick search failed:', error);
      }
    }, 200);
  });

  // Hide results when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.inventory-quick-add') && !e.target.closest('.printing-flyout')) {
      resultsContainer.classList.add('hidden');
      closePrintingFlyout();
    }
  });

  // Show results when focusing input with existing results
  searchInput.addEventListener('focus', () => {
    if (resultsContainer.innerHTML.trim()) {
      resultsContainer.classList.remove('hidden');
    }
  });
}

function deduplicateCardsByName(cards) {
  const seen = new Map();
  for (const card of cards) {
    if (!seen.has(card.name)) {
      seen.set(card.name, card);
    }
  }
  return Array.from(seen.values());
}

function renderQuickSearchResults(cards) {
  const resultsContainer = document.getElementById('inventory-quick-results');
  if (!resultsContainer) return;

  if (!cards || cards.length === 0) {
    resultsContainer.innerHTML = '<div class="quick-result-empty">No cards found</div>';
    resultsContainer.classList.remove('hidden');
    return;
  }

  resultsContainer.innerHTML = cards.map(card => `
    <div class="quick-result-item" data-card-id="${card.id}" data-card-name="${card.name}">
      ${card.image_url ? `
        <img src="${card.large_image_url || card.image_url}"
             class="quick-result-image"
             data-fallback="${card.image_url}"
             alt="${card.name}"
             onerror="this.src=this.dataset.fallback">
      ` : '<div class="quick-result-image-placeholder"></div>'}
      <div class="quick-result-info">
        <span class="quick-result-name">${card.name}</span>
        <span class="quick-result-type">${card.type_line || ''}</span>
      </div>
      <div class="quick-result-mana">${formatMana(card.mana_cost || '')}</div>
      <button class="btn btn-sm btn-secondary show-printings-btn" data-card-id="${card.id}" title="Choose printing">
        <i class="ph ph-caret-right"></i>
      </button>
    </div>
  `).join('');

  resultsContainer.classList.remove('hidden');

  // Add click handlers for showing printings flyout
  resultsContainer.querySelectorAll('.show-printings-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const cardId = parseInt(btn.dataset.cardId);
      const itemEl = btn.closest('.quick-result-item');
      await showPrintingsFlyout(cardId, itemEl);
    });
  });

  // Also show printings on row click
  resultsContainer.querySelectorAll('.quick-result-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      if (e.target.closest('.show-printings-btn')) return;
      const cardId = parseInt(item.dataset.cardId);
      await showPrintingsFlyout(cardId, item);
    });
  });
}

async function showPrintingsFlyout(cardId, anchorEl) {
  // Close existing flyout
  closePrintingFlyout();

  try {
    // Get all printings for this card
    const result = await api.getCardPrintings(cardId);
    const printings = result.printings || [];

    if (printings.length === 0) {
      showToast('No printings found', 'warning');
      return;
    }

    // Create flyout
    const flyout = document.createElement('div');
    flyout.className = 'printing-flyout';
    flyout.innerHTML = `
      <div class="printing-flyout-header">
        <input type="text" class="printing-flyout-search" placeholder="Filter by set..." autocomplete="off">
        <span class="printing-flyout-count">${printings.length} printings</span>
      </div>
      <div class="printing-flyout-list">
        ${printings.map(p => `
          <div class="printing-flyout-item" data-printing-id="${p.id}" data-set-code="${p.set_code.toLowerCase()}" data-set-name="${(p.set_name || '').toLowerCase()}">
            <img src="${p.image_url}" alt="${p.set_code}" onerror="this.style.display='none'">
            <div class="printing-flyout-info">
              <span class="printing-flyout-set">${p.set_code.toUpperCase()}</span>
              <span class="printing-flyout-num">#${p.collector_number || '?'}</span>
              ${p.rarity ? `<span class="printing-flyout-rarity">${p.rarity}</span>` : ''}
            </div>
            <button class="btn btn-sm btn-success printing-add-btn" data-printing-id="${p.id}">
              <i class="ph ph-plus"></i>
            </button>
          </div>
        `).join('')}
      </div>
    `;

    // Position flyout next to the anchor element
    const resultsContainer = document.getElementById('inventory-quick-results');
    const containerRect = resultsContainer.getBoundingClientRect();

    flyout.style.position = 'fixed';
    flyout.style.left = `${containerRect.right + 8}px`;
    flyout.style.top = `${containerRect.top}px`;
    flyout.style.maxHeight = `${Math.min(400, window.innerHeight - containerRect.top - 20)}px`;

    document.body.appendChild(flyout);
    activePrintingFlyout = flyout;

    // Highlight the selected item
    document.querySelectorAll('.quick-result-item').forEach(el => el.classList.remove('active'));
    anchorEl.classList.add('active');

    // Search filter
    const searchInput = flyout.querySelector('.printing-flyout-search');
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      flyout.querySelectorAll('.printing-flyout-item').forEach(item => {
        const setCode = item.dataset.setCode || '';
        const setName = item.dataset.setName || '';
        const matches = !query || setCode.includes(query) || setName.includes(query);
        item.style.display = matches ? 'flex' : 'none';
      });
    });

    // Focus search
    setTimeout(() => searchInput.focus(), 50);

    // Add handlers for adding printings
    flyout.querySelectorAll('.printing-add-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const printingId = parseInt(btn.dataset.printingId);
        await quickAddPrinting(printingId);
      });
    });

    // Click on printing item to add
    flyout.querySelectorAll('.printing-flyout-item').forEach(item => {
      item.addEventListener('click', async (e) => {
        if (e.target.closest('.printing-add-btn')) return;
        const printingId = parseInt(item.dataset.printingId);
        await quickAddPrinting(printingId);
      });
    });

  } catch (error) {
    console.error('Failed to load printings:', error);
    showError('Failed to load printings');
  }
}

function closePrintingFlyout() {
  if (activePrintingFlyout) {
    activePrintingFlyout.remove();
    activePrintingFlyout = null;
  }
  document.querySelectorAll('.quick-result-item').forEach(el => el.classList.remove('active'));
}

async function quickAddPrinting(printingId) {
  try {
    await api.setOwnedPrintingQuantity(printingId, 1);
    showToast('Card added to inventory!', 'success');

    // Refresh inventory data
    await loadInventoryData();

    // Close flyout and clear search
    closePrintingFlyout();
    const searchInput = document.getElementById('inventory-quick-search');
    const resultsContainer = document.getElementById('inventory-quick-results');
    if (searchInput) searchInput.value = '';
    if (resultsContainer) {
      resultsContainer.classList.add('hidden');
      resultsContainer.innerHTML = '';
    }
  } catch (error) {
    showError('Failed to add card: ' + error.message);
  }
}

function setupBulkActions() {
  const selectToggle = document.getElementById('inventory-select-toggle');
  const selectAllBtn = document.getElementById('inventory-select-all');
  const clearSelectionBtn = document.getElementById('inventory-clear-selection');
  const removeSelectedBtn = document.getElementById('inventory-remove-selected');
  const addToDeckBtn = document.getElementById('inventory-add-to-deck');

  if (selectToggle) {
    selectToggle.addEventListener('click', () => {
      selectMode = !selectMode;
      selectToggle.classList.toggle('active', selectMode);
      if (!selectMode) {
        selectedCards.clear();
      }
      updateBulkActionsBar();
      renderInventory();
    });
  }

  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
      if (inventoryData?.cards) {
        inventoryData.cards.forEach(card => selectedCards.add(card.card_id));
        updateBulkActionsBar();
        renderInventory();
      }
    });
  }

  if (clearSelectionBtn) {
    clearSelectionBtn.addEventListener('click', () => {
      selectedCards.clear();
      updateBulkActionsBar();
      renderInventory();
    });
  }

  if (removeSelectedBtn) {
    removeSelectedBtn.addEventListener('click', async () => {
      if (selectedCards.size === 0) return;

      if (!confirm(`Remove ${selectedCards.size} card(s) from inventory?`)) return;

      try {
        showLoading();
        // For each selected card, set all owned printings to 0
        for (const cardId of selectedCards) {
          const card = inventoryData.cards.find(c => c.card_id === cardId);
          if (card && card.printings) {
            for (const printing of card.printings) {
              await api.setOwnedPrintingQuantity(printing.printing_id, 0);
            }
          }
        }
        selectedCards.clear();
        await loadInventoryData();
        hideLoading();
        showToast('Cards removed from inventory', 'success');
      } catch (error) {
        hideLoading();
        showError('Failed to remove cards: ' + error.message);
      }
    });
  }

  if (addToDeckBtn) {
    addToDeckBtn.addEventListener('click', async () => {
      if (selectedCards.size === 0) return;
      await showAddToDeckModal();
    });
  }
}

async function showAddToDeckModal() {
  try {
    const result = await api.getDecks();
    const decks = result.decks;

    if (!decks || decks.length === 0) {
      showToast('Create a deck first', 'warning');
      return;
    }

    // Create a simple deck selection dropdown
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'add-to-deck-modal';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 400px;">
        <span class="modal-close" id="add-to-deck-modal-close">&times;</span>
        <h2 style="margin-bottom: 1rem;">Add ${selectedCards.size} Card(s) to Deck</h2>
        <div class="form-group">
          <label>Select Deck</label>
          <select id="deck-select-for-add" class="filter-select" style="width: 100%;">
            ${decks.map(d => `<option value="${d.id}">${d.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin-top: 1rem;">
          <label>Add to</label>
          <select id="board-select-for-add" class="filter-select" style="width: 100%;">
            <option value="mainboard">Mainboard</option>
            <option value="sideboard">Sideboard</option>
            <option value="maybeboard">Maybeboard</option>
          </select>
        </div>
        <button id="confirm-add-to-deck" class="btn btn-primary" style="width: 100%; margin-top: 1rem;">Add to Deck</button>
      </div>
    `;

    document.body.appendChild(modal);

    // Close handlers
    const closeModal = () => {
      modal.remove();
    };

    document.getElementById('add-to-deck-modal-close').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    // Confirm handler
    document.getElementById('confirm-add-to-deck').addEventListener('click', async () => {
      const deckId = document.getElementById('deck-select-for-add').value;
      const boardType = document.getElementById('board-select-for-add').value;

      try {
        showLoading();
        let added = 0;

        for (const cardId of selectedCards) {
          const card = inventoryData.cards.find(c => c.card_id === cardId);
          if (card && card.printings && card.printings.length > 0) {
            const isSideboard = boardType === 'sideboard';
            await api.addCardToDeck(deckId, card.printings[0].printing_id, 1, isSideboard, false, boardType);
            added++;
          }
        }

        hideLoading();
        closeModal();
        showToast(`Added ${added} card(s) to deck!`, 'success');
        selectedCards.clear();
        updateBulkActionsBar();
        renderInventory();
      } catch (error) {
        hideLoading();
        showError('Failed to add cards: ' + error.message);
      }
    });
  } catch (error) {
    showError('Failed to load decks: ' + error.message);
  }
}

function updateBulkActionsBar() {
  const bulkBar = document.getElementById('inventory-bulk-actions');
  const countSpan = document.getElementById('inventory-selected-count');

  if (!bulkBar) return;

  if (selectMode && selectedCards.size > 0) {
    bulkBar.classList.remove('hidden');
    if (countSpan) {
      countSpan.textContent = `${selectedCards.size} selected`;
    }
  } else {
    bulkBar.classList.add('hidden');
  }
}

function toggleCardSelection(cardId) {
  if (selectedCards.has(cardId)) {
    selectedCards.delete(cardId);
  } else {
    selectedCards.add(cardId);
  }
  updateBulkActionsBar();
}

function setupBulkAddModal() {
  const bulkAddBtn = document.getElementById('inventory-bulk-add-btn');
  const modal = document.getElementById('bulk-add-modal');
  const closeBtn = document.getElementById('bulk-add-modal-close');
  const previewBtn = document.getElementById('bulk-add-preview-btn');
  const submitBtn = document.getElementById('bulk-add-submit-btn');

  if (bulkAddBtn) {
    bulkAddBtn.addEventListener('click', () => {
      modal?.classList.remove('hidden');
      document.getElementById('bulk-add-text').value = '';
      document.getElementById('bulk-add-preview').classList.add('hidden');
      document.getElementById('bulk-add-result').classList.add('hidden');
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      modal?.classList.add('hidden');
    });
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.add('hidden');
      }
    });
  }

  if (previewBtn) {
    previewBtn.addEventListener('click', () => {
      const text = document.getElementById('bulk-add-text').value;
      const items = parseBulkAddText(text);
      renderBulkAddPreview(items);
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener('click', async () => {
      const text = document.getElementById('bulk-add-text').value;
      const items = parseBulkAddText(text);

      if (items.length === 0) {
        showError('No valid cards to add');
        return;
      }

      try {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Adding...';

        const result = await api.bulkAddToInventory(items);

        const resultDiv = document.getElementById('bulk-add-result');
        resultDiv.classList.remove('hidden');
        resultDiv.innerHTML = `
          <div style="color: var(--success);">Added ${result.added} cards to inventory</div>
          ${result.failed > 0 ? `
            <div style="color: var(--danger); margin-top: 0.5rem;">
              Failed: ${result.failed}
              <ul style="margin-top: 0.5rem; padding-left: 1.5rem;">
                ${result.errors.map(e => `<li>${e.cardName}: ${e.error}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
        `;

        showToast(`Added ${result.added} cards!`, 'success');

        // Refresh inventory
        await loadInventoryData();
      } catch (error) {
        showError('Bulk add failed: ' + error.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Add to Inventory';
      }
    });
  }
}

function parseBulkAddText(text) {
  const lines = text.split('\n').filter(line => line.trim());
  const items = [];

  for (const line of lines) {
    // Parse formats like:
    // 4 Lightning Bolt
    // 4x Lightning Bolt
    // 4 Lightning Bolt [M21]
    // Lightning Bolt

    const match = line.match(/^(\d+)?x?\s*(.+?)(?:\s*\[(\w+)\])?$/i);

    if (match) {
      const quantity = match[1] ? parseInt(match[1]) : 1;
      const cardName = match[2].trim();
      const setCode = match[3] || null;

      if (cardName) {
        items.push({ cardName, setCode, quantity });
      }
    }
  }

  return items;
}

function renderBulkAddPreview(items) {
  const previewDiv = document.getElementById('bulk-add-preview');
  const contentDiv = document.getElementById('bulk-add-preview-content');

  if (!previewDiv || !contentDiv) return;

  if (items.length === 0) {
    contentDiv.innerHTML = '<div style="color: var(--text-secondary);">No valid cards found</div>';
  } else {
    contentDiv.innerHTML = items.map(item => `
      <div style="display: flex; justify-content: space-between; padding: 0.25rem 0; border-bottom: 1px solid var(--border);">
        <span>${item.quantity}x ${item.cardName}</span>
        ${item.setCode ? `<span style="color: var(--text-secondary);">[${item.setCode.toUpperCase()}]</span>` : ''}
      </div>
    `).join('');
  }

  previewDiv.classList.remove('hidden');
}

async function loadInventoryData() {
  try {
    showLoading();

    // Load inventory and stats in parallel
    const [inventoryResult, statsResult] = await Promise.all([
      api.getInventory({
        ...filters,
        page: currentPage,
        limit: 50
      }),
      api.getInventoryStats()
    ]);

    inventoryData = inventoryResult;
    totalPages = inventoryResult.pagination.totalPages || 1;

    renderStats(statsResult);
    renderInventory();
    renderPagination();
    updateBulkActionsBar();

    hideLoading();
  } catch (error) {
    hideLoading();
    showError('Failed to load inventory: ' + error.message);
  }
}

function renderStats(stats) {
  const container = document.getElementById('inventory-stats');
  if (!container) return;

  container.innerHTML = `
    <div class="inventory-stat">
      <i class="ph ph-cards"></i>
      <div>
        <div class="stat-value">${stats.uniqueCards.toLocaleString()}</div>
        <div class="stat-label">Unique Cards</div>
      </div>
    </div>
    <div class="inventory-stat">
      <i class="ph ph-stack"></i>
      <div>
        <div class="stat-value">${stats.totalCopies.toLocaleString()}</div>
        <div class="stat-label">Total Copies</div>
      </div>
    </div>
    <div class="inventory-stat">
      <i class="ph ph-folder"></i>
      <div>
        <div class="stat-value">${stats.inDecks.toLocaleString()}</div>
        <div class="stat-label">In Decks</div>
      </div>
    </div>
    <div class="inventory-stat">
      <i class="ph ph-check-circle"></i>
      <div>
        <div class="stat-value">${stats.available.toLocaleString()}</div>
        <div class="stat-label">Available</div>
      </div>
    </div>
    <div class="inventory-stat">
      <i class="ph ph-currency-dollar"></i>
      <div>
        <div class="stat-value">$${stats.estimatedValue.toFixed(2)}</div>
        <div class="stat-label">Est. Value</div>
      </div>
    </div>
  `;
}

function renderInventory() {
  const container = document.getElementById('inventory-grid');
  if (!container) return;

  if (!inventoryData || !inventoryData.cards || inventoryData.cards.length === 0) {
    container.innerHTML = `
      <div class="inventory-empty">
        <i class="ph ph-archive" style="font-size: 4rem; opacity: 0.3;"></i>
        <h3>No cards in inventory</h3>
        <p>Add cards using the Quick Add search or Bulk Add button above.</p>
      </div>
    `;
    return;
  }

  if (viewMode === 'grid') {
    renderGridView(container);
  } else {
    renderListView(container);
  }
}

function renderGridView(container) {
  container.className = 'inventory-grid';

  container.innerHTML = inventoryData.cards.map(card => {
    const isSelected = selectedCards.has(card.card_id);
    const printingCount = card.printings ? card.printings.length : 0;
    const printingImages = card.printings ? card.printings.map(p => p.image_url).filter(Boolean) : [];

    return `
      <div class="inventory-card-item ${isSelected ? 'selected' : ''}" data-card-id="${card.card_id}" data-printing-images='${JSON.stringify(printingImages)}'>
        ${selectMode ? `
          <div class="inventory-card-checkbox ${isSelected ? 'checked' : ''}" data-card-id="${card.card_id}">
            <i class="ph ${isSelected ? 'ph-check-square' : 'ph-square'}"></i>
          </div>
        ` : ''}
        <div class="inventory-card-image">
          ${card.image_url ? `
            <img src="${card.image_url}" alt="${card.name}" loading="lazy" onerror="this.style.display='none'" data-original-src="${card.image_url}" />
          ` : ''}
          <div class="inventory-quantity-badge">${card.total_owned}</div>
          ${printingCount > 1 ? `
            <div class="inventory-printings-badge" title="${printingCount} different printings owned">
              <i class="ph ph-stack"></i> ${printingCount}
            </div>
          ` : ''}
        </div>
        <div class="inventory-card-info">
          <div class="inventory-card-name">${card.name}</div>
          <div class="inventory-card-mana">${formatMana(card.mana_cost || '')}</div>
          <div class="inventory-card-stats">
            <span class="inventory-in-decks" title="In decks">
              <i class="ph ph-folder"></i> ${card.total_in_decks}
            </span>
            <span class="inventory-available ${card.available <= 0 ? 'none-available' : ''}" title="Available">
              <i class="ph ph-check-circle"></i> ${card.available}
            </span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Add click and hover handlers
  container.querySelectorAll('.inventory-card-item').forEach(item => {
    const cardId = parseInt(item.dataset.cardId);
    const printingImages = JSON.parse(item.dataset.printingImages || '[]');

    // Checkbox click
    const checkbox = item.querySelector('.inventory-card-checkbox');
    if (checkbox) {
      checkbox.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCardSelection(cardId);
        // Update UI immediately
        item.classList.toggle('selected', selectedCards.has(cardId));
        checkbox.classList.toggle('checked', selectedCards.has(cardId));
        checkbox.innerHTML = `<i class="ph ${selectedCards.has(cardId) ? 'ph-check-square' : 'ph-square'}"></i>`;
      });
    }

    // Hover image cycling for multi-printing cards
    if (printingImages.length > 1) {
      let cycleInterval = null;
      let currentIndex = 0;
      const img = item.querySelector('.inventory-card-image img');

      item.addEventListener('mouseenter', () => {
        if (!img) return;
        currentIndex = 0;
        cycleInterval = setInterval(() => {
          currentIndex = (currentIndex + 1) % printingImages.length;
          img.src = printingImages[currentIndex];
        }, 1200);
      });

      item.addEventListener('mouseleave', () => {
        if (cycleInterval) {
          clearInterval(cycleInterval);
          cycleInterval = null;
        }
        // Reset to original image
        if (img && img.dataset.originalSrc) {
          img.src = img.dataset.originalSrc;
        }
      });
    }

    // Card click - show details (or toggle selection in select mode if clicking outside checkbox)
    item.addEventListener('click', async (e) => {
      if (e.target.closest('.inventory-card-checkbox')) return;

      if (selectMode) {
        toggleCardSelection(cardId);
        item.classList.toggle('selected', selectedCards.has(cardId));
        const cb = item.querySelector('.inventory-card-checkbox');
        if (cb) {
          cb.classList.toggle('checked', selectedCards.has(cardId));
          cb.innerHTML = `<i class="ph ${selectedCards.has(cardId) ? 'ph-check-square' : 'ph-square'}"></i>`;
        }
      } else {
        await showCardDetail(cardId);
      }
    });
  });
}

function renderListView(container) {
  container.className = 'inventory-list';

  container.innerHTML = `
    <div class="inventory-list-header">
      ${selectMode ? '<span class="list-col-select"></span>' : ''}
      <span class="list-col-name">Name</span>
      <span class="list-col-type">Type</span>
      <span class="list-col-mana">Mana</span>
      <span class="list-col-prints">Prints</span>
      <span class="list-col-owned">Owned</span>
      <span class="list-col-decks">In Decks</span>
      <span class="list-col-available">Available</span>
    </div>
    ${inventoryData.cards.map(card => {
      const isSelected = selectedCards.has(card.card_id);
      const printingCount = card.printings ? card.printings.length : 0;
      return `
        <div class="inventory-list-item ${isSelected ? 'selected' : ''}" data-card-id="${card.card_id}">
          ${selectMode ? `
            <span class="list-col-select">
              <div class="inventory-list-checkbox ${isSelected ? 'checked' : ''}" data-card-id="${card.card_id}">
                <i class="ph ${isSelected ? 'ph-check-square' : 'ph-square'}"></i>
              </div>
            </span>
          ` : ''}
          <span class="list-col-name">${card.name}</span>
          <span class="list-col-type">${card.type_line || ''}</span>
          <span class="list-col-mana">${formatMana(card.mana_cost || '')}</span>
          <span class="list-col-prints">${printingCount > 1 ? `<i class="ph ph-stack"></i> ${printingCount}` : '1'}</span>
          <span class="list-col-owned">${card.total_owned}</span>
          <span class="list-col-decks">${card.total_in_decks}</span>
          <span class="list-col-available ${card.available <= 0 ? 'none-available' : ''}">${card.available}</span>
        </div>
      `;
    }).join('')}
  `;

  // Add click handlers
  container.querySelectorAll('.inventory-list-item').forEach(item => {
    const cardId = parseInt(item.dataset.cardId);

    // Checkbox click
    const checkbox = item.querySelector('.inventory-list-checkbox');
    if (checkbox) {
      checkbox.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCardSelection(cardId);
        item.classList.toggle('selected', selectedCards.has(cardId));
        checkbox.classList.toggle('checked', selectedCards.has(cardId));
        checkbox.innerHTML = `<i class="ph ${selectedCards.has(cardId) ? 'ph-check-square' : 'ph-square'}"></i>`;
      });
    }

    // Row click
    item.addEventListener('click', async (e) => {
      if (e.target.closest('.inventory-list-checkbox')) return;

      if (selectMode) {
        toggleCardSelection(cardId);
        item.classList.toggle('selected', selectedCards.has(cardId));
        const cb = item.querySelector('.inventory-list-checkbox');
        if (cb) {
          cb.classList.toggle('checked', selectedCards.has(cardId));
          cb.innerHTML = `<i class="ph ${selectedCards.has(cardId) ? 'ph-check-square' : 'ph-square'}"></i>`;
        }
      } else {
        await showCardDetail(cardId);
      }
    });
  });
}

function renderPagination() {
  const prevBtn = document.getElementById('inventory-prev-page');
  const nextBtn = document.getElementById('inventory-next-page');
  const pageInfo = document.getElementById('inventory-page-info');

  if (prevBtn) prevBtn.disabled = currentPage <= 1;
  if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
  if (pageInfo) pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
}
