/**
 * MTGJSON has one row per face per printing, and every face of a card shares the same combined
 * name ("Bonecrusher Giant // Stomp"). We keep one row per name, so the faces have to be merged
 * on purpose. Left to chance, a card takes on the type, cost and stats of whichever face came last.
 *
 * The merged card describes its front face, since that's what the card is in a deck: a creature
 * with a prepared sorcery is a creature, and a sorcery with a land on the back is not a land.
 * Type, mana value and commander checks all read these fields and rely on that.
 */

// Both halves are live on the card at once, so by the rules it has the colors of both.
const COMBINED_COLOR_LAYOUTS = new Set(['split', 'aftermath']);

const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'];

function parseColors(colors) {
  return colors ? colors.split(',').map((color) => color.trim()).filter(Boolean) : [];
}

function combinedColors(faces) {
  const present = new Set(faces.flatMap((face) => parseColors(face.colors)));
  return COLOR_ORDER.filter((color) => present.has(color)).join(', ') || null;
}

/** Rules text for every face, so the back stays readable and searchable. */
function combinedText(faces) {
  const seen = new Set();
  const parts = [];
  for (const face of faces) {
    // Reversible cards repeat the same face on both sides.
    if (!face.text || seen.has(face.text)) continue;
    seen.add(face.text);
    parts.push(face === faces[0] ? face.text : `// ${face.faceName}\n${face.text}`);
  }
  return parts.join('\n\n') || null;
}

/**
 * Merge every source row sharing one card name into the single row we store.
 * @param {Array} rows MTGJSON rows with the same name, in any order
 */
export function mergeCardFaces(rows) {
  // Later printings of the same face win, as they do for single-faced cards.
  const bySide = new Map(rows.map((row) => [row.side || '', row]));
  const faces = [...bySide.keys()].sort().map((side) => bySide.get(side));
  const [front] = faces;

  if (faces.length === 1) return front;

  return {
    ...front,
    text: combinedText(faces),
    colors: COMBINED_COLOR_LAYOUTS.has(front.layout) ? combinedColors(faces) : front.colors,
  };
}

/** One merged row per card name. */
export function mergeCardRows(rows) {
  const byName = new Map();
  for (const row of rows) {
    if (!byName.has(row.name)) byName.set(row.name, []);
    byName.get(row.name).push(row);
  }
  return [...byName.values()].map(mergeCardFaces);
}
