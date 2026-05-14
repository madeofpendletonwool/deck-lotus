// Mana Pool API v1 integration
// Requires MANAPOOL_API_TOKEN and MANAPOOL_USER_EMAIL env vars
// Generate a token at: https://manapool.com/seller/settings/integrations

const BASE_URL = 'https://manapool.com/api/v1';

export function isConfigured() {
  return !!(process.env.MANAPOOL_API_TOKEN && process.env.MANAPOOL_USER_EMAIL);
}

function authHeaders() {
  return {
    'X-ManaPool-Email': process.env.MANAPOOL_USER_EMAIL,
    'X-ManaPool-Access-Token': process.env.MANAPOOL_API_TOKEN,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

async function apiGet(path) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: authHeaders() });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Mana Pool API error ${res.status}: ${path}${text ? ` — ${text}` : ''}`);
  }
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Mana Pool API error ${res.status}: ${path}${text ? ` — ${text}` : ''}`);
  }
  return res.json();
}

// POST /card_info — body: { card_names: [...] }
// Response: { cards: [{ name, from_price_cents, quantity_available, ... }], not_found: [...] }
export async function getCardInfoBulk(names) {
  if (!isConfigured()) throw new Error('Mana Pool API token not configured (MANAPOOL_API_TOKEN missing)');
  if (!names?.length) return [];
  const res = await apiPost('/card_info', { card_names: names.slice(0, 100) });
  return Array.isArray(res) ? res : (res.cards ?? []);
}

// GET /prices/singles — no params, returns all in-stock singles
// Response: { meta: { as_of }, data: [{ name, scryfall_id, price_cents, price_cents_nm, price_cents_lp_plus, ... }] }
// All prices are in cents — divide by 100 for dollars.
async function getAllSinglePrices() {
  if (!isConfigured()) throw new Error('Mana Pool API token not configured (MANAPOOL_API_TOKEN missing)');
  const res = await apiGet('/prices/singles');
  return Array.isArray(res) ? res : (res.data ?? []);
}

// Returns the lowest available price (in dollars) for a card at a given condition.
// condition: 'nm' | 'lp' | 'mp' | 'hp' | 'dm' | 'any' | null
// Uses /prices/singles which has per-printing prices for all in-stock items.
// All prices from the API are in cents — divided by 100 here.
export async function getLowestPrice(cardName, condition = 'nm') {
  if (!isConfigured()) {
    throw new Error('Mana Pool API token not configured (MANAPOOL_API_TOKEN missing)');
  }

  const normalised = condition?.toLowerCase();
  const useNm = normalised === 'nm';
  const useLp = normalised === 'lp' || normalised === 'mp' || normalised === 'hp' || normalised === 'dm';
  // 'any' / null → use price_cents (cheapest available across all conditions)

  // GET /prices/singles returns ALL in-stock singles with per-condition prices.
  // Filter to all printings of this card, then take the minimum.
  const singles = await getAllSinglePrices();
  const matches = singles.filter(s => s.name?.toLowerCase() === cardName.toLowerCase());

  if (!matches.length) {
    // Fallback: POST /card_info gives from_price_cents (cheapest overall, any condition)
    const cards = await getCardInfoBulk([cardName]);
    const matching = cards.filter(c => c.name?.toLowerCase() === cardName.toLowerCase());
    const prices = matching.map(c => c.from_price_cents).filter(p => p > 0);
    if (!prices.length) return null;
    const low = Math.min(...prices) / 100;
    return { lowPrice: low, marketPrice: low, products: [cardName] };
  }

  // Pick the correct price field per condition, then find the minimum across all printings
  const prices = matches
    .map(s => {
      if (useNm) return s.price_cents_nm || s.price_cents;
      if (useLp) return s.price_cents_lp_plus || s.price_cents;
      return s.price_cents; // any condition
    })
    .filter(p => p > 0);

  if (!prices.length) return null;

  const low = Math.min(...prices) / 100;
  const lowestMatch = matches.find(s => {
    const p = useNm ? (s.price_cents_nm || s.price_cents) : useLp ? (s.price_cents_lp_plus || s.price_cents) : s.price_cents;
    return p === Math.min(...prices);
  });
  const market = lowestMatch?.price_market ? lowestMatch.price_market / 100 : low;

  return { lowPrice: low, marketPrice: market, products: [cardName] };
}

// Map internal condition codes to Mana Pool condition_ids arrays.
// Mana Pool accepts an array of acceptable conditions — include all conditions at or above the requested one.
function toConditionIds(condition) {
  const all = ['NM', 'LP', 'MP', 'HP', 'DMG'];
  const norm = condition?.toLowerCase();
  if (!norm || norm === 'any') return all;
  const idx = { nm: 0, lp: 1, mp: 2, hp: 3, dm: 4, dmg: 4 }[norm] ?? 0;
  return all.slice(idx); // e.g. 'lp' → ['LP', 'MP', 'HP', 'DM'] — any condition LP or worse accepted
}

// POST /buyer/optimizer — finds cheapest combination of sellers for a list of cards
// items: [{ name, quantity, condition?, foil? }]
// model: 'lowest_price' | 'balanced' | 'fewest_packages' | 'gathered_shipping_only'
// Response: { cart: [{ inventory_id, quantity_selected }], totals: { subtotal_cents, shipping_cents, buyer_fee_cents, total_cents, seller_count } }
export async function optimizeCart(items, model = 'lowest_price') {
  if (!isConfigured()) throw new Error('Mana Pool API token not configured (MANAPOOL_API_TOKEN missing)');
  if (!items?.length) throw new Error('No items provided');

  const body = {
    model,
    destination_country: 'US',
    cart: items.map(item => ({
      type: 'mtg_single',
      name: item.name,
      quantity_requested: item.quantity ?? 1,
      language_ids: ['EN'],
      finish_ids: item.foil ? ['FO'] : ['NF'],
      condition_ids: toConditionIds(item.condition),
    })),
  };

  return apiPost('/buyer/optimizer', body);
}

// POST /deck — validate a deck for a given format
// decklist: plain-text list, e.g. "1 Sol Ring\n1 Atraxa..."
// format: 'commander' | 'standard' | 'modern' | etc.
export async function validateDeck(decklist, format = 'commander') {
  if (!isConfigured()) throw new Error('Mana Pool API token not configured (MANAPOOL_API_TOKEN missing)');
  return apiPost('/deck', { decklist, format });
}
