import api from './services/api.js';
import { setupAuth } from './components/auth.js';
import { setupDecks } from './components/decks.js';
import { setupDeckBuilder } from './components/deckBuilder.js';
import { setupCards } from './components/cards.js';
import { setupSettings } from './components/settings.js';
import { showLoading, hideLoading } from './utils/ui.js';

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

    // Check if user is already logged in
    if (api.token) {
      try {
        showLoading();
        await api.getProfile();
        this.showApp();
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
    document.getElementById('auth-page').classList.remove('hidden');
    document.getElementById('navbar').classList.add('hidden');
    this.hideAllPages();
  }

  showApp() {
    document.getElementById('auth-page').classList.add('hidden');
    document.getElementById('navbar').classList.remove('hidden');
    this.showPage('decks');
  }

  hideAllPages() {
    document.querySelectorAll('.page').forEach(page => {
      if (page.id !== 'auth-page') {
        page.classList.add('hidden');
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

    // Update nav links
    document.querySelectorAll('.nav-link').forEach(link => {
      link.classList.remove('active');
      if (link.dataset.page === pageName) {
        link.classList.add('active');
      }
    });

    // Trigger page-specific logic
    switch (pageName) {
      case 'decks':
        window.dispatchEvent(new CustomEvent('page:decks'));
        break;
      case 'cards':
        window.dispatchEvent(new CustomEvent('page:cards'));
        break;
      case 'settings':
        window.dispatchEvent(new CustomEvent('page:settings'));
        break;
    }
  }

  setupNavigation() {
    // Nav links
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const page = link.dataset.page;
        this.showPage(page);
      });
    });

    // Logout button
    document.getElementById('logout-btn').addEventListener('click', () => {
      api.logout();
      this.showAuthPage();
      window.location.reload();
    });
  }

  setupComponents() {
    setupAuth((user) => {
      this.showApp();
    });
    setupDecks();
    setupDeckBuilder();
    setupCards();
    setupSettings();
  }
}

// Start the app
new App();
