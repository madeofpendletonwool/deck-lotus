// API Client for Deck Lotus

class ApiClient {
  constructor() {
    this.baseURL = '/api';
    this.token = localStorage.getItem('token');
  }

  setToken(token) {
    this.token = token;
    if (token) {
      localStorage.setItem('token', token);
    } else {
      localStorage.removeItem('token');
    }
  }

  async request(endpoint, options = {}) {
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
    this.setToken(data.accessToken);
    return data;
  }

  async login(username, password) {
    const data = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    this.setToken(data.accessToken);
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
  async searchCards(query, limit = 20) {
    return this.request(`/cards/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  }

  async browseCards(filters = {}) {
    const params = new URLSearchParams();
    if (filters.name) params.append('name', filters.name);
    if (filters.colors) params.append('colors', filters.colors); // Already a string from frontend
    if (filters.type) params.append('type', filters.type);
    if (filters.rarities) params.append('rarities', filters.rarities);
    if (filters.sort) params.append('sort', filters.sort);
    if (filters.sets) params.append('sets', filters.sets); // Already a string from frontend
    if (filters.subtypes) params.append('subtypes', filters.subtypes); // Already a string from frontend
    if (filters.cmcMin !== null && filters.cmcMin !== undefined) params.append('cmcMin', filters.cmcMin);
    if (filters.cmcMax !== null && filters.cmcMax !== undefined) params.append('cmcMax', filters.cmcMax);
    if (filters.onlyOwned) params.append('onlyOwned', filters.onlyOwned);
    if (filters.page) params.append('page', filters.page);
    if (filters.limit) params.append('limit', filters.limit);
    return this.request(`/cards/browse?${params}`);
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
}

export default new ApiClient();
