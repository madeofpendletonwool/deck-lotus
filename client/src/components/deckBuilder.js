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
  // Render mana curve as single segmented bar
  const manaCurve = document.getElementById('mana-curve');
  const totalCards = stats.manaCurve.reduce((sum, item) => sum + item.total_cards, 0);

  if (totalCards === 0) {
    manaCurve.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 2rem;">No cards in deck</div>';
  } else {
    manaCurve.innerHTML = `
      <div class="mana-curve-single-bar">
        ${stats.manaCurve.map(item => {
          const percentage = (item.total_cards / totalCards) * 100;
          const cmcColor = getCMCColor(item.cmc);
          return `
            <div class="mana-curve-segment"
                 style="width: ${percentage}%; background: ${cmcColor};"
                 title="${item.cmc} CMC: ${item.total_cards} cards (${percentage.toFixed(1)}%)">
              <span class="mana-curve-segment-label">${item.cmc}</span>
            </div>
          `;
        }).join('')}
      </div>
    `;
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
    return `
      <div class="chart-bar" title="${item.total_cards} cards (${percentage}%)">
        <div class="chart-label color-label">${colorIcons}</div>
        <div class="chart-bar-container">
          <div class="chart-bar-fill" style="width: ${width}%; background: ${colorBg};">
            <span class="chart-value">${item.total_cards}</span>
          </div>
          <span class="chart-percentage">${percentage}%</span>
        </div>
      </div>
    `;
  }).join('');
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

  // Split individual color letters and create mana icons
  return colors.split('').map(color => {
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
