// TCGPlayer API v1.39.0 integration
// Requires TCGPLAYER_CLIENT_ID and TCGPLAYER_CLIENT_SECRET env vars

const BASE_URL = 'https://api.tcgplayer.com';
const API_VERSION = 'v1.39.0';
const MAGIC_CATEGORY_ID = 1;

let accessToken = null;
let tokenExpiresAt = 0;

function isConfigured() {
  return !!(process.env.TCGPLAYER_CLIENT_ID && process.env.TCGPLAYER_CLIENT_SECRET);
}

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiresAt - 60_000) {
    return accessToken;
  }

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.TCGPLAYER_CLIENT_ID,
    client_secret: process.env.TCGPLAYER_CLIENT_SECRET,
  });

  const res = await fetch(`${BASE_URL}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) {
    throw new Error(`TCGPlayer auth failed: ${res.status}`);
  }

  const data = await res.json();
  accessToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
  return accessToken;
}

async function apiGet(path) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}/${API_VERSION}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`TCGPlayer API error ${res.status}: ${path}`);
  }

  return res.json();
}

// Returns products matching cardName in Magic category
export async function searchProducts(cardName) {
  if (!isConfigured()) return [];

  const params = new URLSearchParams({
    productName: cardName,
    categoryId: MAGIC_CATEGORY_ID,
    productTypes: 'Cards',
    limit: 10,
  });

  const data = await apiGet(`/catalog/products?${params}`);
  return data.results || [];
}

// Returns market/low prices for given productIds (array)
export async function getProductPrices(productIds) {
  if (!isConfigured() || !productIds.length) return [];

  const data = await apiGet(`/pricing/product/${productIds.join(',')}`);
  return data.results || [];
}

// Returns the lowest normal (non-foil) market price for a card name
// condition: 'nm' | 'lp' | 'mp' | 'hp' | 'dm'
export async function getLowestPrice(cardName, condition = 'nm') {
  if (!isConfigured()) {
    throw new Error('TCGPlayer API credentials not configured');
  }

  const products = await searchProducts(cardName);
  if (!products.length) return null;

  // Prefer exact name match
  const exact = products.find(p => p.name.toLowerCase() === cardName.toLowerCase());
  const candidates = exact ? [exact] : products.slice(0, 3);
  const productIds = candidates.map(p => p.productId);

  const prices = await getProductPrices(productIds);

  // Each price entry has subTypeName (Normal/Foil) and condition fields
  const normal = prices.filter(p => p.subTypeName === 'Normal');
  if (!normal.length) return null;

  // Find lowest lowPrice across all printings for the given condition
  // TCGPlayer pricing doesn't break down by condition in the market endpoint —
  // market prices are condition-adjusted aggregates. lowPrice is the floor.
  const lowestLow = Math.min(...normal.map(p => p.lowPrice).filter(v => v != null));
  const lowestMarket = Math.min(...normal.map(p => p.marketPrice).filter(v => v != null));

  return {
    lowPrice: isFinite(lowestLow) ? lowestLow : null,
    marketPrice: isFinite(lowestMarket) ? lowestMarket : null,
    products: candidates.map(p => p.name),
  };
}

export { isConfigured };
