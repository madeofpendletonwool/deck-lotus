import api from '../services/api.js';
import { showLoading, hideLoading, formatMana, showToast, showError } from '../utils/ui.js';

let selectedDeckIds = new Set();
let shoppingData = null;
let allDecks = [];
let filters = {
  priceMin: null,
  priceMax: null,
  rarity: null,
  colors: null,
  setSearch: '',
  sortBy: 'setName', // setName, price, releaseDate
  budgetMode: false,
  compactView: false, // Toggle between full and compact view
};
let sessionState = {
  found: new Set(), // card IDs marked as found
  skipped: new Set(), // card IDs skipped for now
};

export function setupShopping() {
  window.addEventListener('page:shopping', loadShoppingData);

  document.getElementById('shopping-optimize-btn')?.addEventListener('click', runShoppingOptimizer);
}

async function runShoppingOptimizer() {
  if (!shoppingData?.sets?.length) {
    showToast('Load your shopping list first', 'warning');
    return;
  }

  // Gather all needed cards (not marked found/skipped)
  const items = [];
  for (const set of shoppingData.sets) {
    for (const card of set.cards) {
      const key = `${card.printingId}`;
      if (sessionState.found.has(key) || sessionState.skipped.has(key)) continue;
      const existing = items.find(i => i.name === card.name);
      if (existing) {
        existing.quantity += card.quantity ?? 1;
      } else {
        items.push({ name: card.name, quantity: card.quantity ?? 1 });
      }
    }
  }

  if (!items.length) {
    showToast('No cards to optimize', 'warning');
    return;
  }

  const model = document.getElementById('shopping-optimizer-strategy')?.value || 'lowest_price';
  const btn = document.getElementById('shopping-optimize-btn');
  const resultsEl = document.getElementById('shopping-optimizer-results');
  btn.disabled = true;
  btn.innerHTML = '<i class="ph ph-spinner"></i> Optimizing…';
  resultsEl.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-secondary);">Finding best deals across Mana Pool sellers…</div>';

  try {
    const result = await api.manaPoolOptimize(items, model);
    renderShoppingOptimizerResults(result, resultsEl);
  } catch (err) {
    resultsEl.innerHTML = `<div style="color:#f87171;padding:1rem;border-radius:6px;background:rgba(248,113,113,0.1);">
      <i class="ph ph-warning"></i> ${err.message}
      ${!err.message.includes('token') ? '' : '<br><small>Set MANAPOOL_API_TOKEN in your server .env to use the optimizer.</small>'}
    </div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ph ph-magic-wand"></i> Optimize Cart';
  }
}

function renderShoppingOptimizerResults(result, el) {
  // API response: { cart: [{ inventory_id, quantity_selected }], totals: { subtotal_cents, shipping_cents, buyer_fee_cents, total_cents, seller_count } }
  const totals = result.totals;
  const cart = result.cart ?? [];

  if (!totals && !cart.length) {
    el.innerHTML = '<div style="color:var(--text-secondary);padding:1rem;">No results returned from Mana Pool optimizer.</div>';
    return;
  }

  const fmt = cents => `$${(cents / 100).toFixed(2)}`;
  const sellerCount = totals?.seller_count ?? '?';
  const totalCents = totals?.total_cents ?? 0;

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
      <span style="font-size:1rem;font-weight:700;color:#16a34a;">
        <i class="ph ph-check-circle"></i> ${fmt(totalCents)} total across ${sellerCount} seller${sellerCount !== 1 ? 's' : ''}
      </span>
      <a href="https://manapool.com/cart" target="_blank" rel="noopener" class="btn btn-primary btn-sm">
        Complete on Mana Pool <i class="ph ph-arrow-square-out"></i>
      </a>
    </div>
    ${totals ? `
      <div style="background:var(--bg-tertiary);border-radius:8px;padding:0.75rem;margin-bottom:0.75rem;">
        <div style="display:flex;justify-content:space-between;padding:0.2rem 0;font-size:0.85rem;">
          <span>Subtotal</span><span>${fmt(totals.subtotal_cents ?? 0)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:0.2rem 0;font-size:0.85rem;">
          <span>Shipping</span><span>${fmt(totals.shipping_cents ?? 0)}</span>
        </div>
        ${totals.buyer_fee_cents ? `
        <div style="display:flex;justify-content:space-between;padding:0.2rem 0;font-size:0.85rem;">
          <span>Buyer fee</span><span>${fmt(totals.buyer_fee_cents)}</span>
        </div>` : ''}
        <div style="display:flex;justify-content:space-between;padding:0.3rem 0 0;font-size:0.95rem;font-weight:700;border-top:1px solid var(--border-color);margin-top:0.25rem;">
          <span>Total</span><span style="color:var(--primary);">${fmt(totalCents)}</span>
        </div>
      </div>
    ` : ''}
    <div style="font-size:0.8rem;color:var(--text-secondary);text-align:center;">
      ${cart.length} item${cart.length !== 1 ? 's' : ''} selected — click "Complete on Mana Pool" to review and checkout.
    </div>
  `;
}

async function loadShoppingData() {
  try {
    showLoading();

    // Get user's decks first
    const decksResult = await api.getDecks();
    allDecks = decksResult.decks;

    // Select all decks by default
    selectedDeckIds = new Set(allDecks.map(d => d.id));

    // Get shopping data
    const result = await api.getShoppingList(Array.from(selectedDeckIds));
    shoppingData = result;

    renderDeckSelector();
    renderFilters();
    renderShoppingList();
    hideLoading();
  } catch (error) {
    hideLoading();
    showError('Failed to load shopping data: ' + error.message);
  }
}

function renderDeckSelector() {
  const container = document.getElementById('shopping-deck-selector');

  if (allDecks.length === 0) {
    container.innerHTML = '<p style="color: var(--text-secondary);">No decks found</p>';
    return;
  }

  container.innerHTML = `
    <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap;">
      <button id="select-all-decks" class="btn btn-secondary btn-sm">Select All</button>
      <button id="deselect-all-decks" class="btn btn-secondary btn-sm">Deselect All</button>
    </div>
    <div class="deck-selector-grid">
      ${allDecks.map(deck => `
        <label class="deck-selector-item">
          <input
            type="checkbox"
            value="${deck.id}"
            ${selectedDeckIds.has(deck.id) ? 'checked' : ''}
            class="deck-checkbox"
          />
          <span class="deck-selector-name">${deck.name}</span>
          ${deck.format ? `<span class="deck-selector-format">${deck.format}</span>` : ''}
        </label>
      `).join('')}
    </div>
  `;

  // Add event listeners
  document.getElementById('select-all-decks').addEventListener('click', () => {
    selectedDeckIds = new Set(allDecks.map(d => d.id));
    document.querySelectorAll('.deck-checkbox').forEach(cb => cb.checked = true);
    refreshShoppingData();
  });

  document.getElementById('deselect-all-decks').addEventListener('click', () => {
    selectedDeckIds.clear();
    document.querySelectorAll('.deck-checkbox').forEach(cb => cb.checked = false);
    refreshShoppingData();
  });

  document.querySelectorAll('.deck-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const deckId = parseInt(e.target.value);
      if (e.target.checked) {
        selectedDeckIds.add(deckId);
      } else {
        selectedDeckIds.delete(deckId);
      }
      refreshShoppingData();
    });
  });
}

function renderFilters() {
  const filtersContainer = document.getElementById('shopping-filters');
  if (!filtersContainer) return;

  filtersContainer.innerHTML = `
    <div class="shopping-filters-grid">
      <!-- Price Filters -->
      <div class="filter-group">
        <label>Price Range</label>
        <div style="display: flex; gap: 0.5rem; align-items: center;">
          <input
            type="number"
            id="price-min"
            placeholder="Min $"
            min="0"
            step="0.01"
            value="${filters.priceMin || ''}"
            class="filter-input"
            style="width: 80px;"
          />
          <span>to</span>
          <input
            type="number"
            id="price-max"
            placeholder="Max $"
            min="0"
            step="0.01"
            value="${filters.priceMax || ''}"
            class="filter-input"
            style="width: 80px;"
          />
          <label class="checkbox-label">
            <input type="checkbox" id="budget-mode" ${filters.budgetMode ? 'checked' : ''} />
            Budget Mode
          </label>
        </div>
      </div>

      <!-- Rarity Filter -->
      <div class="filter-group">
        <label>Rarity</label>
        <select id="rarity-filter" class="filter-select">
          <option value="">All Rarities</option>
          <option value="common" ${filters.rarity === 'common' ? 'selected' : ''}>Common</option>
          <option value="uncommon" ${filters.rarity === 'uncommon' ? 'selected' : ''}>Uncommon</option>
          <option value="rare" ${filters.rarity === 'rare' ? 'selected' : ''}>Rare</option>
          <option value="mythic" ${filters.rarity === 'mythic' ? 'selected' : ''}>Mythic</option>
        </select>
      </div>

      <!-- Color Filter -->
      <div class="filter-group">
        <label>Color Identity</label>
        <select id="color-filter" class="filter-select">
          <option value="">All Colors</option>
          <option value="W" ${filters.colors === 'W' ? 'selected' : ''}>White</option>
          <option value="U" ${filters.colors === 'U' ? 'selected' : ''}>Blue</option>
          <option value="B" ${filters.colors === 'B' ? 'selected' : ''}>Black</option>
          <option value="R" ${filters.colors === 'R' ? 'selected' : ''}>Red</option>
          <option value="G" ${filters.colors === 'G' ? 'selected' : ''}>Green</option>
          <option value="C" ${filters.colors === 'C' ? 'selected' : ''}>Colorless</option>
        </select>
      </div>

      <!-- Sort By -->
      <div class="filter-group">
        <label>Sort Sets By</label>
        <select id="sort-by" class="filter-select">
          <option value="setName" ${filters.sortBy === 'setName' ? 'selected' : ''}>Set Name</option>
          <option value="totalPrice" ${filters.sortBy === 'totalPrice' ? 'selected' : ''}>Total Value (High to Low)</option>
          <option value="releaseDate" ${filters.sortBy === 'releaseDate' ? 'selected' : ''}>Release Date (Newest First)</option>
          <option value="cardCount" ${filters.sortBy === 'cardCount' ? 'selected' : ''}>Card Count</option>
        </select>
      </div>

      <!-- Set Search -->
      <div class="filter-group">
        <label>Search Sets</label>
        <input
          type="text"
          id="set-search"
          placeholder="Filter by set name..."
          value="${filters.setSearch}"
          class="filter-input"
        />
      </div>

      <!-- Action Buttons -->
      <div class="filter-group" style="display: flex; gap: 0.5rem; align-items: flex-end;">
        <label class="checkbox-label">
          <input type="checkbox" id="compact-view" ${filters.compactView ? 'checked' : ''} />
          Compact View
        </label>
        <button id="clear-filters-btn" class="btn btn-secondary btn-sm">Clear Filters</button>
        <button id="export-list-btn" class="btn btn-primary btn-sm">
          <i class="ph ph-export"></i> Export
        </button>
      </div>
    </div>
  `;

  // Add event listeners for filters
  document.getElementById('price-min').addEventListener('input', (e) => {
    filters.priceMin = e.target.value ? parseFloat(e.target.value) : null;
    renderShoppingList();
  });

  document.getElementById('price-max').addEventListener('input', (e) => {
    filters.priceMax = e.target.value ? parseFloat(e.target.value) : null;
    renderShoppingList();
  });

  document.getElementById('budget-mode').addEventListener('change', (e) => {
    filters.budgetMode = e.target.checked;
    renderShoppingList();
  });

  document.getElementById('rarity-filter').addEventListener('change', (e) => {
    filters.rarity = e.target.value || null;
    renderShoppingList();
  });

  document.getElementById('color-filter').addEventListener('change', (e) => {
    filters.colors = e.target.value || null;
    renderShoppingList();
  });

  document.getElementById('sort-by').addEventListener('change', (e) => {
    filters.sortBy = e.target.value;
    renderShoppingList();
  });

  document.getElementById('set-search').addEventListener('input', (e) => {
    filters.setSearch = e.target.value.toLowerCase();
    renderShoppingList();
  });

  document.getElementById('compact-view').addEventListener('change', (e) => {
    filters.compactView = e.target.checked;
    renderShoppingList();
  });

  document.getElementById('clear-filters-btn').addEventListener('click', () => {
    filters = {
      priceMin: null,
      priceMax: null,
      rarity: null,
      colors: null,
      setSearch: '',
      sortBy: 'setName',
      budgetMode: false,
      compactView: filters.compactView, // Preserve compact view setting
    };
    renderFilters();
    renderShoppingList();
  });

  document.getElementById('export-list-btn').addEventListener('click', exportShoppingList);
}

async function refreshShoppingData() {
  if (selectedDeckIds.size === 0) {
    shoppingData = { sets: [], totalCards: 0, totalDecks: 0, totalPrice: 0 };
    renderShoppingList();
    return;
  }

  try {
    showLoading();
    const result = await api.getShoppingList(Array.from(selectedDeckIds));
    shoppingData = result;
    renderShoppingList();
    hideLoading();
  } catch (error) {
    hideLoading();
    showError('Failed to refresh shopping data: ' + error.message);
  }
}

function applyFiltersToData(data) {
  if (!data || !data.sets) return data;

  let filteredSets = data.sets.map(set => {
    // Filter cards within each set
    let filteredCards = set.cards.filter(card => {
      // Skip found/skipped cards
      const cardKey = `${card.printingId}`;
      if (sessionState.found.has(cardKey) || sessionState.skipped.has(cardKey)) {
        return false;
      }

      // Price filter
      if (filters.priceMin !== null && card.price < filters.priceMin) return false;
      if (filters.priceMax !== null && card.price > filters.priceMax) return false;

      // Rarity filter
      if (filters.rarity && card.rarity && card.rarity.toLowerCase() !== filters.rarity) return false;

      // Color filter
      if (filters.colors && card.colorIdentity && !card.colorIdentity.includes(filters.colors)) return false;

      return true;
    });

    // Budget mode: sort cards by price (cheapest first)
    if (filters.budgetMode) {
      filteredCards = filteredCards.sort((a, b) => (a.price || 999) - (b.price || 999));
    }

    return {
      ...set,
      cards: filteredCards,
      totalPrice: filteredCards.reduce((sum, card) => sum + (card.price || 0), 0),
      cardCount: filteredCards.length,
    };
  });

  // Filter out sets with no cards
  filteredSets = filteredSets.filter(set => set.cards.length > 0);

  // Apply set search filter
  if (filters.setSearch) {
    filteredSets = filteredSets.filter(set =>
      set.setName.toLowerCase().includes(filters.setSearch)
    );
  }

  // Sort sets
  filteredSets.sort((a, b) => {
    switch (filters.sortBy) {
      case 'totalPrice':
        return (b.totalPrice || 0) - (a.totalPrice || 0);
      case 'releaseDate':
        return (b.releaseDate || '').localeCompare(a.releaseDate || '');
      case 'cardCount':
        return b.cardCount - a.cardCount;
      case 'setName':
      default:
        return a.setName.localeCompare(b.setName);
    }
  });

  return {
    ...data,
    sets: filteredSets,
    totalCards: filteredSets.reduce((sum, set) => sum + set.cards.length, 0),
    totalPrice: filteredSets.reduce((sum, set) => sum + (set.totalPrice || 0), 0),
  };
}

function renderShoppingList() {
  const container = document.getElementById('shopping-list-container');
  const stats = document.getElementById('shopping-stats');

  if (!shoppingData || selectedDeckIds.size === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 3rem; color: var(--text-secondary);">
        <i class="ph ph-shopping-cart" style="font-size: 4rem; opacity: 0.3;"></i>
        <h3>Select decks to shop for</h3>
        <p>Choose one or more decks above to see what cards you need.</p>
      </div>
    `;
    stats.innerHTML = '';
    return;
  }

  // Apply filters
  const filteredData = applyFiltersToData(shoppingData);

  if (filteredData.sets.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 3rem; color: var(--text-secondary);">
        <i class="ph ph-check-circle" style="font-size: 4rem; opacity: 0.3;"></i>
        <h3>No cards match your filters!</h3>
        <p>Try adjusting your filters or you might own everything already.</p>
      </div>
    `;
    stats.innerHTML = '';
    return;
  }

  // Render statistics
  stats.innerHTML = `
    <div class="shopping-stat">
      <i class="ph ph-cards"></i>
      <div>
        <div class="stat-value">${filteredData.totalCards}</div>
        <div class="stat-label">Cards Needed</div>
      </div>
    </div>
    <div class="shopping-stat">
      <i class="ph ph-stack"></i>
      <div>
        <div class="stat-value">${filteredData.sets.length}</div>
        <div class="stat-label">Sets</div>
      </div>
    </div>
    <div class="shopping-stat">
      <i class="ph ph-currency-dollar"></i>
      <div>
        <div class="stat-value">$${(filteredData.totalPrice || 0).toFixed(2)}</div>
        <div class="stat-label">Total Est. Cost</div>
      </div>
    </div>
    <div class="shopping-stat">
      <i class="ph ph-folder"></i>
      <div>
        <div class="stat-value">${selectedDeckIds.size}</div>
        <div class="stat-label">Decks Selected</div>
      </div>
    </div>
  `;

  // Show optimizer section when there are cards to buy
  const optimizerSection = document.getElementById('shopping-optimizer-section');
  if (optimizerSection) {
    optimizerSection.style.display = filteredData.totalCards > 0 ? '' : 'none';
    document.getElementById('shopping-optimizer-results').innerHTML = '';
  }

  // Render expand/collapse all buttons + sets
  container.innerHTML = `
    <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap;">
      <button id="expand-all-sets" class="btn btn-secondary btn-sm">
        <i class="ph ph-caret-down"></i> Expand All
      </button>
      <button id="collapse-all-sets" class="btn btn-secondary btn-sm">
        <i class="ph ph-caret-up"></i> Collapse All
      </button>
    </div>
    ${filteredData.sets.map(set => `
      <div class="shopping-set-card">
        <div class="shopping-set-header" data-set-code="${set.setCode}">
          <div class="shopping-set-info">
            <h3>${set.setName} (${set.setCode.toUpperCase()})</h3>
            <span class="shopping-set-count">
              ${set.cards.length} card${set.cards.length !== 1 ? 's' : ''}
              ${set.totalPrice ? ` • $${set.totalPrice.toFixed(2)}` : ''}
            </span>
          </div>
          <i class="ph ph-caret-down shopping-set-toggle"></i>
        </div>
        <div class="shopping-set-content collapsed" id="set-${set.setCode}">
          ${renderSetCards(set.cards)}
        </div>
      </div>
    `).join('')}
  `;

  // Add expand/collapse all functionality
  document.getElementById('expand-all-sets').addEventListener('click', () => {
    document.querySelectorAll('.shopping-set-content').forEach(content => {
      content.classList.remove('collapsed');
    });
    document.querySelectorAll('.shopping-set-toggle').forEach(toggle => {
      toggle.classList.add('rotated');
    });
  });

  document.getElementById('collapse-all-sets').addEventListener('click', () => {
    document.querySelectorAll('.shopping-set-content').forEach(content => {
      content.classList.add('collapsed');
    });
    document.querySelectorAll('.shopping-set-toggle').forEach(toggle => {
      toggle.classList.remove('rotated');
    });
  });

  // Add toggle functionality for individual sets
  document.querySelectorAll('.shopping-set-header').forEach(header => {
    header.addEventListener('click', () => {
      const setCode = header.dataset.setCode;
      const content = document.getElementById(`set-${setCode}`);
      const toggle = header.querySelector('.shopping-set-toggle');

      content.classList.toggle('collapsed');
      toggle.classList.toggle('rotated');
    });
  });
}

function renderSetCards(cards) {
  if (filters.compactView) {
    // Compact view - just a simple list
    return `
      <div class="shopping-cards-compact">
        ${cards.map(card => {
          const deckDetails = card.decks.map(d => {
            const boardIcon = d.boardType === 'sideboard' ? '📋' : d.boardType === 'maybeboard' ? '🤔' : '📚';
            return `${d.deckName} (${boardIcon} ${d.boardType})`;
          }).join(', ');
          const totalQuantity = card.decks.reduce((sum, d) => sum + d.quantity, 0);
          const isHighPriority = card.decks.length >= 3;
          const cardKey = `${card.printingId}`;

          return `
            <div class="shopping-card-compact ${isHighPriority ? 'high-priority' : ''}" data-card-key="${cardKey}">
              <div class="compact-card-main">
                <span class="compact-card-qty">${totalQuantity}x</span>
                <span class="compact-card-name">${card.name}</span>
                <span class="compact-card-number">#${card.collectorNumber || '?'}</span>
                ${card.price ? `<span class="compact-card-price">$${card.price.toFixed(2)}</span>` : ''}
                ${isHighPriority ? `<span class="compact-priority-badge" title="Format staple!"><i class="ph ph-star-fill"></i></span>` : ''}
              </div>
              <div class="compact-card-details">
                <span class="compact-card-decks">${deckDetails}</span>
                <div class="compact-card-actions">
                  <button class="btn-icon found-btn" data-card-key="${cardKey}" data-card-id="${card.cardId}" title="Found it!">
                    <i class="ph ph-check"></i>
                  </button>
                  <button class="btn-icon skip-btn" data-card-key="${cardKey}" title="Skip">
                    <i class="ph ph-x"></i>
                  </button>
                  <a href="https://manapool.com/search?q=${encodeURIComponent(card.name)}" target="_blank" rel="noopener" class="btn-icon" title="Buy on Mana Pool" style="text-decoration:none;color:inherit;">
                    <i class="ph ph-shopping-cart-simple"></i>
                  </a>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // Full view with images
  return `
    <div class="shopping-cards-list">
      ${cards.map(card => {
        const deckDetails = card.decks.map(d => {
          const boardIcon = d.boardType === 'sideboard' ? '📋' : d.boardType === 'maybeboard' ? '🤔' : '📚';
          const boardLabel = d.boardType.charAt(0).toUpperCase() + d.boardType.slice(1);
          return `<div style="margin-top: 0.25rem;">
            ${boardIcon} <strong>${d.deckName}</strong>: ${boardLabel} (${d.quantity}x)
          </div>`;
        }).join('');
        const totalQuantity = card.decks.reduce((sum, d) => sum + d.quantity, 0);
        const isMultiDeck = card.decks.length > 1;
        const isHighPriority = card.decks.length >= 3; // Format staple
        const cardKey = `${card.printingId}`;

        return `
          <div class="shopping-card-item ${isHighPriority ? 'high-priority' : ''}" data-card-key="${cardKey}">
            <div class="shopping-card-image">
              ${card.imageUrl ? `
                <img
                  src="${card.imageUrl}"
                  alt="${card.name}"
                  loading="lazy"
                  onerror="this.style.display='none'"
                />
              ` : ''}
            </div>
            <div class="shopping-card-info">
              <div class="shopping-card-name-row">
                <span class="shopping-card-name">${card.name}</span>
                ${isMultiDeck ? `
                  <span class="multi-deck-badge ${isHighPriority ? 'high-priority-badge' : ''}"
                        title="${isHighPriority ? 'Format staple! Appears in ' + card.decks.length + ' decks' : 'Appears in ' + card.decks.length + ' decks'}">
                    <i class="ph ph-stack"></i> ${card.decks.length}
                  </span>
                ` : ''}
              </div>
              <div class="shopping-card-mana">${formatMana(card.manaCost || '')}</div>
              <div class="shopping-card-type">${card.typeLine || ''}</div>
              <div class="shopping-card-rarity">
                <span class="rarity-badge rarity-${card.rarity ? card.rarity.toLowerCase() : 'common'}">
                  ${card.rarity || 'Common'}
                </span>
                <span class="collector-number">#${card.collectorNumber || '?'}</span>
                ${card.price ? `<span class="card-price">$${card.price.toFixed(2)}</span>` : ''}
              </div>
              <div class="shopping-card-decks">
                <strong>Needed for:</strong>
                ${deckDetails}
              </div>
              ${totalQuantity > 1 ? `
                <div class="shopping-card-quantity">
                  <strong>Total quantity:</strong> ${totalQuantity}x
                </div>
              ` : ''}
              <div class="shopping-card-actions">
                <button class="btn btn-sm btn-success found-btn" data-card-key="${cardKey}" data-card-id="${card.cardId}">
                  <i class="ph ph-check"></i> Found It!
                </button>
                <button class="btn btn-sm btn-secondary skip-btn" data-card-key="${cardKey}">
                  <i class="ph ph-x"></i> Skip
                </button>
                <a href="https://manapool.com/search?q=${encodeURIComponent(card.name)}" target="_blank" rel="noopener" class="btn btn-sm btn-secondary" title="Buy on Mana Pool" style="text-decoration:none;">
                  <i class="ph ph-shopping-cart-simple"></i> Mana Pool
                </a>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// Export shopping list
function exportShoppingList() {
  if (!shoppingData || shoppingData.sets.length === 0) {
    showToast('No cards to export', 'warning');
    return;
  }

  const filteredData = applyFiltersToData(shoppingData);
  let exportText = `SHOPPING LIST\n`;
  exportText += `Generated: ${new Date().toLocaleString()}\n`;
  exportText += `Total Cards: ${filteredData.totalCards}\n`;
  exportText += `Total Est. Cost: $${(filteredData.totalPrice || 0).toFixed(2)}\n`;
  exportText += `\n${'='.repeat(50)}\n\n`;

  filteredData.sets.forEach(set => {
    exportText += `${set.setName} (${set.setCode.toUpperCase()})\n`;
    exportText += `${set.cards.length} cards • $${(set.totalPrice || 0).toFixed(2)}\n`;
    exportText += `${'-'.repeat(50)}\n`;

    set.cards.forEach(card => {
      const totalQty = card.decks.reduce((sum, d) => sum + d.quantity, 0);
      const deckDetails = card.decks.map(d => `${d.deckName} (${d.boardType}, ${d.quantity}x)`).join(', ');
      const price = card.price ? ` • $${card.price.toFixed(2)}` : '';
      exportText += `${totalQty}x ${card.name} (#${card.collectorNumber})${price}\n`;
      exportText += `   Decks: ${deckDetails}\n`;
    });
    exportText += `\n`;
  });

  // Copy to clipboard
  navigator.clipboard.writeText(exportText).then(() => {
    showToast('Shopping list copied to clipboard!', 'success');
  }).catch(() => {
    showToast('Failed to copy to clipboard', 'error');
  });
}

// Session tracking setup
document.addEventListener('click', async (e) => {
  if (e.target.closest('.found-btn')) {
    const btn = e.target.closest('.found-btn');
    const cardKey = btn.dataset.cardKey;
    const cardId = btn.dataset.cardId;

    // Mark as found in session (hide from list)
    sessionState.found.add(cardKey);

    // Mark card as owned in database
    if (cardId) {
      try {
        await api.addOwnedCard(parseInt(cardId));
        showToast('Card marked as owned!', 'success', 1500);
      } catch (error) {
        console.error('Failed to mark card as owned:', error);
        showToast('Card hidden (ownership not saved)', 'warning', 2000);
      }
    } else {
      showToast('Card marked as found!', 'success', 1500);
    }

    renderShoppingList();
  }

  if (e.target.closest('.skip-btn')) {
    const btn = e.target.closest('.skip-btn');
    const cardKey = btn.dataset.cardKey;
    sessionState.skipped.add(cardKey);
    showToast('Card skipped', 'info', 1500);
    renderShoppingList();
  }
});
