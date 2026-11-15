/**
 * The owned toggle on a deck row. Owned is per deck: a row is owned when copies from your
 * collection are in this deck, so one Ornithopter can't be owned in two decks at once.
 *
 * Clicking an owned row takes its copies out of the deck (they stay in your collection, free).
 * Clicking any other row puts copies in: free ones first. When there aren't enough, a dialog
 * offers to move them out of the decks that hold them, to add new copies to the collection, or
 * to mark the rest as proxies.
 *
 * Proxies (proxy_quantity) are stand-ins that aren't yours. They fill a row so it isn't missing,
 * but they never count as owned, and real copies replace them as they arrive.
 */
import api from '../services/api.js';
import { showToast } from '../utils/ui.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const copies = (n) => `${n} ${n === 1 ? 'copy' : 'copies'}`;

const proxiesOf = (n) => `${n} ${n === 1 ? 'proxy' : 'proxies'}`;

/** A row's copies: { qty, held (yours, in this deck), proxies }. */
function rowCopies(card) {
  const qty = Number(card.quantity) || 0;
  const held = Math.min(qty, Math.max(0, Number(card.owned_quantity) || 0));
  const proxies = card.board_type === 'maybeboard' ? 0 : Math.min(qty - held, Math.max(0, Number(card.proxy_quantity) || 0));
  return { qty, held, proxies };
}

/** The toggle's look for a row: { state: 'owned' | 'proxy' | 'partial' | 'none' | 'maybe', label }. */
export function ownershipState(card) {
  const { qty, held, proxies } = rowCopies(card);
  const free = Number(card.free_quantity) || 0;
  if (card.board_type === 'maybeboard') {
    return { state: 'maybe', label: `Maybeboard cards don't hold copies${free ? ` (${copies(free)} free in your collection)` : ''}` };
  }
  if (qty && held >= qty) return { state: 'owned', label: qty > 1 ? `All ${qty} copies are in this deck` : 'Your copy is in this deck' };
  if (qty && proxies && held + proxies >= qty) {
    return { state: 'proxy', label: held ? `${held} of yours and ${proxiesOf(proxies)}` : qty > 1 ? `All ${qty} are proxies` : 'Proxy' };
  }
  if (held > 0 || proxies > 0) {
    const parts = [held && `${held} of yours`, proxies && proxiesOf(proxies)].filter(Boolean).join(' and ');
    return { state: 'partial', label: `${parts}; ${qty - held - proxies} of ${qty} missing` };
  }
  const owned = Number(card.collection_quantity) || 0;
  if (!owned) return { state: 'none', label: 'Not in your collection' };
  return { state: 'none', label: free ? `Not in this deck (${copies(free)} free)` : `Not in this deck (your ${owned === 1 ? 'copy is' : 'copies are'} in other decks)` };
}

export function renderOwnershipToggle(card) {
  const { state, label } = ownershipState(card);
  const icon = { owned: 'ph-fill ph-check-circle', proxy: 'ph-fill ph-printer', partial: 'ph-fill ph-circle-half', none: 'ph ph-circle', maybe: 'ph ph-circle-dashed' }[state];
  const { qty, held, proxies } = rowCopies(card);
  const badge = state === 'partial'
    ? `<span class="own-count">${held + proxies}/${qty}${proxies ? 'P' : ''}</span>`
    : state === 'proxy' && held ? `<span class="own-count">${proxies}P</span>` : '';
  return `<button class="ownership-toggle-btn ${state === 'owned' ? 'owned' : ''} own-${state}" data-deck-card-id="${card.deck_card_id}" title="${esc(label)}" aria-label="${esc(label)}"${state === 'maybe' ? ' disabled' : ''}>
    <i class="${icon}"></i>${badge}
  </button>`;
}

/**
 * Handle a click on a row's toggle. Resolves to true when the deck changed, so the caller can
 * reload it.
 */
export async function toggleDeckOwnership(deckId, card) {
  const { qty, held } = rowCopies(card);
  try {
    if (held >= qty) {
      await api.setDeckCardOwned(deckId, card.deck_card_id, { owned: 0 });
      showToast(`${card.name} taken out of this deck (still in your collection)`, 'success', 2000);
      return true;
    }
    const result = await api.setDeckCardOwned(deckId, card.deck_card_id, { owned: qty });
    if (!result.short) {
      showToast(`${card.name}: ${result.owned_quantity > held ? `${copies(result.owned_quantity - held)} put in this deck` : 'in this deck'}`, 'success', 1800);
      return true;
    }
    const choice = await askWhereFrom(result);
    if (!choice) return result.owned_quantity !== held;
    if ('proxy' in choice) {
      await api.setDeckCardProxies(deckId, card.deck_card_id, choice.proxy);
      showToast(choice.proxy
        ? `${card.name}: ${proxiesOf(choice.proxy)}, not bought or counted as yours`
        : `${card.name}: proxies taken off`, 'success', 2200);
      return true;
    }
    if (choice.release) {
      await api.setDeckCardOwned(deckId, card.deck_card_id, { owned: 0 });
      showToast(`${card.name} taken out of this deck`, 'success', 1800);
      return true;
    }
    const after = await api.setDeckCardOwned(deckId, card.deck_card_id, { owned: qty, ...choice });
    const moved = (after.moved || []).map((m) => `${copies(m.quantity)} from ${m.name}`);
    if (after.added) moved.push(`${copies(after.added)} added to your collection`);
    showToast(`${card.name}: ${moved.join(', ') || 'updated'}${after.short ? ` · still ${after.short} short` : ''}`, 'success', 2500);
    return true;
  } catch (error) {
    showToast(`Couldn't update ${card.name}: ${error.message}`, 'error');
    return false;
  }
}

/**
 * The deck is short of copies. Ask where the rest come from: another deck, new copies, or
 * proxies. Resolves to { takeFrom: [deckId] }, { addToCollection: true }, { proxy: n },
 * { release: true } or null.
 */
function askWhereFrom(view) {
  const short = view.short;
  const inDeck = view.owned_quantity;
  const proxies = Math.max(0, Number(view.proxy_quantity) || 0);
  // Proxies already fill the gap: the dialog is about replacing them
  const proxied = proxies >= short;
  const elsewhere = view.elsewhere || [];
  const intro = view.collection_quantity
    ? `This deck needs ${short} more ${short === 1 ? 'copy' : 'copies'}. ${elsewhere.length
      ? `Your other copies are in ${elsewhere.map((d) => `<strong>${esc(d.name)}</strong>${d.held > 1 ? ` (${d.held})` : ''}`).join(', ')}.`
      : 'You have no other copies.'}`
    : `You don't have ${view.quantity > 1 ? 'any copies' : 'a copy'} in your collection yet.`;
  const proxyNote = proxies ? ` ${proxies === short ? (proxies === 1 ? 'It is' : 'They are') : `${proxies} are`} proxied for now.` : '';

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal';
    overlay.innerHTML = `
      <div class="modal-content modal-sm confirm-dialog own-dialog" role="dialog" aria-labelledby="own-dialog-title">
        <div class="confirm-icon"><i class="ph-fill ph-cards"></i></div>
        <h2 id="own-dialog-title">${esc(view.name)}</h2>
        <p>${intro}${inDeck ? ` ${copies(inDeck)} ${inDeck === 1 ? 'is' : 'are'} in this deck already.` : ''}${proxyNote}</p>
        <div class="own-choices">
          ${elsewhere.map((d) => `<button type="button" class="btn btn-secondary" data-take="${d.deck_id}"><i class="ph ph-arrow-bend-down-right"></i> Move ${copies(Math.min(short, d.held))} from ${esc(d.name)}</button>`).join('')}
          <button type="button" class="btn btn-secondary" data-act="add"><i class="ph ph-plus"></i> ${proxied ? `I got the real ${short > 1 ? 'ones' : 'one'}` : `I have ${view.collection_quantity ? 'more' : short > 1 ? 'them' : 'one'}`}: add ${copies(short)} to my collection</button>
          ${proxied
            ? `<button type="button" class="btn btn-ghost" data-proxy="0"><i class="ph ph-printer"></i> Stop proxying ${proxies === 1 ? 'it' : 'them'}</button>`
            : `<button type="button" class="btn btn-secondary" data-proxy="${short}"><i class="ph ph-printer"></i> ${proxies ? `Proxy all ${short}` : `Mark ${short > 1 ? `the ${short}` : 'it'} as ${short > 1 ? 'proxies' : 'a proxy'}`}</button>`}
          ${inDeck ? `<button type="button" class="btn btn-ghost" data-act="release"><i class="ph ph-minus-circle"></i> Take ${inDeck === 1 ? 'it' : 'them'} out of this deck instead</button>` : ''}
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-ghost" data-act="cancel">${proxied ? `Keep the ${proxies === 1 ? 'proxy' : 'proxies'}` : inDeck ? `Keep ${inDeck}` : 'Cancel'}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const done = (value) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (e) => { if (e.key === 'Escape') done(null); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) return done(null);
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.take) return done({ takeFrom: [Number(btn.dataset.take)] });
      if (btn.dataset.proxy != null) return done({ proxy: Number(btn.dataset.proxy) });
      if (btn.dataset.act === 'add') return done({ addToCollection: true });
      if (btn.dataset.act === 'release') return done({ release: true });
      if (btn.dataset.act === 'cancel') return done(null);
    });
    overlay.querySelector('.own-choices button')?.focus();
  });
}
