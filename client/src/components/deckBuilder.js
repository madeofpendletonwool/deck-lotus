import api from '../services/api.js';
import { showLoading, hideLoading, debounce, formatMana, showToast, hideModal } from '../utils/ui.js';
import { showCardDetail } from './cards.js';

let currentDeck = null;
let currentDeckId = null;
let searchTimeout = null;
let currentFilter = { cmc: null, color: null, ownership: null }; // Filter state for deck cards (null, 'owned', 'not-owned')
let exampleHand = []; // Current example hand
let activeTab = 'mainboard'; // Track which tab is currently active ('mainboard' or 'sideboard')
let pricingMode = false; // Track if pricing mode is enabled
let setGroupMode = false; // Track if set grouping mode is enabled
let currentPriceData = null; // Store current price data for cards

// Detect if device is touch-enabled (mobile/tablet)
function isTouchDevice() {
  return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (navigator.msMaxTouchPoints > 0);
}

export function setupDeckBuilder() {
  const cardSearch = document.getElementById('card-search');
  const searchResults = document.getElementById('search-results');
  const saveDeckBtn = document.getElementById('save-deck-btn');
  const backToDecksBtn = document.getElementById('back-to-decks-btn');
  const buyDeckBtn = document.getElementById('buy-deck-btn');
  const deckNameInput = document.getElementById('deck-name');
  const deckFormatSelect = document.getElementById('deck-format');

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
  });

  // Card search with debounce
  const debouncedSearch = debounce(async (query) => {
    if (query.length < 2) {
      searchResults.classList.add('hidden');
      return;
    }

    try {
      const result = await api.searchCards(query);
      displaySearchResults(result.cards);
    } catch (error) {
      console.error('Search error:', error);
    }
  }, 200);

  cardSearch.addEventListener('input', (e) => {
    debouncedSearch(e.target.value);
  });

  // Click outside to close search results
  document.addEventListener('click', (e) => {
    if (!cardSearch.contains(e.target) && !searchResults.contains(e.target)) {
      searchResults.classList.add('hidden');
    }
  });

  // Save deck
  saveDeckBtn.addEventListener('click', async () => {
    if (!currentDeckId) return;

    const name = deckNameInput.value;
    const format = deckFormatSelect.value;

    if (!name) {
      showToast('Please enter a deck name', 'warning');
      return;
    }

    try {
      showLoading();
      await api.updateDeck(currentDeckId, { name, format });
      hideLoading();
      showToast('Deck saved!', 'success');
    } catch (error) {
      hideLoading();
      showToast('Failed to save deck: ' + error.message, 'error');
    }
  });

  // Buy Deck Modal
  buyDeckBtn.addEventListener('click', () => {
    if (!currentDeck || !currentDeck.cards || currentDeck.cards.length === 0) {
      showToast('Add some cards first', 'warning');
      return;
    }
    openBuyDeckModal();
  });

  // Modal close
  document.getElementById('buy-modal-close').addEventListener('click', () => {
    document.getElementById('buy-deck-modal').classList.add('hidden');
  });

  // TCGPlayer button in modal
  document.querySelector('#buy-tcgplayer .btn').addEventListener('click', () => {
    exportToTCGPlayer();
  });

  // Manapool button in modal
  document.querySelector('#buy-manapool .btn').addEventListener('click', () => {
    exportToManapool();
  });

  // Copy decklist button
  document.getElementById('copy-decklist').addEventListener('click', () => {
    const deckText = generateDeckList();
    navigator.clipboard.writeText(deckText).then(() => {
      showToast('Deck list copied to clipboard!', 'success', 2000);
      // Show preview
      document.getElementById('decklist-preview').classList.remove('hidden');
      document.getElementById('decklist-text').value = deckText;
    }).catch(() => {
      showToast('Failed to copy', 'error');
    });
  });

  // Compact view toggle
  document.getElementById('toggle-compact-btn').addEventListener('click', () => {
    compactView = !compactView;
    document.getElementById('toggle-compact-btn').classList.toggle('active', compactView);
    renderDeckCards();
  });

  // Export deck button
  document.getElementById('export-deck-btn').addEventListener('click', () => {
    if (!currentDeck || !currentDeck.cards || currentDeck.cards.length === 0) {
      showToast('Add some cards first', 'warning');
      return;
    }
    document.getElementById('export-deck-modal').classList.remove('hidden');
    document.getElementById('export-preview').classList.add('hidden');
  });

  // Export modal close
  document.getElementById('export-modal-close').addEventListener('click', () => {
    document.getElementById('export-deck-modal').classList.add('hidden');
  });

  // Export format buttons
  document.querySelectorAll('.export-format-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const format = btn.dataset.format;
      const exportText = generateExport(format);
      document.getElementById('export-text').value = exportText;
      document.getElementById('export-preview').classList.remove('hidden');
    });
  });

  // Copy export
  document.getElementById('copy-export').addEventListener('click', () => {
    const exportText = document.getElementById('export-text').value;
    navigator.clipboard.writeText(exportText).then(() => {
      showToast('Deck list copied!', 'success', 2000);
    }).catch(() => {
      showToast('Failed to copy', 'error');
    });
  });

  // Back to decks
  backToDecksBtn.addEventListener('click', () => {
    document.getElementById('deck-builder-page').classList.add('hidden');
    document.getElementById('decks-page').classList.remove('hidden');
    window.dispatchEvent(new CustomEvent('page:decks'));
  });

  // Share deck button
  document.getElementById('share-deck-btn').addEventListener('click', async () => {
    if (!currentDeckId) return;
    await showShareModal();
  });

  // Share modal close
  document.getElementById('share-modal-close').addEventListener('click', () => {
    document.getElementById('share-deck-modal').classList.add('hidden');
  });

  // Copy share link
  document.getElementById('copy-share-link').addEventListener('click', () => {
    const input = document.getElementById('share-link-input');
    input.select();
    navigator.clipboard.writeText(input.value).then(() => {
      showToast('Share link copied to clipboard!', 'success', 2000);
    }).catch(() => {
      showToast('Failed to copy', 'error');
    });
  });

  // Delete share link
  document.getElementById('delete-share-link').addEventListener('click', async () => {
    if (!currentDeckId) return;
    try {
      showLoading();
      await api.deleteDeckShare(currentDeckId);
      document.getElementById('share-deck-modal').classList.add('hidden');
      hideLoading();
      showToast('Share link deleted', 'success');
    } catch (error) {
      hideLoading();
      showToast('Failed to delete share link: ' + error.message, 'error');
    }
  });

  // Check Legality button
  document.getElementById('check-legality-btn').addEventListener('click', () => {
    if (!currentDeck || !currentDeck.cards || currentDeck.cards.length === 0) {
      showToast('Add some cards first', 'warning');
      return;
    }
    showLegalityModal();
  });

  // Legality modal close
  document.getElementById('legality-modal-close').addEventListener('click', () => {
    document.getElementById('legality-check-modal').classList.add('hidden');
  });

  // Listen for open deck event
  window.addEventListener('open-deck', async (e) => {
    const { deckId } = e.detail;
    await loadDeck(deckId);
    showDeckBuilder();
  });

  // Example Hand buttons
  document.getElementById('deal-hand-btn').addEventListener('click', () => {
    dealExampleHand();
  });

  document.getElementById('draw-card-btn').addEventListener('click', () => {
    drawCard();
  });
}

async function showShareModal() {
  try {
    showLoading();
    const result = await api.createDeckShare(currentDeckId);
    const shareUrl = `${window.location.origin}/share/${result.shareToken}`;
    document.getElementById('share-link-input').value = shareUrl;
    document.getElementById('share-deck-modal').classList.remove('hidden');
    hideLoading();
  } catch (error) {
    hideLoading();
    showToast('Failed to create share link: ' + error.message, 'error');
  }
}

function showDeckBuilder() {
  document.querySelectorAll('.page').forEach(page => page.classList.add('hidden'));
  document.getElementById('deck-builder-page').classList.remove('hidden');
}

async function loadDeck(deckId) {
  try {
    showLoading();
    const result = await api.getDeck(deckId);
    currentDeck = result.deck;
    currentDeckId = deckId;

    // Reset to mainboard tab when loading a deck
    activeTab = 'mainboard';
    switchTab('mainboard');

    // Clear previous example hand
    exampleHand = [];

    // Populate deck info
    document.getElementById('deck-name').value = currentDeck.name;
    document.getElementById('deck-format').value = currentDeck.format || '';

    // Render deck cards
    renderDeckCards();

    // Load and render stats
    await loadDeckStats();

    // Auto-deal example hand
    dealExampleHand();

    hideLoading();
  } catch (error) {
    hideLoading();
    showToast('Failed to load deck: ' + error.message, 'error');
  }
}

function displaySearchResults(cards) {
  const searchResults = document.getElementById('search-results');

  if (cards.length === 0) {
    searchResults.innerHTML = '<div style="padding: 1rem; color: var(--text-secondary);">No cards found</div>';
    searchResults.classList.remove('hidden');
    return;
  }

  searchResults.innerHTML = cards.map(card => `
    <div class="search-result-item" data-card-id="${card.id}" style="display: flex; gap: 1rem; align-items: center;">
      ${card.image_url ? `<img src="${card.large_image_url || card.image_url}"
           class="search-result-image"
           data-fallback="${card.image_url}"
           style="width: 50px; height: 70px; border-radius: 4px; object-fit: cover;"
           alt="${card.name}">` : ''}
      <div style="flex: 1;">
        <div class="card-name">${card.name}</div>
        <div class="card-type" style="font-size: 0.875rem; color: var(--text-secondary);">${card.type_line || ''}</div>
      </div>
      <div class="card-mana" style="font-size: 1.2rem;">${formatMana(card.mana_cost)}</div>
    </div>
  `).join('');

  searchResults.classList.remove('hidden');

  // Add error handlers for search result images
  searchResults.querySelectorAll('.search-result-image').forEach(img => {
    img.addEventListener('error', function() {
      const fallback = this.dataset.fallback;
      if (fallback && this.src !== fallback) {
        this.src = fallback;
      } else {
        this.style.display = 'none';
      }
    });
  });

  // Add click handlers
  searchResults.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', async () => {
      const cardId = item.dataset.cardId;
      await addCardToDeck(cardId);
      searchResults.classList.add('hidden');
      document.getElementById('card-search').value = '';
    });
  });
}

async function addCardToDeck(cardId) {
  try {
    // Get card printings
    const result = await api.getCardPrintings(cardId);
    const printings = result.printings;

    if (printings.length === 0) {
      showToast('No printings found for this card', 'warning');
      return;
    }

    // Use first printing by default (could show modal to choose)
    const printingId = printings[0].id;

    // Add card to the currently active tab (mainboard or sideboard)
    const isSideboard = activeTab === 'sideboard';

    showLoading();
    const updatedDeck = await api.addCardToDeck(currentDeckId, printingId, 1, isSideboard);
    currentDeck = updatedDeck.deck;
    renderDeckCards();
    await loadDeckStats();
    hideLoading();
    showToast(`Card added to ${isSideboard ? 'sideboard' : 'mainboard'}`, 'success', 2000);
  } catch (error) {
    hideLoading();
    showToast('Failed to add card: ' + error.message, 'error');
  }
}

let compactView = false;

function renderDeckCards() {
  const mainboard = document.getElementById('mainboard');
  const sideboard = document.getElementById('sideboard');

  let mainboardCards = currentDeck.cards.filter(c => !c.is_sideboard);
  let sideboardCards = currentDeck.cards.filter(c => c.is_sideboard);

  // Apply filters
  const hasFilter = currentFilter.cmc !== null || currentFilter.color !== null || currentFilter.ownership !== null;

  if (currentFilter.cmc !== null) {
    mainboardCards = mainboardCards.filter(c => calculateActualCMC(c) === currentFilter.cmc);
    sideboardCards = sideboardCards.filter(c => calculateActualCMC(c) === currentFilter.cmc);
  }

  if (currentFilter.color !== null) {
    mainboardCards = mainboardCards.filter(c => c.colors === currentFilter.color);
    sideboardCards = sideboardCards.filter(c => c.colors === currentFilter.color);
  }

  if (currentFilter.ownership === 'owned') {
    mainboardCards = mainboardCards.filter(c => c.is_owned);
    sideboardCards = sideboardCards.filter(c => c.is_owned);
  } else if (currentFilter.ownership === 'not-owned') {
    mainboardCards = mainboardCards.filter(c => !c.is_owned);
    sideboardCards = sideboardCards.filter(c => !c.is_owned);
  }

  // Update counts
  const mainboardTotal = mainboardCards.reduce((sum, c) => sum + c.quantity, 0);
  const sideboardTotal = sideboardCards.reduce((sum, c) => sum + c.quantity, 0);

  document.getElementById('mainboard-count').textContent = mainboardTotal;
  document.getElementById('sideboard-count').textContent = sideboardTotal;

  // Add/update clear filter button
  let clearFilterBtn = document.getElementById('clear-filter-btn');
  if (!clearFilterBtn) {
    clearFilterBtn = document.createElement('button');
    clearFilterBtn.id = 'clear-filter-btn';
    clearFilterBtn.className = 'btn btn-secondary btn-sm';
    clearFilterBtn.innerHTML = '<i class="ph ph-x"></i> Clear Filter';
    clearFilterBtn.style.marginLeft = 'auto';

    clearFilterBtn.addEventListener('click', () => {
      currentFilter.cmc = null;
      currentFilter.color = null;
      currentFilter.ownership = null;
      renderDeckCards();
      // Re-render stats to clear highlighted segments
      loadDeckStats();
    });

    // Insert into tabs container
    const tabsContainer = document.querySelector('.deck-tabs');
    tabsContainer.insertBefore(clearFilterBtn, tabsContainer.querySelector('.deck-view-controls'));
  }

  // Show/hide clear filter button
  clearFilterBtn.style.display = hasFilter ? 'inline-flex' : 'none';

  mainboard.innerHTML = renderCardsList(mainboardCards);
  sideboard.innerHTML = renderCardsList(sideboardCards);

  // Add event listeners
  setupCardControls();
}

function renderCardsList(cards) {
  if (cards.length === 0) {
    return '<div style="padding: 2rem; text-align: center; color: var(--text-secondary);">No cards yet</div>';
  }

  // Separate commanders from other cards
  const commanders = cards.filter(c => c.is_commander);
  const nonCommanders = cards.filter(c => !c.is_commander);

  // Group non-commander cards by set or type based on mode
  let grouped = {};
  let groupOrder = [];

  if (setGroupMode) {
    // Group by set
    nonCommanders.forEach(card => {
      const setCode = card.set_code || 'unknown';
      if (!grouped[setCode]) {
        grouped[setCode] = {
          cards: [],
          setName: card.set_name || setCode.toUpperCase()
        };
        groupOrder.push(setCode);
      }
      grouped[setCode].cards.push(card);
    });
  } else {
    // Group by type
    const typeOrder = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Enchantment', 'Artifact', 'Land', 'Other'];
    groupOrder = typeOrder;

    nonCommanders.forEach(card => {
      const typeLine = card.type_line || '';
      let category = 'Other';

      // Determine category based on type line
      for (const type of typeOrder) {
        if (typeLine.includes(type)) {
          category = type;
          break;
        }
      }

      if (!grouped[category]) {
        grouped[category] = { cards: [] };
      }
      grouped[category].cards.push(card);
    });
  }

  // Render grouped cards
  let html = '';

  // Render commander section first (if any)
  if (commanders.length > 0) {
    html += `
      <div class="card-type-group">
        <div class="card-type-header">Commander (${commanders.length})</div>
        ${commanders.map(card => renderCardItem(card)).join('')}
      </div>
    `;
  }

  // Render other card groups
  for (const groupKey of groupOrder) {
    const group = grouped[groupKey];
    if (group && group.cards && group.cards.length > 0) {
      const count = group.cards.reduce((sum, c) => sum + c.quantity, 0);

      let headerLabel;
      if (setGroupMode) {
        // Show full set name with code in parentheses
        headerLabel = `${group.setName} (${groupKey.toUpperCase()})`;
      } else {
        // Show type name (pluralized)
        const pluralType = groupKey === 'Sorcery' ? 'Sorceries' : groupKey + 's';
        headerLabel = pluralType;
      }

      // Sort cards by price if pricing mode is on, otherwise keep as-is
      let cardsToRender = group.cards;
      if (pricingMode && currentPriceData?.cardPrices) {
        cardsToRender = [...group.cards].sort((a, b) => {
          const priceA = currentPriceData.cardPrices[a.deck_card_id] || 0;
          const priceB = currentPriceData.cardPrices[b.deck_card_id] || 0;
          return priceB - priceA; // Sort descending (most expensive first)
        });
      }

      html += `
        <div class="card-type-group">
          <div class="card-type-header">${headerLabel} (${count})</div>
          ${cardsToRender.map(card => renderCardItem(card)).join('')}
        </div>
      `;
    }
  }

  return html;
}

function renderCardItem(card) {
  const isCommanderDeck = currentDeck.format === 'commander';
  const isLegendaryCreature = card.type_line &&
    (card.type_line.includes('Legendary') || card.type_line.includes('legendary')) &&
    (card.type_line.includes('Creature') || card.type_line.includes('creature'));
  const showCommanderIcon = isCommanderDeck && isLegendaryCreature && !card.is_sideboard;

  if (compactView) {
    return `
      <div class="deck-card-item compact ${card.is_commander ? 'is-commander' : ''}" data-deck-card-id="${card.deck_card_id}" data-printing-id="${card.printing_id}" data-is-sideboard="${card.is_sideboard}" data-card-id="${card.card_id}" draggable="true" style="position: relative;">
        <button class="ownership-toggle-btn ${card.is_owned ? 'owned' : ''}" data-card-id="${card.card_id}" style="position: absolute; top: 4px; left: 4px; background: ${card.is_owned ? 'rgba(16, 185, 129, 0.9)' : 'rgba(0,0,0,0.8)'}; color: white; border: none; border-radius: 50%; width: 20px; height: 20px; cursor: pointer; font-size: 12px; display: flex; align-items: center; justify-content: center; z-index: 10; transition: all 0.2s;">
          <i class="ph ${card.is_owned ? 'ph-check-circle' : 'ph-circle'}"></i>
        </button>
        ${showCommanderIcon ? `
          <button class="commander-toggle-btn ${card.is_commander ? 'active' : ''}"
                  data-deck-card-id="${card.deck_card_id}"
                  title="${card.is_commander ? 'Remove as Commander' : 'Set as Commander'}">
            ⚔️
          </button>
        ` : ''}
        <img src="${card.image_url}"
             class="deck-card-image-compact"
             alt="${card.name}"
             onerror="this.style.display='none'">
        <div class="deck-card-info-compact">
          <span class="card-name">${card.name}</span>
          <span class="card-mana">${formatMana(card.mana_cost || '')}</span>
        </div>
        <div class="deck-card-controls">
          <div class="quantity-control">
            <button class="quantity-btn btn-decrease" data-deck-card-id="${card.deck_card_id}">-</button>
            <input type="number" class="quantity-input" data-deck-card-id="${card.deck_card_id}" value="${card.quantity}" min="1" max="99">
            <button class="quantity-btn btn-increase" data-deck-card-id="${card.deck_card_id}">+</button>
          </div>
          <button class="remove-btn" data-deck-card-id="${card.deck_card_id}">×</button>
        </div>
      </div>
    `;
  }

  // Get price for this card if pricing mode is on
  const cardPrice = pricingMode && currentPriceData?.cardPrices
    ? currentPriceData.cardPrices[card.deck_card_id] || 0
    : 0;

  return `
    <div class="deck-card-item ${card.is_commander ? 'is-commander' : ''}" data-deck-card-id="${card.deck_card_id}" data-printing-id="${card.printing_id}" data-is-sideboard="${card.is_sideboard}" data-card-id="${card.card_id}" draggable="true" style="position: relative;">
      <button class="ownership-toggle-btn ${card.is_owned ? 'owned' : ''}" data-card-id="${card.card_id}" style="position: absolute; top: 8px; left: 8px; background: ${card.is_owned ? 'rgba(16, 185, 129, 0.9)' : 'rgba(0,0,0,0.8)'}; color: white; border: none; border-radius: 50%; width: 24px; height: 24px; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; z-index: 10; transition: all 0.2s;">
        <i class="ph ${card.is_owned ? 'ph-check-circle' : 'ph-circle'}"></i>
      </button>
      ${showCommanderIcon ? `
        <button class="commander-toggle-btn ${card.is_commander ? 'active' : ''}"
                data-deck-card-id="${card.deck_card_id}"
                title="${card.is_commander ? 'Remove as Commander' : 'Set as Commander'}">
          ⚔️
        </button>
      ` : ''}
      <img src="${card.image_url}"
           class="deck-card-image"
           alt="${card.name}"
           onerror="this.style.display='none'">
      <div class="deck-card-info">
        <div class="card-name">${card.name}</div>
        <div class="card-type">${card.type_line || ''}</div>
        <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">
          ${pricingMode
            ? `<span style="color: var(--primary); font-weight: 600;">$${cardPrice.toFixed(2)}</span>`
            : `<span class="set-code-link" data-card-id="${card.card_id}" data-deck-card-id="${card.deck_card_id}" style="cursor: pointer; text-decoration: underline;">${card.set_code}</span> • ${card.artist || 'Unknown'}`
          }
        </div>
      </div>
      <div class="deck-card-controls">
        <div class="quantity-control">
          <button class="quantity-btn btn-decrease" data-deck-card-id="${card.deck_card_id}">-</button>
          <input type="number" class="quantity-input" data-deck-card-id="${card.deck_card_id}" value="${card.quantity}" min="1" max="99">
          <button class="quantity-btn btn-increase" data-deck-card-id="${card.deck_card_id}">+</button>
        </div>
        <button class="remove-btn" data-deck-card-id="${card.deck_card_id}">Remove</button>
      </div>
    </div>
  `;
}

function setupCardControls() {
  // Setup drag and drop
  setupDragAndDrop();

  // Card click to show modal
  document.querySelectorAll('.deck-card-item').forEach(item => {
    // Click on card (not on controls)
    item.addEventListener('click', async (e) => {
      // Don't trigger if clicking controls
      if (e.target.closest('.deck-card-controls')) return;

      const printingId = item.dataset.printingId;
      if (printingId) {
        await showCardModal(printingId);
      }
    });

    // Add hover preview (only on non-touch devices)
    if (!isTouchDevice()) {
      item.addEventListener('mouseenter', (e) => {
        // Don't show preview if hovering over commander button
        if (e.target.closest('.commander-toggle-btn')) return;

        const img = item.querySelector('.deck-card-image, .deck-card-image-compact');
        if (img && img.src) {
          showCardPreview(img.src, e);
        }
      });

      item.addEventListener('mouseleave', () => {
        hideCardPreview();
      });

      // Prevent preview when hovering over commander button
      const commanderBtn = item.querySelector('.commander-toggle-btn');
      if (commanderBtn) {
        commanderBtn.addEventListener('mouseenter', () => {
          hideCardPreview();
        });
      }
    }
  });

  // Increase quantity
  document.querySelectorAll('.btn-increase').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const deckCardId = btn.dataset.deckCardId;
      const card = currentDeck.cards.find(c => c.deck_card_id == deckCardId);
      await updateCardQuantity(deckCardId, card.quantity + 1);
    });
  });

  // Decrease quantity
  document.querySelectorAll('.btn-decrease').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const deckCardId = btn.dataset.deckCardId;
      const card = currentDeck.cards.find(c => c.deck_card_id == deckCardId);
      if (card.quantity > 1) {
        await updateCardQuantity(deckCardId, card.quantity - 1);
      }
    });
  });

  // Remove card
  document.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const deckCardId = btn.dataset.deckCardId;
      await removeCard(deckCardId);
    });
  });

  // Direct quantity input
  document.querySelectorAll('.quantity-input').forEach(input => {
    // Stop propagation to prevent card detail modal from opening
    input.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // Select all text on focus for easy editing
    input.addEventListener('focus', (e) => {
      e.target.select();
    });

    // Handle quantity change
    input.addEventListener('change', async (e) => {
      e.stopPropagation();
      const deckCardId = input.dataset.deckCardId;
      let newQuantity = parseInt(input.value);

      // Validate quantity
      if (isNaN(newQuantity) || newQuantity < 1) {
        newQuantity = 1;
      } else if (newQuantity > 99) {
        newQuantity = 99;
      }

      await updateCardQuantity(deckCardId, newQuantity);
    });

    // Handle Enter key
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.target.blur(); // Trigger change event
      }
    });
  });

  // Commander toggle
  document.querySelectorAll('.commander-toggle-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const deckCardId = btn.dataset.deckCardId;
      await toggleCommander(deckCardId);
    });
  });

  // Ownership toggle
  document.querySelectorAll('.ownership-toggle-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const cardId = btn.dataset.cardId;
      await toggleCardOwnership(cardId, btn);
    });
  });

  // Set code link to swap printings
  document.querySelectorAll('.set-code-link').forEach(link => {
    link.addEventListener('click', async (e) => {
      e.stopPropagation();
      const cardId = link.dataset.cardId;
      const deckCardId = link.dataset.deckCardId;
      await showPrintingSelectionModal(cardId, deckCardId);
    });
  });
}

let draggedCardId = null;
let draggedIsSideboard = null;
let dragPopupInitialized = false;

function setupDragAndDrop() {
  // Get or create the drag popup
  let dragPopup = document.getElementById('drag-popup');
  if (!dragPopup) {
    dragPopup = document.createElement('div');
    dragPopup.id = 'drag-popup';
    dragPopup.className = 'drag-popup hidden';
    dragPopup.innerHTML = `
      <div class="drag-popup-title">Move to...</div>
      <div class="drag-popup-zones">
        <div class="drag-zone" data-target="mainboard">
          <div class="drag-zone-icon">📚</div>
          <div class="drag-zone-label">Mainboard</div>
        </div>
        <div class="drag-zone" data-target="sideboard">
          <div class="drag-zone-icon">📋</div>
          <div class="drag-zone-label">Sideboard</div>
        </div>
      </div>
    `;
    document.body.appendChild(dragPopup);
  }

  const dragZones = dragPopup.querySelectorAll('.drag-zone');

  // Only set up drop zone handlers once
  if (!dragPopupInitialized) {
    dragZones.forEach(zone => {
      zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        const target = zone.dataset.target;
        const canDrop = (target === 'mainboard' && draggedIsSideboard) ||
                        (target === 'sideboard' && !draggedIsSideboard);

        if (canDrop) {
          e.dataTransfer.dropEffect = 'move';
          zone.classList.add('drag-over');
        } else {
          e.dataTransfer.dropEffect = 'none';
        }
      });

      zone.addEventListener('dragleave', (e) => {
        zone.classList.remove('drag-over');
      });

      zone.addEventListener('drop', async (e) => {
        e.preventDefault();
        zone.classList.remove('drag-over');

        const target = zone.dataset.target;
        const newIsSideboard = target === 'sideboard';

        // Only move if it's actually changing boards
        if (draggedCardId && newIsSideboard !== draggedIsSideboard) {
          await moveCardToBoard(draggedCardId, newIsSideboard);
        }
      });
    });
    dragPopupInitialized = true;
  }

  // Setup drag events on card items (these need to be re-attached each render)
  document.querySelectorAll('.deck-card-item').forEach(item => {
    item.addEventListener('dragstart', (e) => {
      draggedCardId = item.dataset.deckCardId;
      draggedIsSideboard = item.dataset.isSideboard === 'true' || item.dataset.isSideboard === '1';

      // Get the actual card image
      const cardImage = item.querySelector('.deck-card-image, .deck-card-image-compact');
      if (cardImage) {
        const isFirefox = navigator.userAgent.toLowerCase().includes('firefox');

        if (isFirefox) {
          // Firefox: Use canvas
          const canvas = document.createElement('canvas');
          canvas.width = 80;
          canvas.height = 112;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(cardImage, 0, 0, 80, 112);
          e.dataTransfer.setDragImage(canvas, 40, 56);
        } else {
          // Chrome: Use cloned image in DOM
          const dragImage = cardImage.cloneNode(false);
          dragImage.style.position = 'fixed';
          dragImage.style.top = '-500px';
          dragImage.style.left = '0';
          dragImage.style.width = '80px';
          dragImage.style.height = '112px';
          dragImage.style.objectFit = 'cover';
          dragImage.style.border = 'none';
          dragImage.style.borderRadius = '4px';
          dragImage.style.pointerEvents = 'none';
          dragImage.style.zIndex = '-1';
          document.body.appendChild(dragImage);

          e.dataTransfer.setDragImage(dragImage, 40, 56);

          // Clean up after drag ends
          item.addEventListener('dragend', function cleanup() {
            if (dragImage && dragImage.parentNode) {
              document.body.removeChild(dragImage);
            }
            item.removeEventListener('dragend', cleanup);
          }, { once: true });
        }
      }

      // Show popup
      dragPopup.classList.remove('hidden');

      // Highlight the zone the card is NOT currently in
      dragZones.forEach(zone => {
        const target = zone.dataset.target;
        if ((target === 'mainboard' && draggedIsSideboard) ||
            (target === 'sideboard' && !draggedIsSideboard)) {
          zone.classList.add('can-drop');
        } else {
          zone.classList.add('current-zone');
        }
      });

      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggedCardId);
    });

    item.addEventListener('dragend', (e) => {
      dragPopup.classList.add('hidden');

      // Clean up zone states
      dragZones.forEach(zone => {
        zone.classList.remove('can-drop', 'current-zone', 'drag-over');
      });

      draggedCardId = null;
      draggedIsSideboard = null;
    });
  });
}

async function moveCardToBoard(deckCardId, isSideboard) {
  try {
    showLoading();
    const updatedDeck = await api.updateDeckCard(currentDeckId, deckCardId, { isSideboard });
    currentDeck = updatedDeck.deck;
    renderDeckCards();
    await loadDeckStats();
    hideLoading();
    showToast(`Card moved to ${isSideboard ? 'sideboard' : 'mainboard'}`, 'success', 2000);
  } catch (error) {
    hideLoading();
    showToast('Failed to move card: ' + error.message, 'error');
  }
}

async function updateCardQuantity(deckCardId, newQuantity) {
  try {
    showLoading();
    const updatedDeck = await api.updateDeckCard(currentDeckId, deckCardId, { quantity: newQuantity });
    currentDeck = updatedDeck.deck;
    renderDeckCards();
    await loadDeckStats();
    hideLoading();
    showToast('Quantity updated', 'success', 2000);
  } catch (error) {
    hideLoading();
    showToast('Failed to update card: ' + error.message, 'error');
  }
}

async function removeCard(deckCardId) {
  try {
    showLoading();
    const updatedDeck = await api.removeDeckCard(currentDeckId, deckCardId);
    currentDeck = updatedDeck.deck;
    renderDeckCards();
    await loadDeckStats();
    hideLoading();
    showToast('Card removed', 'success', 2000);
  } catch (error) {
    hideLoading();
    showToast('Failed to remove card: ' + error.message, 'error');
  }
}

async function toggleCommander(deckCardId) {
  try {
    showLoading();

    // Find the card being toggled
    const card = currentDeck.cards.find(c => c.deck_card_id == deckCardId);
    const newCommanderStatus = !card.is_commander;

    // If setting as commander, first unmark any existing commander
    if (newCommanderStatus) {
      const currentCommander = currentDeck.cards.find(c => c.is_commander);
      if (currentCommander && currentCommander.deck_card_id != deckCardId) {
        // Unmark the current commander
        await api.updateDeckCard(currentDeckId, currentCommander.deck_card_id, { isCommander: false });
      }
    }

    // Toggle the commander status on the target card
    const updatedDeck = await api.updateDeckCard(currentDeckId, deckCardId, { isCommander: newCommanderStatus });
    currentDeck = updatedDeck.deck;
    renderDeckCards();
    await loadDeckStats();
    hideLoading();

    showToast(
      newCommanderStatus ? '⚔️ Commander set!' : 'Commander removed',
      'success',
      2000
    );
  } catch (error) {
    hideLoading();
    showToast('Failed to update commander: ' + error.message, 'error');
  }
}

async function toggleCardOwnership(cardId, buttonEl) {
  try {
    const result = await api.toggleCardOwnership(cardId);

    // Update the button appearance
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

    // Update the card's is_owned status in currentDeck
    currentDeck.cards.forEach(card => {
      if (card.card_id == cardId) {
        card.is_owned = result.owned;
      }
    });

    // Reload stats to update the ownership percentage
    await loadDeckStats();
  } catch (error) {
    showToast('Failed to update collection', 'error');
    console.error('Toggle ownership error:', error);
  }
}

function switchTab(tab) {
  // Update active tab state
  activeTab = tab;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  document.querySelectorAll('.deck-list').forEach(list => {
    list.classList.toggle('hidden', list.id !== tab);
    list.classList.toggle('active', list.id === tab);
  });
}

async function loadDeckStats() {
  try {
    const stats = await api.getDeckStats(currentDeckId);
    renderStats(stats);

    // Load deck price and store globally
    const price = await api.getDeckPrice(currentDeckId);
    currentPriceData = price;
    displayDeckPrice(price);
  } catch (error) {
    console.error('Failed to load stats:', error);
  }
}

function displayDeckPrice(price) {
  const priceEl = document.getElementById('deck-total-price');
  if (priceEl) {
    priceEl.innerHTML = `
      <span style="color: var(--text-secondary);">Deck Total (TCGPlayer):</span>
      <span style="margin-left: 0.5rem;">$${price.total.toFixed(2)}</span>
    `;
  }

  // Add pricing statistics section under color distribution
  const statsPanel = document.getElementById('deck-stats');
  let pricingStatSection = document.getElementById('pricing-stat-section');

  if (!pricingStatSection) {
    pricingStatSection = document.createElement('div');
    pricingStatSection.id = 'pricing-stat-section';
    pricingStatSection.className = 'stat-section';
    statsPanel.appendChild(pricingStatSection);
  }

  pricingStatSection.innerHTML = `
    <h4>Pricing & Display</h4>
    <div style="padding: 1rem; background: var(--bg-tertiary); border-radius: 8px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
        <span style="color: var(--text-secondary);">Deck Total:</span>
        <span style="font-weight: 600; font-size: 1.1rem;">$${price.total.toFixed(2)}</span>
      </div>
      ${price.mostExpensive ? `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
          <span style="color: var(--text-secondary);">Most Expensive:</span>
          <div style="text-align: right;">
            <div style="font-weight: 600;">${price.mostExpensive.name}</div>
            <div style="color: var(--primary); font-weight: 600;">$${price.mostExpensive.price.toFixed(2)}</div>
          </div>
        </div>
      ` : ''}
      <button id="toggle-pricing-btn" class="btn btn-secondary btn-sm ${pricingMode ? 'active' : ''}" style="width: 100%; margin-bottom: 0.5rem;">
        <i class="ph ${pricingMode ? 'ph-eye-slash' : 'ph-currency-dollar'}"></i>
        ${pricingMode ? 'Hide Pricing Mode' : 'Show Pricing Mode'}
      </button>
      <button id="toggle-set-group-btn" class="btn btn-secondary btn-sm ${setGroupMode ? 'active' : ''}" style="width: 100%;">
        <i class="ph ${setGroupMode ? 'ph-grid-four' : 'ph-stack'}"></i>
        ${setGroupMode ? 'Group by Type' : 'Group by Set'}
      </button>
    </div>
  `;

  // Add click handler for pricing mode toggle
  const togglePricingBtn = document.getElementById('toggle-pricing-btn');
  togglePricingBtn.addEventListener('click', () => {
    pricingMode = !pricingMode;
    renderDeckCards();

    // Update button text and icon
    togglePricingBtn.classList.toggle('active', pricingMode);
    togglePricingBtn.innerHTML = `
      <i class="ph ${pricingMode ? 'ph-eye-slash' : 'ph-currency-dollar'}"></i>
      ${pricingMode ? 'Hide Pricing Mode' : 'Show Pricing Mode'}
    `;
  });

  // Add click handler for set group mode toggle
  const toggleSetGroupBtn = document.getElementById('toggle-set-group-btn');
  toggleSetGroupBtn.addEventListener('click', () => {
    setGroupMode = !setGroupMode;
    renderDeckCards();

    // Update button text and icon
    toggleSetGroupBtn.classList.toggle('active', setGroupMode);
    toggleSetGroupBtn.innerHTML = `
      <i class="ph ${setGroupMode ? 'ph-grid-four' : 'ph-stack'}"></i>
      ${setGroupMode ? 'Group by Type' : 'Group by Set'}
    `;
  });
}

function openBuyDeckModal() {
  document.getElementById('buy-deck-modal').classList.remove('hidden');
  document.getElementById('decklist-preview').classList.add('hidden');
}

function generateDeckList() {
  // Check if non-owned only filter is enabled
  const nonOwnedOnly = document.getElementById('copy-non-owned-only')?.checked || false;

  // Build deck list in TCGPlayer format with set codes
  let mainboardCards = currentDeck.cards.filter(c => !c.is_sideboard);
  let sideboardCards = currentDeck.cards.filter(c => c.is_sideboard);

  // Filter for non-owned cards if checkbox is checked
  if (nonOwnedOnly) {
    mainboardCards = mainboardCards.filter(c => !c.is_owned);
    sideboardCards = sideboardCards.filter(c => !c.is_owned);
  }

  const mainboard = mainboardCards
    .map(c => `${c.quantity} ${c.name} [${c.set_code}]`)
    .join('\n');

  const sideboard = sideboardCards
    .map(c => `${c.quantity} ${c.name} [${c.set_code}]`)
    .join('\n');

  // Combine with proper formatting
  let deckText = mainboard;
  if (sideboard) {
    deckText += '\n\nSideboard\n' + sideboard;
  }

  return deckText;
}

function exportToTCGPlayer() {
  try {
    const deckText = generateDeckList();

    if (!deckText.trim()) {
      const nonOwnedOnly = document.getElementById('copy-non-owned-only')?.checked || false;
      if (nonOwnedOnly) {
        showToast('No non-owned cards to export', 'warning', 3000);
      } else {
        showToast('No cards to export', 'warning', 3000);
      }
      return;
    }

    // Copy to clipboard
    navigator.clipboard.writeText(deckText).then(() => {
      // Open TCGPlayer mass entry page
      window.open('https://www.tcgplayer.com/massentry', '_blank');

      document.getElementById('buy-deck-modal').classList.add('hidden');
      showToast('Deck list copied! Paste it into TCGPlayer Mass Entry.', 'success', 4000);
    }).catch(() => {
      // Fallback: just show the text
      document.getElementById('decklist-preview').classList.remove('hidden');
      document.getElementById('decklist-text').value = deckText;
      showToast('Copy the deck list below and paste into TCGPlayer', 'warning', 4000);
    });
  } catch (error) {
    showToast('Failed to export', 'error');
  }
}

function exportToManapool() {
  try {
    const deckText = generateDeckList();

    if (!deckText.trim()) {
      const nonOwnedOnly = document.getElementById('copy-non-owned-only')?.checked || false;
      if (nonOwnedOnly) {
        showToast('No non-owned cards to export', 'warning', 3000);
      } else {
        showToast('No cards to export', 'warning', 3000);
      }
      return;
    }

    // Copy to clipboard
    navigator.clipboard.writeText(deckText).then(() => {
      // Open Manapool mass entry page
      window.open('https://manapool.com/add-deck', '_blank');

      document.getElementById('buy-deck-modal').classList.add('hidden');
      showToast('Deck list copied! Paste it into Manapool Mass Entry.', 'success', 4000);
    }).catch(() => {
      // Fallback: just show the text
      document.getElementById('decklist-preview').classList.remove('hidden');
      document.getElementById('decklist-text').value = deckText;
      showToast('Copy the deck list below and paste into Manapool', 'warning', 4000);
    });
  } catch (error) {
    showToast('Failed to export', 'error');
  }
}

function generateExport(format) {
  const mainboard = currentDeck.cards.filter(c => !c.is_sideboard);
  const sideboard = currentDeck.cards.filter(c => c.is_sideboard);

  let text = '';

  switch (format) {
    case 'moxfield':
      // Format: 1 Card Name (SET) collector_number *F* (for foil)
      text = mainboard.map(c => {
        let line = `${c.quantity} ${c.name} (${c.set_code.toUpperCase()}) ${c.collector_number || ''}`;
        if (c.finishes && c.finishes.includes('foil')) line += ' *F*';
        return line.trim();
      }).join('\n');
      if (sideboard.length > 0) {
        text += '\n\n';
        text += sideboard.map(c => {
          let line = `${c.quantity} ${c.name} (${c.set_code.toUpperCase()}) ${c.collector_number || ''}`;
          if (c.finishes && c.finishes.includes('foil')) line += ' *F*';
          return line.trim();
        }).join('\n');
      }
      break;

    case 'arena':
    case 'mtgo':
    case 'text':
      // Simple format: quantity name
      text = 'Deck\n' + mainboard.map(c => `${c.quantity} ${c.name}`).join('\n');
      if (sideboard.length > 0) {
        text += '\n\n' + sideboard.map(c => `${c.quantity} ${c.name}`).join('\n');
      }
      if (currentDeck.cards.find(c => c.is_commander)) {
        const commander = currentDeck.cards.find(c => c.is_commander);
        text = `Commander\n1 ${commander.name}\n\n` + text;
      }
      break;
  }

  return text;
}

let lastMouseX = 0;
let lastMouseY = 0;

// Track mouse position globally
document.addEventListener('mousemove', (e) => {
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
});

function showCardPreview(imageSrc, event) {
  const preview = document.getElementById('card-preview');
  const img = document.getElementById('card-preview-img');

  // Use large image if available
  const largeImageSrc = imageSrc.replace('/normal/', '/large/') || imageSrc;
  img.src = largeImageSrc;

  // Position preview away from mouse
  // If mouse is on left half of screen, show preview on right
  // If mouse is on right half, show preview on left
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;

  if (lastMouseX < screenWidth / 2) {
    // Mouse on left, show preview on right
    preview.style.left = 'auto';
    preview.style.right = '20px';
  } else {
    // Mouse on right, show preview on left
    preview.style.left = '20px';
    preview.style.right = 'auto';
  }

  preview.classList.remove('hidden');
}

function hideCardPreview() {
  document.getElementById('card-preview').classList.add('hidden');
}

async function showCardModal(printingId) {
  try {
    const card = currentDeck.cards.find(c => c.printing_id == printingId);
    if (card && card.card_id) {
      await showCardDetail(card.card_id);
    } else {
      console.error('Card not found or missing card_id:', { printingId, card, currentDeck: currentDeck?.cards?.length });
      showToast('Card details not available', 'warning');
    }
  } catch (error) {
    console.error('Error in showCardModal:', error);
    showToast('Failed to load card details', 'error');
  }
}

async function showPrintingSelectionModal(cardId, deckCardId) {
  try {
    showLoading();
    const result = await api.getCardPrintings(cardId);
    const printings = result.printings || [];
    hideLoading();

    if (printings.length === 0) {
      showToast('No printings found for this card', 'warning');
      return;
    }

    // Get the current printing for this deck card
    const currentCard = currentDeck.cards.find(c => c.deck_card_id == deckCardId);
    const currentPrintingId = currentCard?.printing_id;

    // Create modal content
    const modalBody = document.getElementById('modal-body');
    modalBody.innerHTML = `
      <div style="max-width: 900px; margin: 0 auto;">
        <h2 style="margin: 0 0 1rem 0;">Select a Printing</h2>
        <input type="text"
               id="printing-search"
               placeholder="Search by set code (e.g., INR, J25)..."
               style="width: 100%; padding: 0.75rem; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-secondary); color: var(--text-primary); font-size: 0.95rem; margin-bottom: 1.5rem;"
               autocomplete="off">
        <div id="printing-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; max-height: 60vh; overflow-y: auto;">
          ${printings.map(printing => `
            <div class="printing-option ${printing.id == currentPrintingId ? 'current-printing' : ''}"
                 data-printing-id="${printing.id}"
                 data-set-code="${printing.set_code.toUpperCase()}"
                 data-set-name="${(printing.set_name || '').toLowerCase()}"
                 style="cursor: pointer; padding: 1rem; background: var(--bg-tertiary); border-radius: 8px; transition: all 0.2s; border: 2px solid ${printing.id == currentPrintingId ? 'var(--primary)' : 'transparent'};">
              <img src="${printing.image_url}"
                   alt="${printing.set_name || printing.set_code}"
                   style="width: 100%; border-radius: 8px; margin-bottom: 0.5rem;"
                   onerror="this.style.display='none'">
              <div style="font-weight: 600; font-size: 0.9rem; margin-bottom: 0.25rem;">
                ${printing.set_name || printing.set_code.toUpperCase()}
              </div>
              <div style="font-size: 0.75rem; color: var(--text-secondary);">
                ${printing.set_code.toUpperCase()} #${printing.collector_number || '?'}
              </div>
              ${printing.rarity ? `
                <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">
                  ${printing.rarity}
                </div>
              ` : ''}
              ${printing.id == currentPrintingId ? `
                <div style="margin-top: 0.5rem; padding: 0.25rem 0.5rem; background: var(--primary); color: white; border-radius: 4px; font-size: 0.75rem; text-align: center; font-weight: 600;">
                  Current
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;

    // Add search functionality
    const searchInput = document.getElementById('printing-search');
    const printingOptions = modalBody.querySelectorAll('.printing-option');

    searchInput.addEventListener('input', (e) => {
      const searchTerm = e.target.value.toUpperCase().trim();

      printingOptions.forEach(option => {
        const setCode = option.dataset.setCode;
        const setName = option.dataset.setName;

        // Match against set code or set name
        const matches = setCode.includes(searchTerm) || setName.includes(searchTerm.toLowerCase());

        if (matches || searchTerm === '') {
          option.style.display = '';
        } else {
          option.style.display = 'none';
        }
      });
    });

    // Focus the search input
    setTimeout(() => searchInput.focus(), 100);

    // Add click handlers for printing selection
    printingOptions.forEach(option => {
      // Hover effect
      option.addEventListener('mouseenter', function() {
        if (!this.classList.contains('current-printing')) {
          this.style.background = 'var(--bg-secondary)';
          this.style.borderColor = 'var(--primary)';
        }
      });
      option.addEventListener('mouseleave', function() {
        if (!this.classList.contains('current-printing')) {
          this.style.background = 'var(--bg-tertiary)';
          this.style.borderColor = 'transparent';
        }
      });

      // Click to select
      option.addEventListener('click', async function() {
        const printingId = this.dataset.printingId;
        await swapPrinting(deckCardId, printingId);
        hideModal();
      });
    });

    // Show the modal
    document.getElementById('modal').classList.remove('hidden');
  } catch (error) {
    hideLoading();
    console.error('Failed to load printings:', error);
    showToast('Failed to load printings', 'error');
  }
}

async function swapPrinting(deckCardId, newPrintingId) {
  try {
    console.log('Swapping printing:', { deckCardId, newPrintingId, currentDeckId });
    showLoading();
    // Update the deck card with the new printing
    const updatedDeck = await api.updateDeckCard(currentDeckId, deckCardId, { printingId: parseInt(newPrintingId) });
    console.log('Updated deck received:', updatedDeck);
    currentDeck = updatedDeck.deck;
    renderDeckCards();
    await loadDeckStats();
    hideLoading();
    showToast('Printing updated!', 'success', 2000);
  } catch (error) {
    console.error('Swap printing error:', error);
    hideLoading();
    showToast('Failed to update printing: ' + error.message, 'error');
  }
}

// Helper function to calculate actual CMC from mana cost string
// Handles DFC/split cards where stored CMC might be combined
function calculateActualCMC(card) {
  // If card has // in name (DFC or split card), calculate from mana_cost
  if (card.name && card.name.includes(' // ') && card.mana_cost) {
    // Parse mana cost like {3}{U}{U} -> 3 + 1 + 1 = 5
    const cost = card.mana_cost;
    let cmc = 0;

    // Match all mana symbols
    const symbols = cost.match(/\{[^}]+\}/g) || [];
    for (const symbol of symbols) {
      const inner = symbol.slice(1, -1); // Remove { }

      // Check if it's a number
      if (/^\d+$/.test(inner)) {
        cmc += parseInt(inner);
      } else if (inner === 'X') {
        // X counts as 0 for CMC purposes
        cmc += 0;
      } else {
        // Any other symbol (W, U, B, R, G, C, hybrid, phyrexian, etc.) counts as 1
        cmc += 1;
      }
    }

    return cmc;
  }

  // For normal cards, use stored CMC
  return card.cmc || 0;
}

function renderStats(stats) {
  // Calculate statistics for mana values
  const mainboardCards = currentDeck.cards.filter(c => !c.is_sideboard);
  const totalCards = mainboardCards.reduce((sum, c) => sum + c.quantity, 0);

  // Calculate owned percentage
  const ownedCards = mainboardCards.filter(c => c.is_owned).reduce((sum, c) => sum + c.quantity, 0);
  const ownedPercentage = totalCards > 0 ? ((ownedCards / totalCards) * 100).toFixed(0) : 0;

  // Use calculated CMC for accurate totals
  const totalManaValue = mainboardCards.reduce((sum, c) => {
    const actualCMC = calculateActualCMC(c);
    return sum + (actualCMC * c.quantity);
  }, 0);

  // Calculate with lands
  const avgWithLands = totalCards > 0 ? (totalManaValue / totalCards).toFixed(2) : 0;

  // Calculate without lands
  const nonLandCards = mainboardCards.filter(c => !c.type_line || !c.type_line.includes('Land'));
  const nonLandTotal = nonLandCards.reduce((sum, c) => sum + c.quantity, 0);
  const nonLandManaValue = nonLandCards.reduce((sum, c) => {
    const actualCMC = calculateActualCMC(c);
    return sum + (actualCMC * c.quantity);
  }, 0);
  const avgWithoutLands = nonLandTotal > 0 ? (nonLandManaValue / nonLandTotal).toFixed(2) : 0;

  // Calculate median with lands
  const allCmcValues = [];
  mainboardCards.forEach(c => {
    const actualCMC = calculateActualCMC(c);
    for (let i = 0; i < c.quantity; i++) {
      allCmcValues.push(actualCMC);
    }
  });
  allCmcValues.sort((a, b) => a - b);
  const medianWithLands = allCmcValues.length > 0
    ? allCmcValues.length % 2 === 0
      ? ((allCmcValues[allCmcValues.length / 2 - 1] + allCmcValues[allCmcValues.length / 2]) / 2)
      : allCmcValues[Math.floor(allCmcValues.length / 2)]
    : 0;

  // Calculate median without lands
  const nonLandCmcValues = [];
  nonLandCards.forEach(c => {
    const actualCMC = calculateActualCMC(c);
    for (let i = 0; i < c.quantity; i++) {
      nonLandCmcValues.push(actualCMC);
    }
  });
  nonLandCmcValues.sort((a, b) => a - b);
  const medianWithoutLands = nonLandCmcValues.length > 0
    ? nonLandCmcValues.length % 2 === 0
      ? ((nonLandCmcValues[nonLandCmcValues.length / 2 - 1] + nonLandCmcValues[nonLandCmcValues.length / 2]) / 2)
      : nonLandCmcValues[Math.floor(nonLandCmcValues.length / 2)]
    : 0;

  // Render owned stat at the top
  const statsPanel = document.getElementById('deck-stats');
  let ownedStatSection = document.getElementById('owned-stat-section');

  if (!ownedStatSection) {
    ownedStatSection = document.createElement('div');
    ownedStatSection.id = 'owned-stat-section';
    ownedStatSection.className = 'stat-section';
    statsPanel.insertBefore(ownedStatSection, statsPanel.firstChild);
  }

  const ownedFilterClass = currentFilter.ownership === 'owned' ? 'filtered' : currentFilter.ownership === 'not-owned' ? 'filtered' : '';

  ownedStatSection.innerHTML = `
    <h4>Collection Status</h4>
    <div class="owned-stat-bar ${ownedFilterClass}" style="cursor: pointer; padding: 1rem; background: var(--bg-tertiary); border-radius: 8px; transition: all 0.2s;" title="Click to filter by ownership">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
        <span style="font-weight: 600; font-size: 1rem;">${ownedPercentage}% Owned</span>
        <span style="font-size: 0.875rem; color: var(--text-secondary);">${ownedCards} / ${totalCards} cards</span>
      </div>
      <div style="width: 100%; height: 8px; background: var(--border); border-radius: 4px; overflow: hidden;">
        <div style="width: ${ownedPercentage}%; height: 100%; background: linear-gradient(90deg, #10b981, #059669); transition: width 0.3s;"></div>
      </div>
      ${currentFilter.ownership ? `
        <div style="margin-top: 0.5rem; font-size: 0.75rem; color: var(--primary); font-weight: 600;">
          ${currentFilter.ownership === 'owned' ? '✓ Showing owned cards only' : '○ Showing unowned cards only'}
        </div>
      ` : ''}
    </div>
  `;

  // Add click handler for ownership filter cycling
  const ownedStatBar = ownedStatSection.querySelector('.owned-stat-bar');
  ownedStatBar.addEventListener('click', () => {
    if (currentFilter.ownership === null) {
      currentFilter.ownership = 'owned';
    } else if (currentFilter.ownership === 'owned') {
      currentFilter.ownership = 'not-owned';
    } else {
      currentFilter.ownership = null;
    }
    currentFilter.cmc = null; // Clear other filters
    currentFilter.color = null;
    renderDeckCards();
    renderStats(stats); // Re-render to update filter indicator
  });

  // Render mana curve chart
  const manaCurve = document.getElementById('mana-curve');
  const totalCurveCards = stats.manaCurve.reduce((sum, item) => sum + item.total_cards, 0);

  if (totalCurveCards === 0) {
    manaCurve.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 2rem;">No cards in deck</div>';
  } else {
    // Determine which values need overflow labels (less than 5% of total)
    const overflowThreshold = 0.05;

    // Calculate positions for overflow labels to prevent overlap
    const overflowLabels = [];
    stats.manaCurve.forEach((item, index) => {
      const percentage = (item.total_cards / totalCurveCards) * 100;
      const needsOverflow = percentage < (overflowThreshold * 100);
      if (needsOverflow) {
        overflowLabels.push({ cmc: item.cmc, index, percentage });
      }
    });

    // Calculate cumulative positions to determine label placement
    let cumulativeWidth = 0;
    const labelPositions = stats.manaCurve.map((item, index) => {
      const percentage = (item.total_cards / totalCurveCards) * 100;
      const position = cumulativeWidth + (percentage / 2); // Center of segment
      cumulativeWidth += percentage;
      return position;
    });

    manaCurve.innerHTML = `
      <div class="mana-curve-container" style="padding-top: 2.5rem; position: relative;">
        <div class="mana-curve-single-bar" style="overflow: visible; position: relative;">
          ${stats.manaCurve.map((item, index) => {
            const percentage = (item.total_cards / totalCurveCards) * 100;
            const cmcColor = getCMCColor(item.cmc);
            const needsOverflow = percentage < (overflowThreshold * 100);
            const isFiltered = currentFilter.cmc === item.cmc;

            return `
              <div class="mana-curve-segment ${isFiltered ? 'filtered' : ''}"
                   data-cmc="${item.cmc}"
                   style="width: ${percentage}%; background: ${cmcColor}; cursor: pointer; position: relative;"
                   title="${item.cmc} CMC: ${item.total_cards} cards (${percentage.toFixed(1)}%)">
                ${!needsOverflow ? `
                  <span class="mana-curve-segment-label">${item.cmc}</span>
                ` : ''}
              </div>
            `;
          }).join('')}
          ${overflowLabels.map((labelData, idx) => {
            const position = labelPositions[labelData.index];
            const cmcColor = getCMCColor(labelData.cmc);
            const isFiltered = currentFilter.cmc === labelData.cmc;

            return `
              <span class="mana-curve-overflow-label ${isFiltered ? 'filtered' : ''}"
                    data-cmc="${labelData.cmc}"
                    style="position: absolute; bottom: calc(100% + 0.5rem); left: ${position}%; transform: translateX(-50%); font-size: 0.75rem; font-weight: 600; white-space: nowrap; padding: 0.25rem 0.5rem; background: ${cmcColor}; border-radius: 4px; color: white; text-shadow: 0 1px 2px rgba(0,0,0,0.5); z-index: ${50 + idx}; pointer-events: auto; cursor: pointer; transition: transform 0.15s ease-out, box-shadow 0.15s ease-out, z-index 0s;">${labelData.cmc}</span>
            `;
          }).join('')}
        </div>
        <div class="mana-stats" style="margin-top: 1rem; padding: 1rem; background: var(--bg-tertiary); border-radius: 8px; font-size: 0.875rem; line-height: 1.6;">
          <div>The average mana value of your main deck is <strong>${avgWithLands}</strong> with lands and <strong>${avgWithoutLands}</strong> without lands.</div>
          <div style="margin-top: 0.25rem;">The median mana value of your main deck is <strong>${medianWithLands}</strong> with lands and <strong>${medianWithoutLands}</strong> without lands.</div>
          <div style="margin-top: 0.25rem;">This deck's total mana value is <strong>${totalManaValue}</strong>.</div>
        </div>
      </div>
    `;

    // Add click handlers for filtering
    manaCurve.querySelectorAll('.mana-curve-segment').forEach(segment => {
      segment.addEventListener('click', () => {
        const cmc = parseInt(segment.dataset.cmc);
        if (currentFilter.cmc === cmc) {
          // Clear filter if clicking the same CMC
          currentFilter.cmc = null;
        } else {
          currentFilter.cmc = cmc;
          currentFilter.color = null; // Clear color filter when CMC is selected
        }
        renderDeckCards();
        renderStats(stats); // Re-render to update highlighted segment
      });
    });

    // Add click and hover handlers for overflow labels
    manaCurve.querySelectorAll('.mana-curve-overflow-label').forEach((label, idx) => {
      const defaultZIndex = 50 + idx;

      label.addEventListener('click', (e) => {
        e.stopPropagation();
        const cmc = parseInt(label.dataset.cmc);
        if (currentFilter.cmc === cmc) {
          currentFilter.cmc = null;
        } else {
          currentFilter.cmc = cmc;
          currentFilter.color = null;
        }
        renderDeckCards();
        renderStats(stats);
      });

      // Add hover effect - bring to front and scale up
      label.addEventListener('mouseenter', () => {
        label.style.zIndex = '500';
        label.style.transform = 'translateX(-50%) scale(1.2)';
        label.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.7)';
      });

      label.addEventListener('mouseleave', () => {
        label.style.zIndex = defaultZIndex;
        label.style.transform = 'translateX(-50%)';
        label.style.boxShadow = 'none';
      });
    });
  }

  // Render type distribution as simple list
  const typeDistribution = document.getElementById('type-distribution');
  const totalTypeCards = stats.typeDistribution.reduce((sum, item) => sum + item.total_cards, 0);

  typeDistribution.innerHTML = `
    <div class="type-list">
      ${stats.typeDistribution.map(item => {
        const percentage = totalTypeCards > 0 ? ((item.total_cards / totalTypeCards) * 100).toFixed(1) : 0;
        return `
          <div class="type-list-item">
            <span class="type-name">${item.type}</span>
            <span class="type-stats">${item.total_cards} (${percentage}%)</span>
          </div>
        `;
      }).join('')}
    </div>
  `;

  // Render color distribution with mana icons
  const colorDistribution = document.getElementById('color-distribution');
  const maxColor = Math.max(...stats.colorDistribution.map(c => c.total_cards), 1);
  const totalColorCards = stats.colorDistribution.reduce((sum, item) => sum + item.total_cards, 0);

  colorDistribution.innerHTML = stats.colorDistribution.map(item => {
    const width = (item.total_cards / maxColor) * 100;
    const percentage = totalColorCards > 0 ? ((item.total_cards / totalColorCards) * 100).toFixed(1) : 0;
    const colorIcons = formatColorIcons(item.colors);
    const colorBg = getColorBackground(item.colors);
    const isFiltered = currentFilter.color === item.colors;

    return `
      <div class="chart-bar ${isFiltered ? 'filtered' : ''}" title="${item.total_cards} cards (${percentage}%)" data-colors="${item.colors || ''}" style="cursor: pointer;">
        <div class="chart-label color-label">${colorIcons}</div>
        <div class="chart-bar-container">
          <div class="chart-bar-fill" style="width: ${width}%; background: ${colorBg}; ${isFiltered ? 'box-shadow: 0 0 0 3px var(--primary);' : ''}">
            <span class="chart-value">${item.total_cards}</span>
          </div>
          <span class="chart-percentage">${percentage}%</span>
        </div>
      </div>
    `;
  }).join('');

  // Add click handlers for color filtering
  colorDistribution.querySelectorAll('.chart-bar').forEach(bar => {
    bar.addEventListener('click', () => {
      const colors = bar.dataset.colors;
      if (currentFilter.color === colors) {
        // Clear filter if clicking the same color
        currentFilter.color = null;
      } else {
        currentFilter.color = colors;
        currentFilter.cmc = null; // Clear CMC filter when color is selected
      }
      renderDeckCards();
      renderStats(stats); // Re-render to update highlighted bar
    });
  });
}

function getCMCColor(cmc) {
  // Unique color for each CMC value
  const colors = {
    0: '#94a3b8',  // Gray
    1: '#10b981',  // Green
    2: '#34d399',  // Light Green
    3: '#fbbf24',  // Yellow
    4: '#fb923c',  // Orange
    5: '#f87171',  // Light Red
    6: '#ef4444',  // Red
    7: '#c084fc',  // Light Purple
    8: '#a855f7',  // Purple
    9: '#7c3aed',  // Dark Purple
    10: '#6366f1', // Indigo
  };

  // For CMC > 10, use a cycling pattern
  if (cmc > 10) {
    const colorKeys = Object.keys(colors);
    return colors[colorKeys[cmc % colorKeys.length]];
  }

  return colors[cmc] || '#6b7280'; // Default gray if not found
}

function getTypeColor(type) {
  const colors = {
    'Creature': '#10b981',
    'Instant': '#3b82f6',
    'Sorcery': '#8b5cf6',
    'Enchantment': '#ec4899',
    'Artifact': '#64748b',
    'Planeswalker': '#f59e0b',
    'Land': '#78716c',
    'Other': '#6b7280'
  };
  return colors[type] || colors['Other'];
}

function formatColorIcons(colors) {
  if (!colors) return '<i class="ms ms-c ms-cost"></i>'; // Colorless

  // Parse colors - handle both single string (e.g., "WU") and comma-separated (e.g., "W,U")
  const colorArray = colors.includes(',')
    ? colors.split(',').map(c => c.trim()).filter(c => c.length > 0)
    : colors.split('').filter(c => c.trim().length > 0);

  // Create mana icons for each valid color
  return colorArray.map(color => {
    const colorLower = color.toLowerCase();
    return `<i class="ms ms-${colorLower} ms-cost ms-cost-shadow"></i>`;
  }).join('');
}

function getColorBackground(colors) {
  if (!colors) return 'linear-gradient(135deg, #d0c6bb, #a8a8a8)'; // Colorless gradient

  // Map colors to their MTG color values
  const colorMap = {
    'W': '#fdfbce',
    'U': '#bcdaf7',
    'B': '#a7999e',
    'R': '#f19b79',
    'G': '#9fcba6'
  };

  const colorValues = colors.split('').map(c => colorMap[c] || '#ccc');

  if (colorValues.length === 1) {
    return `linear-gradient(135deg, ${colorValues[0]}, ${adjustBrightness(colorValues[0], -20)})`;
  }

  // Multi-color gradient
  return `linear-gradient(135deg, ${colorValues.join(', ')})`;
}

function adjustBrightness(color, amount) {
  // Simple brightness adjustment for gradients
  const hex = color.replace('#', '');
  const num = parseInt(hex, 16);
  const r = Math.max(0, Math.min(255, (num >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amount));
  const b = Math.max(0, Math.min(255, (num & 0x0000FF) + amount));
  return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
}

function showLegalityModal() {
  const modal = document.getElementById('legality-check-modal');
  const formatSelection = document.getElementById('format-selection');
  const resultsDiv = document.getElementById('legality-results');

  // Reset modal
  resultsDiv.classList.add('hidden');
  resultsDiv.innerHTML = '';

  // Define all formats with their labels
  const formats = {
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

  // Render format buttons
  formatSelection.innerHTML = Object.entries(formats).map(([key, label]) => `
    <button class="btn btn-secondary format-check-btn" data-format="${key}">
      ${label}
    </button>
  `).join('');

  // Add click handlers for format buttons
  formatSelection.querySelectorAll('.format-check-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const format = btn.dataset.format;
      await checkFormatLegality(format, formats[format]);
    });
  });

  modal.classList.remove('hidden');
}

async function checkFormatLegality(format, formatLabel) {
  const resultsDiv = document.getElementById('legality-results');

  try {
    showLoading();
    const result = await api.checkDeckLegality(currentDeckId, format);
    hideLoading();

    // Display results
    resultsDiv.innerHTML = `
      <h3>${formatLabel} Legality</h3>
      <div style="padding: 1rem; background: ${result.isLegal ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; border-radius: 8px; margin: 1rem 0;">
        <div style="font-size: 1.1rem; font-weight: 600; color: ${result.isLegal ? '#10b981' : '#ef4444'};">
          ${result.isLegal ? '✓' : '✗'} ${result.isLegal ? 'This deck is legal for ' + formatLabel : 'This deck is not legal for ' + formatLabel}
        </div>
        ${!result.isLegal ? `
          <div style="margin-top: 0.5rem; color: var(--text-secondary);">
            There ${result.illegalCardCount === 1 ? 'is' : 'are'} ${result.illegalCardCount} card${result.illegalCardCount === 1 ? '' : 's'} that ${result.illegalCardCount === 1 ? 'isn\'t' : 'aren\'t'} legal.
          </div>
        ` : ''}
      </div>

      ${result.illegalCards && result.illegalCards.length > 0 ? `
        <h4 style="margin-top: 1.5rem; margin-bottom: 0.75rem;">Illegal Cards:</h4>
        <div style="display: grid; gap: 0.75rem;">
          ${result.illegalCards.map(card => `
            <div style="padding: 0.75rem; background: var(--bg-tertiary); border-radius: 6px; display: flex; gap: 1rem; align-items: center; border-left: 3px solid #ef4444;">
              ${card.image_url ? `
                <img src="${card.image_url}" alt="${card.name}" style="width: 50px; height: 70px; border-radius: 4px; object-fit: cover;">
              ` : ''}
              <div style="flex: 1;">
                <div style="font-weight: 600;">${card.name}</div>
                <div style="font-size: 0.875rem; color: var(--text-secondary); margin-top: 0.25rem;">${card.type_line || ''}</div>
                <div style="font-size: 0.875rem; color: #ef4444; margin-top: 0.25rem; font-weight: 500;">
                  ${card.reason}
                </div>
              </div>
              <div style="text-align: right; color: var(--text-secondary);">
                Qty: ${card.quantity}
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}
    `;

    resultsDiv.classList.remove('hidden');
  } catch (error) {
    hideLoading();
    showToast('Failed to check legality: ' + error.message, 'error');
  }
}

// Example Hand Functions
function dealExampleHand() {
  if (!currentDeck || !currentDeck.cards || currentDeck.cards.length === 0) {
    showToast('Add cards to your deck first', 'warning');
    return;
  }

  // Get mainboard cards only
  const mainboardCards = currentDeck.cards.filter(c => !c.is_sideboard);
  if (mainboardCards.length === 0) {
    showToast('Add cards to your mainboard first', 'warning');
    return;
  }

  // Create a pool of cards based on quantities
  const cardPool = [];
  mainboardCards.forEach(card => {
    for (let i = 0; i < card.quantity; i++) {
      cardPool.push(card);
    }
  });

  // Shuffle and draw 7 cards
  const shuffled = cardPool.sort(() => Math.random() - 0.5);
  exampleHand = shuffled.slice(0, Math.min(7, shuffled.length));

  renderExampleHand();
  updateHandStats();
}

function drawCard() {
  if (!currentDeck || !currentDeck.cards || currentDeck.cards.length === 0) {
    showToast('Add cards to your deck first', 'warning');
    return;
  }

  // Get mainboard cards only
  const mainboardCards = currentDeck.cards.filter(c => !c.is_sideboard);
  if (mainboardCards.length === 0) {
    showToast('Add cards to your mainboard first', 'warning');
    return;
  }

  // Create a pool of cards based on quantities, excluding cards already in hand
  const cardPool = [];
  mainboardCards.forEach(card => {
    const inHandCount = exampleHand.filter(c => c.deck_card_id === card.deck_card_id).length;
    const remaining = card.quantity - inHandCount;
    for (let i = 0; i < remaining; i++) {
      cardPool.push(card);
    }
  });

  if (cardPool.length === 0) {
    showToast('No more cards to draw!', 'warning');
    return;
  }

  // Draw a random card from the pool
  const randomCard = cardPool[Math.floor(Math.random() * cardPool.length)];
  exampleHand.push(randomCard);

  renderExampleHand();
  showToast('Card drawn!', 'success', 1500);
}

function renderExampleHand() {
  const handContainer = document.getElementById('example-hand');

  if (exampleHand.length === 0) {
    handContainer.innerHTML = '<div class="example-hand-empty">Click "Deal New Hand" to draw 7 random cards from your deck</div>';
    return;
  }

  handContainer.innerHTML = exampleHand.map((card, index) => `
    <div class="example-hand-card" data-card-index="${index}" data-printing-id="${card.printing_id}" data-card-id="${card.card_id}">
      <img src="${card.image_url}" alt="${card.name}" onerror="this.style.display='none'">
    </div>
  `).join('');

  // Add click handlers for card modal and hover preview
  handContainer.querySelectorAll('.example-hand-card').forEach(cardEl => {
    // Click to show modal
    cardEl.addEventListener('click', async () => {
      const cardId = cardEl.dataset.cardId;
      if (cardId) {
        await showCardDetail(cardId);
      }
    });

    // Hover preview (only on non-touch devices)
    if (!isTouchDevice()) {
      cardEl.addEventListener('mouseenter', (e) => {
        const img = cardEl.querySelector('img');
        if (img && img.src) {
          showCardPreview(img.src, e);
        }
      });

      cardEl.addEventListener('mouseleave', () => {
        hideCardPreview();
      });
    }
  });
}

function updateHandStats() {
  const statsContainer = document.getElementById('hand-stats');

  if (!currentDeck || !currentDeck.cards || currentDeck.cards.length === 0) {
    statsContainer.innerHTML = '';
    return;
  }

  // Get mainboard cards only
  const mainboardCards = currentDeck.cards.filter(c => !c.is_sideboard);
  if (mainboardCards.length === 0) {
    statsContainer.innerHTML = '';
    return;
  }

  // Count total lands and total cards in deck
  let totalLands = 0;
  let totalCards = 0;

  mainboardCards.forEach(card => {
    const isLand = card.type_line && card.type_line.includes('Land');
    totalCards += card.quantity;
    if (isLand) {
      totalLands += card.quantity;
    }
  });

  if (totalCards === 0) {
    statsContainer.innerHTML = '';
    return;
  }

  // Calculate expected lands in a 7-card opening hand using hypergeometric distribution
  // Expected value = n * K / N
  // where n = hand size (7), K = lands in deck, N = total cards
  const handSize = 7;
  const expectedLands = (handSize * totalLands / totalCards).toFixed(2);

  statsContainer.innerHTML = `Average number of lands in opening hand: <strong>${expectedLands}</strong>`;
}
