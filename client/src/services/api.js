// API Client for Deck Lotus

const SEARCH_CACHE_SIZE = 200;

class ApiClient {
  constructor() {
    this.baseURL = '/api';
    this.token = localStorage.getItem('token');
    this.refreshToken = localStorage.getItem('refreshToken');
    this.refreshing = null;
    this.searchCache = new Map();
  }

  setToken(token, refreshToken = null) {
    this.token = token;
    this.refreshToken = refreshToken;
    this.persist('token', token);
    this.persist('refreshToken', refreshToken);
  }

  persist(key, value) {
    if (value) {
      localStorage.setItem(key, value);
    } else {
      localStorage.removeItem(key);
    }
  }

  /** Swap the refresh token for new tokens. Concurrent 401s share one attempt. */
  renewSession() {
    if (!this.refreshToken) return Promise.resolve(false);
    if (!this.refreshing) {
      this.refreshing = fetch(`${this.baseURL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      })
        .then(async (response) => {
          if (!response.ok) return false;
          const tokens = await response.json();
          this.setToken(tokens.accessToken, tokens.refreshToken);
          return true;
        })
        .catch(() => false)
        .finally(() => {
          this.refreshing = null;
        });
    }
    return this.refreshing;
  }

  async request(endpoint, options = {}, isRetry = false) {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${this.baseURL}${endpoint}`, {
      ...options,
      headers,
    });

    // A 401 only ever means the session is no good. Renew it, or send the user back to log in,
    // rather than leaving every request on the page failing silently until a manual refresh.
    if (response.status === 401 && this.token && !endpoint.startsWith('/auth/log')) {
      if (!isRetry && (await this.renewSession())) {
        return this.request(endpoint, options, true);
      }
      this.logout();
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // Auth methods
  async register(username, email, password) {
    const data = await this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    });
    this.setToken(data.accessToken, data.refreshToken);
    return data;
  }

  async login(username, password) {
    const data = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    this.setToken(data.accessToken, data.refreshToken);
    return data;
  }

  logout() {
    this.setToken(null);
  }

  async getProfile() {
    return this.request('/auth/me');
  }

  async getUserStats() {
    return this.request('/auth/stats');
  }

  async getApiKeys() {
    return this.request('/auth/api-keys');
  }

  async createApiKey(name) {
    return this.request('/auth/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  // Card methods
  async searchCards(query, limit = 20, type = null, { signal } = {}) {
    const params = new URLSearchParams({ q: query, limit });
    if (type) params.append('type', type);

    const key = params.toString();
    const cached = this.searchCache.get(key);
    if (cached) return cached;

    const result = await this.request(`/cards/search?${params}`, { signal });
    if (this.searchCache.size >= SEARCH_CACHE_SIZE) {
      this.searchCache.delete(this.searchCache.keys().next().value);
    }
    this.searchCache.set(key, result);
    return result;
  }

  async browseCards(filters = {}, { signal } = {}) {
    const params = new URLSearchParams();
    if (filters.name) params.append('name', filters.name);
    if (filters.colors) params.append('colors', filters.colors); // Already a string from frontend
    if (filters.type) params.append('type', filters.type);
    if (filters.rarities) params.append('rarities', filters.rarities);
    if (filters.sort) params.append('sort', filters.sort);
    if (filters.seed) params.append('seed', filters.seed);
    if (filters.sets) params.append('sets', filters.sets); // Already a string from frontend
    if (filters.subtypes) params.append('subtypes', filters.subtypes); // Already a string from frontend
    if (filters.cmcMin !== null && filters.cmcMin !== undefined) params.append('cmcMin', filters.cmcMin);
    if (filters.cmcMax !== null && filters.cmcMax !== undefined) params.append('cmcMax', filters.cmcMax);
    if (filters.onlyOwned) params.append('onlyOwned', filters.onlyOwned);
    if (filters.page) params.append('page', filters.page);
    if (filters.limit) params.append('limit', filters.limit);
    return this.request(`/cards/browse?${params}`, { signal });
  }

  async getCard(id) {
    return this.request(`/cards/${id}`);
  }

  async getCardPrintings(id) {
    return this.request(`/cards/${id}/printings`);
  }

  async advancedSearch(filters) {
    const params = new URLSearchParams(filters);
    return this.request(`/cards/advanced?${params}`);
  }

  async toggleCardOwnership(cardId) {
    return this.request(`/cards/${cardId}/owned`, {
      method: 'POST',
    });
  }

  async getUserOwnedCards() {
    return this.request('/cards/owned/all');
  }

  async getCardOwnershipStatus(cardId) {
    return this.request(`/cards/${cardId}/owned`);
  }

  async getCardOwnershipAndUsage(cardId) {
    return this.request(`/cards/${cardId}/ownership-usage`);
  }

  async setOwnedPrintingQuantity(printingId, quantity) {
    return this.request(`/cards/printings/${printingId}/quantity`, {
      method: 'POST',
      body: JSON.stringify({ quantity }),
    });
  }

  async swapOwnedPrinting(fromPrintingId, replacementPrintingId) {
    return this.request(`/cards/printings/${fromPrintingId}/swap`, {
      method: 'POST',
      body: JSON.stringify({ replacementPrintingId }),
    });
  }

  // Deck methods
  async getDecks() {
    return this.request('/decks');
  }

  async getDeck(id) {
    return this.request(`/decks/${id}`);
  }

  async createDeck(name, format, description) {
    return this.request('/decks', {
      method: 'POST',
      body: JSON.stringify({ name, format, description }),
    });
  }

  async updateDeck(id, updates) {
    return this.request(`/decks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async deleteDeck(id) {
    return this.request(`/decks/${id}`, {
      method: 'DELETE',
    });
  }

  async addCardToDeck(deckId, printingId, quantity = 1, isSideboard = false, isCommander = false, boardType = null) {
    return this.request(`/decks/${deckId}/cards`, {
      method: 'POST',
      body: JSON.stringify({ printingId, quantity, isSideboard, isCommander, boardType }),
    });
  }

  async updateDeckCard(deckId, cardId, updates) {
    return this.request(`/decks/${deckId}/cards/${cardId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async removeDeckCard(deckId, cardId) {
    return this.request(`/decks/${deckId}/cards/${cardId}`, {
      method: 'DELETE',
    });
  }

  async getDeckStats(deckId) {
    return this.request(`/decks/${deckId}/stats`);
  }

  async getDeckPrice(deckId) {
    return this.request(`/decks/${deckId}/price`);
  }

  async importDeck(name, format, deckList) {
    return this.request('/decks/import', {
      method: 'POST',
      body: JSON.stringify({ name, format, deckList }),
    });
  }

  // Deck sharing methods
  async createDeckShare(deckId) {
    return this.request(`/decks/${deckId}/share`, {
      method: 'POST',
    });
  }

  async deleteDeckShare(deckId) {
    return this.request(`/decks/${deckId}/share`, {
      method: 'DELETE',
    });
  }

  async getSharedDeck(token) {
    return this.request(`/decks/share/${token}`);
  }

  async importSharedDeck(token) {
    return this.request(`/decks/share/${token}/import`, {
      method: 'POST',
    });
  }

  async checkDeckLegality(deckId, format) {
    return this.request(`/decks/${deckId}/legality/${format}`);
  }

  // Printing optimization methods
  async analyzeDeckPrintings(deckId, topN = 5, excludeCommander = false) {
    return this.request(`/decks/${deckId}/optimize-printings?topN=${topN}&excludeCommander=${excludeCommander}`);
  }

  async getOptimizationSets(deckId) {
    return this.request(`/decks/${deckId}/optimize-printings/sets`);
  }

  async analyzeSpecificSet(deckId, setCode) {
    return this.request(`/decks/${deckId}/optimize-printings/analyze-set`, {
      method: 'POST',
      body: JSON.stringify({ setCode }),
    });
  }

  async applyPrintingOptimization(deckId, changes) {
    return this.request(`/decks/${deckId}/optimize-printings/apply`, {
      method: 'POST',
      body: JSON.stringify({ changes }),
    });
  }

  // Set methods
  async getSets() {
    return this.request('/sets');
  }

  async getSet(code) {
    return this.request(`/sets/${code}`);
  }

  // Subtype methods
  async getSubtypes() {
    return this.request('/cards/subtypes');
  }

  async getSetCards(code, page = 1) {
    return this.request(`/sets/${code}/cards?page=${page}`);
  }

  // Admin methods
  async syncDatabase() {
    return this.request('/admin/sync', { method: 'POST' });
  }

  async getSyncStatus() {
    return this.request('/admin/sync-status');
  }

  async createBackup() {
    // Returns a backup JSON object
    return this.request('/admin/backup', { method: 'POST' });
  }

  async restoreBackup(backup, overwrite = false) {
    return this.request('/admin/restore', {
      method: 'POST',
      body: JSON.stringify({ backup, overwrite }),
    });
  }

  // Backup management methods
  async getBackups() {
    return this.request('/admin/backups');
  }

  async downloadBackupFile(filename) {
    return this.request(`/admin/backups/${filename}`);
  }

  async deleteBackupFile(filename) {
    return this.request(`/admin/backups/${filename}`, {
      method: 'DELETE',
    });
  }

  async createBackupNow() {
    return this.request('/admin/backup/create', {
      method: 'POST',
    });
  }

  async restoreFromBackupFile(filename, overwrite = false) {
    return this.request('/admin/restore-from-file', {
      method: 'POST',
      body: JSON.stringify({ filename, overwrite }),
    });
  }

  async getBackupConfig() {
    return this.request('/admin/backup-config');
  }

  async saveBackupConfig(config) {
    return this.request('/admin/backup-config', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  // User management methods (admin only)
  async getAllUsers() {
    return this.request('/admin/users');
  }

  async updateUser(userId, updates) {
    return this.request(`/admin/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async deleteUser(userId) {
    return this.request(`/admin/users/${userId}`, {
      method: 'DELETE',
    });
  }

  async resetUserPassword(userId, password) {
    return this.request(`/admin/users/${userId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  }

  // Public auth config (no auth required) — used to hide the Register option
  async getAuthConfig() {
    return this.request('/auth/config');
  }

  // App settings (admin only)
  async getAdminSettings() {
    return this.request('/admin/settings');
  }

  async updateAdminSettings(updates) {
    return this.request('/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  // Shopping methods
  async getShoppingList(deckIds) {
    const params = new URLSearchParams();
    if (deckIds && deckIds.length > 0) {
      params.append('deckIds', deckIds.join(','));
    }
    return this.request(`/shopping?${params}`);
  }

  // Inventory methods
  async getInventory(filters = {}) {
    const params = new URLSearchParams();
    if (filters.name) params.append('name', filters.name);
    if (filters.colors && filters.colors.length > 0) params.append('colors', filters.colors.join(','));
    if (filters.type && filters.type !== 'all') params.append('type', filters.type);
    if (filters.sets && filters.sets.length > 0) params.append('sets', filters.sets.join(','));
    if (filters.sort) params.append('sort', filters.sort);
    if (filters.seed) params.append('seed', filters.seed);
    if (filters.availability) params.append('availability', filters.availability);
    if (filters.page) params.append('page', filters.page);
    if (filters.limit) params.append('limit', filters.limit);

    const queryString = params.toString();
    return this.request(`/inventory${queryString ? '?' + queryString : ''}`);
  }

  async getInventoryStats() {
    return this.request('/inventory/stats');
  }

  async searchForInventoryAdd(query) {
    return this.request(`/inventory/search?q=${encodeURIComponent(query)}`);
  }

  async getInventorySets() {
    return this.request('/inventory/sets');
  }

  async bulkAddToInventory(items) {
    return this.request('/inventory/bulk-add', {
      method: 'POST',
      body: JSON.stringify({ items }),
    });
  }

  async quickAddToInventory(printingId, quantity = 1) {
    return this.request('/inventory/quick-add', {
      method: 'POST',
      body: JSON.stringify({ printingId, quantity }),
    });
  }

  // Price monitoring methods
  async getPriceMonitoringStatus() {
    return this.request('/price-monitoring/status');
  }

  async getPriceWatches() {
    return this.request('/price-monitoring');
  }

  async createPriceWatch(data) {
    return this.request('/price-monitoring', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updatePriceWatch(id, data) {
    return this.request(`/price-monitoring/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deletePriceWatch(id) {
    return this.request(`/price-monitoring/${id}`, {
      method: 'DELETE',
    });
  }

  async getPriceWatchHistory(id) {
    return this.request(`/price-monitoring/${id}/history`);
  }

  async runPriceChecksNow() {
    return this.request('/price-monitoring/check-now', { method: 'POST' });
  }

  async getPriceCheckSchedule() {
    return this.request('/price-monitoring/schedule');
  }

  async setPriceCheckSchedule(schedule) {
    return this.request('/price-monitoring/schedule', { method: 'POST', body: JSON.stringify({ schedule }) });
  }

  // Mana Pool methods
  async manaPoolStatus() {
    return this.request('/manapool/status');
  }

  async manaPoolOptimize(items, model = 'lowest_price') {
    return this.request('/manapool/optimize', {
      method: 'POST',
      body: JSON.stringify({ items, model }),
    });
  }

  async manaPoolValidateDeck(decklist, format = 'commander') {
    return this.request('/manapool/validate-deck', {
      method: 'POST',
      body: JSON.stringify({ decklist, format }),
    });
  }

  async manaPoolCardInfo(names) {
    return this.request('/manapool/card-info', {
      method: 'POST',
      body: JSON.stringify({ names }),
    });
  }
}

export default new ApiClient();
