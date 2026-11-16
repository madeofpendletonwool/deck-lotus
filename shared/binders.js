/**
 * Store binders: which sets a card shop keeps in a binder, and which binders to pull to find the
 * most cards on a list.
 *
 * Stores file singles by set, so the useful question isn't "which printing did I pick" but "which
 * binder holds this card at all". A card printed in six sets can be found in any of those six
 * binders, and the best walk around the store opens the fewest binders that between them hold
 * everything.
 */

// Set types a store plausibly keeps a binder for, including Portal-era starters and the paper
// Un-sets. Promos, Secret Lair (box), The List, tokens, memorabilia and online-only sets are left
// out: nobody has a binder of those.
const BINDER_TYPES = new Set(['expansion', 'core', 'masters', 'draft_innovation', 'commander', 'eternal', 'starter', 'funny']);
const NOT_BINDERS = new Set(['PLST', 'PLIST']);

/**
 * @param {{code: string, type?: string, is_online_only?: number|boolean}} set
 * @param {{commander?: boolean}} opts commander: false leaves Commander precons out, since many
 *   stores don't binder them
 */
export function isBinderSet(set, { commander = true } = {}) {
  if (!set || !set.code) return false;
  if (set.is_online_only) return false;
  if (NOT_BINDERS.has(set.code.toUpperCase())) return false;
  if (!BINDER_TYPES.has(set.type)) return false;
  if (!commander && set.type === 'commander') return false;
  return true;
}

/**
 * Pick binders that between them hold as many of the items as possible, opening as few binders as
 * possible. This is set cover, which is NP-hard, so it's solved greedily (always open the binder
 * holding the most cards not yet placed), which is never worse than about ln(n) times the best,
 * and in practice close to it. A cleanup pass then drops any binder whose cards all sit in other
 * chosen binders, and moves each card to the biggest chosen binder that holds it.
 *
 * @param {Array} items anything; `setsOf(item)` lists the binder set codes it's printed in
 * @param {object} opts
 * @param {(item) => string[]} opts.setsOf
 * @param {(item) => string} [opts.preferred] the set the item is listed in now, which wins ties
 * @param {(code) => string} [opts.tieBreak] sort key for remaining ties, larger first (e.g. release date)
 * @returns {{ binders: Array<{code: string, items: Array, holds: number}>, unplaced: Array }}
 *   `items` are the cards assigned to that binder; `holds` is how many of all the items the
 *   binder has, assigned there or not.
 */
export function planBinders(items, { setsOf, preferred = () => null, tieBreak = () => '' }) {
  const setsFor = new Map();
  const holders = new Map(); // set code -> indexes of items printed in it
  items.forEach((item, i) => {
    const sets = [...new Set(setsOf(item) || [])];
    setsFor.set(i, sets);
    for (const code of sets) {
      if (!holders.has(code)) holders.set(code, []);
      holders.get(code).push(i);
    }
  });

  const unplaced = items.filter((_, i) => !setsFor.get(i).length);
  const open = new Set(items.map((_, i) => i).filter((i) => setsFor.get(i).length));
  const chosen = [];

  while (open.size) {
    let best = null;
    for (const [code, idxs] of holders) {
      if (chosen.includes(code)) continue;
      let gain = 0;
      let liked = 0;
      for (const i of idxs) {
        if (!open.has(i)) continue;
        gain++;
        if (preferred(items[i]) === code) liked++;
      }
      if (!gain) continue;
      const key = [gain, liked, tieBreak(code)];
      if (!best || compareKeys(key, best.key) > 0) best = { code, key };
    }
    if (!best) break;
    chosen.push(best.code);
    for (const i of holders.get(best.code)) open.delete(i);
  }

  // Drop binders made redundant by later picks, smallest first.
  const bySize = [...chosen].sort((a, b) => holders.get(a).length - holders.get(b).length);
  const kept = new Set(chosen);
  for (const code of bySize) {
    const others = [...kept].filter((c) => c !== code);
    const covered = holders.get(code).every((i) => setsFor.get(i).some((c) => others.includes(c)));
    if (covered && others.length) kept.delete(code);
  }

  // Each card goes to the biggest kept binder that holds it, or the one it's listed in if kept.
  const assigned = new Map([...kept].map((code) => [code, []]));
  const size = (code) => holders.get(code).length;
  items.forEach((item, i) => {
    const options = setsFor.get(i).filter((c) => kept.has(c));
    if (!options.length) return;
    const pref = preferred(item);
    const home = options.includes(pref)
      ? pref
      : options.sort((a, b) => size(b) - size(a) || compareKeys([tieBreak(b)], [tieBreak(a)]))[0];
    assigned.get(home).push(item);
  });

  const binders = [...assigned]
    .filter(([, list]) => list.length)
    .map(([code, list]) => ({ code, items: list, holds: size(code) }))
    .sort((a, b) => b.items.length - a.items.length || b.holds - a.holds || compareKeys([tieBreak(b.code)], [tieBreak(a.code)]));
  return { binders, unplaced };
}

/** How many of the items each binder holds, not counting any card twice within one binder. */
export function binderReach(items, setsOf) {
  const reach = new Map();
  for (const item of items) {
    for (const code of new Set(setsOf(item) || [])) reach.set(code, (reach.get(code) || 0) + 1);
  }
  return reach;
}

function compareKeys(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (typeof a[i] === 'number') return a[i] - b[i];
    return String(a[i]).localeCompare(String(b[i]));
  }
  return 0;
}
