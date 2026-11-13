import api from '../services/api.js';
import { showLoading, hideLoading, debounce, formatMana, showToast, hideModal, copyText } from '../utils/ui.js';
import { showCardDetail } from './cards.js';
import { setupExportModal, openExportModal } from './exportModal.js';
import { PRINTING_SORTS, printingPrice, printingFinishNote, formatPrice, sortPrintings, uniquePrintings, printingMatches, priceRange } from '../utils/printings.js';
import { resolveRules, canLead, canPairCommanders, isCubeFormat, getFormat, formatLabel, deckSizeLabel, TWO_HEADED_GIANT_BASES } from '../../../shared/formats.js';
import { fillFormatSelect, formatOptionsHtml } from '../utils/formatUi.js';
import { compileQuery } from '../utils/cardQuery.js';
import { setupCubeTools, setCubeMode, renderCubeBoard, refreshCube, cubeViewShowsList, clearCubeSelection } from './cubeTools.js';
import { DeckTools } from './deckAnalysis.js';
import { DeckCollection } from './deckCollection.js';
import { missingRows } from '../../../shared/collection.js';
import { shuffle } from '../utils/cube.js';
import { hypergeometricAtLeast } from '../utils/manaMath.js';

let currentDeck = null;
let currentDeckId = null;
let searchController = null; // Aborts the in-flight search when a newer one starts
let activeResultIndex = -1;
let saveTimer = null;
let currentFilter = { cmc: null, color: null, ownership: null }; // Filter state for deck cards (null, 'owned', 'not-owned')
let deckFilterQuery = ''; // Name filter for deck cards
let exampleHand = []; // Current example hand
let deckView = 'build'; // 'build' | 'analysis' | 'playtest' | 'collection' (decks that aren't cubes)
let deckTools = null; // Analysis and playtest views
let deckCollection = null; // The deck against your collection
let activeTab = 'mainboard'; // Track which tab is currently active ('mainboard', 'sideboard', or 'maybeboard')
let pricingMode = false; // Track if pricing mode is enabled
let setGroupMode = false; // Track if set grouping mode is enabled
let currentPriceData = null; // Store current price data for cards
let printingSort = PRINTING_SORTS[0].value; // Printing picker sort, kept between cards
let optimizerState = {
  suggestions: [],
  currentIndex: 0,
  currentSelection: null,
  availableSets: []
}; // Store printing optimizer state

// Which board a deck card belongs to. board_type is authoritative; is_sideboard is
// the legacy fallback for rows written before maybeboard existed. Note maybeboard rows
// carry is_sideboard = 0, so `!is_sideboard` must never be used to mean "mainboard".
function boardOf(card) {
  return card.board_type || (card.is_sideboard ? 'sideboard' : 'mainboard');
}
const isMainboardCard = (c) => boardOf(c) === 'mainboard';
const isSideboardCard = (c) => boardOf(c) === 'sideboard';
const isMaybeboardCard = (c) => boardOf(c) === 'maybeboard';

// Detect if device is touch-enabled (mobile/tablet)
function isTouchDevice() {
  return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (navigator.msMaxTouchPoints > 0);
}

export function setupDeckBuilder() {
  const cardSearch = document.getElementById('card-search');
  const searchResults = document.getElementById('search-results');
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

  // Card search. Results are fast enough to feel live, so the debounce only needs to skip
  // the keystrokes inside a word.
  const debouncedSearch = debounce(runCardSearch, 90);
  cardSearch.addEventListener('input', (e) => debouncedSearch(e.target.value));
  cardSearch.addEventListener('keydown', handleSearchKeydown);
  cardSearch.addEventListener('focus', () => {
    if (cardSearch.value.trim().length >= 2 && searchResults.children.length > 0) {
      setSearchResultsOpen(true);
    }
  });
  searchResults.addEventListener('click', (e) => {
    const item = e.target.closest('.search-result-item');
    if (item) addSearchResult(item);
  });
  searchResults.addEventListener('mousemove', (e) => {
    const item = e.target.closest('.search-result-item');
    if (item) setActiveResult([...searchResults.querySelectorAll('.search-result-item')].indexOf(item));
  });

  // "/" jumps to the card search from anywhere in the deck builder
  document.addEventListener('keydown', (e) => {
    const builderOpen = !document.getElementById('deck-builder-page').classList.contains('hidden');
    const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
    if (e.key === '/' && builderOpen && !typing && !e.metaKey && !e.ctrlKey && !document.querySelector('.modal:not(.hidden)')) {
      e.preventDefault();
      cardSearch.focus();
    }
  });

  // Deck filter search
  const deckFilterSearch = document.getElementById('deck-filter-search');
  const deckFilterClear = document.getElementById('deck-filter-clear');

  deckFilterSearch.addEventListener('input', (e) => {
    deckFilterQuery = e.target.value.toLowerCase();
    // Show/hide clear button
    if (deckFilterQuery) {
      deckFilterClear.classList.remove('hidden');
    } else {
      deckFilterClear.classList.add('hidden');
    }
    renderDeckCards();
  });

  deckFilterClear.addEventListener('click', () => {
    deckFilterSearch.value = '';
    deckFilterQuery = '';
    deckFilterClear.classList.add('hidden');
    renderDeckCards();
  });

  // Click outside to close search results
  document.addEventListener('click', (e) => {
    if (!cardSearch.contains(e.target) && !searchResults.contains(e.target)) {
      setSearchResultsOpen(false);
    }
  });

  // Name and format save themselves
  const queueSave = () => {
    clearTimeout(saveTimer);
    setSaveStatus('Saving…');
    saveTimer = setTimeout(saveDeckDetails, 500);
  };
  deckNameInput.addEventListener('input', queueSave);
  fillFormatSelect(deckFormatSelect, { noneLabel: 'No format' });
  deckFormatSelect.addEventListener('change', () => {
    if (currentDeck) {
      const wasCube = isCubeFormat(currentDeck.format);
      currentDeck.format = deckFormatSelect.value;
      // A deck turned into a cube gets the default draft settings
      if (!wasCube && isCubeFormat(currentDeck.format) && !currentDeck.settings?.packSize) {
        currentDeck.settings = { ...(currentDeck.settings || {}), targetSize: 360, packSize: 15, packsPerPlayer: 3, seats: 8, singleton: true, cardPool: '' };
      }
      applyFormatMode();
      renderDeckCards(); // Commander controls depend on the format
    }
    queueSave();
  });

  document.getElementById('deck-format-options-btn').addEventListener('click', openFormatOptions);
  document.getElementById('deck-format-status').addEventListener('click', () => showLegalityModal(currentDeck?.format));

  // Cube views live in their own module; it reads and replaces the deck through these hooks
  setupCubeTools({
    getDeck: () => currentDeck,
    getDeckId: () => currentDeckId,
    setDeck: async (deck) => {
      currentDeck = deck;
      renderDeckCards();
      await loadDeckStats();
    },
    saveSettings: (settings) => saveDeckSettings(settings),
    openPrinting: (cardId, deckCardId) => showPrintingSelectionModal(cardId, deckCardId),
    showCard: (printingId) => showCardModal(printingId),
    getFilter: () => deckFilterPredicate(),
    getActiveBoard: () => activeTab,
    rerender: () => renderDeckCards(),
  });

  // Analysis and playtest views for decks that aren't cubes
  deckTools = new DeckTools({
    container: document.getElementById('deck-view'),
    getDeck: () => currentDeck,
    showCard: (card) => card.card_id && showCardDetail(card.card_id),
    preview: (src, e) => showCardPreview(src, e),
    hidePreview: () => hideCardPreview(),
  });
  // Collection view: what you own of the deck, what the rest costs, what in your binder fits
  deckCollection = new DeckCollection({
    container: document.getElementById('deck-collection-view'),
    getDeck: () => currentDeck,
    fetchReport: () => api.getDeckCollection(currentDeckId),
    fetchBinder: (params) => api.getBinderFits(currentDeckId, params),
    addCard: (card) => addOwnedCard(card),
    buyMissing: () => {
      openBuyDeckModal();
      document.getElementById('copy-non-owned-only').checked = true;
    },
    showCard: (card) => card.card_id && showCardDetail(card.card_id),
    preview: (src, e) => showCardPreview(src, e),
    hidePreview: () => hideCardPreview(),
  });
  document.querySelectorAll('.deck-view-btn').forEach((btn) => {
    btn.addEventListener('click', () => setDeckView(btn.dataset.deckView));
  });
  document.getElementById('playtest-hand-btn').addEventListener('click', () => setDeckView('playtest'));

  // Buy Deck Modal
  buyDeckBtn.addEventListener('click', () => {
    if (!currentDeck || !currentDeck.cards || currentDeck.cards.length === 0) {
      showToast('Add some cards first', 'warning');
      return;
    }
    openBuyDeckModal();
  });

  document.getElementById('buy-modal-close').addEventListener('click', () => {
    document.getElementById('buy-deck-modal').classList.add('hidden');
  });

  // Buy modal tab switching
  document.querySelectorAll('.buy-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.buy-tab-btn').forEach(b => {
        b.classList.remove('active');
        b.style.borderBottom = 'none';
        b.style.color = 'var(--text-secondary)';
        b.style.fontWeight = 'normal';
      });
      btn.classList.add('active');
      btn.style.borderBottom = '2px solid var(--primary)';
      btn.style.color = 'var(--primary)';
      btn.style.fontWeight = '600';
      const tab = btn.dataset.buyTab;
      document.getElementById('buy-tab-optimizer').classList.toggle('hidden', tab !== 'optimizer');
      document.getElementById('buy-tab-export').classList.toggle('hidden', tab !== 'export');
    });
  });

  // Optimizer button
  document.getElementById('run-optimizer-btn').addEventListener('click', async () => {
    const nonOwnedOnly = document.getElementById('copy-non-owned-only')?.checked || false;
    let cards = (currentDeck?.cards || []).filter((c) => !isMaybeboardCard(c));
    if (nonOwnedOnly) cards = missingRows(cards);
    if (!cards.length) { showToast(nonOwnedOnly ? 'You own every card in this deck' : 'No cards to optimize', 'warning'); return; }

    const model = document.getElementById('optimizer-strategy').value;
    const btn = document.getElementById('run-optimizer-btn');
    const resultsEl = document.getElementById('optimizer-results');
    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-spinner"></i> Optimizing…';
    resultsEl.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-secondary);">Finding best deals across Mana Pool sellers…</div>';

    const items = cards.map(c => ({ name: c.name, quantity: c.quantity ?? 1 }));
    try {
      const result = await api.manaPoolOptimize(items, model);
      renderOptimizerResults(result, resultsEl);
    } catch (err) {
      resultsEl.innerHTML = `<div style="color:#f87171;padding:1rem;border-radius:6px;background:rgba(248,113,113,0.1);">
        <i class="ph ph-warning"></i> ${err.message}
        ${!err.message.includes('token') ? '' : '<br><small>Set MANAPOOL_API_TOKEN in your server .env file.</small>'}
      </div>`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="ph ph-magic-wand"></i> Optimize Cart';
    }
  });

  // Deck Validator modal
  document.getElementById('deck-validator-close').addEventListener('click', () => {
    document.getElementById('deck-validator-modal').classList.add('hidden');
  });

  document.getElementById('run-validator-btn').addEventListener('click', async () => {
    if (!currentDeck?.cards?.length) { showToast('No cards in deck', 'warning'); return; }
    const format = document.getElementById('validator-format').value;
    const resultsEl = document.getElementById('validator-results');
    const btn = document.getElementById('run-validator-btn');
    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-spinner"></i> Validating…';
    resultsEl.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-secondary);">Checking deck with Mana Pool…</div>';

    const decklist = currentDeck.cards
      .filter(isMainboardCard)
      .map(c => `${c.quantity} ${c.name}`)
      .join('\n');

    try {
      const result = await api.manaPoolValidateDeck(decklist, format);
      renderValidatorResults(result, resultsEl);
    } catch (err) {
      resultsEl.innerHTML = `<div style="color:#f87171;padding:1rem;border-radius:6px;background:rgba(248,113,113,0.1);">
        <i class="ph ph-warning"></i> ${err.message}
        ${!err.message.includes('token') ? '' : '<br><small>Set MANAPOOL_API_TOKEN in your server .env file.</small>'}
      </div>`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="ph ph-shield-check"></i> Validate';
    }
  });

  // TCGPlayer export
  document.querySelector('#buy-tcgplayer .btn').addEventListener('click', () => {
    exportToTCGPlayer();
  });

  // Mana Pool export
  document.querySelector('#buy-manapool .btn').addEventListener('click', () => {
    exportToManapool();
  });

  // Copy decklist button
  document.getElementById('copy-decklist').addEventListener('click', () => {
    const deckText = generateDeckList();
    copyText(deckText).then((copied) => {
      showToast(copied ? 'Deck list copied to clipboard!' : 'Failed to copy', copied ? 'success' : 'error', 2000);
      document.getElementById('decklist-preview').classList.remove('hidden');
      document.getElementById('decklist-text').value = deckText;
    });
  });

  // Layout view toggle - cycles through: compact -> ultra-compact -> full
  updateLayoutButton();
  document.getElementById('toggle-compact-btn').addEventListener('click', () => {
    const order = ['compact', 'ultra-compact', 'full'];
    layoutView = order[(order.indexOf(layoutView) + 1) % order.length];
    try {
      localStorage.setItem(LAYOUT_PREFERENCE_KEY, layoutView);
    } catch {
      // A remembered density is only a convenience.
    }
    updateLayoutButton();
    renderDeckCards();
  });

  // Export deck button
  setupExportModal();
  document.getElementById('export-deck-btn').addEventListener('click', () => {
    if (!currentDeck?.cards?.length) {
      showToast('Add some cards first', 'warning');
      return;
    }
    openExportModal(currentDeck, { prices: currentPriceData?.cardPrices });
  });

  // Back to decks
  backToDecksBtn.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', { detail: { path: '/decks' } }));
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
    copyText(input.value).then((copied) => {
      showToast(copied ? 'Share link copied to clipboard!' : 'Failed to copy', copied ? 'success' : 'error', 2000);
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

  // Printing Optimizer button
  document.getElementById('optimize-printings-btn').addEventListener('click', () => {
    if (!currentDeck || !currentDeck.cards || currentDeck.cards.length === 0) {
      showToast('Add some cards first', 'warning');
      return;
    }
    openPrintingOptimizer();
  });

  // Printing Optimizer modal close
  document.getElementById('optimizer-modal-close').addEventListener('click', () => {
    closePrintingOptimizer();
  });

  document.getElementById('cancel-optimization-btn').addEventListener('click', () => {
    closePrintingOptimizer();
  });

  // Optimizer tab switching
  document.getElementById('optimizer-tab-auto').addEventListener('click', () => {
    switchOptimizerTab('auto');
  });

  document.getElementById('optimizer-tab-manual').addEventListener('click', () => {
    switchOptimizerTab('manual');
  });

  // Optimizer navigation
  document.getElementById('prev-suggestion-btn').addEventListener('click', () => {
    if (optimizerState.currentIndex > 0) {
      optimizerState.currentIndex--;
      displayCurrentSuggestion();
    }
  });

  document.getElementById('next-suggestion-btn').addEventListener('click', () => {
    if (optimizerState.currentIndex < optimizerState.suggestions.length - 1) {
      optimizerState.currentIndex++;
      displayCurrentSuggestion();
    }
  });

  // Manual set analysis
  document.getElementById('analyze-manual-set-btn').addEventListener('click', async () => {
    const setCode = document.getElementById('manual-set-select').value;
    if (!setCode) {
      showToast('Please select a set', 'warning');
      return;
    }
    await analyzeManualSet(setCode);
  });

  // Apply optimization
  document.getElementById('apply-optimization-btn').addEventListener('click', async () => {
    await applyOptimization();
  });

  // Commander sets exclusion checkbox
  document.getElementById('exclude-commander-sets').addEventListener('change', async (e) => {
    if (optimizerState.suggestions.length > 0) {
      // Reload suggestions with new filter
      await reloadOptimizerSuggestions();
    }
  });

  // Listen for open deck event
  window.addEventListener('open-deck', async (e) => {
    const { deckId, view } = e.detail;
    // Moving between this deck's own views (back/forward) doesn't reload it
    const builderOpen = !document.getElementById('deck-builder-page').classList.contains('hidden');
    if (builderOpen && currentDeck && String(deckId) === String(currentDeckId)) {
      setDeckView(view, { push: false });
      return;
    }
    showDeckBuilder();
    deckView = view || 'build';
    await loadDeck(deckId);
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

    // Clear previous example hand and playtest game
    exampleHand = [];
    deckTools.reset();
    deckCollection.reset();

    // Populate deck info
    document.getElementById('deck-name').value = currentDeck.name;
    // Formats from before this list existed are still shown, not silently dropped
    const formatSelect = document.getElementById('deck-format');
    fillFormatSelect(formatSelect, { selected: currentDeck.format || '', noneLabel: 'No format' });
    if (currentDeck.format && !getFormat(currentDeck.format)) {
      formatSelect.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(currentDeck.format)}">${escapeHtml(currentDeck.format)}</option>`);
      formatSelect.value = currentDeck.format;
    }
    document.title = `${currentDeck.name} · Deck Lotus`;
    setSaveStatus('');
    clearCubeSelection();
    applyFormatMode();

    // Render deck cards
    renderDeckCards();

    // Load and render stats
    await loadDeckStats();

    // Auto-deal example hand (quietly: an empty deck just shows the empty state)
    dealExampleHand({ silent: true });

    hideLoading();
  } catch (error) {
    hideLoading();
    showToast('Failed to load deck: ' + error.message, 'error');
    window.dispatchEvent(new CustomEvent('navigate', { detail: { path: '/decks', replace: true } }));
  }
}

/**
 * Persist the deck's name and format. Shows progress quietly next to the title, since this runs
 * on its own and shouldn't interrupt anything.
 */
async function saveDeckDetails() {
  if (!currentDeckId) return;
  const name = document.getElementById('deck-name').value.trim();
  if (!name) {
    setSaveStatus('A deck needs a name');
    return;
  }
  try {
    await api.updateDeck(currentDeckId, { name, format: document.getElementById('deck-format').value, settings: currentDeck.settings || {} });
    currentDeck.name = name;
    document.title = `${name} · Deck Lotus`;
    setSaveStatus('Saved');
  } catch (error) {
    setSaveStatus('');
    showToast('Failed to save deck: ' + error.message, 'error');
  }
}

function setSaveStatus(text) {
  document.getElementById('deck-save-status').textContent = text;
}

function setSearchResultsOpen(open) {
  document.getElementById('search-results').classList.toggle('hidden', !open);
  document.getElementById('card-search').setAttribute('aria-expanded', String(open));
}

function showSearchMessage(html) {
  document.getElementById('search-results').innerHTML = `<div class="search-message">${html}</div>`;
  activeResultIndex = -1;
  setSearchResultsOpen(true);
}

async function runCardSearch(rawQuery) {
  const query = rawQuery.trim();
  searchController?.abort();

  if (query.length < 2) {
    setSearchResultsOpen(false);
    return;
  }

  const controller = new AbortController();
  searchController = controller;

  // Only shows up if the server is actually slow, so normal typing never flickers.
  const slowNotice = setTimeout(() => showSearchMessage('Searching…'), 250);

  try {
    const result = await api.searchCards(query, 20, null, { signal: controller.signal });
    if (!controller.signal.aborted) displaySearchResults(result.cards);
  } catch (error) {
    if (error.name === 'AbortError') return;
    console.error('Search error:', error);
    showSearchMessage(`Search failed: ${escapeHtml(error.message)}. Keep typing to try again.`);
  } finally {
    clearTimeout(slowNotice);
  }
}

function displaySearchResults(cards) {
  const searchResults = document.getElementById('search-results');

  if (cards.length === 0) {
    showSearchMessage('No cards found');
    return;
  }

  searchResults.innerHTML = cards.map((card, index) => `
    <div class="search-result-item" role="option" id="search-result-${index}" data-card-id="${card.id}" data-printing-id="${card.printing_id ?? ''}" data-card-name="${escapeHtml(card.name)}">
      ${card.small_image_url ? `<img src="${card.small_image_url}" class="search-result-image" width="36" height="50" alt="" loading="lazy" decoding="async" onerror="this.style.visibility='hidden'">` : '<span class="search-result-image"></span>'}
      <div class="search-result-text">
        <div class="card-name">${escapeHtml(card.name)}</div>
        <div class="card-type">${escapeHtml(card.type_line || '')}</div>
      </div>
      <div class="card-mana">${formatMana(card.mana_cost)}</div>
    </div>
  `).join('');

  setActiveResult(0);
  setSearchResultsOpen(true);
}

function setActiveResult(index) {
  const items = document.querySelectorAll('#search-results .search-result-item');
  if (index === activeResultIndex && items[index]?.classList.contains('active')) return;
  activeResultIndex = items.length ? (index + items.length) % items.length : -1;

  items.forEach((item, i) => {
    const isActive = i === activeResultIndex;
    item.classList.toggle('active', isActive);
    item.setAttribute('aria-selected', String(isActive));
    if (isActive) {
      document.getElementById('card-search').setAttribute('aria-activedescendant', item.id);
      item.scrollIntoView({ block: 'nearest' });
    }
  });
}

function handleSearchKeydown(e) {
  const results = document.getElementById('search-results');
  const isOpen = !results.classList.contains('hidden');

  if (e.key === 'Escape') {
    if (isOpen) {
      e.stopPropagation();
      setSearchResultsOpen(false);
    }
  } else if (isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    setActiveResult(activeResultIndex + (e.key === 'ArrowDown' ? 1 : -1));
  } else if (isOpen && e.key === 'Enter') {
    e.preventDefault();
    const active = results.querySelectorAll('.search-result-item')[activeResultIndex];
    if (active) addSearchResult(active);
  }
}

function addSearchResult(item) {
  const input = document.getElementById('card-search');
  searchController?.abort();
  input.value = '';
  setSearchResultsOpen(false);
  input.focus(); // Ready for the next card
  addCardToDeck(item.dataset.cardId, item.dataset.printingId, item.dataset.cardName);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML.replace(/"/g, '&quot;');
}

async function addCardToDeck(cardId, knownPrintingId = null, cardName = 'Card') {
  try {
    let printingId = knownPrintingId;
    if (!printingId) {
      const { printings } = await api.getCardPrintings(cardId);
      if (printings.length === 0) {
        showToast('No printings found for this card', 'warning');
        return;
      }
      printingId = printings[0].id;
    }

    // A singleton cube usually wants one of each; say so rather than refuse
    const alreadyIn = isCubeFormat(currentDeck.format) && currentDeck.settings?.singleton !== false &&
      currentDeck.cards.some((c) => c.card_id == cardId && boardOf(c) === activeTab);

    // Add card to the currently active tab (mainboard, sideboard, or maybeboard)
    const updatedDeck = await api.addCardToDeck(currentDeckId, printingId, 1, activeTab === 'sideboard', false, activeTab);
    currentDeck = updatedDeck.deck;
    renderDeckCards();
    const boardName = isCubeFormat(currentDeck.format) && activeTab === 'mainboard' ? 'the cube' : activeTab;
    if (alreadyIn) showToast(`${cardName} was already in ${boardName}; this cube is singleton`, 'warning', 3000);
    else showToast(`Added ${cardName} to ${boardName}`, 'success', 1500);
    await loadDeckStats();
  } catch (error) {
    showToast('Failed to add card: ' + error.message, 'error');
  }
}

/** Add a card from your binder to the main deck, as the printing you own. */
async function addOwnedCard(card) {
  const deckId = currentDeckId;
  const updated = await api.addCardToDeck(deckId, card.printing_id, 1, false, false, 'mainboard');
  if (deckId !== currentDeckId) return; // Another deck was opened meanwhile
  currentDeck = updated.deck;
  renderDeckCards();
  showToast(`Added ${card.name} to the main deck`, 'success', 1500);
  loadDeckStats();
}

const smallImage = (url) => (url ? url.replace('/normal/', '/small/') : '');

const LAYOUT_PREFERENCE_KEY = 'deckListLayout';
const LAYOUT_ICONS = { compact: 'ph-rows', 'ultra-compact': 'ph-list', full: 'ph-squares-four' };

function loadLayoutPreference() {
  try {
    const saved = localStorage.getItem(LAYOUT_PREFERENCE_KEY);
    return LAYOUT_ICONS[saved] ? saved : 'compact';
  } catch {
    return 'compact';
  }
}

let layoutView = loadLayoutPreference(); // Can be 'compact', 'ultra-compact', or 'full'

function updateLayoutButton() {
  document.getElementById('toggle-compact-btn').innerHTML = `<i class="ph ${LAYOUT_ICONS[layoutView]}"></i>`;
}

function renderDeckCards() {
  const mainboard = document.getElementById('mainboard');
  const sideboard = document.getElementById('sideboard');
  const maybeboard = document.getElementById('maybeboard');

  // Filter cards by board type (board_type authoritative, is_sideboard legacy fallback)
  let mainboardCards = currentDeck.cards.filter(isMainboardCard);
  let sideboardCards = currentDeck.cards.filter(isSideboardCard);
  let maybeboardCards = currentDeck.cards.filter(isMaybeboardCard);

  // Apply filters
  const hasFilter = currentFilter.cmc !== null || currentFilter.color !== null || currentFilter.ownership !== null || deckFilterQuery;

  // Apply name filter
  if (deckFilterQuery) {
    // Plain text matches names; "t:creature c:r mv<=2 #aggro" style searches work too
    const matches = deckFilterPredicate();
    mainboardCards = mainboardCards.filter(matches);
    sideboardCards = sideboardCards.filter(matches);
    maybeboardCards = maybeboardCards.filter(matches);
  }

  if (currentFilter.cmc !== null) {
    mainboardCards = mainboardCards.filter(c => calculateActualCMC(c) === currentFilter.cmc);
    sideboardCards = sideboardCards.filter(c => calculateActualCMC(c) === currentFilter.cmc);
    maybeboardCards = maybeboardCards.filter(c => calculateActualCMC(c) === currentFilter.cmc);
  }

  if (currentFilter.color !== null) {
    mainboardCards = mainboardCards.filter(c => c.colors === currentFilter.color);
    sideboardCards = sideboardCards.filter(c => c.colors === currentFilter.color);
    maybeboardCards = maybeboardCards.filter(c => c.colors === currentFilter.color);
  }

  if (currentFilter.ownership === 'owned') {
    mainboardCards = mainboardCards.filter(c => c.is_owned);
    sideboardCards = sideboardCards.filter(c => c.is_owned);
    maybeboardCards = maybeboardCards.filter(c => c.is_owned);
  } else if (currentFilter.ownership === 'not-owned') {
    mainboardCards = mainboardCards.filter(c => !c.is_owned);
    sideboardCards = sideboardCards.filter(c => !c.is_owned);
    maybeboardCards = maybeboardCards.filter(c => !c.is_owned);
  }

  // Update counts
  const mainboardTotal = mainboardCards.reduce((sum, c) => sum + c.quantity, 0);
  const sideboardTotal = sideboardCards.reduce((sum, c) => sum + c.quantity, 0);
  const maybeboardTotal = maybeboardCards.reduce((sum, c) => sum + c.quantity, 0);

  document.getElementById('mainboard-count').textContent = mainboardTotal;
  document.getElementById('sideboard-count').textContent = sideboardTotal;
  document.getElementById('maybeboard-count').textContent = maybeboardTotal;

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

  const cube = isCubeFormat(currentDeck.format);
  if (cube && !cubeViewShowsList()) {
    // Table and visual views draw the cube themselves
    renderCubeBoard(mainboard, mainboardCards, 'mainboard');
    renderCubeBoard(maybeboard, maybeboardCards, 'maybeboard');
    sideboard.innerHTML = renderCardsList(sideboardCards);
    sideboard.dataset.layout = layoutView;
  } else {
    mainboard.innerHTML = renderCardsList(mainboardCards);
    sideboard.innerHTML = renderCardsList(sideboardCards);
    maybeboard.innerHTML = renderCardsList(maybeboardCards);
    [mainboard, sideboard, maybeboard].forEach((list) => {
      list.dataset.layout = layoutView;
    });
  }

  // Add event listeners
  setupCardControls();

  if (cube) refreshCube();
  else if (deckView === 'collection') deckCollection.refresh();
  else if (deckView !== 'build') deckTools.refresh();
  scheduleFormatStatus();

  // A hand drawn from cards that are no longer in the mainboard is stale
  if (exampleHand.length > 0 && !(currentDeck?.cards || []).some(isMainboardCard)) {
    exampleHand = [];
    renderExampleHand();
    updateHandStats();
  }
}

/** The deck filter box as a card predicate. */
function deckFilterPredicate() {
  return compileQuery(deckFilterQuery);
}

/**
 * Show or hide the controls that depend on the format: cube views, the format options button,
 * the sideboard tab (cubes don't have one) and the sample hand.
 */
function applyFormatMode() {
  const format = currentDeck?.format || '';
  const cube = isCubeFormat(format);
  const def = getFormat(format);
  document.querySelector('#deck-builder-page .deck-builder').classList.toggle('is-cube', cube);
  document.getElementById('deck-format-options-btn').classList.toggle('hidden', !def?.baseFormat);
  const mainTab = document.querySelector('#deck-builder-page .tab-btn[data-tab="mainboard"]');
  if (mainTab?.firstChild) mainTab.firstChild.textContent = cube ? 'Cube ' : 'Main ';
  document.querySelector('#deck-builder-page .tab-btn[data-tab="sideboard"]')?.classList.toggle('hidden', cube && !(currentDeck?.cards || []).some(isSideboardCard));
  if (cube && activeTab === 'sideboard') switchTab('mainboard');
  if (!cube) clearCubeSelection();
  setCubeMode(cube);
  applyDeckView();
}

const DECK_VIEWS = ['analysis', 'playtest', 'collection'];

/** Switch between Build, Analysis, Playtest and Collection, keeping the URL in step. */
function setDeckView(view, { push = true } = {}) {
  deckView = DECK_VIEWS.includes(view) ? view : 'build';
  if (push && currentDeckId) {
    const path = `/decks/${currentDeckId}${deckView === 'build' ? '' : `/${deckView}`}`;
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
  }
  applyDeckView();
}

function applyDeckView() {
  const cube = isCubeFormat(currentDeck?.format);
  const view = cube ? 'build' : deckView; // Cubes have their own views
  document.getElementById('deck-view-bar').classList.toggle('hidden', cube);
  document.querySelectorAll('.deck-view-btn').forEach((btn) => {
    const active = btn.dataset.deckView === view;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  const panel = view !== 'build';
  const tools = view === 'analysis' || view === 'playtest';
  document.getElementById('deck-view').classList.toggle('hidden', !tools);
  document.getElementById('deck-collection-view').classList.toggle('hidden', view !== 'collection');
  if (!cube) document.querySelector('#deck-builder-page .deck-builder-content').classList.toggle('hidden', panel);
  document.querySelector('#deck-builder-page .example-hand-section').classList.toggle('hidden', panel);
  hideCardPreview();
  deckTools.show(tools ? view : null);
  deckCollection.show(view === 'collection');
}

// ---- Live format check ----
let formatStatusTimer = null;
let formatStatusSeq = 0;
let formatStatusKey = '';

/** What the format check depends on, so re-renders that change nothing (filtering, views) skip it. */
function formatStatusInputs() {
  const cards = (currentDeck?.cards || []).map((c) => `${c.deck_card_id}:${c.printing_id}:${c.quantity}:${boardOf(c)}:${c.is_commander ? 1 : 0}`).join(',');
  return `${currentDeckId}|${currentDeck?.format}|${JSON.stringify(currentDeck?.settings || {})}|${cards}`;
}

/** Re-check the deck against its format shortly after it changes. */
function scheduleFormatStatus() {
  const key = formatStatusInputs();
  if (key === formatStatusKey) return;
  formatStatusKey = key;
  clearTimeout(formatStatusTimer);
  formatStatusTimer = setTimeout(updateFormatStatus, 400);
}

async function updateFormatStatus() {
  const el = document.getElementById('deck-format-status');
  const format = currentDeck?.format;
  if (!format || !getFormat(format) || !currentDeckId) {
    el.classList.add('hidden');
    return;
  }
  const seq = ++formatStatusSeq;
  try {
    const result = await api.checkDeckLegality(currentDeckId, format);
    if (seq !== formatStatusSeq) return; // A newer check is on its way
    const errors = result.issues.filter((i) => i.severity === 'error');
    const warnings = result.issues.filter((i) => i.severity === 'warning');
    const rules = resolveRules(format, currentDeck.settings || {});
    const parts = [];
    const size = rules?.deckSize?.exact || rules?.deckSize?.min || result.summary?.targetSize;
    if (size) parts.push(`${result.summary.mainCount}/${size}`);
    else parts.push(`${result.summary.mainCount} cards`);
    if (result.summary.points) parts.push(`${result.summary.points.total}/${result.summary.points.cap} pts`);

    let icon = 'ph-seal-check';
    let state = 'ok';
    let label = 'Legal';
    if (errors.length) {
      icon = 'ph-warning-circle';
      state = 'error';
      label = `${errors.length} issue${errors.length === 1 ? '' : 's'}`;
    } else if (warnings.length) {
      icon = 'ph-info';
      state = 'warning';
      label = isCubeFormat(format) ? `${warnings.length} note${warnings.length === 1 ? '' : 's'}` : 'Legal';
    }
    el.dataset.state = state;
    el.title = [...errors, ...warnings].map((i) => `• ${i.message}`).join('\n') || `Legal in ${result.label}`;
    el.innerHTML = `<i class="ph ${icon}"></i><span>${label}</span><span class="format-status-meta">${parts.join(' · ')}</span>`;
    el.classList.remove('hidden');
  } catch {
    if (seq === formatStatusSeq) {
      el.classList.add('hidden');
      formatStatusKey = ''; // Try again on the next change
    }
  }
}

/** Save the deck's format options (two-headed giant pool, cube settings). */
async function saveDeckSettings(settings) {
  currentDeck.settings = settings;
  await api.updateDeck(currentDeckId, { settings });
  applyFormatMode();
  renderDeckCards();
}

/** Options for formats that have them: two-headed giant picks a card pool and a teammate deck. */
async function openFormatOptions() {
  const def = getFormat(currentDeck?.format);
  if (!def?.baseFormat) return;
  const settings = currentDeck.settings || {};
  let decks = [];
  try {
    decks = (await api.getDecks()).decks.filter((d) => String(d.id) !== String(currentDeckId) && !isCubeFormat(d.format));
  } catch { /* the teammate picker just stays empty */ }

  const modal = document.getElementById('modal');
  document.getElementById('modal-body').innerHTML = `
    <h2>${escapeHtml(def.label)} options</h2>
    <p class="modal-lede">Two-Headed Giant uses a constructed card pool. Pick your teammate's deck to check the team limit of four copies of a card across both decks.</p>
    <form id="format-options-form">
      <div class="form-group">
        <label for="fo-base">Card pool</label>
        <select id="fo-base">${TWO_HEADED_GIANT_BASES.map((id) => `<option value="${id}" ${id === (settings.baseFormat || def.baseFormat.default) ? 'selected' : ''}>${escapeHtml(formatLabel(id))}</option>`).join('')}</select>
      </div>
      <div class="form-group">
        <label for="fo-teammate">Teammate's deck</label>
        <select id="fo-teammate">
          <option value="">None</option>
          ${decks.map((d) => `<option value="${d.id}" ${String(d.id) === String(settings.teammateDeckId) ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('')}
        </select>
      </div>
      <div class="btn-row">
        <button type="submit" class="btn btn-primary">Save</button>
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
      </div>
    </form>`;
  modal.classList.remove('hidden');
  document.getElementById('format-options-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const teammate = document.getElementById('fo-teammate').value;
    try {
      await saveDeckSettings({ ...settings, baseFormat: document.getElementById('fo-base').value, teammateDeckId: teammate ? Number(teammate) : null });
      modal.classList.add('hidden');
      showToast('Format options saved', 'success', 1500);
    } catch (error) {
      showToast('Failed to save options: ' + error.message, 'error');
    }
  });
}

function renderCardsList(cards) {
  if (cards.length === 0) {
    return `<div class="deck-list-empty">
      <i class="ph ph-cards"></i>
      <p>${deckFilterQuery || currentFilter.cmc !== null || currentFilter.color !== null || currentFilter.ownership ? 'No cards match this filter' : 'Nothing here yet. Search above to add your first card.'}</p>
    </div>`;
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
        <div class="card-type-header"><span>Commander</span><span class="card-type-count">${commanders.length}</span></div>
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
          <div class="card-type-header"><span>${headerLabel}</span><span class="card-type-count">${count}</span></div>
          ${cardsToRender.map(card => renderCardItem(card)).join('')}
        </div>
      `;
    }
  }

  return html;
}

// The deck's commander rules (null when its format has no commander). Eligibility follows the
// format: Brawl allows planeswalkers, Pauper Commander wants an uncommon creature, and
// Oathbreaker marks a planeswalker plus an instant or sorcery as its signature spell.
function commanderSpec() {
  return resolveRules(currentDeck?.format, currentDeck?.settings || {})?.commander || null;
}

const isSpell = (card) => /\b(Instant|Sorcery)\b/.test(card.type_line || '');

function canBeCommander(card) {
  const spec = commanderSpec();
  if (!spec) return false;
  if (spec.signatureSpell && isSpell(card)) return true;
  return canLead(card, spec.skill);
}

function renderOwnershipToggle(card) {
  const label = card.is_owned ? 'In your collection' : 'Add to collection';
  return `<button class="ownership-toggle-btn ${card.is_owned ? 'owned' : ''}" data-card-id="${card.card_id}" title="${label}" aria-label="${label}">
    <i class="${card.is_owned ? 'ph-fill ph-check-circle' : 'ph ph-circle'}"></i>
  </button>`;
}

function renderPrintingLink(card) {
  return `<button type="button" class="set-code-link" data-card-id="${card.card_id}" data-deck-card-id="${card.deck_card_id}" title="Change printing" aria-label="Change printing, currently ${escapeHtml(card.set_code)}">${escapeHtml(card.set_code)}</button>`;
}

function renderCardPrice(card) {
  if (!pricingMode) return '';
  const price = currentPriceData?.cardPrices?.[card.deck_card_id];
  if (!price) return '<span class="deck-card-price deck-card-price-none" title="No price available for this card">—</span>';
  return currentPriceData.estimatedCards?.includes(card.deck_card_id)
    ? `<span class="deck-card-price deck-card-price-estimate" title="This printing has no price, so this is the card's cheapest paper price">~${formatPrice(price)}</span>`
    : `<span class="deck-card-price">${formatPrice(price)}</span>`;
}

// The set code and price for the dense layouts, which have no room for a second line.
function renderCompactPrinting(card) {
  return `<div class="deck-card-printing">${renderCardPrice(card)}${renderPrintingLink(card)}</div>`;
}

function renderCardItem(card) {
  const showCommanderIcon = canBeCommander(card) && isMainboardCard(card);

  // Ultra-compact view - minimal text-only with dropdown
  if (layoutView === 'ultra-compact') {
    return `
      <div class="deck-card-item ultra-compact ${card.is_commander ? 'is-commander' : ''}" data-deck-card-id="${card.deck_card_id}" data-printing-id="${card.printing_id}" data-is-sideboard="${card.is_sideboard}" data-board-type="${card.board_type || (card.is_sideboard ? 'sideboard' : 'mainboard')}" data-card-id="${card.card_id}" draggable="true">
        ${renderOwnershipToggle(card)}
        <span class="card-quantity-badge">${card.quantity}</span>
        <div class="deck-card-info-ultra-compact">
          <span class="card-name">${card.name}</span>
          <span class="card-mana">${formatMana(card.mana_cost || '')}</span>
        </div>
        ${renderCompactPrinting(card)}
        <div class="card-actions-dropdown">
          <button class="card-actions-menu-btn" data-deck-card-id="${card.deck_card_id}" onclick="event.stopPropagation(); this.nextElementSibling.classList.toggle('hidden')">
            <i class="ph ph-dots-three-vertical"></i>
          </button>
          <div class="card-actions-menu hidden">
            <div class="card-actions-menu-item quantity-adjuster">
              <button class="quantity-adjuster-btn quantity-btn btn-decrease" data-deck-card-id="${card.deck_card_id}">-</button>
              <span class="quantity-adjuster-value">${card.quantity}</span>
              <button class="quantity-adjuster-btn quantity-btn btn-increase" data-deck-card-id="${card.deck_card_id}">+</button>
            </div>
            <div class="card-actions-menu-item move-card-submenu">
              <i class="ph ph-arrows-left-right"></i>
              Move to...
              <div class="move-submenu hidden">
                ${card.board_type !== 'mainboard' ? `<div class="move-submenu-item" data-deck-card-id="${card.deck_card_id}" data-board-type="mainboard">Mainboard</div>` : ''}
                ${card.board_type !== 'sideboard' ? `<div class="move-submenu-item" data-deck-card-id="${card.deck_card_id}" data-board-type="sideboard">Sideboard</div>` : ''}
                ${card.board_type !== 'maybeboard' ? `<div class="move-submenu-item" data-deck-card-id="${card.deck_card_id}" data-board-type="maybeboard">Maybeboard</div>` : ''}
              </div>
            </div>
            <a class="card-actions-menu-item" href="https://manapool.com/search?q=${encodeURIComponent(card.name)}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit;">
              <i class="ph ph-shopping-cart-simple"></i>
              Buy on Mana Pool
            </a>
            <div class="card-actions-menu-item remove-card-item danger" data-deck-card-id="${card.deck_card_id}">
              <i class="ph ph-trash"></i>
              Remove
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // Compact view - with small images
  if (layoutView === 'compact') {
    return `
      <div class="deck-card-item compact ${card.is_commander ? 'is-commander' : ''}" data-deck-card-id="${card.deck_card_id}" data-printing-id="${card.printing_id}" data-is-sideboard="${card.is_sideboard}" data-board-type="${card.board_type || (card.is_sideboard ? 'sideboard' : 'mainboard')}" data-card-id="${card.card_id}" draggable="true" style="position: relative;">
        ${renderOwnershipToggle(card)}
        ${showCommanderIcon ? `
          <button class="commander-toggle-btn ${card.is_commander ? 'active' : ''}"
                  data-deck-card-id="${card.deck_card_id}"
                  title="${card.is_commander ? 'Remove as commander' : 'Set as commander'}"
                  aria-label="${card.is_commander ? 'Remove as commander' : 'Set as commander'}">
            <i class="${card.is_commander ? 'ph-fill' : 'ph'} ph-crown-simple"></i>
          </button>
        ` : ''}
        <img src="${smallImage(card.image_url)}"
             class="deck-card-image-compact"
             alt="" width="29" height="40" loading="lazy" decoding="async"
             onerror="this.style.visibility='hidden'">
        <div class="deck-card-info-compact">
          <span class="card-name">${card.name}</span>
          <span class="card-mana">${formatMana(card.mana_cost || '')}</span>
        </div>
        ${renderCompactPrinting(card)}
        <div class="deck-card-controls">
          <div class="quantity-control">
            <button class="quantity-btn btn-decrease" data-deck-card-id="${card.deck_card_id}">-</button>
            <input type="number" class="quantity-input" data-deck-card-id="${card.deck_card_id}" value="${card.quantity}" min="1" max="99">
            <button class="quantity-btn btn-increase" data-deck-card-id="${card.deck_card_id}">+</button>
          </div>
          <button class="remove-btn" data-deck-card-id="${card.deck_card_id}" title="Remove" aria-label="Remove ${card.name}"><i class="ph ph-x"></i></button>
        </div>
      </div>
    `;
  }

  return `
    <div class="deck-card-item ${card.is_commander ? 'is-commander' : ''}" data-deck-card-id="${card.deck_card_id}" data-printing-id="${card.printing_id}" data-is-sideboard="${card.is_sideboard}" data-board-type="${card.board_type || (card.is_sideboard ? 'sideboard' : 'mainboard')}" data-card-id="${card.card_id}" draggable="true" style="position: relative;">
      ${renderOwnershipToggle(card)}
      ${showCommanderIcon ? `
        <button class="commander-toggle-btn ${card.is_commander ? 'active' : ''}"
                  data-deck-card-id="${card.deck_card_id}"
                  title="${card.is_commander ? 'Remove as commander' : 'Set as commander'}"
                  aria-label="${card.is_commander ? 'Remove as commander' : 'Set as commander'}">
            <i class="${card.is_commander ? 'ph-fill' : 'ph'} ph-crown-simple"></i>
          </button>
      ` : ''}
      <img src="${smallImage(card.image_url)}"
           class="deck-card-image"
           alt="" width="50" height="70" loading="lazy" decoding="async"
           onerror="this.style.visibility='hidden'">
      <div class="deck-card-info">
        <div class="card-name">${card.name}</div>
        <div class="card-type">${card.type_line || ''}</div>
        <div class="deck-card-meta">
          ${renderPrintingLink(card)} · ${card.artist || 'Unknown'}${pricingMode ? ` · ${renderCardPrice(card)}` : ''}
        </div>
      </div>
      <div class="deck-card-controls">
        <div class="quantity-control">
          <button class="quantity-btn btn-decrease" data-deck-card-id="${card.deck_card_id}">-</button>
          <input type="number" class="quantity-input" data-deck-card-id="${card.deck_card_id}" value="${card.quantity}" min="1" max="99">
          <button class="quantity-btn btn-increase" data-deck-card-id="${card.deck_card_id}">+</button>
        </div>
        <button class="remove-btn" data-deck-card-id="${card.deck_card_id}" title="Remove" aria-label="Remove ${card.name}"><i class="ph ph-trash"></i></button>
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
      e.preventDefault();
      const deckCardId = btn.dataset.deckCardId;
      const card = currentDeck.cards.find(c => c.deck_card_id == deckCardId);
      await updateCardQuantity(deckCardId, card.quantity + 1);

      // Update the quantity display in the dropdown if it exists
      const quantityDisplay = btn.parentElement.querySelector('.quantity-adjuster-value');
      if (quantityDisplay) {
        quantityDisplay.textContent = card.quantity + 1;
      }
    });
  });

  // Decrease quantity
  document.querySelectorAll('.btn-decrease').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const deckCardId = btn.dataset.deckCardId;
      const card = currentDeck.cards.find(c => c.deck_card_id == deckCardId);
      if (card.quantity > 1) {
        await updateCardQuantity(deckCardId, card.quantity - 1);

        // Update the quantity display in the dropdown if it exists
        const quantityDisplay = btn.parentElement.querySelector('.quantity-adjuster-value');
        if (quantityDisplay) {
          quantityDisplay.textContent = card.quantity - 1;
        }
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

  // Ultra-compact view dropdown remove button
  document.querySelectorAll('.remove-card-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      const deckCardId = item.dataset.deckCardId;
      await removeCard(deckCardId);
      // Close the dropdown
      const menu = item.closest('.card-actions-menu');
      if (menu) menu.classList.add('hidden');
    });
  });

  // Ultra-compact view dropdown move to board submenu
  document.querySelectorAll('.move-card-submenu').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const submenu = item.querySelector('.move-submenu');
      if (submenu) {
        submenu.classList.toggle('hidden');
      }
    });
  });

  // Move submenu items
  document.querySelectorAll('.move-submenu-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      const deckCardId = item.dataset.deckCardId;
      const boardType = item.dataset.boardType;
      await moveCardToBoard(deckCardId, boardType);
      // Close the dropdown
      const menu = item.closest('.card-actions-menu');
      if (menu) menu.classList.add('hidden');
    });
  });

  // Prevent dropdown from closing when clicking inside it
  document.querySelectorAll('.card-actions-menu').forEach(menu => {
    menu.addEventListener('click', (e) => {
      // Only stop propagation for quantity adjuster, not for remove button
      if (e.target.closest('.quantity-adjuster')) {
        e.stopPropagation();
      }
    });
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.card-actions-dropdown')) {
      document.querySelectorAll('.card-actions-menu').forEach(menu => {
        menu.classList.add('hidden');
      });
    }
  });
}

let draggedCardId = null;
let draggedBoardType = null; // Now tracking board_type instead of just is_sideboard
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
        <div class="drag-zone" data-target="maybeboard">
          <div class="drag-zone-icon">🤔</div>
          <div class="drag-zone-label">Maybeboard</div>
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
        const canDrop = target !== draggedBoardType;

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

        // Only move if it's actually changing boards
        if (draggedCardId && target !== draggedBoardType) {
          await moveCardToBoard(draggedCardId, target);
        }
      });
    });
    dragPopupInitialized = true;
  }

  // Setup drag events on card items (these need to be re-attached each render)
  document.querySelectorAll('.deck-card-item').forEach(item => {
    item.addEventListener('dragstart', (e) => {
      draggedCardId = item.dataset.deckCardId;
      // Determine board type from the card's data
      const isSideboard = item.dataset.isSideboard === 'true' || item.dataset.isSideboard === '1';
      const boardTypeAttr = item.dataset.boardType;
      draggedBoardType = boardTypeAttr || (isSideboard ? 'sideboard' : 'mainboard');

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
        if (target !== draggedBoardType) {
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
      draggedBoardType = null;
    });
  });
}

async function moveCardToBoard(deckCardId, boardType) {
  try {
    showLoading();
    const isSideboard = boardType === 'sideboard';
    const updatedDeck = await api.updateDeckCard(currentDeckId, deckCardId, { isSideboard, boardType });
    currentDeck = updatedDeck.deck;
    renderDeckCards();
    await loadDeckStats();
    hideLoading();
    showToast(`Card moved to ${boardType}`, 'success', 2000);
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

    // When setting a commander, keep an existing commander only if the two form a
    // valid pair (Partner / Partner with / Friends forever / Background / Doctor's
    // companion). Otherwise the new pick replaces whatever was there.
    let pairedWithPartner = false;
    const spec = commanderSpec();
    if (newCommanderStatus) {
      // In Oathbreaker the planeswalker and its signature spell are marked separately
      const sameKind = (c) => !spec?.signatureSpell || isSpell(c) === isSpell(card);
      const existing = currentDeck.cards.filter(
        c => c.is_commander && c.deck_card_id != deckCardId && sameKind(c)
      );
      const partner = isSpell(card) && spec?.signatureSpell ? null : existing.find(c => canPairCommanders(c, card));
      pairedWithPartner = !!partner;
      const toUnmark = partner
        ? existing.filter(c => c.deck_card_id != partner.deck_card_id)
        : existing;
      for (const c of toUnmark) {
        await api.updateDeckCard(currentDeckId, c.deck_card_id, { isCommander: false });
      }
    }

    // Toggle the commander status on the target card
    const updatedDeck = await api.updateDeckCard(currentDeckId, deckCardId, { isCommander: newCommanderStatus });
    currentDeck = updatedDeck.deck;
    renderDeckCards();
    await loadDeckStats();
    hideLoading();

    showToast(
      newCommanderStatus
        ? (pairedWithPartner ? '⚔️ Partner commander set!' : '⚔️ Commander set!')
        : 'Commander removed',
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
      buttonEl.innerHTML = '<i class="ph-fill ph-check-circle"></i>';
      showToast('Added to collection', 'success', 1500);
    } else {
      buttonEl.classList.remove('owned');
      buttonEl.innerHTML = '<i class="ph ph-circle"></i>';
      showToast('Removed from collection', 'success', 1500);
    }

    // Update the card's is_owned status in currentDeck
    currentDeck.cards.forEach(card => {
      if (card.card_id == cardId) {
        card.is_owned = result.owned;
        // Marking a card owned adds one copy to the collection; unmarking removes them all.
        card.owned_quantity = result.owned ? 1 : 0;
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
    // Rows render before this fetch returns, so without this they'd show the previous prices
    if (pricingMode) renderDeckCards();
  } catch (error) {
    console.error('Failed to load stats:', error);
  }
}

function displayDeckPrice(price) {
  const priceEl = document.getElementById('deck-total-price');
  if (priceEl) {
    priceEl.textContent = `$${price.total.toFixed(2)}`;
    priceEl.title = 'Estimated deck value';
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
      ${price.estimatedCount || price.unpricedCount ? `
        <p class="deck-price-note">${[
          price.estimatedCount ? `Estimated for ${price.estimatedCount} ${price.estimatedCount === 1 ? 'card' : 'cards'} whose printing has no price.` : '',
          price.unpricedCount ? `Leaves out ${price.unpricedCount} ${price.unpricedCount === 1 ? 'card' : 'cards'} with no price at all.` : '',
        ].filter(Boolean).join(' ')}</p>
      ` : ''}
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
      <button id="toggle-set-group-btn" class="btn btn-secondary btn-sm ${setGroupMode ? 'active' : ''}" style="width: 100%; margin-bottom: 0.5rem;">
        <i class="ph ${setGroupMode ? 'ph-grid-four' : 'ph-stack'}"></i>
        ${setGroupMode ? 'Group by Type' : 'Group by Set'}
      </button>
      <button id="validate-deck-btn" class="btn btn-secondary btn-sm" style="width: 100%;">
        <i class="ph ph-shield-check"></i> Validate Deck
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

    toggleSetGroupBtn.classList.toggle('active', setGroupMode);
    toggleSetGroupBtn.innerHTML = `
      <i class="ph ${setGroupMode ? 'ph-grid-four' : 'ph-stack'}"></i>
      ${setGroupMode ? 'Group by Type' : 'Group by Set'}
    `;
  });

  // Open validator modal from sidebar
  document.getElementById('validate-deck-btn').addEventListener('click', () => {
    document.getElementById('deck-validator-modal').classList.remove('hidden');
    document.getElementById('validator-results').innerHTML = `
      <div style="text-align:center;padding:2rem;color:var(--text-secondary);font-size:0.875rem;">
        <i class="ph ph-shield" style="font-size:2rem;display:block;margin-bottom:0.5rem;opacity:0.4;"></i>
        Select a format and click Validate.
      </div>`;
  });
}

function openBuyDeckModal() {
  document.getElementById('buy-deck-modal').classList.remove('hidden');
  document.getElementById('decklist-preview').classList.add('hidden');
  // Reset to optimizer tab
  document.getElementById('buy-tab-optimizer').classList.remove('hidden');
  document.getElementById('buy-tab-export').classList.add('hidden');
  document.querySelectorAll('.buy-tab-btn').forEach((b, i) => {
    const active = i === 0;
    b.classList.toggle('active', active);
    b.style.borderBottom = active ? '2px solid var(--primary)' : 'none';
    b.style.color = active ? 'var(--primary)' : 'var(--text-secondary)';
    b.style.fontWeight = active ? '600' : 'normal';
  });
  document.getElementById('optimizer-results').innerHTML = `
    <div style="text-align:center;padding:2rem;color:var(--text-secondary);font-size:0.875rem;">
      <i class="ph ph-magic-wand" style="font-size:2rem;display:block;margin-bottom:0.5rem;opacity:0.4;"></i>
      Click "Optimize Cart" to find the best deal across Mana Pool sellers.
    </div>`;
}

function generateDeckList() {
  // Check if non-owned only filter is enabled
  const nonOwnedOnly = document.getElementById('copy-non-owned-only')?.checked || false;

  // Build deck list in TCGPlayer format with set codes
  let mainboardCards = currentDeck.cards.filter(isMainboardCard);
  let sideboardCards = currentDeck.cards.filter(isSideboardCard);

  // Only the copies you're short of (owned copies go to the mainboard first)
  if (nonOwnedOnly) {
    const short = missingRows([...mainboardCards, ...sideboardCards]);
    mainboardCards = short.filter(isMainboardCard);
    sideboardCards = short.filter(isSideboardCard);
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
    copyText(deckText).then((copied) => {
      if (!copied) {
        document.getElementById('decklist-preview').classList.remove('hidden');
        document.getElementById('decklist-text').value = deckText;
        showToast('Copy the deck list below and paste into TCGPlayer', 'warning', 4000);
        return;
      }
      window.open('https://www.tcgplayer.com/massentry', '_blank');
      document.getElementById('buy-deck-modal').classList.add('hidden');
      showToast('Deck list copied! Paste it into TCGPlayer Mass Entry.', 'success', 4000);
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
    copyText(deckText).then((copied) => {
      if (!copied) {
        document.getElementById('decklist-preview').classList.remove('hidden');
        document.getElementById('decklist-text').value = deckText;
        showToast('Copy the deck list below and paste into Manapool', 'warning', 4000);
        return;
      }
      window.open('https://manapool.com/add-deck', '_blank');
      document.getElementById('buy-deck-modal').classList.add('hidden');
      showToast('Deck list copied! Paste it into Manapool Mass Entry.', 'success', 4000);
    });
  } catch (error) {
    showToast('Failed to export', 'error');
  }
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
  const largeImageSrc = imageSrc.replace(/\/(small|normal)\//, '/large/');
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

function renderPrintingOption(printing, isCurrent) {
  const price = printingPrice(printing);
  const finishNote = printingFinishNote(printing);
  const setCode = escapeHtml(printing.set_code.toUpperCase());
  const setName = escapeHtml(printing.set_name || printing.set_code.toUpperCase());

  return `
    <button type="button" class="printing-option ${isCurrent ? 'is-current' : ''}" data-printing-id="${printing.id}" ${isCurrent ? 'aria-current="true"' : ''}>
      <span class="printing-option-image">
        ${printing.image_url ? `<img src="${escapeHtml(printing.image_url)}" alt="" loading="lazy" decoding="async" onerror="this.style.visibility='hidden'">` : ''}
        ${isCurrent ? '<span class="printing-option-current">Current</span>' : ''}
      </span>
      <span class="printing-option-price-row">
        ${price != null
          ? `<span class="printing-option-price">${formatPrice(price)}</span>`
          : '<span class="printing-option-no-price">No price</span>'}
        ${finishNote ? `<span class="printing-option-foil">${finishNote}</span>` : ''}
      </span>
      <span class="printing-option-set">${setName}</span>
      <span class="printing-option-meta">${setCode} #${escapeHtml(printing.collector_number || '?')}${printing.rarity ? ` · ${escapeHtml(printing.rarity)}` : ''}</span>
    </button>
  `;
}

async function showPrintingSelectionModal(cardId, deckCardId) {
  hideCardPreview();
  let printings;
  try {
    showLoading();
    ({ printings = [] } = await api.getCardPrintings(cardId));
  } catch (error) {
    console.error('Failed to load printings:', error);
    showToast('Failed to load printings', 'error');
    return;
  } finally {
    hideLoading();
  }

  if (printings.length === 0) {
    showToast('No printings found for this card', 'warning');
    return;
  }

  const currentCard = currentDeck.cards.find(c => c.deck_card_id == deckCardId);
  const currentPrintingId = currentCard?.printing_id;
  printings = uniquePrintings(printings, currentPrintingId);
  const range = priceRange(printings);
  const rangeLabel = range
    ? ` · ${range.min === range.max ? formatPrice(range.min) : `${formatPrice(range.min)} – ${formatPrice(range.max)}`}`
    : '';

  const modalBody = document.getElementById('modal-body');
  modalBody.innerHTML = `
    <div class="printing-picker">
      <h2>Change printing</h2>
      <p class="printing-picker-summary">
        ${escapeHtml(printings[0].card_name || currentCard?.name)} · ${printings.length} ${printings.length === 1 ? 'printing' : 'printings'}${rangeLabel}
      </p>
      <div class="printing-picker-controls">
        <input type="text" id="printing-search" placeholder="Filter by set name or code" aria-label="Filter printings by set" autocomplete="off">
        <label class="printing-picker-sort">
          <span>Sort by</span>
          <select id="printing-sort">
            ${PRINTING_SORTS.map(({ value, label }) => `<option value="${value}" ${value === printingSort ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
      </div>
      <div id="printing-grid" class="printing-grid">
        ${sortPrintings(printings, printingSort).map(p => renderPrintingOption(p, p.id == currentPrintingId)).join('')}
      </div>
      <p id="printing-none" class="printing-picker-none hidden">No printings match that filter.</p>
    </div>
  `;

  const grid = document.getElementById('printing-grid');
  const searchInput = document.getElementById('printing-search');
  const sortSelect = document.getElementById('printing-sort');
  const optionsById = new Map([...grid.children].map(option => [option.dataset.printingId, option]));

  // Moves and hides the existing elements, so images that have already loaded don't load again
  const applyFilter = () => {
    let shown = 0;
    printings.forEach(printing => {
      const matches = printingMatches(printing, searchInput.value);
      optionsById.get(String(printing.id)).classList.toggle('hidden', !matches);
      if (matches) shown++;
    });
    document.getElementById('printing-none').classList.toggle('hidden', shown > 0);
  };

  searchInput.addEventListener('input', applyFilter);

  sortSelect.addEventListener('change', () => {
    printingSort = sortSelect.value;
    grid.append(...sortPrintings(printings, printingSort).map(p => optionsById.get(String(p.id))));
    grid.scrollTop = 0;
  });

  grid.addEventListener('click', async (e) => {
    const option = e.target.closest('.printing-option');
    if (!option) return;
    if (option.dataset.printingId != currentPrintingId) {
      await swapPrinting(deckCardId, option.dataset.printingId);
    }
    hideModal();
  });

  document.getElementById('modal').classList.remove('hidden');
  searchInput.focus();
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
  const mainboardCards = currentDeck.cards.filter(isMainboardCard);
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
    <div class="owned-stat-bar ${ownedFilterClass}" style="cursor: pointer;" title="Click to filter by ownership">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
        <span style="font-weight: 600; font-size: 0.8125rem;">${ownedPercentage}% owned</span>
        <span style="font-size: 0.75rem; color: var(--text-muted);">${ownedCards} / ${totalCards} cards</span>
      </div>
      <div style="width: 100%; height: 4px; background: var(--border); border-radius: 2px; overflow: hidden;">
        <div style="width: ${ownedPercentage}%; height: 100%; background: var(--success); transition: width 0.3s;"></div>
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
        <div class="mana-stats" style="margin-top: 0.75rem; color: var(--text-secondary); font-size: 0.75rem; line-height: 1.6;">
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

let legalitySetup = false;

/**
 * The legality modal: pick a format for a full report (size, copies, commanders, color identity,
 * points), or check every format at once. Opens on the deck's own format when it has one.
 */
function showLegalityModal(format) {
  const modal = document.getElementById('legality-check-modal');
  const select = document.getElementById('legality-format-select');
  const deckFormat = currentDeck?.format && getFormat(currentDeck.format) && !isCubeFormat(currentDeck.format) ? currentDeck.format : '';
  const initial = format && getFormat(format) ? format : deckFormat || 'commander';
  select.innerHTML = formatOptionsHtml({ selected: initial, noneLabel: null, includeLimited: true, includeCube: isCubeFormat(currentDeck?.format) });

  if (!legalitySetup) {
    legalitySetup = true;
    select.addEventListener('change', () => checkFormatLegality(select.value));
    document.getElementById('legality-check-all-btn').addEventListener('click', checkAllFormats);
    document.getElementById('legality-results').addEventListener('click', (e) => {
      const pick = e.target.closest('[data-pick-format]');
      if (pick) {
        select.value = pick.dataset.pickFormat;
        checkFormatLegality(select.value);
      }
    });
  }

  modal.classList.remove('hidden');
  checkFormatLegality(initial);
}

function renderIssue(issue) {
  const icon = issue.severity === 'error' ? 'ph-x-circle' : 'ph-info';
  const cards = issue.cards?.length
    ? `<ul class="legality-issue-cards">${issue.cards.slice(0, 60).map((c) => `<li>${escapeHtml(c)}</li>`).join('')}${issue.cards.length > 60 ? `<li class="muted">and ${issue.cards.length - 60} more</li>` : ''}</ul>`
    : '';
  return `<li class="legality-issue" data-severity="${issue.severity}">
    <i class="ph ${icon}" aria-hidden="true"></i>
    <div><div class="legality-issue-msg">${escapeHtml(issue.message)}</div>${cards}</div>
  </li>`;
}

async function checkFormatLegality(format) {
  const resultsDiv = document.getElementById('legality-results');
  resultsDiv.innerHTML = '<div class="legality-loading">Checking…</div>';
  try {
    const result = await api.checkDeckLegality(currentDeckId, format);
    const def = getFormat(format);
    const rules = resolveRules(format, format === currentDeck.format ? currentDeck.settings || {} : {});
    const errors = result.issues.filter((i) => i.severity === 'error');
    const warnings = result.issues.filter((i) => i.severity === 'warning');
    const facts = [
      deckSizeLabel(rules),
      rules?.copies === 1 ? 'Singleton' : rules?.copies ? `Up to ${rules.copies} copies` : '',
      rules?.commander ? (rules.commander.signatureSpell ? 'Oathbreaker + signature spell' : 'Commander, color identity') : '',
      rules?.sideboard ? `${rules.sideboard}-card sideboard` : '',
      rules?.points ? `${rules.points.cap} point cap` : '',
      result.baseFormat ? `${formatLabel(result.baseFormat)} card pool` : '',
      rules?.isCube ? result.summary.poolLabel : '',
    ].filter(Boolean);

    const points = result.summary.points;
    resultsDiv.innerHTML = `
      <div class="legality-verdict" data-legal="${result.isLegal}">
        <i class="ph ${result.isLegal ? 'ph-seal-check' : 'ph-warning-circle'}"></i>
        <div>
          <strong>${result.isLegal ? `Legal in ${escapeHtml(result.label)}` : `Not legal in ${escapeHtml(result.label)}`}</strong>
          <div class="legality-facts">${facts.map(escapeHtml).join(' · ')}${def?.description ? ` — ${escapeHtml(def.description)}` : ''}</div>
        </div>
      </div>
      ${errors.length || warnings.length ? `<ul class="legality-issues">${[...errors, ...warnings].map(renderIssue).join('')}</ul>` : ''}
      ${points ? `<div class="legality-points"><h4>Points: ${points.total} of ${points.cap}</h4>
        ${points.cards.length ? `<ul>${points.cards.map((c) => `<li><span>${escapeHtml(c.name)}</span><span>${c.points}</span></li>`).join('')}</ul>` : '<p class="muted">No pointed cards.</p>'}</div>` : ''}
      ${result.summary.commanders?.length ? `<p class="legality-meta">Commander: ${result.summary.commanders.map(escapeHtml).join(' + ')}${result.summary.colorIdentity ? ` · Identity: ${formatMana(result.summary.colorIdentity.map((c) => `{${c}}`).join('')) || 'colorless'}` : ''}</p>` : ''}
    `;
  } catch (error) {
    resultsDiv.innerHTML = '';
    showToast('Failed to check legality: ' + error.message, 'error');
  }
}

async function checkAllFormats() {
  const resultsDiv = document.getElementById('legality-results');
  resultsDiv.innerHTML = '<div class="legality-loading">Checking every format…</div>';
  try {
    const { formats } = await api.checkAllFormats(currentDeckId);
    const legal = formats.filter((f) => f.isLegal);
    const groups = [...new Set(formats.map((f) => f.group))];
    resultsDiv.innerHTML = `
      <p class="legality-meta">${legal.length ? `Legal in ${legal.map((f) => escapeHtml(f.label)).join(', ')}.` : 'Not legal in any format as it stands.'} Pick one for details.</p>
      ${groups.map((g) => `<h4 class="legality-group">${escapeHtml(g)}</h4>
        <div class="legality-grid">${formats.filter((f) => f.group === g).map((f) => `
          <button type="button" class="legality-chip" data-legal="${f.isLegal}" data-pick-format="${f.format}" title="${escapeHtml(f.errors.join('\n') || 'Legal')}">
            <i class="ph ${f.isLegal ? 'ph-check' : 'ph-x'}"></i> ${escapeHtml(f.label)}
            ${f.isLegal ? '' : `<span class="legality-chip-count">${f.errors.length}</span>`}
          </button>`).join('')}</div>`).join('')}
    `;
  } catch (error) {
    resultsDiv.innerHTML = '';
    showToast('Failed to check formats: ' + error.message, 'error');
  }
}

// Example Hand Functions
function dealExampleHand({ silent = false } = {}) {
  // Get mainboard cards only
  const mainboardCards = (currentDeck?.cards || []).filter(isMainboardCard);
  if (mainboardCards.length === 0) {
    // Never leave a previous deck's hand on screen
    exampleHand = [];
    renderExampleHand();
    updateHandStats();
    if (!silent) showToast('Add cards to your mainboard first', 'warning');
    return;
  }

  // Create a pool of cards based on quantities
  const cardPool = [];
  mainboardCards.forEach(card => {
    for (let i = 0; i < card.quantity; i++) {
      cardPool.push(card);
    }
  });

  // Shuffle and draw 7 cards (a sort with a random comparator isn't a fair shuffle)
  const shuffled = shuffle(cardPool);
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
  const mainboardCards = currentDeck.cards.filter(isMainboardCard);
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
    const hasMainboard = (currentDeck?.cards || []).some(isMainboardCard);
    handContainer.innerHTML = `<div class="example-hand-empty">${hasMainboard
      ? 'Press New hand to draw 7 random cards from your deck'
      : 'Add cards to your mainboard to draw a sample hand'}</div>`;
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
  const mainboardCards = currentDeck.cards.filter(isMainboardCard);
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
  const keepable = totalCards >= handSize
    ? hypergeometricAtLeast(totalCards, totalLands, handSize, 2) - hypergeometricAtLeast(totalCards, totalLands, handSize, 6)
    : 0;

  statsContainer.innerHTML = `Average lands in an opening hand: <strong>${expectedLands}</strong> · 2 to 5 lands: <strong>${Math.round(keepable * 100)}%</strong>`;
}

// ===== Printing Optimizer Functions =====

async function openPrintingOptimizer() {
  try {
    // Reset state
    optimizerState = {
      suggestions: [],
      currentIndex: 0,
      currentSelection: null,
      availableSets: []
    };

    // Show modal
    document.getElementById('printing-optimizer-modal').classList.remove('hidden');

    // Switch to auto tab by default
    switchOptimizerTab('auto');

    // Show loading
    document.getElementById('optimizer-loading').classList.remove('hidden');
    document.getElementById('optimizer-suggestions').classList.add('hidden');
    document.getElementById('optimizer-empty').classList.add('hidden');
    document.getElementById('apply-optimization-btn').disabled = true;

    // Load auto suggestions with commander filter
    const excludeCommander = document.getElementById('exclude-commander-sets').checked;
    const result = await api.analyzeDeckPrintings(currentDeckId, 5, excludeCommander);

    optimizerState.suggestions = result.suggestions || [];

    if (optimizerState.suggestions.length === 0) {
      document.getElementById('optimizer-loading').classList.add('hidden');
      document.getElementById('optimizer-empty').classList.remove('hidden');
      return;
    }

    // Load available sets for manual selection
    const setsResult = await api.getOptimizationSets(currentDeckId);
    optimizerState.availableSets = setsResult.sets || [];

    // Populate set dropdown
    const setSelect = document.getElementById('manual-set-select');
    setSelect.innerHTML = '<option value="">Choose a set...</option>' +
      optimizerState.availableSets.map(set =>
        `<option value="${set.code}">${set.name} (${set.code}) - ${set.card_count} cards</option>`
      ).join('');

    // Display first suggestion
    document.getElementById('optimizer-loading').classList.add('hidden');
    document.getElementById('optimizer-suggestions').classList.remove('hidden');
    displayCurrentSuggestion();

  } catch (error) {
    console.error('Failed to load optimizer:', error);
    showToast('Failed to load optimizer: ' + error.message, 'error');
    closePrintingOptimizer();
  }
}

function closePrintingOptimizer() {
  document.getElementById('printing-optimizer-modal').classList.add('hidden');
  optimizerState = {
    suggestions: [],
    currentIndex: 0,
    currentSelection: null,
    availableSets: []
  };
}

function switchOptimizerTab(tab) {
  // Update tab buttons
  document.getElementById('optimizer-tab-auto').classList.toggle('active', tab === 'auto');
  document.getElementById('optimizer-tab-manual').classList.toggle('active', tab === 'manual');

  // Update views
  document.getElementById('optimizer-auto-view').classList.toggle('hidden', tab !== 'auto');
  document.getElementById('optimizer-manual-view').classList.toggle('hidden', tab !== 'manual');

  // Reset apply button
  document.getElementById('apply-optimization-btn').disabled = true;

  // If switching to auto, enable apply button if we have suggestions
  if (tab === 'auto' && optimizerState.suggestions.length > 0) {
    optimizerState.currentSelection = optimizerState.suggestions[optimizerState.currentIndex];
    document.getElementById('apply-optimization-btn').disabled = false;
  } else if (tab === 'manual') {
    // Clear manual selection when switching to manual
    optimizerState.currentSelection = null;
    document.getElementById('manual-result').classList.add('hidden');
  }
}

function displayCurrentSuggestion() {
  const suggestion = optimizerState.suggestions[optimizerState.currentIndex];
  if (!suggestion) return;

  // Update counter
  document.getElementById('suggestion-counter').textContent =
    `${optimizerState.currentIndex + 1} / ${optimizerState.suggestions.length}`;

  // Update navigation buttons
  document.getElementById('prev-suggestion-btn').disabled = optimizerState.currentIndex === 0;
  document.getElementById('next-suggestion-btn').disabled =
    optimizerState.currentIndex === optimizerState.suggestions.length - 1;

  // Display suggestion details
  const suggestionEl = document.getElementById('current-suggestion');
  suggestionEl.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 1rem;">
      <div>
        <h4 style="margin: 0 0 0.5rem 0; font-size: 1.25rem;">${suggestion.setName}</h4>
        <div style="color: var(--text-secondary); font-size: 0.875rem;">
          <strong>${suggestion.setCode}</strong> • Released ${new Date(suggestion.releaseDate).toLocaleDateString()}
        </div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 2rem; font-weight: 700; color: var(--accent);">${suggestion.percentage}%</div>
        <div style="color: var(--text-secondary); font-size: 0.875rem;">${suggestion.cardCount} / ${suggestion.cards.length} cards</div>
      </div>
    </div>
    <div style="padding: 0.75rem; background: var(--bg-secondary); border-radius: 0.5rem; border-left: 4px solid var(--accent);">
      <i class="ph ph-info"></i>
      ${suggestion.cardCount} cards in your deck have printings in this set. Apply this optimization to use ${suggestion.setName} versions for all available cards.
    </div>
  `;

  // Display cards
  renderSuggestionCards(suggestion.cards, 'suggestion-cards-list');

  // Set current selection and enable apply button
  optimizerState.currentSelection = suggestion;
  document.getElementById('apply-optimization-btn').disabled = false;
}

function renderSuggestionCards(cards, containerId) {
  const container = document.getElementById(containerId);

  if (!cards || cards.length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-secondary);">No cards to display</div>';
    return;
  }

  container.innerHTML = cards.map(card => `
    <div style="display: flex; align-items: center; gap: 1rem; padding: 0.75rem; background: var(--bg-secondary); border-radius: 0.5rem; margin-bottom: 0.5rem;">
      <img src="${card.imageUrl}" alt="${card.cardName}"
        style="width: 60px; height: 84px; border-radius: 0.25rem; object-fit: cover;"
        onerror="this.style.display='none'">
      <div style="flex: 1;">
        <div style="font-weight: 600; margin-bottom: 0.25rem;">${card.cardName}</div>
        <div style="font-size: 0.875rem; color: var(--text-secondary);">
          ${card.quantity > 1 ? `${card.quantity}x • ` : ''}
          <span style="color: var(--text-muted);">Currently: ${card.currentSetName || card.currentSetCode}</span>
        </div>
        ${card.boardType && card.boardType !== 'mainboard' ?
          `<span style="font-size: 0.75rem; padding: 0.125rem 0.5rem; background: var(--bg-tertiary); border-radius: 0.25rem; margin-top: 0.25rem; display: inline-block;">
            ${card.boardType}
          </span>` : ''}
      </div>
      <div style="display: flex; align-items: center; gap: 0.5rem;">
        <i class="ph ph-arrow-right" style="color: var(--text-secondary);"></i>
        <div style="text-align: right;">
          <div style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">${card.rarity || 'Common'}</div>
        </div>
      </div>
    </div>
  `).join('');
}

async function analyzeManualSet(setCode) {
  try {
    document.getElementById('analyze-manual-set-btn').disabled = true;
    document.getElementById('analyze-manual-set-btn').innerHTML = '<i class="ph ph-spinner"></i> Analyzing...';

    const result = await api.analyzeSpecificSet(currentDeckId, setCode);

    if (!result || result.cardCount === 0) {
      showToast('No cards in your deck have printings in this set', 'info');
      document.getElementById('manual-result').classList.add('hidden');
      optimizerState.currentSelection = null;
      document.getElementById('apply-optimization-btn').disabled = true;
      return;
    }

    // Display manual result
    const manualSuggestionEl = document.getElementById('manual-suggestion');
    manualSuggestionEl.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 1rem;">
        <div>
          <h4 style="margin: 0 0 0.5rem 0; font-size: 1.25rem;">${result.setName}</h4>
          <div style="color: var(--text-secondary); font-size: 0.875rem;">
            <strong>${result.setCode}</strong> • Released ${new Date(result.releaseDate).toLocaleDateString()}
          </div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 2rem; font-weight: 700; color: var(--accent);">${result.percentage}%</div>
          <div style="color: var(--text-secondary); font-size: 0.875rem;">${result.cardCount} / ${result.totalCards} cards</div>
        </div>
      </div>
      <div style="padding: 0.75rem; background: var(--bg-secondary); border-radius: 0.5rem; border-left: 4px solid var(--accent);">
        <i class="ph ph-info"></i>
        ${result.cardCount} cards in your deck have printings in this set. Apply this optimization to use ${result.setName} versions for all available cards.
      </div>
    `;

    // Display cards
    renderSuggestionCards(result.cards, 'manual-cards-list');

    // Show result
    document.getElementById('manual-result').classList.remove('hidden');

    // Set current selection and enable apply button
    optimizerState.currentSelection = result;
    document.getElementById('apply-optimization-btn').disabled = false;

  } catch (error) {
    console.error('Failed to analyze set:', error);
    showToast('Failed to analyze set: ' + error.message, 'error');
  } finally {
    document.getElementById('analyze-manual-set-btn').disabled = false;
    document.getElementById('analyze-manual-set-btn').innerHTML = '<i class="ph ph-magnifying-glass"></i> Analyze';
  }
}

async function reloadOptimizerSuggestions() {
  try {
    // Show loading
    document.getElementById('optimizer-loading').classList.remove('hidden');
    document.getElementById('optimizer-suggestions').classList.add('hidden');
    document.getElementById('optimizer-empty').classList.add('hidden');

    // Reset current index
    optimizerState.currentIndex = 0;

    // Load auto suggestions with commander filter
    const excludeCommander = document.getElementById('exclude-commander-sets').checked;
    const result = await api.analyzeDeckPrintings(currentDeckId, 5, excludeCommander);

    optimizerState.suggestions = result.suggestions || [];

    if (optimizerState.suggestions.length === 0) {
      document.getElementById('optimizer-loading').classList.add('hidden');
      document.getElementById('optimizer-empty').classList.remove('hidden');
      document.getElementById('apply-optimization-btn').disabled = true;
      return;
    }

    // Display first suggestion
    document.getElementById('optimizer-loading').classList.add('hidden');
    document.getElementById('optimizer-suggestions').classList.remove('hidden');
    displayCurrentSuggestion();

  } catch (error) {
    console.error('Failed to reload suggestions:', error);
    showToast('Failed to reload suggestions: ' + error.message, 'error');
  }
}

async function applyOptimization() {
  if (!optimizerState.currentSelection || !optimizerState.currentSelection.cards) {
    showToast('No optimization selected', 'warning');
    return;
  }

  try {
    const applyBtn = document.getElementById('apply-optimization-btn');
    applyBtn.disabled = true;
    applyBtn.innerHTML = '<i class="ph ph-spinner"></i> Applying...';

    // Build changes array
    const changes = optimizerState.currentSelection.cards.map(card => ({
      deckCardId: card.deckCardId,
      newPrintingId: card.newPrintingId
    }));

    // Apply changes
    const result = await api.applyPrintingOptimization(currentDeckId, changes);

    showToast(result.message || `Updated ${result.updated} cards!`, 'success');

    // Reload deck to show updated printings
    await loadDeck(currentDeckId);

    // Keep modal open and reset button state
    applyBtn.disabled = false;
    applyBtn.innerHTML = '<i class="ph ph-check"></i> Apply Optimization';

    // Reload optimizer suggestions to reflect changes
    await reloadOptimizerSuggestions();

  } catch (error) {
    console.error('Failed to apply optimization:', error);
    showToast('Failed to apply optimization: ' + error.message, 'error');

    const applyBtn = document.getElementById('apply-optimization-btn');
    applyBtn.disabled = false;
    applyBtn.innerHTML = '<i class="ph ph-check"></i> Apply Optimization';
  }
}

function renderOptimizerResults(result, el) {
  // API response: { cart: [{ inventory_id, quantity_selected }], totals: { subtotal_cents, shipping_cents, buyer_fee_cents, total_cents, seller_count } }
  const totals = result.totals;
  const cart = result.cart ?? [];

  if (!totals && !cart.length) {
    el.innerHTML = `<div style="color:var(--text-secondary);padding:1rem;text-align:center;">
      No results returned. Check that your MANAPOOL_API_TOKEN is valid and cards are listed on Mana Pool.
    </div>`;
    return;
  }

  const fmt = cents => `$${(cents / 100).toFixed(2)}`;
  const sellerCount = totals?.seller_count ?? '?';
  const totalCents = totals?.total_cents ?? 0;

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
      <span style="font-size:1.1rem;font-weight:700;color:#16a34a;">
        <i class="ph ph-check-circle"></i> Optimized — ${fmt(totalCents)} across ${sellerCount} seller${sellerCount !== 1 ? 's' : ''}
      </span>
      <a href="https://manapool.com/cart" target="_blank" rel="noopener" class="btn btn-primary btn-sm">
        Complete on Mana Pool <i class="ph ph-arrow-square-out"></i>
      </a>
    </div>
    ${totals ? `
      <div style="background:var(--bg-tertiary);border-radius:8px;padding:0.75rem;margin-bottom:0.75rem;">
        <div style="display:flex;justify-content:space-between;padding:0.2rem 0;font-size:0.9rem;">
          <span>Subtotal</span><span>${fmt(totals.subtotal_cents ?? 0)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:0.2rem 0;font-size:0.9rem;">
          <span>Shipping</span><span>${fmt(totals.shipping_cents ?? 0)}</span>
        </div>
        ${totals.buyer_fee_cents ? `
        <div style="display:flex;justify-content:space-between;padding:0.2rem 0;font-size:0.9rem;">
          <span>Buyer fee</span><span>${fmt(totals.buyer_fee_cents)}</span>
        </div>` : ''}
        <div style="display:flex;justify-content:space-between;padding:0.35rem 0 0;font-size:1rem;font-weight:700;border-top:1px solid var(--border-color);margin-top:0.25rem;">
          <span>Total</span><span style="color:var(--primary);">${fmt(totalCents)}</span>
        </div>
      </div>
    ` : ''}
    <div style="font-size:0.8rem;color:var(--text-secondary);text-align:center;">
      ${cart.length} item${cart.length !== 1 ? 's' : ''} selected — click "Complete on Mana Pool" to review and checkout.
    </div>
  `;
}

function renderValidatorResults(result, el) {
  const valid = result.valid ?? result.is_valid ?? result.legal;
  const violations = result.violations ?? result.errors ?? result.issues ?? [];
  const commander = result.commander ?? result.commanders?.[0] ?? null;
  const colorIdentity = result.color_identity ?? result.colors ?? [];
  const cardCount = result.card_count ?? result.deck_size ?? null;

  const colorMap = { W: '☀️', U: '💧', B: '💀', R: '🔥', G: '🌲' };

  el.innerHTML = `
    <div style="padding:1rem;border-radius:8px;background:${valid ? 'rgba(22,163,74,0.1)' : 'rgba(239,68,68,0.1)'};border:1px solid ${valid ? '#16a34a' : '#ef4444'};margin-bottom:1rem;">
      <div style="font-size:1.1rem;font-weight:700;color:${valid ? '#16a34a' : '#ef4444'};">
        <i class="ph ${valid ? 'ph-check-circle' : 'ph-x-circle'}"></i>
        ${valid ? 'Deck is Legal' : 'Deck has Violations'}
      </div>
      ${cardCount != null ? `<div style="font-size:0.85rem;color:var(--text-secondary);margin-top:0.25rem;">${cardCount} cards</div>` : ''}
    </div>
    ${commander ? `
      <div style="margin-bottom:0.75rem;">
        <span style="font-size:0.75rem;text-transform:uppercase;color:var(--text-secondary);font-weight:600;">Commander</span>
        <div style="font-weight:600;margin-top:0.2rem;">${Array.isArray(commander) ? commander.join(' // ') : commander}</div>
      </div>
    ` : ''}
    ${colorIdentity.length ? `
      <div style="margin-bottom:0.75rem;">
        <span style="font-size:0.75rem;text-transform:uppercase;color:var(--text-secondary);font-weight:600;">Color Identity</span>
        <div style="font-size:1.2rem;margin-top:0.2rem;">${colorIdentity.map(c => colorMap[c] || c).join(' ')}</div>
      </div>
    ` : ''}
    ${violations.length ? `
      <div>
        <span style="font-size:0.75rem;text-transform:uppercase;color:#ef4444;font-weight:600;">Violations (${violations.length})</span>
        <div style="margin-top:0.5rem;display:flex;flex-direction:column;gap:0.4rem;">
          ${violations.map(v => {
            const card = v.card ?? v.name ?? '';
            const reason = v.reason ?? v.message ?? v.error ?? String(v);
            return `<div style="font-size:0.85rem;padding:0.4rem 0.6rem;background:rgba(239,68,68,0.08);border-radius:4px;">
              ${card ? `<strong>${card}</strong> — ` : ''}${reason}
            </div>`;
          }).join('')}
        </div>
      </div>
    ` : (valid ? `<div style="font-size:0.875rem;color:var(--text-secondary);">No issues found.</div>` : '')}
  `;
}
