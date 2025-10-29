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
  cmcMax: null,
  onlyOwned: false
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
  const ownedCheckbox = document.getElementById('filter-owned');
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

  // Owned filter change
  ownedCheckbox.addEventListener('change', async () => {
    currentFilters.onlyOwned = ownedCheckbox.checked;
    currentPage = 1;
    await loadCards();
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
      onlyOwned: currentFilters.onlyOwned,
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
    <div class="card-item" data-card-id="${card.id}" draggable="true" style="position: relative;">
      ${card.image_url ? `
        <img src="${card.large_image_url || card.image_url}"
             alt="${card.name}"
             data-fallback="${card.image_url}"
             class="card-image"
             style="width: 100%; border-radius: 8px; margin-bottom: 0.5rem; pointer-events: none;">
      ` : ''}
      <button class="quick-add-btn" data-card-id="${card.id}" style="position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,0.8); color: white; border: none; border-radius: 50%; width: 32px; height: 32px; cursor: pointer; font-size: 20px; display: flex; align-items: center; justify-content: center; z-index: 10;">+</button>
      <button class="ownership-toggle-btn ${card.is_owned ? 'owned' : ''}" data-card-id="${card.id}" style="position: absolute; top: 8px; left: 8px; background: ${card.is_owned ? 'rgba(16, 185, 129, 0.9)' : 'rgba(0,0,0,0.8)'}; color: white; border: none; border-radius: 50%; width: 32px; height: 32px; cursor: pointer; font-size: 18px; display: flex; align-items: center; justify-content: center; z-index: 10;">
        <i class="ph ${card.is_owned ? 'ph-check-circle' : 'ph-circle'}"></i>
      </button>
      <div class="card-name" style="pointer-events: none;">${card.name}</div>
      <div class="card-mana" style="pointer-events: none;">${formatMana(card.mana_cost)}</div>
      <div class="card-type" style="pointer-events: none;">${card.type_line || ''}</div>
      <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.5rem; pointer-events: none;">
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
      buttonEl.style.background = 'rgba(16, 185, 129, 0.9)';
      buttonEl.innerHTML = '<i class="ph ph-check-circle"></i>';
      showToast('Added to collection', 'success', 1500);
    } else {
      buttonEl.classList.remove('owned');
      buttonEl.style.background = 'rgba(0,0,0,0.8)';
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
          ${card.supertypes ? `
            <div style="margin-bottom: 1rem;">
              <strong>Supertypes:</strong> ${card.supertypes.split(',').join(', ')}
            </div>
          ` : ''}
          <div style="margin-bottom: 1rem;">
            <strong>Type:</strong> ${card.types ? card.types.split(',').join(', ') : (card.type_line || 'Unknown')}
          </div>
          ${card.subtypes ? `
            <div style="margin-bottom: 1rem;">
              <strong>Subtypes:</strong> ${card.subtypes.split(',').join(', ')}
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
          ${card.leadership_skills ? `
            <div style="margin-top: 2rem; padding: 1rem; background: linear-gradient(135deg, rgba(139,92,246,0.1), rgba(59,130,246,0.1)); border-radius: 8px; border: 1px solid rgba(139,92,246,0.3);">
              <h3 style="margin: 0 0 0.75rem 0; color: #a78bfa;">⚔️ Commander Legal</h3>
              <div style="line-height: 1.6;">
                This card can be your commander in: <strong>${JSON.parse(card.leadership_skills).brawl ? 'Commander, Brawl' : 'Commander'}</strong>
                ${JSON.parse(card.leadership_skills).oathbreaker ? ', <strong>Oathbreaker</strong>' : ''}
              </div>
            </div>
          ` : ''}
          ${card.legalities ? `
            <div style="margin-top: 2rem;">
              <h3>Format Legality</h3>
              <div style="margin-top: 1rem; display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 0.5rem;">
                ${(() => {
                  const legalities = JSON.parse(card.legalities);
                  const formatLabels = {
                    standard: 'Standard',
                    pioneer: 'Pioneer',
                    modern: 'Modern',
                    legacy: 'Legacy',
                    vintage: 'Vintage',
                    commander: 'Commander',
                    brawl: 'Brawl',
                    historic: 'Historic',
                    timeless: 'Timeless',
                    pauper: 'Pauper',
                    penny: 'Penny Dreadful',
                    alchemy: 'Alchemy',
                    explorer: 'Explorer',
                    oathbreaker: 'Oathbreaker',
                    standardbrawl: 'Standard Brawl',
                    paupercommander: 'Pauper Commander',
                    duel: 'Duel Commander',
                    oldschool: 'Old School',
                    premodern: 'Premodern',
                    predh: 'Pre-EDH',
                    gladiator: 'Gladiator',
                    future: 'Future'
                  };
                  const statusConfig = {
                    Legal: { icon: '✓', color: '#4ade80' },
                    Banned: { icon: '✗', color: '#f87171' },
                    Restricted: { icon: '⚠', color: '#fbbf24' }
                  };

                  return Object.entries(legalities)
                    .filter(([_, status]) => status && status !== 'null')
                    .map(([format, status]) => {
                      const config = statusConfig[status] || { icon: '⊘', color: '#9ca3af' };
                      const label = formatLabels[format] || format;
                      return `
                        <div style="padding: 0.5rem 0.75rem; background: var(--bg-tertiary); border-radius: 6px; display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem;">
                          <span style="color: ${config.color}; font-weight: bold; font-size: 1rem;">${config.icon}</span>
                          <span>${label}</span>
                        </div>
                      `;
                    }).join('');
                })()}
              </div>
            </div>
          ` : ''}
          ${card.printings && card.printings.length > 0 ? `
            <div style="margin-top: 2rem;">
              <h3>Available Sets</h3>
              <div style="margin-top: 1rem; display: grid; gap: 0.5rem;">
                ${(() => {
                  // Group printings by set to get unique sets
                  const uniqueSets = new Map();
                  card.printings.forEach(p => {
                    if (!uniqueSets.has(p.set_code)) {
                      uniqueSets.set(p.set_code, {
                        code: p.set_code,
                        name: p.set_name || p.set_code.toUpperCase(),
                        count: 1
                      });
                    } else {
                      uniqueSets.get(p.set_code).count++;
                    }
                  });

                  return Array.from(uniqueSets.values())
                    .map(set => `
                      <div style="padding: 0.75rem; background: var(--bg-tertiary); border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                          <span style="font-weight: 600;">${set.name}</span>
                          <span style="margin-left: 0.5rem; color: var(--text-secondary); font-size: 0.875rem;">(${set.code.toUpperCase()})</span>
                        </div>
                        <span style="color: var(--text-secondary); font-size: 0.875rem;">
                          ${set.count} printing${set.count > 1 ? 's' : ''}
                        </span>
                      </div>
                    `).join('');
                })()}
              </div>
            </div>
          ` : ''}
          ${card.relatedCards && card.relatedCards.length > 0 ? `
            <div style="margin-top: 2rem;">
              <h3>Related Cards</h3>
              <div style="margin-top: 1rem; display: grid; gap: 0.5rem;">
                ${card.relatedCards.map(r => `
                  <div style="padding: 0.75rem; background: var(--bg-tertiary); border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: 500;">${r.related_name}</span>
                    <span style="color: var(--text-secondary); font-size: 0.875rem; text-transform: capitalize;">
                      ${r.relation_type === 'reverseRelated' ? 'Referenced by' : r.relation_type}
                    </span>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
          ${card.edhrec_rank || card.edhrec_saltiness || card.first_printing ? `
            <div style="margin-top: 2rem; padding: 1rem; background: var(--bg-tertiary); border-radius: 8px;">
              <h3 style="margin: 0 0 1rem 0;">Card Metadata</h3>
              <div style="display: grid; gap: 0.75rem;">
                ${card.edhrec_rank ? `
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span>EDHRec Rank:</span>
                    <a href="https://edhrec.com/cards/${encodeURIComponent(card.name.toLowerCase().replace(/\s+/g, '-'))}" target="_blank" style="color: #60a5fa; text-decoration: none; font-weight: 500;">
                      #${card.edhrec_rank} →
                    </a>
                  </div>
                ` : ''}
                ${card.edhrec_saltiness ? `
                  <div style="display: flex; justify-content: space-between;">
                    <span>EDHRec Saltiness:</span>
                    <span style="font-weight: 500;">${card.edhrec_saltiness.toFixed(2)}</span>
                  </div>
                ` : ''}
                ${card.first_printing ? `
                  <div style="display: flex; justify-content: space-between;">
                    <span>First Printing:</span>
                    <span style="font-weight: 500;">${card.first_printing}</span>
                  </div>
                ` : ''}
              </div>
            </div>
          ` : ''}
          ${card.foreignData && card.foreignData.length > 0 ? `
            <div style="margin-top: 2rem;">
              <details style="cursor: pointer;">
                <summary style="font-size: 1.1rem; font-weight: 600; padding: 0.5rem; background: var(--bg-tertiary); border-radius: 6px;">
                  🌍 Foreign Printings (${card.foreignData.length} languages)
                </summary>
                <div style="margin-top: 1rem; display: grid; gap: 0.75rem; max-height: 400px; overflow-y: auto;">
                  ${card.foreignData.map(f => `
                    <div style="padding: 1rem; background: var(--bg-tertiary); border-radius: 6px; border-left: 3px solid var(--accent-color);">
                      <div style="font-weight: 600; margin-bottom: 0.5rem; text-transform: uppercase; font-size: 0.875rem; color: var(--text-secondary);">
                        ${f.language}
                      </div>
                      ${f.foreign_name ? `
                        <div style="font-size: 1.1rem; font-weight: 500; margin-bottom: 0.5rem;">
                          ${f.foreign_name}
                        </div>
                      ` : ''}
                      ${f.foreign_type ? `
                        <div style="font-style: italic; color: var(--text-secondary); margin-bottom: 0.5rem;">
                          ${f.foreign_type}
                        </div>
                      ` : ''}
                      ${f.foreign_text ? `
                        <div style="line-height: 1.5; margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid var(--border-color);">
                          ${f.foreign_text}
                        </div>
                      ` : ''}
                      ${f.foreign_flavor_text ? `
                        <div style="font-style: italic; color: var(--text-secondary); margin-top: 0.5rem; font-size: 0.9rem;">
                          "${f.foreign_flavor_text}"
                        </div>
                      ` : ''}
                    </div>
                  `).join('')}
                </div>
              </details>
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
