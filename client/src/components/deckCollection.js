/**
 * A deck measured against your collection:
 *   - how much of it you already own, and what the rest costs
 *   - which of its cards other decks of yours also claim ("fighting over your only copy")
 *   - what in your binder fits it: its colors (the commander's identity), its format, not already in it
 *
 * The counting happens on the server (shared/collection.js). A DeckCollection renders into one
 * container; the deck builder gives it a binder and an add button, the shared deck page doesn't.
 */
import { formatMana, showToast, copyText } from '../utils/ui.js';

const STATUS = {
  missing: { label: 'Missing', icon: 'ph-x-circle' },
  partial: { label: 'Short', icon: 'ph-circle-half' },
  shared: { label: 'Shared', icon: 'ph-arrows-left-right' },
  owned: { label: 'Owned', icon: 'ph-check-circle' },
};
const TYPE_LABELS = {
  creature: 'Creatures', planeswalker: 'Planeswalkers', battle: 'Battles', land: 'Lands',
  instant: 'Instants', sorcery: 'Sorceries', artifact: 'Artifacts', enchantment: 'Enchantments', other: 'Other',
};
const PAGE_SIZE = 60;

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const smallImage = (url) => (url ? url.replace('/normal/', '/small/') : '');

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Remembered settings are only a convenience
  }
}

/** Everything in the deck, boards included, so any change to it fetches a fresh report. */
function deckKey(deck) {
  return (deck?.cards || [])
    .map((c) => `${c.card_id}:${c.quantity}:${c.board_type || ''}:${c.is_commander ? 1 : 0}`)
    .sort()
    .join('|') + `#${deck?.format || ''}`;
}

function seg(name, options, value) {
  return `<div class="seg" role="radiogroup">${options.map(([v, label]) => `<button type="button" class="seg-btn${String(v) === String(value) ? ' active' : ''}" data-seg="${name}" data-value="${escapeHtml(v)}" role="radio" aria-checked="${String(v) === String(value)}">${label}</button>`).join('')}</div>`;
}

export class DeckCollection {
  /**
   * @param host.container     element to render into
   * @param host.getDeck       () => the deck being shown
   * @param host.fetchReport   () => Promise of the ownership report
   * @param host.fetchBinder   (params) => Promise of binder fits; leave out for no binder
   * @param host.addCard       (card) => Promise, adds an owned card to the deck
   * @param host.buyMissing    () => opens the buy flow for what's missing; optional
   * @param host.deckLinks     false to show your other decks as plain names, not links
   * @param host.showCard, host.preview, host.hidePreview  card detail and hover preview; optional
   */
  constructor(host) {
    this.host = host;
    this.el = host.container;
    this.visible = false;
    this.report = null;
    this.reportKey = null;
    this.reportError = null;
    this.loading = false;
    this.prefs = readJson('deckCollection', { alongside: false, filter: 'all' });
    this.binderPrefs = readJson('deckBinder', { colors: 'deck', free: false, sort: '' });
    this.binder = null;
    this.binderKey = null;
    this.binderQuery = { q: '', type: '' };
    this.binderLoading = false;
    this.binderSeq = 0;
    this.searchTimer = null;
    this.adding = new Set();

    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('input', (e) => this.onInput(e));
    this.el.addEventListener('change', (e) => this.onChange(e));
    this.el.addEventListener('mouseover', (e) => this.onHover(e));
    this.el.addEventListener('mouseout', (e) => {
      if (e.target.closest?.('[data-preview]')) this.host.hidePreview?.();
    });
  }

  /** Show (true) or hide (false). Showing always fetches, since your collection may have changed. */
  show(visible) {
    this.visible = visible;
    if (!visible) return;
    this.reportKey = null;
    this.binderKey = null;
    this.load();
  }

  /** The deck changed: fetch again if it's on screen. */
  refresh() {
    if (this.visible) this.load();
  }

  /** A different deck was opened. */
  reset() {
    this.report = null;
    this.reportKey = null;
    this.binder = null;
    this.binderKey = null;
    this.binderQuery = { q: '', type: '' };
  }

  async load() {
    const key = deckKey(this.host.getDeck());
    const jobs = [];
    if (key !== this.reportKey) {
      this.reportKey = key;
      jobs.push(this.loadReport(key));
    }
    if (this.host.fetchBinder && key !== this.binderKey) {
      this.binderKey = key;
      jobs.push(this.loadBinder());
    }
    if (!jobs.length) return this.render();
    if (!this.report) this.render(); // Loading state
    await Promise.all(jobs);
  }

  async loadReport(key) {
    this.loading = true;
    try {
      const report = await this.host.fetchReport();
      if (key !== this.reportKey) return; // A newer request is on its way
      this.report = report;
      this.reportError = null;
    } catch (err) {
      if (key !== this.reportKey) return;
      this.reportError = err.message || 'Could not load your collection';
    } finally {
      this.loading = false;
    }
    if (this.visible) this.render();
  }

  async loadBinder({ more = false } = {}) {
    const seq = ++this.binderSeq;
    this.binderLoading = true;
    if (!more) this.renderBinderResults();
    const params = {
      q: this.binderQuery.q,
      type: this.binderQuery.type,
      free: this.binderPrefs.free ? '1' : '',
      colors: this.binderPrefs.colors,
      sort: this.binderPrefs.sort,
      offset: more ? this.binder?.cards.length || 0 : 0,
      limit: PAGE_SIZE,
    };
    try {
      const result = await this.host.fetchBinder(params);
      if (seq !== this.binderSeq) return;
      this.binder = more && this.binder ? { ...result, cards: [...this.binder.cards, ...result.cards] } : result;
      this.binderError = null;
    } catch (err) {
      if (seq !== this.binderSeq) return;
      this.binderError = err.message || 'Could not search your binder';
    } finally {
      if (seq === this.binderSeq) this.binderLoading = false;
    }
    if (this.visible) this.renderBinder();
  }

  // ==== Rendering ==============================================================================

  render() {
    if (!this.visible) return;
    if (!this.report) {
      this.el.innerHTML = this.reportError
        ? `<div class="grid-message"><i class="ph ph-warning"></i><h3>Couldn't check your collection</h3><p>${escapeHtml(this.reportError)}</p></div>`
        : `<div class="grid-message"><i class="ph ph-spinner"></i><p>Checking your collection…</p></div>`;
      return;
    }
    const { summary } = this.report;
    const binder = this.host.fetchBinder
      ? `<section class="an-section an-wide col-binder" aria-labelledby="col-binder-title" data-binder>${this.binderHtml()}</section>`
      : '';
    const body = summary.cards === 0
      ? `<div class="grid-message"><i class="ph ph-books"></i><h3>Nothing to check yet</h3><p>${summary.basics ? 'This deck is only basic lands, which aren\'t counted.' : 'Add cards to see how many you already own.'}</p></div>`
      : `${this.tilesHtml()}
        <div class="an-grid">
          <section class="an-section an-wide" aria-labelledby="col-list-title">${this.listHtml()}</section>
        </div>`;
    this.el.innerHTML = `${body}${binder ? `<div class="an-grid col-binder-grid">${binder}</div>` : ''}`;
  }

  tilesHtml() {
    const s = this.report.summary;
    const alongside = this.prefs.alongside;
    const toBuy = alongside ? s.alongsideCopies : s.missingCopies;
    const cost = alongside ? s.alongsideCost : s.cost;
    const ownedPct = s.copies ? Math.round((s.ownedCopies / s.copies) * 100) : 0;
    return `<div class="an-tiles">
      <div class="an-tile"><span class="an-tile-label">Owned</span><span class="an-tile-value">${s.ownedCards}<small> / ${s.cards}</small></span><span class="an-tile-sub">cards you have enough of${s.basics ? ', basics aside' : ''}</span></div>
      <div class="an-tile"><span class="an-tile-label">Copies</span><span class="an-tile-value">${ownedPct}%</span>
        <span class="col-meter" role="img" aria-label="${s.ownedCopies} of ${s.copies} copies owned"><span style="width:${ownedPct}%"></span></span>
        <span class="an-tile-sub">${s.ownedCopies} of ${s.copies} owned</span></div>
      <div class="an-tile"><span class="an-tile-label">${alongside ? 'To build it alongside the rest' : 'To finish it'}</span><span class="an-tile-value">${toBuy ? money(cost) : '$0'}</span>
        <span class="an-tile-sub">${toBuy ? `${plural(toBuy, 'copy', 'copies')}${s.unpriced && !alongside ? `, ${s.unpriced} without a price` : ''}` : 'Nothing to buy'}</span></div>
      ${alongside ? '' : `<div class="an-tile"><span class="an-tile-label">Cheapest printings</span><span class="an-tile-value">${s.missingCopies ? money(s.cheapestCost) : '$0'}</span><span class="an-tile-sub">if you don't mind which printing</span></div>`}
      <div class="an-tile"><span class="an-tile-label">Shared with other decks</span><span class="an-tile-value">${s.sharedCards}</span><span class="an-tile-sub">${s.sharedCards ? `${plural(s.alongsideCopies - s.missingCopies, 'more copy', 'more copies')} to have every deck built at once` : 'No copies borrowed'}</span></div>
    </div>`;
  }

  listHtml() {
    const { cards, summary } = this.report;
    const filter = this.prefs.filter;
    const counts = { all: cards.length, missing: 0, shared: 0, owned: 0 };
    for (const c of cards) {
      if (c.missing > 0) counts.missing += 1;
      if (c.status === 'shared') counts.shared += 1;
      if (c.status === 'owned' || c.status === 'shared') counts.owned += 1;
    }
    const shown = cards.filter((c) => {
      if (filter === 'missing') return c.missing > 0;
      if (filter === 'shared') return c.status === 'shared' || (c.other_demand > 0 && c.alongside > c.missing);
      if (filter === 'owned') return c.missing === 0;
      return true;
    });
    const toBuy = this.prefs.alongside ? summary.alongsideCopies : summary.missingCopies;

    const rows = shown.map((c) => {
      const st = STATUS[c.status];
      const buy = this.prefs.alongside ? c.alongside : c.missing;
      const others = c.other_decks.length
        ? c.other_decks.map((d) => {
          const label = `${escapeHtml(d.name)}${d.quantity > 1 ? ` <span class="muted">×${d.quantity}</span>` : ''}`;
          const title = `${escapeHtml(d.name)} lists ${d.quantity}`;
          return this.host.deckLinks === false
            ? `<span class="col-deck" title="${title}">${label}</span>`
            : `<a class="col-deck" href="/decks/${d.deck_id}" data-deck-link="${d.deck_id}" title="${title}">${label}</a>`;
        }).join('')
        : '<span class="muted">—</span>';
      const only = c.status === 'shared' && c.owned === 1 ? '<span class="col-only">your only copy</span>' : '';
      return `<tr data-status="${c.status}">
        <td><span class="col-pill" data-status="${c.status}"><i class="ph-fill ${st.icon}" aria-hidden="true"></i> ${st.label}</span></td>
        <th scope="row" class="col-name"><button type="button" class="link-btn" data-card="${c.card_id}" data-preview="${escapeHtml(c.image_url || '')}">${escapeHtml(c.name)}</button>${c.is_commander ? ' <span class="col-tag">Commander</span>' : ''}</th>
        <td class="col-cost">${formatMana(c.mana_cost || '')}</td>
        <td class="num">${c.need}</td>
        <td class="num${c.owned < c.need ? ' col-short' : ''}">${c.owned}</td>
        <td class="col-others">${others}${only}</td>
        <td class="num">${c.price_each == null ? '<span class="muted">—</span>' : money(c.price_each)}</td>
        <td class="num">${buy ? (c.price_each == null ? `<span class="muted">${buy} unpriced</span>` : `${buy} · ${money(buy * c.price_each)}`) : '<span class="muted">—</span>'}</td>
      </tr>`;
    }).join('');

    return `
      <div class="an-head">
        <h3 id="col-list-title">Against your collection</h3>
        ${seg('col-filter', [['all', `All ${counts.all}`], ['missing', `Missing ${counts.missing}`], ['shared', `Shared ${counts.shared}`], ['owned', `Owned ${counts.owned}`]], filter)}
        ${seg('col-alongside', [['0', 'This deck alone'], ['1', 'Alongside my other decks']], this.prefs.alongside ? '1' : '0')}
      </div>
      <p class="an-note">Copies count across every printing you own. "Alongside my other decks" treats copies your other decks list as taken, so it shows what to buy to have every deck built at once. Maybeboards don't claim copies, and basic lands aren't counted.</p>
      <div class="col-actions">
        ${this.host.buyMissing && summary.missingCopies ? `<button type="button" class="btn btn-primary btn-sm" data-action="buy"><i class="ph ph-shopping-cart"></i> Buy the missing ${plural(summary.missingCopies, 'copy', 'copies')}</button>` : ''}
        <button type="button" class="btn btn-secondary btn-sm" data-action="copy"${toBuy ? '' : ' disabled'}><i class="ph ph-copy"></i> Copy ${this.prefs.alongside ? 'what to buy' : 'missing list'}</button>
        ${this.loading ? '<span class="muted col-updating"><i class="ph ph-spinner"></i> Updating…</span>' : ''}
      </div>
      <div class="col-table-wrap">
        <table class="an-table col-table">
          <thead><tr><th>Status</th><th>Card</th><th>Cost</th><th class="num">Need</th><th class="num">Own</th><th>Also in</th><th class="num">Each</th><th class="num">To buy</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="8" class="muted">Nothing here.</td></tr>`}</tbody>
        </table>
      </div>`;
  }

  // ---- Binder ----

  binderHtml() {
    const p = this.binderPrefs;
    return `
      <div class="an-head">
        <h3 id="col-binder-title">From your binder</h3>
        ${seg('bd-colors', [['deck', 'Deck colors'], ['any', 'Any color']], p.colors)}
      </div>
      <p class="an-note" data-binder-note>${this.binderNote()}</p>
      <div class="col-binder-controls">
        <input type="search" class="col-search" data-binder-search placeholder="Search name, type or rules text" value="${escapeHtml(this.binderQuery.q)}" aria-label="Search your binder">
        <label class="col-check"><input type="checkbox" data-binder-free${p.free ? ' checked' : ''}> Only copies no deck is using</label>
        <label class="col-sort">Sort
          <select data-binder-sort>
            ${[['', 'Default'], ['rank', 'EDHREC rank'], ['name', 'Name'], ['mv', 'Mana value'], ['free', 'Free copies']].map(([v, l]) => `<option value="${v}"${p.sort === v ? ' selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
      </div>
      <div data-binder-results>${this.binderResultsHtml()}</div>`;
  }

  binderNote() {
    const b = this.binder;
    if (!b) return 'Cards you own that this deck could use.';
    const id = b.identity;
    const colors = id.colors && id.colors.length ? id.colors.map((c) => formatMana(`{${c}}`)).join('') : formatMana('{C}');
    const where = this.binderPrefs.colors === 'any'
      ? 'any color'
      : id.source === 'commander'
        ? `${escapeHtml(id.names.join(' and '))}'s colors ${colors}`
        : id.source === 'deck'
          ? `the deck's colors so far ${colors}`
          : id.source === 'no-commander' ? 'any color (choose a commander to narrow this)' : 'any color';
    const legal = b.format?.legality ? `, legal in ${escapeHtml(b.format.label)}` : '';
    return `${plural(b.fitting, 'card')} of the ${b.owned.toLocaleString()} you own fit: ${where}${legal}, and not already in the deck.`;
  }

  binderResultsHtml() {
    const b = this.binder;
    if (this.binderError) return `<p class="muted"><i class="ph ph-warning"></i> ${escapeHtml(this.binderError)}</p>`;
    if (!b) return `<p class="muted"><i class="ph ph-spinner"></i> Looking through your binder…</p>`;
    if (b.owned === 0) return `<p class="muted">Your collection is empty. Add cards on the Inventory page, or mark them owned from any card.</p>`;

    const types = Object.keys(TYPE_LABELS).filter((t) => b.typeCounts[t]);
    const all = types.reduce((s, t) => s + b.typeCounts[t], 0);
    const chips = `<div class="col-types" role="radiogroup" aria-label="Card type">
      <button type="button" class="tag-chip${!this.binderQuery.type ? ' active' : ''}" data-binder-type="">All <span class="muted">${all}</span></button>
      ${types.map((t) => `<button type="button" class="tag-chip${this.binderQuery.type === t ? ' active' : ''}" data-binder-type="${t}">${TYPE_LABELS[t]} <span class="muted">${b.typeCounts[t]}</span></button>`).join('')}
    </div>`;

    if (!b.cards.length) {
      return `${chips}<p class="muted">${b.fitting ? 'Nothing matches.' : 'Nothing you own fits this deck yet.'}</p>`;
    }
    const tiles = b.cards.map((c) => {
      const busy = this.adding.has(c.card_id);
      const usage = c.free > 0
        ? `<span class="col-free">${c.free} free</span>${c.in_decks ? ` <span class="muted">· ${c.in_decks} in decks</span>` : ''}`
        : `<span class="col-busy">all ${c.owned} in decks</span>`;
      return `<li class="col-card">
        <button type="button" class="col-card-img" data-card="${c.card_id}" data-preview="${escapeHtml(c.image_url || '')}" aria-label="${escapeHtml(c.name)}">
          ${c.image_url ? `<img src="${escapeHtml(smallImage(c.image_url))}" srcset="${escapeHtml(smallImage(c.image_url))} 146w, ${escapeHtml(c.image_url)} 488w" sizes="(max-width: 600px) 120px, 170px" alt="" loading="lazy">` : `<span class="col-noimg">${escapeHtml(c.name)}</span>`}
        </button>
        <div class="col-card-body">
          <div class="col-card-name" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</div>
          <div class="col-card-meta">${usage}${c.in_maybeboard ? ' <span class="col-tag">Maybeboard</span>' : ''}</div>
        </div>
        ${this.host.addCard ? `<button type="button" class="icon-btn col-add" data-add="${c.card_id}" title="Add to the main deck" aria-label="Add ${escapeHtml(c.name)} to the main deck"${busy ? ' disabled' : ''}><i class="ph ${busy ? 'ph-spinner' : 'ph-plus'}"></i></button>` : ''}
      </li>`;
    }).join('');
    const more = b.cards.length < b.total
      ? `<div class="col-more"><button type="button" class="btn btn-secondary btn-sm" data-action="more"${this.binderLoading ? ' disabled' : ''}>Show more <span class="muted">${b.cards.length} of ${b.total}</span></button></div>`
      : '';
    return `${chips}<ul class="col-cards${this.binderLoading ? ' is-loading' : ''}">${tiles}</ul>${more}`;
  }

  renderBinder() {
    const section = this.el.querySelector('[data-binder]');
    if (!section) return this.render();
    section.querySelector('[data-binder-note]').innerHTML = this.binderNote();
    this.renderBinderResults();
  }

  renderBinderResults() {
    const box = this.el.querySelector('[data-binder-results]');
    if (!box) return;
    if (this.binderLoading && this.binder) {
      box.querySelector('.col-cards')?.classList.add('is-loading');
      return;
    }
    box.innerHTML = this.binderResultsHtml();
  }

  // ==== Events =================================================================================

  onClick(e) {
    const segBtn = e.target.closest('[data-seg]');
    if (segBtn) return this.onSeg(segBtn.dataset.seg, segBtn.dataset.value);

    const deckLink = e.target.closest('[data-deck-link]');
    if (deckLink) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      this.host.hidePreview?.();
      window.dispatchEvent(new CustomEvent('navigate', { detail: { path: deckLink.getAttribute('href') } }));
      return;
    }

    const add = e.target.closest('[data-add]');
    if (add) return this.addCard(Number(add.dataset.add));

    const card = e.target.closest('[data-card]');
    if (card) {
      this.host.hidePreview?.();
      this.host.showCard?.({ card_id: Number(card.dataset.card) });
      return;
    }

    const type = e.target.closest('[data-binder-type]');
    if (type) {
      this.binderQuery.type = type.dataset.binderType;
      this.loadBinder();
      return;
    }

    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'buy') this.host.buyMissing();
    else if (action === 'copy') this.copyList();
    else if (action === 'more') this.loadBinder({ more: true });
  }

  onSeg(name, value) {
    if (name === 'col-filter') {
      this.prefs.filter = value;
    } else if (name === 'col-alongside') {
      this.prefs.alongside = value === '1';
    } else if (name === 'bd-colors') {
      this.binderPrefs.colors = value;
      writeJson('deckBinder', this.binderPrefs);
      this.el.querySelectorAll('[data-seg="bd-colors"]').forEach((b) => {
        b.classList.toggle('active', b.dataset.value === value);
        b.setAttribute('aria-checked', String(b.dataset.value === value));
      });
      this.loadBinder();
      return;
    }
    writeJson('deckCollection', this.prefs);
    // Re-render the report but keep the binder (and its scroll position) as it is
    const grid = this.el.querySelector('.an-grid:not(.col-binder-grid)');
    const tiles = this.el.querySelector('.an-tiles');
    if (grid && tiles) {
      tiles.outerHTML = this.tilesHtml();
      grid.querySelector('section').innerHTML = this.listHtml();
    } else {
      this.render();
    }
  }

  onInput(e) {
    if (!e.target.matches('[data-binder-search]')) return;
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.binderQuery.q = e.target.value;
      this.loadBinder();
    }, 250);
  }

  onChange(e) {
    if (e.target.matches('[data-binder-free]')) {
      this.binderPrefs.free = e.target.checked;
    } else if (e.target.matches('[data-binder-sort]')) {
      this.binderPrefs.sort = e.target.value;
    } else {
      return;
    }
    writeJson('deckBinder', this.binderPrefs);
    this.loadBinder();
  }

  onHover(e) {
    const el = e.target.closest?.('[data-preview]');
    if (el && el.dataset.preview && !el.contains(e.relatedTarget)) this.host.preview?.(el.dataset.preview, e);
  }

  async addCard(cardId) {
    const card = this.binder?.cards.find((c) => c.card_id === cardId);
    if (!card || this.adding.has(cardId)) return;
    this.adding.add(cardId);
    this.renderBinderResults();
    try {
      await this.host.addCard(card);
      // It's in the deck now, so it no longer belongs here
      this.binder.cards = this.binder.cards.filter((c) => c.card_id !== cardId);
      this.binder.total = Math.max(0, this.binder.total - 1);
      this.binder.fitting = Math.max(0, this.binder.fitting - 1);
      if (this.binder.typeCounts[card.type]) this.binder.typeCounts[card.type] -= 1;
      this.binderKey = deckKey(this.host.getDeck()); // No need to search again for our own change
    } catch (err) {
      showToast(`Couldn't add ${card.name}: ${err.message}`, 'error');
    } finally {
      this.adding.delete(cardId);
      this.renderBinder();
    }
  }

  copyList() {
    const alongside = this.prefs.alongside;
    const lines = (this.report?.cards || [])
      .map((c) => [alongside ? c.alongside : c.missing, c.name])
      .filter(([n]) => n > 0)
      .map(([n, name]) => `${n} ${name}`);
    if (!lines.length) return;
    const text = lines.join('\n');
    copyText(text).then((ok) => {
      showToast(ok ? `Copied ${plural(lines.length, 'card')}. It pastes into TCGplayer or Mana Pool mass entry.` : 'Couldn\'t copy to the clipboard', ok ? 'success' : 'error', 3000);
    });
  }
}
