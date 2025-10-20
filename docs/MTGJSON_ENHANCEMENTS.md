# MTGJSON Data Enhancement Guide

Complete implementation guide for adding MTGJSON features to Deck Lotus. This document is designed to be comprehensive enough for any developer to pick up and continue implementation.

---

## Table of Contents
1. [MTGJSON Database Structure](#mtgjson-database-structure)
2. [Current Implementation Status](#current-implementation-status)
3. [Fix Broken Implementations](#fix-broken-implementations)
4. [Feature 1: Legalities](#feature-1-legalities)
5. [Feature 2: Type Arrays](#feature-2-type-arrays-subtypes-supertypes-types)
6. [Feature 3: Related Cards](#feature-3-related-cards)
7. [Feature 4: Leadership Skills](#feature-4-leadership-skills)
8. [Feature 5: Card Identifiers](#feature-5-card-identifiers)
9. [Feature 6: Foreign Data](#feature-6-foreign-data)
10. [Feature 7: EDHRec & First Printing](#feature-7-edhrec--first-printing)
11. [Testing & Validation](#testing--validation)
12. [Common Pitfalls](#common-pitfalls)

---

## MTGJSON Database Structure

### AllPrintings.sqlite Tables

```
cardForeignData      - International card names/text (25+ languages)
cardIdentifiers      - Cross-platform IDs (Scryfall, MTGO, TCGPlayer, etc.)
cardLegalities       - Format legality (21 formats)
cardPurchaseUrls     - Buy links for various retailers
cardRulings          - Official card rulings
cards                - Main card data (atomic/oracle)
sets                 - Set metadata
tokens               - Token card data
... (and booster-related tables)
```

**CRITICAL:** Note the table names:
- ✅ `cardRulings` (NOT `rulings`)
- ✅ `cardLegalities` (NOT `legalities`)
- ✅ `cardForeignData` (NOT `foreignData`)

---

## Current Implementation Status

### ✅ Already Implemented
- Basic card data (name, mana cost, colors, type_line, oracle text, power/toughness, loyalty)
- Printings (set code, collector number, rarity, artist, image URLs via Scryfall CDN)
- Purchase URLs (TCGPlayer, Cardmarket, Card Kingdom)
- Pricing data (TCGPlayer, Cardmarket, Card Kingdom - normal and foil)
- Sets metadata
- Deck sharing

### ⚠️ Broken/Incomplete
- **Rulings**: Table exists but empty (wrong source table name in import script)
- **Legalities**: Column exists in schema but set to NULL (not imported)
- **Scryfall ID**: Queried but never stored

### ❌ Not Implemented
- Subtypes/Supertypes/Types as separate fields
- Related cards (tokens, meld pairs, spellbook)
- Leadership skills (Commander/Brawl/Oathbreaker eligibility)
- Extended card identifiers (MTGO ID, TCGPlayer Product ID, etc.)
- Foreign language data
- EDHRec saltiness score
- First printing info

---

## Fix Broken Implementations

### Fix 1: Rulings Import (CRITICAL)

**Problem:** Import script queries `rulings` table but MTGJSON uses `cardRulings`

**File:** `scripts/import-mtgjson.js` line 279

**Change:**
```javascript
// WRONG:
const rulings = srcDb.prepare(`
  SELECT uuid, date, text
  FROM rulings  // ❌ This table doesn't exist
  WHERE uuid IS NOT NULL
`).all();

// CORRECT:
const rulings = srcDb.prepare(`
  SELECT uuid, date, text
  FROM cardRulings  // ✅ Correct table name
  WHERE uuid IS NOT NULL
`).all();
```

**Expected Result:** ~253,482 rulings imported

---

### Fix 2: Legalities Import

**Problem:** Column exists but import sets it to `null` (line 146)

**Solution:** Import from `cardLegalities` table and JOIN with cards

**File:** `scripts/import-mtgjson.js` lines 99-149

The `cardLegalities` table has these columns:
- `uuid` (foreign key to cards.uuid)
- 21 format columns (see below)

Each format can be: `"Legal"`, `"Banned"`, `"Restricted"`, or `NULL`

**21 Supported Formats:**
1. `alchemy` - Arena digital format
2. `brawl` - Standard Singleton Commander
3. `commander` - EDH/Commander
4. `duel` - Duel Commander (1v1)
5. `future` - Future Standard
6. `gladiator` - Arena Historic Singleton
7. `historic` - Arena format
8. `legacy`
9. `modern`
10. `oathbreaker`
11. `oldschool` - 93/94
12. `pauper`
13. `paupercommander` - Pauper EDH
14. `penny` - Penny Dreadful
15. `pioneer`
16. `predh` - Pre-modern EDH
17. `premodern`
18. `standard`
19. `standardbrawl` - Standard Brawl
20. `timeless` - Arena format
21. `vintage`

**Implementation:**

```javascript
// Update the card import SELECT to include legalities
const sourceCards = srcDb.prepare(`
  SELECT DISTINCT
    c.name, c.manaCost, c.manaValue, c.colors, c.colorIdentity,
    c.type, c.text, c.power, c.toughness, c.loyalty, c.keywords,
    c.isReserved, c.edhrecRank,
    cl.alchemy, cl.brawl, cl.commander, cl.duel, cl.future,
    cl.gladiator, cl.historic, cl.legacy, cl.modern, cl.oathbreaker,
    cl.oldschool, cl.pauper, cl.paupercommander, cl.penny, cl.pioneer,
    cl.predh, cl.premodern, cl.standard, cl.standardbrawl, cl.timeless,
    cl.vintage
  FROM cards c
  LEFT JOIN cardLegalities cl ON c.uuid = cl.uuid
  WHERE c.name IS NOT NULL
`).all();

// In the insertMany transaction, build legalities object:
let legalities = null;
if (card.alchemy || card.brawl || card.commander || /* ... any format */) {
  const legalitiesObj = {
    alchemy: card.alchemy,
    brawl: card.brawl,
    commander: card.commander,
    duel: card.duel,
    future: card.future,
    gladiator: card.gladiator,
    historic: card.historic,
    legacy: card.legacy,
    modern: card.modern,
    oathbreaker: card.oathbreaker,
    oldschool: card.oldschool,
    pauper: card.pauper,
    paupercommander: card.paupercommander,
    penny: card.penny,
    pioneer: card.pioneer,
    predh: card.predh,
    premodern: card.premodern,
    standard: card.standard,
    standardbrawl: card.standardbrawl,
    timeless: card.timeless,
    vintage: card.vintage
  };
  legalities = JSON.stringify(legalitiesObj);
}

insertCard.run(
  // ... other fields ...
  legalities,  // Now actually populated
  // ... remaining fields ...
);
```

---

### Fix 3: Store Scryfall ID

**Problem:** Scryfall ID is queried (line 162) but never inserted into printings table

**Migration Needed:** `src/db/migrations/005-add-scryfall-id.js`

```javascript
export function up(db) {
  db.exec(`
    ALTER TABLE printings ADD COLUMN scryfall_id TEXT;
    CREATE INDEX idx_printings_scryfall_id ON printings(scryfall_id);
  `);
  console.log('✓ Added scryfall_id to printings table');
}

export function down(db) {
  // SQLite can't drop columns easily
  db.exec(`
    CREATE TABLE printings_backup AS
    SELECT id, card_id, uuid, set_code, collector_number, rarity,
           artist, flavor_text, image_url, finishes, is_promo, is_full_art,
           frame_version, border_color, watermark, language, released_at,
           tcgplayer_url, cardmarket_url, cardkingdom_url
    FROM printings;

    DROP TABLE printings;
    ALTER TABLE printings_backup RENAME TO printings;
  `);
  console.log('✓ Removed scryfall_id from printings table');
}
```

**Import Script Update:** `scripts/import-mtgjson.js` line 168-177

```javascript
// Already querying scryfallId, just need to store it:
const insertPrinting = targetDb.prepare(`
  INSERT OR IGNORE INTO printings (
    card_id, uuid, set_code, collector_number, rarity,
    artist, flavor_text, finishes, is_promo, is_full_art,
    frame_version, border_color, watermark, language, image_url,
    scryfall_id  // Add this
  ) VALUES (
    (SELECT id FROM cards WHERE name = ? LIMIT 1),
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'en', ?, ?  // Add ? for scryfall_id
  )
`);

// In insertPrintingsMany transaction:
insertPrinting.run(
  p.name,
  p.uuid,
  p.setCode,
  p.number,
  p.rarity,
  p.artist,
  p.flavorText,
  finishes,
  p.isPromo ? 1 : 0,
  p.isFullArt ? 1 : 0,
  p.frameVersion,
  p.borderColor,
  p.watermark,
  imageUrl,
  p.scryfallId  // Add this
);
```

---

## Feature 1: Legalities

**Status:** Column exists, needs import fix (see above)

### Frontend Display

**File:** `client/src/components/cards.js` in `showCardDetail` function

Add after the Type/Subtype section:

```javascript
${card.legalities ? `
  <div style="margin-top: 2rem;">
    <h3>Format Legality</h3>
    <div style="margin-top: 1rem; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 0.5rem;">
      ${(() => {
        const legalities = JSON.parse(card.legalities);
        const formatNames = {
          alchemy: 'Alchemy',
          brawl: 'Brawl',
          commander: 'Commander',
          duel: 'Duel Commander',
          future: 'Future',
          gladiator: 'Gladiator',
          historic: 'Historic',
          legacy: 'Legacy',
          modern: 'Modern',
          oathbreaker: 'Oathbreaker',
          oldschool: 'Old School',
          pauper: 'Pauper',
          paupercommander: 'Pauper EDH',
          penny: 'Penny Dreadful',
          pioneer: 'Pioneer',
          predh: 'PreDH',
          premodern: 'Premodern',
          standard: 'Standard',
          standardbrawl: 'Standard Brawl',
          timeless: 'Timeless',
          vintage: 'Vintage'
        };

        return Object.entries(legalities)
          .filter(([format, _]) => format !== 'uuid')
          .map(([format, status]) => {
            let icon, color, bgColor;
            if (status === 'Legal') {
              icon = '✓';
              color = '#10b981';
              bgColor = 'rgba(16, 185, 129, 0.1)';
            } else if (status === 'Banned') {
              icon = '✗';
              color = '#ef4444';
              bgColor = 'rgba(239, 68, 68, 0.1)';
            } else if (status === 'Restricted') {
              icon = '⚠';
              color = '#f59e0b';
              bgColor = 'rgba(245, 158, 11, 0.1)';
            } else {
              icon = '⊘';
              color = '#6b7280';
              bgColor = 'rgba(107, 114, 128, 0.1)';
            }

            return `
              <div style="
                padding: 0.5rem;
                background: ${bgColor};
                border: 1px solid ${color};
                border-radius: 6px;
                display: flex;
                align-items: center;
                gap: 0.5rem;
                font-size: 0.875rem;
              ">
                <span style="color: ${color}; font-weight: bold; font-size: 1rem;">${icon}</span>
                <span>${formatNames[format] || format}</span>
              </div>
            `;
          }).join('');
      })()}
    </div>
  </div>
` : ''}
```

**Icon Legend:**
- ✓ (Green) = Legal
- ✗ (Red) = Banned
- ⚠ (Yellow) = Restricted
- ⊘ (Gray) = Not Legal

---

## Feature 2: Type Arrays (Subtypes, Supertypes, Types)

**Migration:** `src/db/migrations/006-add-type-arrays.js`

```javascript
export function up(db) {
  db.exec(`
    ALTER TABLE cards ADD COLUMN subtypes TEXT;
    ALTER TABLE cards ADD COLUMN supertypes TEXT;
    ALTER TABLE cards ADD COLUMN types TEXT;
  `);
  console.log('✓ Added type arrays to cards table');
}

export function down(db) {
  // Recreate table without these columns
  db.exec(`
    CREATE TABLE cards_backup AS SELECT
      id, name, mana_cost, cmc, colors, color_identity,
      type_line, oracle_text, power, toughness, loyalty,
      keywords, legalities, is_reserved, edhrec_rank
    FROM cards;

    DROP TABLE cards;
    ALTER TABLE cards_backup RENAME TO cards;

    -- Recreate indexes
    CREATE INDEX idx_cards_name ON cards(name);
    CREATE INDEX idx_cards_colors ON cards(colors);
    CREATE INDEX idx_cards_type_line ON cards(type_line);
  `);
  console.log('✓ Removed type arrays from cards table');
}
```

### Import Script Changes

**File:** `scripts/import-mtgjson.js`

```javascript
// Update SELECT to include type arrays:
const sourceCards = srcDb.prepare(`
  SELECT DISTINCT
    c.name, c.manaCost, c.manaValue, c.colors, c.colorIdentity,
    c.type, c.text, c.power, c.toughness, c.loyalty, c.keywords,
    c.isReserved, c.edhrecRank,
    c.subtypes, c.supertypes, c.types,  // Add these
    cl.alchemy, cl.brawl /* ... all legality fields ... */
  FROM cards c
  LEFT JOIN cardLegalities cl ON c.uuid = cl.uuid
  WHERE c.name IS NOT NULL
`).all();

// Update INSERT:
const insertCard = targetDb.prepare(`
  INSERT OR IGNORE INTO cards (
    name, mana_cost, cmc, colors, color_identity,
    type_line, oracle_text, power, toughness, loyalty,
    keywords, legalities, is_reserved, edhrec_rank,
    subtypes, supertypes, types
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// In insertMany transaction, parse arrays:
let subtypes = null, supertypes = null, types = null;

try {
  if (card.subtypes) {
    const arr = typeof card.subtypes === 'string'
      ? JSON.parse(card.subtypes)
      : card.subtypes;
    subtypes = Array.isArray(arr) ? arr.join(',') : card.subtypes;
  }
} catch (e) { subtypes = card.subtypes; }

try {
  if (card.supertypes) {
    const arr = typeof card.supertypes === 'string'
      ? JSON.parse(card.supertypes)
      : card.supertypes;
    supertypes = Array.isArray(arr) ? arr.join(',') : card.supertypes;
  }
} catch (e) { supertypes = card.supertypes; }

try {
  if (card.types) {
    const arr = typeof card.types === 'string'
      ? JSON.parse(card.types)
      : card.types;
    types = Array.isArray(arr) ? arr.join(',') : card.types;
  }
} catch (e) { types = card.types; }

insertCard.run(
  card.name,
  card.manaCost,
  card.manaValue,
  colors,
  colorIdentity,
  card.type,
  card.text,
  card.power,
  card.toughness,
  card.loyalty,
  keywords,
  legalities,
  card.isReserved ? 1 : 0,
  card.edhrecRank,
  subtypes,   // Add
  supertypes, // Add
  types       // Add
);
```

### Frontend Display

**File:** `client/src/components/cards.js`

Replace the current Type/Subtype display with:

```javascript
${card.supertypes ? `
  <div style="margin-bottom: 1rem;">
    <strong>Supertypes:</strong> ${card.supertypes.split(',').join(', ')}
  </div>
` : ''}
<div style="margin-bottom: 1rem;">
  <strong>Type:</strong> ${card.types ? card.types.split(',').join(', ') : (card.type_line || 'Unknown')}
</div>
${card.subtypes ? `
  <div style="margin-bottom: 1rem;">
    <strong>Subtypes:</strong> ${card.subtypes.split(',').join(', ')}
  </div>
` : ''}
```

---

## Feature 3: Related Cards

Related cards include:
- **reverseRelated**: Tokens, meld pairs, etc.
- **spellbook**: Spellbook mechanic cards

**Migration:** `src/db/migrations/007-add-related-cards.js`

```javascript
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS related_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_name TEXT NOT NULL,
      related_name TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      FOREIGN KEY (card_name) REFERENCES cards(name) ON DELETE CASCADE
    );
    CREATE INDEX idx_related_cards_name ON related_cards(card_name);
    CREATE INDEX idx_related_relation_type ON related_cards(relation_type);
  `);
  console.log('✓ Created related_cards table');
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS related_cards;`);
  console.log('✓ Dropped related_cards table');
}
```

### Import Script Changes

**File:** `scripts/import-mtgjson.js` - Add after rulings import:

```javascript
// Import related cards (reverseRelated and spellbook)
console.log('Importing related cards...');

const relatedCards = srcDb.prepare(`
  SELECT name, reverseRelated, spellbook
  FROM cards
  WHERE reverseRelated IS NOT NULL OR spellbook IS NOT NULL
`).all();

const insertRelated = targetDb.prepare(`
  INSERT OR IGNORE INTO related_cards (card_name, related_name, relation_type)
  VALUES (?, ?, ?)
`);

const insertRelatedMany = targetDb.transaction((relations) => {
  let count = 0;
  for (const card of relations) {
    // Handle reverseRelated
    if (card.reverseRelated) {
      try {
        const related = typeof card.reverseRelated === 'string'
          ? JSON.parse(card.reverseRelated)
          : card.reverseRelated;

        if (Array.isArray(related)) {
          for (const relatedName of related) {
            insertRelated.run(card.name, relatedName, 'reverseRelated');
            count++;
          }
        }
      } catch (e) {
        console.error(`Failed to parse reverseRelated for ${card.name}:`, e.message);
      }
    }

    // Handle spellbook
    if (card.spellbook) {
      try {
        const spellbook = typeof card.spellbook === 'string'
          ? JSON.parse(card.spellbook)
          : card.spellbook;

        if (Array.isArray(spellbook)) {
          for (const spellbookCard of spellbook) {
            insertRelated.run(card.name, spellbookCard, 'spellbook');
            count++;
          }
        }
      } catch (e) {
        console.error(`Failed to parse spellbook for ${card.name}:`, e.message);
      }
    }
  }
  return count;
});

const relatedCount = insertRelatedMany(relatedCards);
console.log(`✓ Imported ${relatedCount} related card relationships`);
```

### Backend Service Changes

**File:** `src/services/cardService.js` - Update `getCardById`:

```javascript
export function getCardById(cardId) {
  const card = db.get(`SELECT * FROM cards WHERE id = ?`, [cardId]);
  if (!card) return null;

  // ... existing printings and rulings queries ...

  // Get related cards
  const relatedCards = db.all(
    `SELECT related_name, relation_type
     FROM related_cards
     WHERE card_name = ?
     ORDER BY relation_type, related_name`,
    [card.name]
  );

  return {
    ...card,
    printings,
    rulings,
    relatedCards,  // Add this
  };
}
```

### Frontend Display

**File:** `client/src/components/cards.js`

```javascript
${card.relatedCards && card.relatedCards.length > 0 ? `
  <div style="margin-top: 2rem;">
    <h3>Related Cards</h3>
    <div style="margin-top: 1rem; display: grid; gap: 0.5rem;">
      ${card.relatedCards.map(r => `
        <div style="
          padding: 0.75rem;
          background: var(--bg-tertiary);
          border-radius: 6px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        ">
          <strong>${r.related_name}</strong>
          <span style="
            color: var(--text-secondary);
            font-size: 0.875rem;
            text-transform: capitalize;
          ">
            ${r.relation_type === 'reverseRelated' ? 'Token/Meld' : r.relation_type}
          </span>
        </div>
      `).join('')}
    </div>
  </div>
` : ''}
```

---

## Feature 4: Leadership Skills

Indicates if a card can be your commander in various formats.

**Migration:** `src/db/migrations/008-add-leadership-skills.js`

```javascript
export function up(db) {
  db.exec(`
    ALTER TABLE cards ADD COLUMN leadership_skills TEXT;
  `);
  console.log('✓ Added leadership_skills to cards table');
}

export function down(db) {
  // Recreate without leadership_skills column
  db.exec(`
    CREATE TABLE cards_backup AS SELECT
      id, name, mana_cost, cmc, colors, color_identity,
      type_line, oracle_text, power, toughness, loyalty,
      keywords, legalities, is_reserved, edhrec_rank,
      subtypes, supertypes, types
    FROM cards;

    DROP TABLE cards;
    ALTER TABLE cards_backup RENAME TO cards;
  `);
  console.log('✓ Removed leadership_skills from cards table');
}
```

### Import Script Changes

**File:** `scripts/import-mtgjson.js`

```javascript
// Add to SELECT:
const sourceCards = srcDb.prepare(`
  SELECT DISTINCT
    c.name, /* ... all other fields ... */,
    c.leadershipSkills  // Add this
  FROM cards c
  LEFT JOIN cardLegalities cl ON c.uuid = cl.uuid
  WHERE c.name IS NOT NULL
`).all();

// Update INSERT:
const insertCard = targetDb.prepare(`
  INSERT OR IGNORE INTO cards (
    name, mana_cost, cmc, colors, color_identity,
    type_line, oracle_text, power, toughness, loyalty,
    keywords, legalities, is_reserved, edhrec_rank,
    subtypes, supertypes, types, leadership_skills
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// In insertMany, parse leadership skills:
let leadershipSkills = null;
if (card.leadershipSkills) {
  try {
    const skills = typeof card.leadershipSkills === 'string'
      ? JSON.parse(card.leadershipSkills)
      : card.leadershipSkills;
    leadershipSkills = JSON.stringify(skills);
  } catch (e) {
    leadershipSkills = card.leadershipSkills;
  }
}

insertCard.run(
  /* ... all other fields ... */,
  leadershipSkills  // Add this
);
```

### Frontend Display

**File:** `client/src/components/cards.js`

```javascript
${card.leadership_skills ? `
  <div style="margin-bottom: 1rem;">
    ${(() => {
      const skills = JSON.parse(card.leadership_skills);
      const formats = [];
      if (skills.commander) formats.push('Commander');
      if (skills.brawl) formats.push('Brawl');
      if (skills.oathbreaker) formats.push('Oathbreaker');

      if (formats.length > 0) {
        return `
          <div style="
            padding: 0.75rem;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border-radius: 8px;
            font-weight: bold;
            text-align: center;
          ">
            ⭐ Can be your Commander in: ${formats.join(', ')}
          </div>
        `;
      }
      return '';
    })()}
  </div>
` : ''}
```

---

## Feature 5: Card Identifiers

Extended cross-platform identifiers beyond just Scryfall ID.

**Migration:** `src/db/migrations/009-add-identifiers.js`

```javascript
export function up(db) {
  db.exec(`
    ALTER TABLE printings ADD COLUMN mtgo_id INTEGER;
    ALTER TABLE printings ADD COLUMN mtgo_foil_id INTEGER;
    ALTER TABLE printings ADD COLUMN tcgplayer_product_id INTEGER;
    ALTER TABLE printings ADD COLUMN cardkingdom_id INTEGER;
    ALTER TABLE printings ADD COLUMN cardkingdom_foil_id INTEGER;
    ALTER TABLE printings ADD COLUMN cardkingdom_etched_id INTEGER;
    ALTER TABLE printings ADD COLUMN mtg_arena_id INTEGER;
    ALTER TABLE printings ADD COLUMN multiverse_id INTEGER;

    CREATE INDEX idx_printings_mtgo_id ON printings(mtgo_id);
    CREATE INDEX idx_printings_tcgplayer_product_id ON printings(tcgplayer_product_id);
  `);
  console.log('✓ Added extended identifiers to printings table');
}

export function down(db) {
  // Recreate printings table without extended IDs
  db.exec(`
    CREATE TABLE printings_backup AS SELECT
      id, card_id, uuid, set_code, collector_number, rarity,
      artist, flavor_text, image_url, finishes, is_promo, is_full_art,
      frame_version, border_color, watermark, language, released_at,
      tcgplayer_url, cardmarket_url, cardkingdom_url, scryfall_id
    FROM printings;

    DROP TABLE printings;
    ALTER TABLE printings_backup RENAME TO printings;
  `);
  console.log('✓ Removed extended identifiers from printings table');
}
```

### Import Script Changes

**File:** `scripts/import-mtgjson.js`

```javascript
// Update printings SELECT:
const sourcePrintings = srcDb.prepare(`
  SELECT c.uuid, c.name, c.setCode, c.number, c.rarity, c.artist,
         c.flavorText, c.finishes, c.isPromo, c.isFullArt,
         c.frameVersion, c.borderColor, c.watermark,
         ci.scryfallId, ci.mtgoId, ci.mtgoFoilId,
         ci.tcgplayerProductId, ci.cardKingdomId,
         ci.cardKingdomFoilId, ci.cardKingdomEtchedId,
         ci.mtgArenaId, ci.multiverseId
  FROM cards c
  LEFT JOIN cardIdentifiers ci ON c.uuid = ci.uuid
  WHERE c.uuid IS NOT NULL
`).all();

// Update INSERT:
const insertPrinting = targetDb.prepare(`
  INSERT OR IGNORE INTO printings (
    card_id, uuid, set_code, collector_number, rarity,
    artist, flavor_text, finishes, is_promo, is_full_art,
    frame_version, border_color, watermark, language, image_url,
    scryfall_id, mtgo_id, mtgo_foil_id, tcgplayer_product_id,
    cardkingdom_id, cardkingdom_foil_id, cardkingdom_etched_id,
    mtg_arena_id, multiverse_id
  ) VALUES (
    (SELECT id FROM cards WHERE name = ? LIMIT 1),
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'en', ?,
    ?, ?, ?, ?, ?, ?, ?, ?, ?
  )
`);

// In insertPrintingsMany:
insertPrinting.run(
  p.name,
  p.uuid,
  p.setCode,
  p.number,
  p.rarity,
  p.artist,
  p.flavorText,
  finishes,
  p.isPromo ? 1 : 0,
  p.isFullArt ? 1 : 0,
  p.frameVersion,
  p.borderColor,
  p.watermark,
  imageUrl,
  p.scryfallId,
  p.mtgoId,
  p.mtgoFoilId,
  p.tcgplayerProductId,
  p.cardKingdomId,
  p.cardKingdomFoilId,
  p.cardKingdomEtchedId,
  p.mtgArenaId,
  p.multiverseId
);
```

### Use Cases

With these IDs you can link to:
- **Scryfall**: `https://scryfall.com/card/${scryfallId}`
- **MTGO**: Direct card lookup
- **TCGPlayer**: Direct product page
- **Card Kingdom**: Direct product page
- **Arena**: Arena deck import codes

---

## Feature 6: Foreign Data

International card names and text in 25+ languages.

**Migration:** `src/db/migrations/010-add-foreign-data.js`

```javascript
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS card_foreign_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_name TEXT NOT NULL,
      language TEXT NOT NULL,
      foreign_name TEXT,
      foreign_text TEXT,
      foreign_type TEXT,
      foreign_flavor_text TEXT,
      FOREIGN KEY (card_name) REFERENCES cards(name) ON DELETE CASCADE
    );
    CREATE INDEX idx_foreign_card_name ON card_foreign_data(card_name);
    CREATE INDEX idx_foreign_language ON card_foreign_data(language);
  `);
  console.log('✓ Created card_foreign_data table');
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS card_foreign_data;`);
  console.log('✓ Dropped card_foreign_data table');
}
```

### Import Script Changes

**File:** `scripts/import-mtgjson.js` - Add after related cards import:

```javascript
// Import foreign data
console.log('Importing foreign card data...');

const foreignData = srcDb.prepare(`
  SELECT name, language, faceName, text, type, flavorText
  FROM cardForeignData
  WHERE name IS NOT NULL
`).all();

const insertForeign = targetDb.prepare(`
  INSERT OR IGNORE INTO card_foreign_data
  (card_name, language, foreign_name, foreign_text, foreign_type, foreign_flavor_text)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const insertForeignMany = targetDb.transaction((data) => {
  for (const fd of data) {
    insertForeign.run(
      fd.name,
      fd.language,
      fd.faceName,
      fd.text,
      fd.type,
      fd.flavorText
    );
  }
});

insertForeignMany(foreignData);
console.log(`✓ Imported ${foreignData.length} foreign card translations`);
```

### Backend Service Changes

**File:** `src/services/cardService.js`

```javascript
export function getCardById(cardId) {
  const card = db.get(`SELECT * FROM cards WHERE id = ?`, [cardId]);
  if (!card) return null;

  // ... existing queries ...

  // Get foreign data
  const foreignData = db.all(
    `SELECT language, foreign_name, foreign_text
     FROM card_foreign_data
     WHERE card_name = ?
     ORDER BY language`,
    [card.name]
  );

  return {
    ...card,
    printings,
    rulings,
    relatedCards,
    foreignData,  // Add this
  };
}
```

### Frontend Display

**File:** `client/src/components/cards.js`

```javascript
${card.foreignData && card.foreignData.length > 0 ? `
  <div style="margin-top: 2rem;">
    <h3>Other Languages (${card.foreignData.length})</h3>
    <details style="margin-top: 0.5rem;">
      <summary style="cursor: pointer; padding: 0.5rem; background: var(--bg-tertiary); border-radius: 6px;">
        Show translations
      </summary>
      <div style="margin-top: 0.5rem; display: grid; gap: 0.5rem; max-height: 300px; overflow-y: auto;">
        ${card.foreignData.map(fd => `
          <div style="padding: 0.75rem; background: var(--bg-tertiary); border-radius: 6px;">
            <div style="font-weight: bold;">${fd.language}: ${fd.foreign_name}</div>
            ${fd.foreign_text ? `<div style="font-size: 0.875rem; margin-top: 0.25rem; color: var(--text-secondary);">${fd.foreign_text}</div>` : ''}
          </div>
        `).join('')}
      </div>
    </details>
  </div>
` : ''}
```

---

## Feature 7: EDHRec & First Printing

Additional metadata for Commander players.

**Migration:** `src/db/migrations/011-add-edhrec-metadata.js`

```javascript
export function up(db) {
  db.exec(`
    ALTER TABLE cards ADD COLUMN edhrec_saltiness REAL;
    ALTER TABLE cards ADD COLUMN first_printing TEXT;
  `);
  console.log('✓ Added EDHRec metadata to cards table');
}

export function down(db) {
  // Recreate without these columns
  db.exec(`
    CREATE TABLE cards_backup AS SELECT
      id, name, mana_cost, cmc, colors, color_identity,
      type_line, oracle_text, power, toughness, loyalty,
      keywords, legalities, is_reserved, edhrec_rank,
      subtypes, supertypes, types, leadership_skills
    FROM cards;

    DROP TABLE cards;
    ALTER TABLE cards_backup RENAME TO cards;
  `);
  console.log('✓ Removed EDHRec metadata from cards table');
}
```

### Import Script Changes

**File:** `scripts/import-mtgjson.js`

```javascript
// Add to SELECT:
const sourceCards = srcDb.prepare(`
  SELECT DISTINCT
    c.name, /* ... all other fields ... */,
    c.edhrecSaltiness,  // Add this
    c.firstPrinting     // Add this
  FROM cards c
  LEFT JOIN cardLegalities cl ON c.uuid = cl.uuid
  WHERE c.name IS NOT NULL
`).all();

// Update INSERT:
const insertCard = targetDb.prepare(`
  INSERT OR IGNORE INTO cards (
    name, mana_cost, cmc, colors, color_identity,
    type_line, oracle_text, power, toughness, loyalty,
    keywords, legalities, is_reserved, edhrec_rank,
    subtypes, supertypes, types, leadership_skills,
    edhrec_saltiness, first_printing
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// In insertMany:
insertCard.run(
  /* ... all other fields ... */,
  card.edhrecSaltiness,
  card.firstPrinting
);
```

### Frontend Display

**File:** `client/src/components/cards.js`

```javascript
${card.edhrec_rank || card.edhrec_saltiness ? `
  <div style="margin-bottom: 1rem; padding: 0.75rem; background: var(--bg-tertiary); border-radius: 6px;">
    <strong>EDHRec:</strong>
    ${card.edhrec_rank ? `<div>Rank: #${card.edhrec_rank}</div>` : ''}
    ${card.edhrec_saltiness ? `<div>Saltiness: ${card.edhrec_saltiness.toFixed(2)}</div>` : ''}
    <a href="https://edhrec.com/cards/${encodeURIComponent(card.name.toLowerCase().replace(/\s+/g, '-'))}"
       target="_blank"
       style="color: var(--primary); text-decoration: none;">
      View on EDHRec →
    </a>
  </div>
` : ''}

${card.first_printing ? `
  <div style="margin-bottom: 1rem;">
    <strong>First Printed:</strong> ${card.first_printing.toUpperCase()}
  </div>
` : ''}
```

---

## Testing & Validation

### After Each Feature

1. **Run Migration**: Migrations auto-run on container restart
2. **Verify Schema**:
   ```bash
   docker exec deck-lotus node -e "const db = require('better-sqlite3')('/app/data/deck-lotus.db'); console.log(db.prepare('PRAGMA table_info(cards)').all())"
   ```
3. **Check Import**: Look for import messages in container logs
4. **Test Frontend**: Check card detail modal for new data
5. **Compare to MTGJSON**: Verify data matches source

### Force Reimport (Production Safe)

To reimport MTGJSON data **without deleting user decks**:

```bash
# Method 1: Using docker-compose.yml
# Uncomment the FORCE_REIMPORT line in docker-compose.yml:
# - FORCE_REIMPORT=true

# Then restart:
docker compose down
docker compose up --build

# Method 2: Using environment variable directly
docker compose down
FORCE_REIMPORT=true docker compose up --build

# Method 3: Using docker run
docker run -e FORCE_REIMPORT=true deck-lotus:latest
```

This will:
- ✅ Preserve all user-created decks and shared decks
- ✅ Keep migration history intact
- ✅ Delete and reimport: cards, printings, sets, prices, rulings, related_cards, card_foreign_data

### Full Re-import (Deletes Everything)

To completely wipe and re-import all data:

```bash
# Stop container
docker compose down

# Remove database volume
docker volume rm deck-lotus_deck-lotus-data

# Rebuild and start (will run migrations and import)
docker compose up --build
```

### Validation Queries

```javascript
// Check rulings count
docker exec deck-lotus node -e "const db = require('better-sqlite3')('/app/data/deck-lotus.db'); console.log('Rulings:', db.prepare('SELECT COUNT(*) as c FROM rulings').get())"

// Check legalities populated
docker exec deck-lotus node -e "const db = require('better-sqlite3')('/app/data/deck-lotus.db'); console.log('Cards with legalities:', db.prepare('SELECT COUNT(*) as c FROM cards WHERE legalities IS NOT NULL').get())"

// Check related cards
docker exec deck-lotus node -e "const db = require('better-sqlite3')('/app/data/deck-lotus.db'); console.log('Related cards:', db.prepare('SELECT COUNT(*) as c FROM related_cards').get())"
```

---

## Common Pitfalls

1. **Table Names**: MTGJSON uses `cardRulings`, `cardLegalities`, `cardForeignData` NOT `rulings`, `legalities`, `foreignData`

2. **JSON Parsing**: MTGJSON stores arrays as JSON strings. Always:
   ```javascript
   try {
     const parsed = typeof field === 'string' ? JSON.parse(field) : field;
   } catch (e) { /* handle error */ }
   ```

3. **NULL vs Empty**: Check for NULL before parsing:
   ```javascript
   if (card.field) { /* parse */ }
   ```

4. **Column Order**: INSERT statement column order MUST match VALUES order

5. **Transactions**: ALWAYS wrap bulk inserts in transactions for 100x speedup:
   ```javascript
   const insertMany = db.transaction((items) => { /* ... */ });
   insertMany(data);
   ```

6. **Legalities Structure**: Stored as flat columns in MTGJSON, need to build JSON object

7. **Migration Numbers**: Migrations run in order. Current latest is 004 (deck sharing), so start with 005

8. **Foreign Keys**: Use card.name for relations, not card.id (MTGJSON uses names)

---

## Reference Links

- [MTGJSON Documentation](https://mtgjson.com/data-models/)
- [MTGJSON Downloads](https://mtgjson.com/downloads/all-files/)
- [Card (Atomic) Model](https://mtgjson.com/data-models/card/card-atomic/)
- [Card (Set) Model](https://mtgjson.com/data-models/card/card-set/)
- [Legalities Model](https://mtgjson.com/data-models/legalities/)
- [Related Cards Model](https://mtgjson.com/data-models/related-cards/)
- [Foreign Data Model](https://mtgjson.com/data-models/foreign-data/)
- [Leadership Skills Model](https://mtgjson.com/data-models/leadership-skills/)
- [Identifiers Model](https://mtgjson.com/data-models/identifiers/)

---

## Migration Execution Order

1. `005-add-scryfall-id.js` - Fix broken Scryfall ID storage
2. `006-add-type-arrays.js` - Add subtypes, supertypes, types
3. `007-add-related-cards.js` - Create related_cards table
4. `008-add-leadership-skills.js` - Add leadership_skills column
5. `009-add-identifiers.js` - Add extended identifiers to printings
6. `010-add-foreign-data.js` - Create card_foreign_data table
7. `011-add-edhrec-metadata.js` - Add EDHRec saltiness and first printing

Then update `scripts/import-mtgjson.js` to import all the data.
