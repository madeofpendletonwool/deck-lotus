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
    if (filters.sort) params.append('sort', filters.sort);
    if (filters.sets) params.append('sets', filters.sets); // Already a string from frontend
    if (filters.cmcMin !== null && filters.cmcMin !== undefined) params.append('cmcMin', filters.cmcMin);
    if (filters.cmcMax !== null && filters.cmcMax !== undefined) params.append('cmcMax', filters.cmcMax);
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

  async addCardToDeck(deckId, printingId, quantity = 1, isSideboard = false) {
    return this.request(`/decks/${deckId}/cards`, {
      method: 'POST',
      body: JSON.stringify({ printingId, quantity, isSideboard }),
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

  // Set methods
  async getSets() {
    return this.request('/sets');
  }

  async getSet(code) {
    return this.request(`/sets/${code}`);
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
}

export default new ApiClient();
