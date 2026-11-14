import api from '../services/api.js';
import { showLoading, hideLoading, formatMana, debounce, showToast } from '../utils/ui.js';
import { showCardDetail } from './cardDetail.js';

export { showCardDetail };

let currentPage = 1;
let currentFilters = {
  name: '',
  colors: [],
  type: 'all',
  rarities: [],
  sort: 'random',
  sets: [],
  subtypes: [],
  cmcMin: null,
  cmcMax: null,
  onlyOwned: false
};
let allSets = [];
let allSubtypes = [];
let filterOptionsLoaded = false;
let browseController = null; // Aborts the in-flight browse when a newer one starts
// Shuffled order stays the same for a visit, so paging never repeats or skips cards.
const shuffleSeed = 10007 + Math.floor(Math.random() * 90000);

export function setupCards() {
  // The card detail modal changes ownership; keep the owned marker on the grid in step.
  window.addEventListener('card-ownership-changed', (e) => updateBrowseGridOwnership(e.detail.cardId, e.detail.owned));

  const searchInput = document.getElementById('cards-browse-search');
  const clearBtn = document.getElementById('cards-browse-clear');
  const sortSelect = document.getElementById('filter-sort');
  const typeSelect = document.getElementById('filter-types');
  const rarityCheckboxes = document.querySelectorAll('#filter-rarity input[type="checkbox"]');
  const setsBtn = document.getElementById('filter-sets-btn');
  const subtypesBtn = document.getElementById('filter-subtypes-btn');
  const cmcMinInput = document.getElementById('filter-cmc-min');
  const cmcMaxInput = document.getElementById('filter-cmc-max');
  const colorCheckboxes = document.querySelectorAll('#filter-colors input[type="checkbox"]');
  const ownedCheckbox = document.getElementById('filter-owned');
  const prevBtn = document.getElementById('prev-page');
  const nextBtn = document.getElementById('next-page');

  // Setup filter modals
  setupSetFilterModal();
  setupSubtypeFilterModal();

  // Debounced search on name input
  const debouncedSearch = debounce(async (query) => {
    currentFilters.name = query;
    currentPage = 1;
    await loadCards();
  }, 150);

  searchInput.addEventListener('input', (e) => {
    debouncedSearch(e.target.value);
    // Show/hide clear button
    if (e.target.value) {
      clearBtn.classList.remove('hidden');
    } else {
      clearBtn.classList.add('hidden');
    }
  });

  // Clear button handler
  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearBtn.classList.add('hidden');
    currentFilters.name = '';
    currentPage = 1;
    loadCards();
  });

  // Sort change
  sortSelect.addEventListener('change', async () => {
    currentFilters.sort = sortSelect.value;
    currentPage = 1;
    await loadCards();
  });

  // Type filter change
  typeSelect.addEventListener('change', async () => {
    currentFilters.type = typeSelect.value;
    currentPage = 1;
    await loadCards();
  });

  // Rarity filter changes
  rarityCheckboxes.forEach(checkbox => {
    checkbox.addEventListener('change', async () => {
      currentFilters.rarities = Array.from(rarityCheckboxes)
        .filter(cb => cb.checked)
        .map(cb => cb.value);
      currentPage = 1;
      await loadCards();
    });
  });

  // CMC filters
  const debouncedCMC = debounce(async () => {
    currentFilters.cmcMin = cmcMinInput.value ? parseInt(cmcMinInput.value) : null;
    currentFilters.cmcMax = cmcMaxInput.value ? parseInt(cmcMaxInput.value) : null;
    currentPage = 1;
    await loadCards();
  }, 500);

  cmcMinInput.addEventListener('input', debouncedCMC);
  cmcMaxInput.addEventListener('input', debouncedCMC);

  // Set filter button - opens modal
  setsBtn.addEventListener('click', () => {
    document.getElementById('set-filter-modal').classList.remove('hidden');
  });

  // Subtype filter button - opens modal
  subtypesBtn.addEventListener('click', () => {
    document.getElementById('subtype-filter-modal').classList.remove('hidden');
  });

  // Color filter changes
  colorCheckboxes.forEach(checkbox => {
    checkbox.addEventListener('change', async () => {
      currentFilters.colors = Array.from(colorCheckboxes)
        .filter(cb => cb.checked)
        .map(cb => cb.value);
      currentPage = 1;
      await loadCards();
    });
  });

  // Owned filter change
  ownedCheckbox.addEventListener('change', async () => {
    currentFilters.onlyOwned = ownedCheckbox.checked;
    currentPage = 1;
    await loadCards();
  });

  // More filters
  const moreFiltersBtn = document.getElementById('browse-more-filters');
  moreFiltersBtn.addEventListener('click', () => {
    const panel = document.getElementById('browse-filters');
    panel.classList.toggle('hidden');
    moreFiltersBtn.setAttribute('aria-expanded', String(!panel.classList.contains('hidden')));
  });

  // Pagination
  prevBtn.addEventListener('click', async () => {
    if (currentPage > 1) {
      currentPage--;
      await loadCards();
      window.scrollTo(0, 0);
    }
  });

  nextBtn.addEventListener('click', async () => {
    currentPage++;
    await loadCards();
    window.scrollTo(0, 0);
  });

  // Load cards when page is shown
  window.addEventListener('page:cards', () => {
    // Fetched here rather than at startup: nothing needs them until this page opens, and at
    // startup the user may not be logged in yet.
    if (!filterOptionsLoaded) {
      filterOptionsLoaded = true;
      loadSets();
      loadSubtypes();
    }
    loadCards();
  });

  // Also check if we're already on the cards page
  if (!document.getElementById('cards-page').classList.contains('hidden')) {
    loadCards();
  }
}

function setupSetFilterModal() {
  const modal = document.getElementById('set-filter-modal');
  const closeBtn = document.getElementById('set-filter-modal-close');
  const applyBtn = document.getElementById('apply-set-filter');
  const clearBtn = document.getElementById('clear-set-selection');
  const searchInput = document.getElementById('set-search-input');

  closeBtn.addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  applyBtn.addEventListener('click', async () => {
    modal.classList.add('hidden');
    currentPage = 1;
    updateSetButtonText();
    await loadCards();
  });

  clearBtn.addEventListener('click', () => {
    currentFilters.sets = [];
    renderSetList(allSets);
    updateSetButtonText();
  });

  // Search sets
  const debouncedSetSearch = debounce((query) => {
    const filtered = allSets.filter(set =>
      set.name.toLowerCase().includes(query.toLowerCase()) ||
      set.code.toLowerCase().includes(query.toLowerCase())
    );
    renderSetList(filtered);
  }, 200);

  searchInput.addEventListener('input', (e) => {
    debouncedSetSearch(e.target.value);
  });

  // Close modal on outside click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.add('hidden');
    }
  });
}

function updateSetButtonText() {
  const btn = document.getElementById('selected-sets-count');
  if (currentFilters.sets.length === 0) {
    btn.textContent = 'All Sets';
  } else if (currentFilters.sets.length === 1) {
    const set = allSets.find(s => s.code === currentFilters.sets[0]);
    btn.textContent = set ? set.code.toUpperCase() : '1 Set';
  } else {
    btn.textContent = `${currentFilters.sets.length} Sets`;
  }
}

async function loadSets() {
  try {
    const result = await api.getSets();
    allSets = result.sets || [];
    renderSetList(allSets);
  } catch (error) {
    console.error('Failed to load sets:', error);
  }
}

function renderSetList(sets) {
  const setList = document.getElementById('set-list');
  if (sets.length === 0) {
    setList.innerHTML = '<div style="padding: 1rem; text-align: center; color: var(--text-secondary);">No sets found</div>';
    return;
  }

  setList.innerHTML = sets.map(set => {
    const isSelected = currentFilters.sets.includes(set.code);
    return `
      <div class="set-item ${isSelected ? 'selected' : ''}" data-set-code="${set.code}">
        <div class="set-checkbox"></div>
        <div class="set-info">
          <div class="set-name">${set.name}</div>
          <div class="set-code">${set.code}</div>
        </div>
      </div>
    `;
  }).join('');

  // Add click handlers
  setList.querySelectorAll('.set-item').forEach(item => {
    item.addEventListener('click', () => {
      const setCode = item.dataset.setCode;
      const index = currentFilters.sets.indexOf(setCode);

      if (index > -1) {
        // Remove from selection
        currentFilters.sets.splice(index, 1);
        item.classList.remove('selected');
      } else {
        // Add to selection
        currentFilters.sets.push(setCode);
        item.classList.add('selected');
      }
    });
  });
}

function setupSubtypeFilterModal() {
  const modal = document.getElementById('subtype-filter-modal');
  const closeBtn = document.getElementById('subtype-filter-modal-close');
  const applyBtn = document.getElementById('apply-subtype-filter');
  const clearBtn = document.getElementById('clear-subtype-selection');
  const searchInput = document.getElementById('subtype-search-input');

  closeBtn.addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  applyBtn.addEventListener('click', async () => {
    modal.classList.add('hidden');
    currentPage = 1;
    updateSubtypeButtonText();
    await loadCards();
  });

  clearBtn.addEventListener('click', () => {
    currentFilters.subtypes = [];
    renderSubtypeList(allSubtypes);
    updateSubtypeButtonText();
  });

  // Search subtypes
  const debouncedSubtypeSearch = debounce((query) => {
    const filtered = allSubtypes.filter(subtype =>
      subtype.toLowerCase().includes(query.toLowerCase())
    );
    renderSubtypeList(filtered);
  }, 200);

  searchInput.addEventListener('input', (e) => {
    debouncedSubtypeSearch(e.target.value);
  });

  // Close modal on outside click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.add('hidden');
    }
  });
}

function updateSubtypeButtonText() {
  const btn = document.getElementById('selected-subtypes-count');
  if (currentFilters.subtypes.length === 0) {
    btn.textContent = 'All Subtypes';
  } else if (currentFilters.subtypes.length === 1) {
    btn.textContent = currentFilters.subtypes[0];
  } else {
    btn.textContent = `${currentFilters.subtypes.length} Subtypes`;
  }
}

async function loadSubtypes() {
  try {
    const result = await api.getSubtypes();
    allSubtypes = result.subtypes || [];
    renderSubtypeList(allSubtypes);
  } catch (error) {
    console.error('Failed to load subtypes:', error);
  }
}

function renderSubtypeList(subtypes) {
  const subtypeList = document.getElementById('subtype-list');
  if (subtypes.length === 0) {
    subtypeList.innerHTML = '<div style="padding: 1rem; text-align: center; color: var(--text-secondary);">No subtypes found</div>';
    return;
  }

  subtypeList.innerHTML = subtypes.map(subtype => {
    const isSelected = currentFilters.subtypes.includes(subtype);
    return `
      <div class="set-item ${isSelected ? 'selected' : ''}" data-subtype="${subtype}">
        <div class="set-checkbox"></div>
        <div class="set-info">
          <div class="set-name">${subtype}</div>
        </div>
      </div>
    `;
  }).join('');

  // Add click handlers
  subtypeList.querySelectorAll('.set-item').forEach(item => {
    item.addEventListener('click', () => {
      const subtype = item.dataset.subtype;
      const index = currentFilters.subtypes.indexOf(subtype);

      if (index > -1) {
        // Remove from selection
        currentFilters.subtypes.splice(index, 1);
        item.classList.remove('selected');
      } else {
        // Add to selection
        currentFilters.subtypes.push(subtype);
        item.classList.add('selected');
      }
    });
  });
}

function updateFilterCount() {
  const count =
    currentFilters.rarities.length +
    currentFilters.sets.length +
    currentFilters.subtypes.length +
    (currentFilters.cmcMin !== null || currentFilters.cmcMax !== null ? 1 : 0) +
    (currentFilters.onlyOwned ? 1 : 0);
  const badge = document.getElementById('browse-filter-count');
  badge.textContent = count;
  badge.classList.toggle('hidden', count === 0);
}

async function loadCards() {
  browseController?.abort();
  const controller = new AbortController();
  browseController = controller;

  const grid = document.getElementById('cards-grid');
  grid.classList.add('is-loading');
  updateFilterCount();

  try {
    const filters = {
      name: currentFilters.name && currentFilters.name.trim() ? currentFilters.name : undefined,
      colors: currentFilters.colors.length > 0 ? currentFilters.colors.join(',') : undefined,
      type: currentFilters.type !== 'all' ? currentFilters.type : undefined,
      rarities: currentFilters.rarities.length > 0 ? currentFilters.rarities.join(',') : undefined,
      sort: currentFilters.sort,
      seed: shuffleSeed,
      sets: currentFilters.sets.length > 0 ? currentFilters.sets.join(',') : undefined,
      subtypes: currentFilters.subtypes.length > 0 ? currentFilters.subtypes.join(',') : undefined,
      cmcMin: currentFilters.cmcMin,
      cmcMax: currentFilters.cmcMax,
      onlyOwned: currentFilters.onlyOwned,
      page: currentPage,
      limit: 60
    };

    // Remove undefined values
    Object.keys(filters).forEach(key => filters[key] === undefined && delete filters[key]);

    const result = await api.browseCards(filters, { signal: controller.signal });
    renderCards(result.cards || []);
    updatePagination(result.page, result.totalPages, result.total);
    grid.classList.remove('is-loading');
  } catch (error) {
    if (error.name === 'AbortError') return;
    grid.classList.remove('is-loading');
    console.error('Failed to load cards:', error);
    grid.innerHTML = `<div class="grid-message"><i class="ph ph-warning-circle"></i><p>Couldn't load cards: ${error.message}</p></div>`;
  }
}

function escapeAttr(text) {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function renderCards(cards) {
  const cardsGrid = document.getElementById('cards-grid');

  if (cards.length === 0) {
    cardsGrid.innerHTML = '<div class="grid-message"><i class="ph ph-magnifying-glass"></i><p>No cards match. Try a shorter name or fewer filters.</p></div>';
    return;
  }

  cardsGrid.innerHTML = cards.map(card => `
    <div class="card-item" data-card-id="${card.id}" draggable="true" title="${escapeAttr(card.name)}">
      ${card.image_url
        ? `<img src="${card.image_url}" alt="${escapeAttr(card.name)}" class="card-image" width="488" height="680" loading="lazy" decoding="async">`
        : `<div class="card-image card-image-missing">${escapeAttr(card.name)}</div>`}
      <button class="ownership-toggle-btn ${card.is_owned ? 'owned' : ''}" data-card-id="${card.id}" aria-label="Toggle in collection">
        <i class="${card.is_owned ? 'ph-fill ph-check-circle' : 'ph ph-circle'}"></i>
      </button>
      <button class="quick-add-btn" data-card-id="${card.id}" aria-label="Add to a deck"><i class="ph ph-plus"></i></button>
    </div>
  `).join('');

  // A card with no working image still needs to show which card it is
  cardsGrid.querySelectorAll('img.card-image').forEach(img => {
    img.addEventListener('error', function() {
      const missing = document.createElement('div');
      missing.className = 'card-image card-image-missing';
      missing.textContent = this.alt;
      this.replaceWith(missing);
    });
  });

  // Add click handlers to show card details
  cardsGrid.querySelectorAll('.card-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      if (e.target.classList.contains('quick-add-btn')) return;
      const cardId = item.dataset.cardId;
      await showCardDetail(cardId);
    });
  });

  // Quick add handlers
  cardsGrid.querySelectorAll('.quick-add-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const cardId = btn.dataset.cardId;
      await showQuickAddMenu(cardId, btn);
    });
  });

  // Ownership toggle handlers
  cardsGrid.querySelectorAll('.ownership-toggle-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const cardId = btn.dataset.cardId;
      await toggleCardOwnership(cardId, btn);
    });
  });

  // Setup drag and drop
  setupBrowseDragAndDrop();
}

async function toggleCardOwnership(cardId, buttonEl) {
  try {
    const result = await api.toggleCardOwnership(cardId);

    // Update button appearance
    if (result.owned) {
      buttonEl.classList.add('owned');
      buttonEl.innerHTML = '<i class="ph-fill ph-check-circle"></i>';
      showToast('Added to collection', 'success', 1500);
    } else {
      buttonEl.classList.remove('owned');
      buttonEl.innerHTML = '<i class="ph ph-circle"></i>';
      showToast('Removed from collection', 'success', 1500);
    }
  } catch (error) {
    showToast('Failed to update collection', 'error');
    console.error('Toggle ownership error:', error);
  }
}

function updatePagination(page, totalPages, total) {
  const pageInfo = document.getElementById('page-info');
  const prevBtn = document.getElementById('prev-page');
  const nextBtn = document.getElementById('next-page');

  pageInfo.textContent = totalPages > 0 ? `Page ${page} of ${totalPages}` : '';
  document.getElementById('browse-count').textContent = `${total.toLocaleString()} ${total === 1 ? 'card' : 'cards'}`;
  document.getElementById('pagination').classList.toggle('hidden', totalPages <= 1);

  prevBtn.disabled = page <= 1;
  nextBtn.disabled = page >= totalPages;
}

async function showQuickAddMenu(cardId, buttonEl) {
  try {
    const result = await api.getDecks();
    const decks = result.decks;

    if (decks.length === 0) {
      showToast('Create a deck first', 'warning');
      return;
    }

    // Create dropdown
    const dropdown = document.createElement('div');
    dropdown.style.cssText = `
      position: absolute;
      top: ${buttonEl.offsetTop + 40}px;
      right: ${buttonEl.offsetParent.offsetWidth - buttonEl.offsetLeft - buttonEl.offsetWidth}px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 0.5rem;
      min-width: 200px;
      max-height: 300px;
      overflow-y: auto;
      z-index: 1000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;

    dropdown.innerHTML = decks.map(d => `
      <div class="deck-option" data-deck-id="${d.id}" style="padding: 0.5rem; cursor: pointer; border-radius: 4px; transition: background 0.2s;">
        ${d.name}
      </div>
    `).join('');

    buttonEl.offsetParent.appendChild(dropdown);

    dropdown.querySelectorAll('.deck-option').forEach(opt => {
      opt.addEventListener('mouseenter', () => opt.style.background = 'var(--bg-tertiary)');
      opt.addEventListener('mouseleave', () => opt.style.background = 'transparent');
      opt.addEventListener('click', async () => {
        const deckId = opt.dataset.deckId;
        dropdown.remove();
        await quickAddCard(cardId, deckId);
      });
    });

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', function closeDropdown(e) {
        if (!dropdown.contains(e.target) && e.target !== buttonEl) {
          dropdown.remove();
          document.removeEventListener('click', closeDropdown);
        }
      });
    }, 100);
  } catch (error) {
    showToast('Failed to load decks', 'error');
  }
}

async function quickAddCard(cardId, deckId) {
  try {
    showLoading();
    const result = await api.getCardPrintings(cardId);
    const printings = result.printings;

    if (printings.length === 0) {
      showToast('No printings found', 'warning');
      hideLoading();
      return;
    }

    await api.addCardToDeck(deckId, printings[0].id, 1, false);
    hideLoading();
    showToast('Added to deck!', 'success', 2000);
  } catch (error) {
    hideLoading();
    showToast('Failed to add card', 'error');
  }
}

/**
 * Update the ownership checkbox on the browse grid
 */
function updateBrowseGridOwnership(cardId, isOwned) {
  const cardItem = document.querySelector(`.card-item[data-card-id="${cardId}"]`);
  if (!cardItem) return; // Card not in current browse view

  const ownershipBtn = cardItem.querySelector('.ownership-toggle-btn');
  if (!ownershipBtn) return;

  if (isOwned) {
    ownershipBtn.classList.add('owned');
    ownershipBtn.innerHTML = '<i class="ph-fill ph-check-circle"></i>';
  } else {
    ownershipBtn.classList.remove('owned');
    ownershipBtn.innerHTML = '<i class="ph ph-circle"></i>';
  }
}

let browseDraggedCardId = null;
let browseDragPopupInitialized = false;

async function setupBrowseDragAndDrop() {
  // Get or create the drag popup
  let dragPopup = document.getElementById('browse-drag-popup');
  if (!dragPopup) {
    dragPopup = document.createElement('div');
    dragPopup.id = 'browse-drag-popup';
    dragPopup.className = 'drag-popup browse-drag-popup hidden';
    dragPopup.innerHTML = `
      <div class="drag-popup-title">Add to deck...</div>
      <div class="drag-popup-decks" id="drag-deck-zones"></div>
    `;
    document.body.appendChild(dragPopup);
  }

  // Setup drag events on card items
  document.querySelectorAll('.card-item[draggable="true"]').forEach(item => {
    item.addEventListener('dragstart', async (e) => {
      // Don't allow drag if clicking the quick-add button
      if (e.target.classList.contains('quick-add-btn')) {
        e.preventDefault();
        return;
      }

      browseDraggedCardId = item.dataset.cardId;

      // Get the actual card image
      const cardImage = item.querySelector('.card-image');
      if (cardImage) {
        const isFirefox = navigator.userAgent.toLowerCase().includes('firefox');

        if (isFirefox) {
          // Firefox: Use canvas
          const canvas = document.createElement('canvas');
          canvas.width = 100;
          canvas.height = 140;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(cardImage, 0, 0, 100, 140);
          e.dataTransfer.setDragImage(canvas, 50, 70);
        } else {
          // Chrome: Use cloned image in DOM
          const dragImage = cardImage.cloneNode(false);
          dragImage.style.position = 'fixed';
          dragImage.style.top = '-500px';
          dragImage.style.left = '0';
          dragImage.style.width = '100px';
          dragImage.style.height = '140px';
          dragImage.style.objectFit = 'cover';
          dragImage.style.border = 'none';
          dragImage.style.borderRadius = '8px';
          dragImage.style.pointerEvents = 'none';
          dragImage.style.zIndex = '-1';
          document.body.appendChild(dragImage);

          e.dataTransfer.setDragImage(dragImage, 50, 70);

          // Clean up after drag ends
          item.addEventListener('dragend', function cleanup() {
            if (dragImage && dragImage.parentNode) {
              document.body.removeChild(dragImage);
            }
            item.removeEventListener('dragend', cleanup);
          }, { once: true });
        }
      }

      // Load decks and show popup
      await loadDecksForDrag();
      dragPopup.classList.remove('hidden');

      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', browseDraggedCardId);
    });

    item.addEventListener('dragend', (e) => {
      dragPopup.classList.add('hidden');

      // Clean up zone states
      document.querySelectorAll('.deck-drag-zone').forEach(zone => {
        zone.classList.remove('drag-over');
      });

      browseDraggedCardId = null;
    });
  });
}

async function loadDecksForDrag() {
  try {
    const result = await api.getDecks();
    const decks = result.decks;

    const deckZonesContainer = document.getElementById('drag-deck-zones');

    if (decks.length === 0) {
      deckZonesContainer.innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--text-secondary);">Create a deck first</div>';
      return;
    }

    deckZonesContainer.innerHTML = decks.map(deck => `
      <div class="deck-drag-container">
        <div class="deck-drag-name">${deck.name}</div>
        <div class="deck-drag-zones-split">
          <div class="deck-drag-zone" data-deck-id="${deck.id}" data-is-sideboard="true">
            <div class="deck-drag-zone-label">Sideboard</div>
          </div>
          <div class="deck-drag-zone" data-deck-id="${deck.id}" data-is-sideboard="false">
            <div class="deck-drag-zone-label">Mainboard</div>
          </div>
        </div>
      </div>
    `).join('');

    // Re-attach handlers for deck zones
    setupDropZones();
  } catch (error) {
    console.error('Failed to load decks for drag:', error);
  }
}

function setupDropZones() {
  document.querySelectorAll('.deck-drag-zone').forEach(zone => {
    // Remove old listeners by cloning
    const newZone = zone.cloneNode(true);
    zone.parentNode.replaceChild(newZone, zone);

    newZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      newZone.classList.add('drag-over');
    });

    newZone.addEventListener('dragleave', (e) => {
      newZone.classList.remove('drag-over');
    });

    newZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      newZone.classList.remove('drag-over');

      const deckId = newZone.dataset.deckId;
      const isSideboard = newZone.dataset.isSideboard === 'true';

      if (browseDraggedCardId) {
        await addCardToDeckFromBrowse(browseDraggedCardId, deckId, isSideboard);
      }
    });
  });
}

async function addCardToDeckFromBrowse(cardId, deckId, isSideboard) {
  try {
    showLoading();
    const result = await api.getCardPrintings(cardId);
    const printings = result.printings;

    if (printings.length === 0) {
      showToast('No printings found', 'warning');
      hideLoading();
      return;
    }

    await api.addCardToDeck(deckId, printings[0].id, 1, isSideboard);
    hideLoading();
    showToast(`Added to ${isSideboard ? 'sideboard' : 'mainboard'}!`, 'success', 2000);
  } catch (error) {
    hideLoading();
    showToast('Failed to add card', 'error');
  }
}
