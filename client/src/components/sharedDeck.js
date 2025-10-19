import api from '../services/api.js';
import { showLoading, hideLoading, formatMana, showToast } from '../utils/ui.js';

let sharedDeck = null;
let isAuthenticated = false;

export function setupSharedDeck() {
  // Tab switching
  document.querySelectorAll('#shared-deck-page .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
  });

  // Import shared deck (for logged-in users)
  document.getElementById('import-shared-deck-btn').addEventListener('click', async () => {
    if (!sharedDeck) return;

    try {
      showLoading();
      const token = window.location.pathname.split('/share/')[1];
      const result = await api.importSharedDeck(token);
      hideLoading();
      showToast('Deck imported successfully!', 'success', 3000);

      // Redirect to the newly imported deck
      setTimeout(() => {
        window.location.href = '/';
      }, 1000);
    } catch (error) {
      hideLoading();
      showToast('Failed to import deck: ' + error.message, 'error');
    }
  });

  // Login to import (for non-logged-in users)
  document.getElementById('login-to-import-btn').addEventListener('click', () => {
    // Store the current share token to redirect back after login
    const token = window.location.pathname.split('/share/')[1];
    localStorage.setItem('pendingShareImport', token);
    window.location.href = '/';
  });
}

export async function loadSharedDeck(token) {
  try {
    showLoading();
    const result = await api.getSharedDeck(token);
    sharedDeck = result.deck;
    isAuthenticated = result.isAuthenticated;

    // Populate deck info
    document.getElementById('shared-deck-name').textContent = sharedDeck.name;
    document.getElementById('shared-deck-format').textContent = sharedDeck.format || 'No format';
    if (sharedDeck.description) {
      document.getElementById('shared-deck-description').textContent = sharedDeck.description;
      document.getElementById('shared-deck-description').classList.remove('hidden');
    } else {
      document.getElementById('shared-deck-description').classList.add('hidden');
    }

    // Show appropriate import button
    if (isAuthenticated) {
      document.getElementById('import-shared-deck-btn').classList.remove('hidden');
      document.getElementById('login-to-import-btn').classList.add('hidden');
    } else {
      document.getElementById('import-shared-deck-btn').classList.add('hidden');
      document.getElementById('login-to-import-btn').classList.remove('hidden');
    }

    // Render deck cards
    renderSharedDeckCards();

    // Render stats
    renderSharedDeckStats();

    // Show the shared deck page
    document.querySelectorAll('.page').forEach(page => page.classList.add('hidden'));
    document.getElementById('shared-deck-page').classList.remove('hidden');

    // Hide navbar for public view
    document.getElementById('navbar').classList.add('hidden');

    hideLoading();
  } catch (error) {
    hideLoading();
    showToast('Failed to load shared deck: ' + error.message, 'error');
    // Redirect to home after error
    setTimeout(() => {
      window.location.href = '/';
    }, 2000);
  }
}

function renderSharedDeckCards() {
  const mainboard = document.getElementById('shared-mainboard');
  const sideboard = document.getElementById('shared-sideboard');

  const mainboardCards = sharedDeck.cards.filter(c => !c.is_sideboard);
  const sideboardCards = sharedDeck.cards.filter(c => c.is_sideboard);

  // Update counts
  const mainboardTotal = mainboardCards.reduce((sum, c) => sum + c.quantity, 0);
  const sideboardTotal = sideboardCards.reduce((sum, c) => sum + c.quantity, 0);

  document.getElementById('shared-mainboard-count').textContent = mainboardTotal;
  document.getElementById('shared-sideboard-count').textContent = sideboardTotal;

  mainboard.innerHTML = renderCardsList(mainboardCards);
  sideboard.innerHTML = renderCardsList(sideboardCards);
}

function renderCardsList(cards) {
  if (cards.length === 0) {
    return '<div style="padding: 2rem; text-align: center; color: var(--text-secondary);">No cards</div>';
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
  return `
    <div class="deck-card-item" style="cursor: default;">
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
        <span class="quantity-display" style="font-weight: 600; font-size: 1.2rem;">${card.quantity}x</span>
      </div>
    </div>
  `;
}

function switchTab(tab) {
  document.querySelectorAll('#shared-deck-page .tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  document.querySelectorAll('#shared-deck-page .deck-list').forEach(list => {
    list.classList.toggle('hidden', list.id !== tab);
    list.classList.toggle('active', list.id === tab);
  });
}

function renderSharedDeckStats() {
  // Calculate mana curve
  const manaCurve = {};
  sharedDeck.cards.filter(c => !c.is_sideboard).forEach(card => {
    const cmc = Math.floor(card.cmc || 0);
    if (!manaCurve[cmc]) {
      manaCurve[cmc] = 0;
    }
    manaCurve[cmc] += card.quantity;
  });

  const manaCurveArray = Object.keys(manaCurve).map(cmc => ({
    cmc: parseInt(cmc),
    total_cards: manaCurve[cmc]
  })).sort((a, b) => a.cmc - b.cmc);

  // Calculate type distribution
  const typeDistribution = {};
  sharedDeck.cards.filter(c => !c.is_sideboard).forEach(card => {
    const typeLine = card.type_line || '';
    let type = 'Other';

    if (typeLine.includes('Creature')) type = 'Creature';
    else if (typeLine.includes('Instant')) type = 'Instant';
    else if (typeLine.includes('Sorcery')) type = 'Sorcery';
    else if (typeLine.includes('Enchantment')) type = 'Enchantment';
    else if (typeLine.includes('Artifact')) type = 'Artifact';
    else if (typeLine.includes('Planeswalker')) type = 'Planeswalker';
    else if (typeLine.includes('Land')) type = 'Land';

    if (!typeDistribution[type]) {
      typeDistribution[type] = 0;
    }
    typeDistribution[type] += card.quantity;
  });

  const typeDistributionArray = Object.keys(typeDistribution).map(type => ({
    type,
    total_cards: typeDistribution[type]
  }));

  // Calculate color distribution
  const colorDistribution = {};
  sharedDeck.cards.filter(c => !c.is_sideboard).forEach(card => {
    const colors = card.colors || '';
    if (!colorDistribution[colors]) {
      colorDistribution[colors] = 0;
    }
    colorDistribution[colors] += card.quantity;
  });

  const colorDistributionArray = Object.keys(colorDistribution).map(colors => ({
    colors,
    total_cards: colorDistribution[colors]
  }));

  // Render stats
  renderStats({
    manaCurve: manaCurveArray,
    typeDistribution: typeDistributionArray,
    colorDistribution: colorDistributionArray
  });
}

function renderStats(stats) {
  // Render mana curve
  const manaCurve = document.getElementById('shared-mana-curve');
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

  // Render type distribution
  const typeDistribution = document.getElementById('shared-type-distribution');
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

  // Render color distribution
  const colorDistribution = document.getElementById('shared-color-distribution');
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
  if (cmc === 0) return '#94a3b8';
  if (cmc <= 2) return '#10b981';
  if (cmc <= 4) return '#f59e0b';
  if (cmc <= 6) return '#ef4444';
  return '#7c3aed';
}

function formatColorIcons(colors) {
  if (!colors) return '<i class="ms ms-c ms-cost"></i>';
  return colors.split('').map(color => {
    const colorLower = color.toLowerCase();
    return `<i class="ms ms-${colorLower} ms-cost ms-cost-shadow"></i>`;
  }).join('');
}

function getColorBackground(colors) {
  if (!colors) return 'linear-gradient(135deg, #d0c6bb, #a8a8a8)';

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

  return `linear-gradient(135deg, ${colorValues.join(', ')})`;
}

function adjustBrightness(color, amount) {
  const hex = color.replace('#', '');
  const num = parseInt(hex, 16);
  const r = Math.max(0, Math.min(255, (num >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amount));
  const b = Math.max(0, Math.min(255, (num & 0x0000FF) + amount));
  return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
}
