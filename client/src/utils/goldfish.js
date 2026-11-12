/**
 * Game state for goldfishing a deck: playing it alone to see how it draws and curves out.
 * Zones, the London mulligan, turns, tapping, counters, tokens, life and commander tax, with undo.
 * No rules engine: the player moves cards where they want and the state keeps track.
 */
import { seededRandom, newSeed, shuffle } from './cube.js';
import { isLandDrop, splitDeck } from './manaMath.js';

export const ZONES = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'];
export const ZONE_LABELS = {
  library: 'Library',
  hand: 'Hand',
  battlefield: 'Battlefield',
  graveyard: 'Graveyard',
  exile: 'Exile',
  command: 'Command zone',
};

const HISTORY_LIMIT = 200;

/** Starting life for a format id. */
export function startingLife(format) {
  if (['commander', 'paupercommander', 'predh', 'canlander'].includes(format)) return 40;
  if (['brawl', 'standardbrawl'].includes(format)) return 25;
  if (format === 'twoheadedgiant') return 30;
  return 20;
}

/** Commander formats where the first mulligan is free. */
export function hasFreeMulligan(format) {
  return ['commander', 'paupercommander', 'predh', 'brawl', 'oathbreaker'].includes(format);
}

const isInstantOrSorcery = (card) => /\b(Instant|Sorcery)\b/.test(String(card.type_line || '').split(' // ')[0]);

export class Goldfish {
  /**
   * @param cards deck cards (only the mainboard is used; commanders start in the command zone)
   * @param options.life starting life
   * @param options.onDraw whether turn one has a draw
   * @param options.freeMulligan whether the first mulligan keeps seven
   * @param options.seed for a repeatable game
   */
  constructor(cards, { life = 20, onDraw = false, freeMulligan = false, seed = newSeed() } = {}) {
    this.options = { life, onDraw, freeMulligan };
    this.rng = seededRandom(seed);
    this.cards = new Map(); // uid -> card (deck card, or a token)
    const { library, commanders } = splitDeck(cards);
    this.libraryUids = [];
    this.commanderUids = [];
    let next = 0;
    const add = (card, list) => {
      for (let i = 0; i < (card.quantity ?? 1); i++) {
        const uid = `c${next++}`;
        this.cards.set(uid, card);
        list.push(uid);
      }
    };
    library.forEach((card) => add(card, this.libraryUids));
    commanders.forEach((card) => add(card, this.commanderUids));
    this.tokenCount = 0;
    this.listeners = new Set();
    this.newGame();
  }

  // ---- State and history ----

  newGame() {
    this.zones = Object.fromEntries(ZONES.map((z) => [z, []]));
    this.zones.library = shuffle(this.libraryUids, this.rng);
    this.zones.command = [...this.commanderUids];
    this.status = {}; // uid -> { tapped, counters }
    this.tax = {}; // commander uid -> times cast from the command zone
    this.life = this.options.life;
    this.turn = 0;
    this.mulligans = 0;
    this.phase = 'mulligan';
    this.log = [];
    this.history = [];
    this.drawCards(7, { quiet: true });
    this.note('Drew an opening hand of 7');
    this.emit();
  }

  /** Save the current state so the next change can be undone. */
  checkpoint() {
    this.history.push(JSON.stringify({
      zones: this.zones,
      status: this.status,
      tax: this.tax,
      life: this.life,
      turn: this.turn,
      mulligans: this.mulligans,
      phase: this.phase,
      log: this.log.length,
    }));
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
  }

  get canUndo() {
    return this.history.length > 0;
  }

  undo() {
    const saved = this.history.pop();
    if (!saved) return false;
    const s = JSON.parse(saved);
    Object.assign(this, { zones: s.zones, status: s.status, tax: s.tax, life: s.life, turn: s.turn, mulligans: s.mulligans, phase: s.phase });
    this.log.length = s.log;
    this.emit();
    return true;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this);
  }

  note(text) {
    this.log.push({ turn: this.turn, text });
  }

  // ---- Lookups ----

  card(uid) {
    return this.cards.get(uid);
  }

  zoneOf(uid) {
    return ZONES.find((z) => this.zones[z].includes(uid)) || null;
  }

  isTapped(uid) {
    return !!this.status[uid]?.tapped;
  }

  counters(uid) {
    return this.status[uid]?.counters || 0;
  }

  isToken(uid) {
    return !!this.card(uid)?.isToken;
  }

  isCommander(uid) {
    return this.commanderUids.includes(uid);
  }

  /** Cards to put on the bottom before keeping: one per mulligan, less a free one. */
  get bottomCount() {
    return Math.min(this.zones.hand.length, Math.max(0, this.mulligans - (this.options.freeMulligan ? 1 : 0)));
  }

  // ---- Actions (each one undoable) ----

  drawCards(count = 1, { quiet = false } = {}) {
    let drawn = 0;
    for (let i = 0; i < count && this.zones.library.length; i++) {
      this.zones.hand.push(this.zones.library.shift());
      drawn++;
    }
    if (!quiet) {
      if (drawn) this.note(drawn === 1 ? `Drew ${this.card(this.zones.hand.at(-1)).name}` : `Drew ${drawn} cards`);
      if (drawn < count) this.note('Tried to draw from an empty library');
    }
    return drawn;
  }

  draw(count = 1) {
    this.checkpoint();
    this.drawCards(count);
    this.emit();
  }

  mulligan() {
    if (this.phase !== 'mulligan') return;
    this.checkpoint();
    this.zones.library.push(...this.zones.hand);
    this.zones.hand = [];
    this.zones.library = shuffle(this.zones.library, this.rng);
    this.mulligans++;
    this.drawCards(7, { quiet: true });
    const bottom = this.bottomCount;
    this.note(`Mulligan ${this.mulligans}: drew 7${bottom ? `, will put ${bottom} on the bottom` : ' (free)'}`);
    this.emit();
  }

  /** Keep the hand, putting `bottomUids` (exactly bottomCount of them) on the bottom in that order. */
  keep(bottomUids = []) {
    if (this.phase !== 'mulligan') return false;
    const unique = [...new Set(bottomUids)].filter((uid) => this.zones.hand.includes(uid));
    if (unique.length !== this.bottomCount) return false;
    this.checkpoint();
    this.zones.hand = this.zones.hand.filter((uid) => !unique.includes(uid));
    this.zones.library.push(...unique);
    this.phase = 'playing';
    this.turn = 1;
    this.note(`Kept ${this.zones.hand.length}${unique.length ? `, bottomed ${unique.map((u) => this.card(u).name).join(', ')}` : ''}`);
    if (this.options.onDraw) this.drawCards(1);
    this.emit();
    return true;
  }

  nextTurn() {
    if (this.phase === 'mulligan') return;
    this.checkpoint();
    this.turn++;
    this.untapPermanents();
    this.note(`Turn ${this.turn}`);
    this.drawCards(1);
    this.emit();
  }

  untapPermanents() {
    for (const uid of this.zones.battlefield) if (this.status[uid]) this.status[uid].tapped = false;
  }

  untapAll() {
    this.checkpoint();
    this.untapPermanents();
    this.note('Untapped everything');
    this.emit();
  }

  toggleTap(uid) {
    if (this.zoneOf(uid) !== 'battlefield') return;
    this.checkpoint();
    const s = (this.status[uid] ||= { tapped: false, counters: 0 });
    s.tapped = !s.tapped;
    this.emit();
  }

  addCounter(uid, delta) {
    if (this.zoneOf(uid) !== 'battlefield') return;
    this.checkpoint();
    const s = (this.status[uid] ||= { tapped: false, counters: 0 });
    s.counters = Math.max(0, s.counters + delta);
    this.emit();
  }

  /**
   * Move a card. `position` is 'top' or 'bottom' for the library, or an index elsewhere.
   * Tokens that leave the battlefield cease to exist; anything leaving it loses its status.
   */
  move(uid, to, { position = to === 'library' ? 'top' : 'end', quiet = false } = {}) {
    const from = this.zoneOf(uid);
    if (!from || !ZONES.includes(to)) return;
    if (from === to && to !== 'library' && to !== 'battlefield' && to !== 'hand') return;
    this.checkpoint();
    this.zones[from] = this.zones[from].filter((u) => u !== uid);
    const card = this.card(uid);

    if (from === 'battlefield' && to !== 'battlefield') delete this.status[uid];
    if (this.isToken(uid) && to !== 'battlefield') {
      this.note(`${card.name} token left the battlefield`);
      this.emit();
      return;
    }
    // Casting from the command zone is what raises the tax
    if (from === 'command' && to === 'battlefield') this.tax[uid] = (this.tax[uid] || 0) + 1;

    const list = this.zones[to];
    if (position === 'top') list.unshift(uid);
    else if (position === 'bottom' || position === 'end') list.push(uid);
    else list.splice(Math.max(0, Math.min(Number(position) || 0, list.length)), 0, uid);

    if (to === 'battlefield') this.status[uid] ||= { tapped: false, counters: 0 };
    if (!quiet) {
      const where = to === 'library' ? `the ${position === 'bottom' ? 'bottom' : 'top'} of the library` : ZONE_LABELS[to].toLowerCase();
      this.note(from === 'hand' && to === 'battlefield' ? `Played ${card.name}` : `${card.name}: ${ZONE_LABELS[from].toLowerCase()} → ${where}`);
    }
    this.emit();
  }

  /** The usual thing to do with a card from the hand: lands and permanents enter, spells resolve to the graveyard. */
  play(uid) {
    const card = this.card(uid);
    if (!card || this.zoneOf(uid) !== 'hand') return;
    if (isInstantOrSorcery(card) && !isLandDrop(card)) {
      this.move(uid, 'graveyard', { quiet: true });
      this.note(`Cast ${card.name}`);
      this.emit();
    } else {
      this.move(uid, 'battlefield');
    }
  }

  /** Commander tax owed on the next cast from the command zone. */
  commanderTax(uid) {
    return 2 * (this.tax[uid] || 0);
  }

  shuffleLibrary() {
    this.checkpoint();
    this.zones.library = shuffle(this.zones.library, this.rng);
    this.note('Shuffled the library');
    this.emit();
  }

  mill(count = 1) {
    this.checkpoint();
    const milled = this.zones.library.splice(0, count);
    this.zones.graveyard.push(...milled);
    if (milled.length) this.note(`Milled ${milled.map((u) => this.card(u).name).join(', ')}`);
    this.emit();
  }

  /** The top `count` cards of the library, without moving them. */
  peek(count) {
    return this.zones.library.slice(0, count);
  }

  /**
   * Resolve a scry or surveil of the top cards: each uid goes to 'top', 'bottom' or 'graveyard'.
   * Cards sent to the top keep the order given.
   */
  arrangeTop(decisions) {
    this.checkpoint();
    const uids = decisions.map((d) => d.uid);
    this.zones.library = this.zones.library.filter((u) => !uids.includes(u));
    const top = decisions.filter((d) => d.to === 'top').map((d) => d.uid);
    const bottom = decisions.filter((d) => d.to === 'bottom').map((d) => d.uid);
    const yard = decisions.filter((d) => d.to === 'graveyard').map((d) => d.uid);
    this.zones.library = [...top, ...this.zones.library, ...bottom];
    this.zones.graveyard.push(...yard);
    const parts = [];
    if (top.length) parts.push(`${top.length} on top`);
    if (bottom.length) parts.push(`${bottom.length} on the bottom`);
    if (yard.length) parts.push(`${yard.length} into the graveyard`);
    this.note(`Looked at ${decisions.length}: ${parts.join(', ') || 'no change'}`);
    this.emit();
  }

  adjustLife(delta) {
    this.setLife(this.life + delta);
  }

  setLife(value) {
    const life = Math.round(Number(value));
    if (!Number.isFinite(life) || life === this.life) return;
    this.checkpoint();
    const from = this.life;
    this.life = life;
    // Runs of +1/-1 clicks read as one change in the log
    const last = this.log.at(-1);
    if (last?.life && last.turn === this.turn) {
      last.life.to = life;
      last.text = `Life ${last.life.from} → ${life}`;
    } else {
      this.log.push({ turn: this.turn, text: `Life ${from} → ${life}`, life: { from, to: life } });
    }
    this.emit();
  }

  createToken(name = 'Token') {
    this.checkpoint();
    const uid = `t${this.tokenCount++}`;
    const label = String(name).trim() || 'Token';
    this.cards.set(uid, { name: label, type_line: 'Token', isToken: true });
    this.zones.battlefield.push(uid);
    this.status[uid] = { tapped: false, counters: 0 };
    this.note(`Created a ${label} token`);
    this.emit();
    return uid;
  }

  /** Counts for the header. */
  summary() {
    const bf = this.zones.battlefield;
    const lands = bf.filter((u) => isLandDrop(this.card(u)) && !this.isToken(u));
    return {
      library: this.zones.library.length,
      hand: this.zones.hand.length,
      lands: lands.length,
      untappedLands: lands.filter((u) => !this.isTapped(u)).length,
      permanents: bf.length - lands.length,
    };
  }
}
