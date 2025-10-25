import api from '../services/api.js';
import { showLoading, hideLoading, debounce, formatMana, showToast } from '../utils/ui.js';
import { showCardDetail } from './cards.js';

let currentDeck = null;
let currentDeckId = null;
let searchTimeout = null;
let currentFilter = { cmc: null, color: null }; // Filter state for deck cards
let exampleHand = []; // Current example hand

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

    showLoading();
    const updatedDeck = await api.addCardToDeck(currentDeckId, printingId, 1, false);
    currentDeck = updatedDeck.deck;
    renderDeckCards();
    await loadDeckStats();
    hideLoading();
    showToast('Card added to deck', 'success', 2000);
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
  const hasFilter = currentFilter.cmc !== null || currentFilter.color !== null;

  if (currentFilter.cmc !== null) {
    mainboardCards = mainboardCards.filter(c => calculateActualCMC(c) === currentFilter.cmc);
    sideboardCards = sideboardCards.filter(c => calculateActualCMC(c) === currentFilter.cmc);
  }

  if (currentFilter.color !== null) {
    mainboardCards = mainboardCards.filter(c => c.colors === currentFilter.color);
    sideboardCards = sideboardCards.filter(c => c.colors === currentFilter.color);
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

  // Group non-commander cards by type
  const grouped = {};
  const typeOrder = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Enchantment', 'Artifact', 'Land', 'Other'];

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
      grouped[category] = [];
    }
    grouped[category].push(card);
  });

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

  // Render other card types
  for (const type of typeOrder) {
    if (grouped[type] && grouped[type].length > 0) {
      const count = grouped[type].reduce((sum, c) => sum + c.quantity, 0);
      const pluralType = type === 'Sorcery' ? 'Sorceries' : type + 's';

      html += `
        <div class="card-type-group">
          <div class="card-type-header">${pluralType} (${count})</div>
          ${grouped[type].map(card => renderCardItem(card)).join('')}
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
      <div class="deck-card-item compact ${card.is_commander ? 'is-commander' : ''}" data-deck-card-id="${card.deck_card_id}" data-printing-id="${card.printing_id}" data-is-sideboard="${card.is_sideboard}" draggable="true">
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

  return `
    <div class="deck-card-item ${card.is_commander ? 'is-commander' : ''}" data-deck-card-id="${card.deck_card_id}" data-printing-id="${card.printing_id}" data-is-sideboard="${card.is_sideboard}" draggable="true">
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
          ${card.set_code} • ${card.artist || 'Unknown'}
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

    // Add hover preview
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

function switchTab(tab) {
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

    // Load deck price
    const price = await api.getDeckPrice(currentDeckId);
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
}

function openBuyDeckModal() {
  document.getElementById('buy-deck-modal').classList.remove('hidden');
  document.getElementById('decklist-preview').classList.add('hidden');
}

function generateDeckList() {
  // Build deck list in TCGPlayer format with set codes
  const mainboard = currentDeck.cards
    .filter(c => !c.is_sideboard)
    .map(c => `${c.quantity} ${c.name} [${c.set_code}]`)
    .join('\n');

  const sideboard = currentDeck.cards
    .filter(c => c.is_sideboard)
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

  // Render mana curve chart
  const manaCurve = document.getElementById('mana-curve');
  const totalCurveCards = stats.manaCurve.reduce((sum, item) => sum + item.total_cards, 0);

  if (totalCurveCards === 0) {
    manaCurve.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 2rem;">No cards in deck</div>';
  } else {
    // Determine which values need overflow labels (less than 5% of total)
    const overflowThreshold = 0.05;

    manaCurve.innerHTML = `
      <div class="mana-curve-container" style="padding-top: 2rem; position: relative;">
        <div class="mana-curve-single-bar" style="overflow: visible;">
          ${stats.manaCurve.map(item => {
            const percentage = (item.total_cards / totalCurveCards) * 100;
            const cmcColor = getCMCColor(item.cmc);
            const needsOverflow = percentage < (overflowThreshold * 100);
            const isFiltered = currentFilter.cmc === item.cmc;

            return `
              <div class="mana-curve-segment ${isFiltered ? 'filtered' : ''}"
                   data-cmc="${item.cmc}"
                   style="width: ${percentage}%; background: ${cmcColor}; cursor: pointer; position: relative; ${needsOverflow ? 'overflow: visible;' : ''}"
                   title="${item.cmc} CMC: ${item.total_cards} cards (${percentage.toFixed(1)}%)">
                ${needsOverflow ? `
                  <span class="mana-curve-overflow-label" style="position: absolute; bottom: calc(100% + 0.25rem); left: 50%; transform: translateX(-50%); font-size: 0.75rem; font-weight: 600; white-space: nowrap; padding: 0.25rem 0.5rem; background: ${cmcColor}; border-radius: 4px; color: white; text-shadow: 0 1px 2px rgba(0,0,0,0.5); z-index: 10;">${item.cmc}</span>
                ` : `
                  <span class="mana-curve-segment-label">${item.cmc}</span>
                `}
              </div>
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
  // Color gradient based on mana value
  if (cmc === 0) return '#94a3b8'; // Gray for 0
  if (cmc <= 2) return '#10b981'; // Green for low cost
  if (cmc <= 4) return '#f59e0b'; // Yellow/Orange for mid cost
  if (cmc <= 6) return '#ef4444'; // Red for high cost
  return '#7c3aed'; // Purple for very high cost
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

    // Hover preview
    cardEl.addEventListener('mouseenter', (e) => {
      const img = cardEl.querySelector('img');
      if (img && img.src) {
        showCardPreview(img.src, e);
      }
    });

    cardEl.addEventListener('mouseleave', () => {
      hideCardPreview();
    });
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
