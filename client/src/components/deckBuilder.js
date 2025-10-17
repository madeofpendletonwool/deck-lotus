import api from '../services/api.js';
import { showLoading, hideLoading, debounce, formatMana, showToast } from '../utils/ui.js';
import { showCardDetail } from './cards.js';

let currentDeck = null;
let currentDeckId = null;
let searchTimeout = null;

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

  // Listen for open deck event
  window.addEventListener('open-deck', async (e) => {
    const { deckId } = e.detail;
    await loadDeck(deckId);
    showDeckBuilder();
  });
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

    // Populate deck info
    document.getElementById('deck-name').value = currentDeck.name;
    document.getElementById('deck-format').value = currentDeck.format || '';

    // Render deck cards
    renderDeckCards();

    // Load and render stats
    await loadDeckStats();

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

  const mainboardCards = currentDeck.cards.filter(c => !c.is_sideboard);
  const sideboardCards = currentDeck.cards.filter(c => c.is_sideboard);

  // Update counts
  const mainboardTotal = mainboardCards.reduce((sum, c) => sum + c.quantity, 0);
  const sideboardTotal = sideboardCards.reduce((sum, c) => sum + c.quantity, 0);

  document.getElementById('mainboard-count').textContent = mainboardTotal;
  document.getElementById('sideboard-count').textContent = sideboardTotal;

  mainboard.innerHTML = renderCardsList(mainboardCards);
  sideboard.innerHTML = renderCardsList(sideboardCards);

  // Add event listeners
  setupCardControls();
}

function renderCardsList(cards) {
  if (cards.length === 0) {
    return '<div style="padding: 2rem; text-align: center; color: var(--text-secondary);">No cards yet</div>';
  }

  // Group cards by type
  const grouped = {};
  const typeOrder = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Enchantment', 'Artifact', 'Land', 'Other'];

  cards.forEach(card => {
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
  if (compactView) {
    return `
      <div class="deck-card-item compact" data-deck-card-id="${card.deck_card_id}" data-printing-id="${card.printing_id}">
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
            <span class="quantity-display">${card.quantity}</span>
            <button class="quantity-btn btn-increase" data-deck-card-id="${card.deck_card_id}">+</button>
          </div>
          <button class="remove-btn" data-deck-card-id="${card.deck_card_id}">×</button>
        </div>
      </div>
    `;
  }

  return `
    <div class="deck-card-item" data-deck-card-id="${card.deck_card_id}" data-printing-id="${card.printing_id}">
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
          <span class="quantity-display">${card.quantity}</span>
          <button class="quantity-btn btn-increase" data-deck-card-id="${card.deck_card_id}">+</button>
        </div>
        <button class="remove-btn" data-deck-card-id="${card.deck_card_id}">Remove</button>
      </div>
    </div>
  `;
}

function setupCardControls() {
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
      const img = item.querySelector('.deck-card-image, .deck-card-image-compact');
      if (img && img.src) {
        showCardPreview(img.src, e);
      }
    });

    item.addEventListener('mouseleave', () => {
      hideCardPreview();
    });
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

function showCardPreview(imageSrc, event) {
  const preview = document.getElementById('card-preview');
  const img = document.getElementById('card-preview-img');

  // Use large image if available
  const largeImageSrc = imageSrc.replace('/normal/', '/large/') || imageSrc;
  img.src = largeImageSrc;

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

function renderStats(stats) {
  // Render mana curve
  const manaCurve = document.getElementById('mana-curve');
  const maxCount = Math.max(...stats.manaCurve.map(c => c.total_cards), 1);

  manaCurve.innerHTML = stats.manaCurve.map(item => {
    const width = (item.total_cards / maxCount) * 100;
    return `
      <div class="chart-bar">
        <div class="chart-label">${item.cmc}</div>
        <div class="chart-bar-fill" style="width: ${width}%">
          <span class="chart-value">${item.total_cards}</span>
        </div>
      </div>
    `;
  }).join('');

  // Render type distribution
  const typeDistribution = document.getElementById('type-distribution');
  const maxType = Math.max(...stats.typeDistribution.map(c => c.total_cards), 1);

  typeDistribution.innerHTML = stats.typeDistribution.map(item => {
    const width = (item.total_cards / maxType) * 100;
    return `
      <div class="chart-bar">
        <div class="chart-label">${item.type}</div>
        <div class="chart-bar-fill" style="width: ${width}%">
          <span class="chart-value">${item.total_cards}</span>
        </div>
      </div>
    `;
  }).join('');

  // Render color distribution
  const colorDistribution = document.getElementById('color-distribution');
  const maxColor = Math.max(...stats.colorDistribution.map(c => c.total_cards), 1);

  colorDistribution.innerHTML = stats.colorDistribution.map(item => {
    const width = (item.total_cards / maxColor) * 100;
    const colorLabel = item.colors || 'Colorless';
    return `
      <div class="chart-bar">
        <div class="chart-label">${colorLabel}</div>
        <div class="chart-bar-fill" style="width: ${width}%">
          <span class="chart-value">${item.total_cards}</span>
        </div>
      </div>
    `;
  }).join('');
}
