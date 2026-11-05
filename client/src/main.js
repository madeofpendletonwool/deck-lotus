import api from './services/api.js';
import { setupAuth } from './components/auth.js';
import { setupDecks } from './components/decks.js';
import { setupDeckBuilder } from './components/deckBuilder.js';
import { setupCards } from './components/cards.js';
import { setupSettings } from './components/settings.js';
import { setupShopping } from './components/shopping.js';
import { setupInventory } from './components/inventory.js';
import { setupSharedDeck, loadSharedDeck } from './components/sharedDeck.js';
import { setupPriceMonitoring } from './components/priceMonitoring.js';
import { setupUserMenu } from './components/userMenu.js';
import { showLoading, hideLoading, showToast } from './utils/ui.js';

const PAGE_TITLES = {
  decks: 'My Decks',
  cards: 'Browse Cards',
  shopping: 'Shopping',
  inventory: 'Inventory',
  'price-monitoring': 'Price Watch',
  settings: 'Settings',
};

/** Work out what a URL points at. Anything unrecognized lands on the deck list. */
function parseRoute(pathname) {
  const deck = pathname.match(/^\/decks\/(\d+)\/?$/);
  if (deck) return { page: 'decks', deckId: deck[1] };

  const page = pathname.replace(/^\/|\/$/g, '');
  return { page: PAGE_TITLES[page] ? page : 'decks', deckId: null };
}

class App {
  constructor() {
    this.currentPage = 'decks';
    this.init();
  }

  async init() {
    // Setup navigation and components first (before async auth check)
    // This ensures event listeners are registered before any events are dispatched
    this.setupNavigation();
    this.setupComponents();

    // Check if this is a shared deck URL
    const path = window.location.pathname;
    if (path.startsWith('/share/')) {
      const token = path.split('/share/')[1];
      await loadSharedDeck(token);
      return;
    }

    // Check if user is already logged in
    if (api.token) {
      try {
        showLoading();
        await api.getProfile();
        await this.showApp();
      } catch (error) {
        api.logout();
        this.showAuthPage();
      } finally {
        hideLoading();
      }
    } else {
      this.showAuthPage();
    }
  }

  showAuthPage() {
    this.hideAllPages();
    document.getElementById('auth-page').classList.remove('hidden');
    document.getElementById('navbar').classList.add('hidden');
    document.title = 'Deck Lotus';
  }

  async showApp() {
    // "Login to Import" on a shared deck sends people here; take them back to that deck.
    const pendingShare = localStorage.getItem('pendingShareImport');
    if (pendingShare) {
      localStorage.removeItem('pendingShareImport');
      window.location.href = `/share/${pendingShare}`;
      return;
    }

    document.getElementById('auth-page').classList.add('hidden');
    document.getElementById('navbar').classList.remove('hidden');
    await setupUserMenu();
    this.route();
  }

  /** Change the URL and show what it points at. */
  navigate(path, { replace = false } = {}) {
    if (path !== window.location.pathname) {
      window.history[replace ? 'replaceState' : 'pushState'](null, '', path);
    }
    this.route();
  }

  /** Show whatever the current URL points at. */
  route() {
    const { page, deckId } = parseRoute(window.location.pathname);
    if (deckId) {
      this.setActiveNav(page);
      document.title = 'Deck Lotus';
      window.dispatchEvent(new CustomEvent('open-deck', { detail: { deckId } }));
    } else {
      this.showPage(page);
    }
  }

  hideAllPages() {
    document.querySelectorAll('.page').forEach(page => {
      if (page.id !== 'auth-page') {
        page.classList.add('hidden');
      }
    });
  }

  setActiveNav(pageName) {
    document.querySelectorAll('.nav-link').forEach(link => {
      const isActive = link.dataset.page === pageName;
      link.classList.toggle('active', isActive);
      if (isActive) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  }

  showPage(pageName) {
    this.currentPage = pageName;

    // Hide all pages
    this.hideAllPages();

    // Show selected page
    const page = document.getElementById(`${pageName}-page`);
    if (page) {
      page.classList.remove('hidden');
    }

    this.setActiveNav(pageName);
    document.title = `${PAGE_TITLES[pageName]} · Deck Lotus`;
    window.scrollTo(0, 0);

    // Trigger page-specific logic
    window.dispatchEvent(new CustomEvent(`page:${pageName}`));
  }

  setupNavigation() {
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', (e) => {
        // Let the browser handle open-in-new-tab and friends.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        this.navigate(link.getAttribute('href'));
      });
    });

    window.addEventListener('popstate', () => {
      if (api.token) this.route();
    });

    window.addEventListener('navigate', (e) => {
      this.navigate(e.detail.path, e.detail);
    });

    window.addEventListener('auth:expired', () => {
      this.showAuthPage();
      showToast('Your session expired. Please log in again.', 'warning', 5000);
    });
  }

  setupComponents() {
    setupAuth(async (user) => {
      await this.showApp();
    });
    setupDecks();
    setupDeckBuilder();
    setupCards();
    setupShopping();
    setupInventory();
    setupSettings();
    setupPriceMonitoring();
    setupSharedDeck();
  }
}

// Start the app
new App();
