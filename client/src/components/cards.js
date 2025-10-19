import api from '../services/api.js';
import { showLoading, hideLoading, formatMana, formatOracleText, debounce, showModal, hideModal, showToast } from '../utils/ui.js';

let currentPage = 1;
let currentFilters = {
  name: '',
  colors: [],
  type: 'all',
  sort: 'random',
  sets: [],
  cmcMin: null,
  cmcMax: null
};
let allSets = [];

export function setupCards() {
  const searchInput = document.getElementById('cards-browse-search');
  const sortSelect = document.getElementById('filter-sort');
  const typeSelect = document.getElementById('filter-types');
  const setsBtn = document.getElementById('filter-sets-btn');
  const cmcMinInput = document.getElementById('filter-cmc-min');
  const cmcMaxInput = document.getElementById('filter-cmc-max');
  const colorCheckboxes = document.querySelectorAll('#filter-colors input[type="checkbox"]');
  const prevBtn = document.getElementById('prev-page');
  const nextBtn = document.getElementById('next-page');

  // Load sets for modal
  loadSets();

  // Setup set filter modal
  setupSetFilterModal();

  // Debounced search on name input
  const debouncedSearch = debounce(async (query) => {
    currentFilters.name = query;
    currentPage = 1;
    await loadCards();
  }, 300);

  searchInput.addEventListener('input', (e) => {
    debouncedSearch(e.target.value);
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

  // Pagination
  prevBtn.addEventListener('click', async () => {
    if (currentPage > 1) {
      currentPage--;
      await loadCards();
    }
  });

  nextBtn.addEventListener('click', async () => {
    currentPage++;
    await loadCards();
  });

  // Load cards when page is shown
  window.addEventListener('page:cards', () => {
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

async function loadCards() {
  try {
    showLoading();

    const filters = {
      name: currentFilters.name && currentFilters.name.trim() ? currentFilters.name : undefined,
      colors: currentFilters.colors.length > 0 ? currentFilters.colors.join(',') : undefined,
      type: currentFilters.type !== 'all' ? currentFilters.type : undefined,
      sort: currentFilters.sort,
      sets: currentFilters.sets.length > 0 ? currentFilters.sets.join(',') : undefined,
      cmcMin: currentFilters.cmcMin,
      cmcMax: currentFilters.cmcMax,
      page: currentPage,
      limit: 50
    };

    // Remove undefined values
    Object.keys(filters).forEach(key => filters[key] === undefined && delete filters[key]);

    console.log('Frontend sending filters:', currentFilters);
    console.log('API filters after processing:', filters);

    const result = await api.browseCards(filters);
    renderCards(result.cards || []);
    updatePagination(result.page, result.totalPages, result.total);
    hideLoading();
  } catch (error) {
    hideLoading();
    console.error('Failed to load cards:', error);
  }
}

function renderCards(cards) {
  const cardsGrid = document.getElementById('cards-grid');

  if (cards.length === 0) {
    cardsGrid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 2rem; color: var(--text-secondary);">No cards found</div>';
    return;
  }

  cardsGrid.innerHTML = cards.map(card => `
    <div class="card-item" data-card-id="${card.id}" style="position: relative;">
      ${card.image_url ? `
        <img src="${card.large_image_url || card.image_url}"
             alt="${card.name}"
             data-fallback="${card.image_url}"
             class="card-image"
             style="width: 100%; border-radius: 8px; margin-bottom: 0.5rem;">
      ` : ''}
      <button class="quick-add-btn" data-card-id="${card.id}" style="position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,0.8); color: white; border: none; border-radius: 50%; width: 32px; height: 32px; cursor: pointer; font-size: 20px; display: flex; align-items: center; justify-content: center; z-index: 10;">+</button>
      <div class="card-name">${card.name}</div>
      <div class="card-mana">${formatMana(card.mana_cost)}</div>
      <div class="card-type">${card.type_line || ''}</div>
      <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.5rem;">
        Mana Value: ${card.cmc || 0}
      </div>
    </div>
  `).join('');

  // Add error handlers for images
  cardsGrid.querySelectorAll('.card-image').forEach(img => {
    img.addEventListener('error', function() {
      const fallback = this.dataset.fallback;
      if (fallback && this.src !== fallback) {
        this.src = fallback;
      } else {
        this.style.display = 'none';
      }
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
}

function updatePagination(page, totalPages, total) {
  const pageInfo = document.getElementById('page-info');
  const prevBtn = document.getElementById('prev-page');
  const nextBtn = document.getElementById('next-page');

  pageInfo.textContent = `Page ${page} of ${totalPages} (${total} cards)`;

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

export async function showCardDetail(cardId) {
  try {
    showLoading();
    const result = await api.getCard(cardId);
    const card = result.card;
    const firstPrinting = card.printings && card.printings.length > 0 ? card.printings[0] : null;
    hideLoading();

    // Parse type line to extract supertypes, types, and subtypes
    const parseTypeLine = (typeLine) => {
      if (!typeLine) return { full: 'Unknown', types: '', subtypes: '' };

      // Split by — to separate types from subtypes
      const parts = typeLine.split('—').map(p => p.trim());
      const types = parts[0] || '';
      const subtypes = parts[1] || '';

      return { full: typeLine, types, subtypes };
    };

    const typeInfo = parseTypeLine(card.type_line);

    const modalBody = document.getElementById('modal-body');
    modalBody.innerHTML = `
      <div class="card-detail-grid">
        <div id="card-detail-image-container">
          ${firstPrinting && firstPrinting.uuid ? `
            <img src="${firstPrinting.image_url}"
                 alt="${card.name}"
                 id="card-detail-image"
                 style="width: 100%; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.5);">
          ` : ''}
        </div>
        <div>
          <h2 style="margin: 0 0 0.5rem 0;">${card.name}</h2>
          <button id="quick-add-modal-btn" class="btn btn-primary" style="margin-bottom: 1rem;">+ Add to Deck</button>

          <div style="margin: 1rem 0; font-size: 1.1rem;">
            ${formatMana(card.mana_cost)}
          </div>
          ${firstPrinting && (firstPrinting.price_normal || firstPrinting.price_foil) ? `
            <div style="margin-bottom: 1rem; padding: 0.75rem; background: var(--bg-tertiary); border-radius: 6px;">
              <strong>TCGPlayer Price:</strong>
              ${firstPrinting.price_normal ? `<span style="margin-left: 0.5rem;">Normal: $${firstPrinting.price_normal.toFixed(2)}</span>` : ''}
              ${firstPrinting.price_foil ? `<span style="margin-left: 0.5rem;">Foil: $${firstPrinting.price_foil.toFixed(2)}</span>` : ''}
            </div>
          ` : ''}
          ${firstPrinting && (firstPrinting.tcgplayer_url || firstPrinting.cardmarket_url || firstPrinting.cardkingdom_url) ? `
            <div style="margin-bottom: 1rem;">
              <strong>Buy:</strong>
              <div style="margin-top: 0.5rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
                ${firstPrinting.tcgplayer_url ? `
                  <a href="${firstPrinting.tcgplayer_url}" target="_blank" class="btn btn-primary btn-sm" style="text-decoration: none;">
                    TCGPlayer →
                  </a>
                ` : ''}
                ${firstPrinting.cardmarket_url ? `
                  <a href="${firstPrinting.cardmarket_url}" target="_blank" class="btn btn-primary btn-sm" style="text-decoration: none;">
                    Cardmarket →
                  </a>
                ` : ''}
                ${firstPrinting.cardkingdom_url ? `
                  <a href="${firstPrinting.cardkingdom_url}" target="_blank" class="btn btn-primary btn-sm" style="text-decoration: none;">
                    Card Kingdom →
                  </a>
                ` : ''}
              </div>
            </div>
          ` : ''}
          <div style="margin-bottom: 1rem;">
            <strong>Type:</strong> ${typeInfo.types || 'Unknown'}
          </div>
          ${typeInfo.subtypes ? `
            <div style="margin-bottom: 1rem;">
              <strong>Subtype:</strong> ${typeInfo.subtypes}
            </div>
          ` : ''}
          <div style="margin-bottom: 1rem;">
            <strong>Mana Value:</strong> ${card.cmc || 0}
          </div>
          ${card.oracle_text ? `
            <div style="margin-bottom: 1rem; padding: 1rem; background: var(--bg-tertiary); border-radius: 8px;">
              ${formatOracleText(card.oracle_text)}
            </div>
          ` : ''}
          ${card.power && card.toughness ? `
            <div style="margin-bottom: 1rem;">
              <strong>Power/Toughness:</strong> ${card.power}/${card.toughness}
            </div>
          ` : ''}
          ${card.loyalty ? `
            <div style="margin-bottom: 1rem;">
              <strong>Loyalty:</strong> ${card.loyalty}
            </div>
          ` : ''}
          ${card.rulings && card.rulings.length > 0 ? `
            <div style="margin-top: 2rem;">
              <h3>Rulings</h3>
              <div style="margin-top: 1rem; display: grid; gap: 0.75rem;">
                ${card.rulings.map(r => `
                  <div style="padding: 0.75rem; background: var(--bg-tertiary); border-radius: 6px;">
                    <div style="font-size: 0.875rem; color: var(--text-secondary); margin-bottom: 0.5rem;">
                      ${r.date}
                    </div>
                    <div style="line-height: 1.5;">
                      ${r.text}
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
          ${card.printings && card.printings.length > 0 ? `
            <div style="margin-top: 2rem;">
              <h3>Available Printings (${card.printings.length})</h3>
              <div id="printings-list" style="margin-top: 1rem; display: grid; gap: 0.5rem;">
                ${card.printings.slice(0, 10).map(p => `
                  <div class="printing-item" data-image-url="${p.large_image_url || p.image_url}" data-fallback="${p.image_url}" style="padding: 0.75rem; background: var(--bg-tertiary); border-radius: 6px; display: flex; justify-content: space-between; cursor: pointer; transition: background 0.2s;">
                    <div>
                      <strong>${p.set_code.toUpperCase()}</strong> #${p.collector_number || '?'}
                      ${p.rarity ? `<span style="margin-left: 1rem; color: var(--text-secondary);">${p.rarity}</span>` : ''}
                    </div>
                    <div style="color: var(--text-secondary);">
                      ${p.artist || 'Unknown Artist'}
                    </div>
                  </div>
                `).join('')}
                ${card.printings.length > 10 ? `<div style="color: var(--text-secondary); text-align: center;">...and ${card.printings.length - 10} more</div>` : ''}
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    // Add error handler for card detail image
    const detailImg = document.getElementById('card-detail-image');
    if (detailImg) {
      detailImg.addEventListener('error', function() {
        const fallback = this.dataset.fallback;
        if (fallback && this.src !== fallback) {
          this.src = fallback;
        } else {
          const container = document.getElementById('card-detail-image-container');
          container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-secondary);">No image available</div>';
        }
      });
    }

    // Add click handlers for printings
    document.querySelectorAll('.printing-item').forEach(item => {
      item.addEventListener('click', function() {
        const imageUrl = this.dataset.imageUrl;
        const fallback = this.dataset.fallback;
        const img = document.getElementById('card-detail-image');
        if (img && imageUrl) {
          img.src = imageUrl;
          img.dataset.fallback = fallback;
        }
      });

      // Hover effect
      item.addEventListener('mouseenter', function() {
        this.style.background = 'var(--bg-secondary)';
      });
      item.addEventListener('mouseleave', function() {
        this.style.background = 'var(--bg-tertiary)';
      });
    });

    // Quick add from modal
    const quickAddModalBtn = document.getElementById('quick-add-modal-btn');
    if (quickAddModalBtn) {
      quickAddModalBtn.addEventListener('click', async () => {
        await showQuickAddMenuModal(cardId);
      });
    }

    document.getElementById('modal').classList.remove('hidden');
  } catch (error) {
    hideLoading();
    console.error('Failed to load card details:', error);
  }
}

async function showQuickAddMenuModal(cardId) {
  try {
    const result = await api.getDecks();
    const decks = result.decks;

    if (decks.length === 0) {
      showToast('Create a deck first', 'warning');
      return;
    }

    const modalBody = document.getElementById('modal-body');
    const dropdown = document.createElement('div');
    dropdown.id = 'modal-deck-dropdown';
    dropdown.style.cssText = `
      position: absolute;
      top: 60px;
      right: 20px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 0.5rem;
      min-width: 200px;
      max-height: 300px;
      overflow-y: auto;
      z-index: 10001;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;

    dropdown.innerHTML = decks.map(d => `
      <div class="deck-option" data-deck-id="${d.id}" style="padding: 0.5rem; cursor: pointer; border-radius: 4px; transition: background 0.2s;">
        ${d.name}
      </div>
    `).join('');

    document.getElementById('modal-body').appendChild(dropdown);

    dropdown.querySelectorAll('.deck-option').forEach(opt => {
      opt.addEventListener('mouseenter', () => opt.style.background = 'var(--bg-tertiary)');
      opt.addEventListener('mouseleave', () => opt.style.background = 'transparent');
      opt.addEventListener('click', async () => {
        const deckId = opt.dataset.deckId;
        dropdown.remove();
        await quickAddCard(cardId, deckId);
      });
    });

    setTimeout(() => {
      document.addEventListener('click', function closeDropdown(e) {
        if (!dropdown.contains(e.target) && !e.target.closest('#quick-add-modal-btn')) {
          dropdown.remove();
          document.removeEventListener('click', closeDropdown);
        }
      });
    }, 100);
  } catch (error) {
    showToast('Failed to load decks', 'error');
  }
}
