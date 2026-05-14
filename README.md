<div align="center">
  <img src="assets/decklotus-icon.png" alt="Deck Lotus" width="200">
  <h1>Deck Lotus</h1>
  <p>A modern, self-hosted Magic: The Gathering deck builder with Mana Pool integration, price monitoring, cart optimization, and multi-user support.</p>
</div>

## Features

### Deck Building
- **Intuitive Deck Builder** — real-time search with autocomplete as you type
- **Multiple Boards** — mainboard, sideboard, and maybeboard support
- **Commander Support** — mark commanders, color identity displayed automatically
- **Multiple Printings** — choose specific card art, set, and foil version per card
- **Printing Optimizer** — automatically find the cheapest or most thematic set for your entire deck
- **Deck Statistics** — live mana curve, type distribution, color breakdown, and estimated value
- **Format Support** — Commander, Standard, Modern, Pioneer, Legacy, Vintage, Pauper
- **Drag & Drop** — reorder cards between boards
- **Layout Views** — full card, compact, and ultra-compact views

### Mana Pool Integration
- **Cart Optimizer** — find the cheapest combination of sellers for your deck or shopping list across four strategies:
  - **Lowest Total Price** — minimize spend
  - **Fewest Packages** — minimize shipping costs
  - **Balanced** — balance between price and convenience
  - **Gathered Shipping Only** — sellers offering combined shipping
- **Deck Validator** — check any deck for format legality via Mana Pool (Commander, Standard, Modern, Pioneer, Legacy, Vintage, Pauper)
- **Buy Links** — every card in the deck builder and shopping list has a direct "Buy on Mana Pool" link
- **Price Monitoring** — watch card prices and get notified when they hit your target

### Price Monitoring & Alerts
- **Price Watches** — set a target price and condition (NM/LP/MP/HP/DM) for any card
- **Automated Checks** — prices polled on a configurable schedule (default: every 6 hours)
- **Push Notifications** — instant alerts via [ntfy](https://ntfy.sh) when a card hits your target price
- **Price History Charts** — beautiful Chart.js line graphs showing price over time with your target threshold overlaid
- **Smart Alerting** — won't re-notify more than once per 24 hours for the same watch
- **Watch Management** — pause, resume, expire, and delete watches from a single dashboard
- **Card Autocomplete** — instant card name search when adding a watch

### Shopping List
- **Cross-Deck Aggregation** — see every card you need across all your decks in one list, organized by set
- **Mana Pool Optimizer** — run the optimizer directly from the shopping list to get a ready-to-buy cart
- **Per-Card Buy Links** — one-click links to Mana Pool search for every card
- **Filters** — price range, rarity, color, set search, and budget mode
- **Session Tracking** — mark cards as "found" or "skip" during an LGS visit
- **Export** — export the full shopping list as formatted text

### Card Browsing & Inventory
- **Advanced Card Browser** — filter by color, type, CMC range, set, subtype, and rarity
- **Inventory Management** — track cards you own with quantity per printing
- **Owned Card Badges** — see which cards in your decks you already own
- **Card Detail Modal** — all printings with prices, artist, set, legality, and rulings
- **Hover Previews** — full card image on hover throughout the app

### Deck Import & Export
- **Import from** Moxfield, MTG Arena, MTGO, and plain text formats
- **Export to** Moxfield (with set codes), Arena, MTGO, and plain text
- **Smart Parser** — auto-detects set codes in brackets or parentheses
- **Shared Deck Import** — one-click import of any publicly shared deck

### Deck Sharing
- **Public Links** — generate a unique read-only URL for any deck
- **No Account Required** — anyone with the link can view the deck
- **Import Shared Decks** — viewers can save a copy to their own account

### User Management
- **Multi-User** — each user has their own decks, inventory, and price watches
- **JWT Authentication** — secure token-based auth with refresh tokens
- **API Keys** — generate named API keys for external integrations
- **Gravatar Support** — profile pictures via Gravatar with colorful initials fallback
- **User Statistics** — deck count, card count, shared decks, and API keys at a glance

### Admin Tools
- **User Management** — view, promote/demote, and delete users
- **Backup & Restore** — export and restore all user data as JSON
- **Database Sync** — manually trigger MTGJSON card data and pricing refresh
- **Auto-Sync** — card data updated daily at 3 AM automatically
- **Safe Reimport** — `FORCE_REIMPORT` clears card data but preserves all user decks via UUIDs

---

## Quick Start with Docker

```bash
mkdir -p deck-lotus-data

cat > docker-compose.yml << 'EOF'
services:
  deck-lotus:
    image: ghcr.io/madeofpendletonwool/deck-lotus:latest
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - JWT_SECRET=replace-with-a-long-random-secret
      - ADMIN_USERNAME=admin
      - ADMIN_EMAIL=admin@example.com
      - ADMIN_PASSWORD=changeme123
      # Optional but recommended — enables price monitoring & cart optimizer
      - MANAPOOL_API_TOKEN=
      # Optional — enables push notifications for price alerts
      - NTFY_TOPIC=
    volumes:
      - ./deck-lotus-data:/app/data
    restart: unless-stopped
EOF

docker compose up -d
```

App runs at `http://localhost:3000`. Generate a secure JWT secret with:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## Build from Source

```bash
git clone https://github.com/madeofpendletonwool/deck-lotus.git
cd deck-lotus

cp .env.example .env
# Edit .env — set JWT_SECRET at minimum

docker compose up -d --build
```

---

## Environment Variables

| Variable | Default | Required | Description |
|---|---|---|---|
| `JWT_SECRET` | — | **Yes** | Secret for signing JWT tokens. Use a long random string. |
| `PORT` | `3000` | No | Port the server listens on |
| `NODE_ENV` | `development` | No | `production` or `development` |
| `DATABASE_PATH` | `./data/deck-lotus.db` | No | Path to the SQLite database |
| `MANAPOOL_USER_EMAIL` | — | No | Your Mana Pool account email address. Required alongside the token. |
| `MANAPOOL_API_TOKEN` | — | No | Enables price monitoring, cart optimizer, and deck validator. Generate at [manapool.com/seller/settings/integrations](https://manapool.com/seller/settings/integrations) |
| `TCGPLAYER_CLIENT_ID` | — | No | TCGPlayer API fallback (keys no longer publicly issued) |
| `TCGPLAYER_CLIENT_SECRET` | — | No | TCGPlayer API fallback |
| `NTFY_URL` | `https://ntfy.sh` | No | ntfy server URL for push notifications |
| `NTFY_TOPIC` | — | No | ntfy topic name for price alert push notifications |
| `PRICE_CHECK_SCHEDULE` | `0 */6 * * *` | No | Cron expression for price check frequency |
| `ADMIN_USERNAME` | — | No | Username for initial admin account |
| `ADMIN_EMAIL` | — | No | Email for initial admin account |
| `ADMIN_PASSWORD` | — | No | Password for initial admin account |
| `JWT_EXPIRES_IN` | `7d` | No | Access token lifetime |
| `JWT_REFRESH_EXPIRES_IN` | `30d` | No | Refresh token lifetime |
| `MTGJSON_URL` | (auto) | No | Custom MTGJSON download URL |
| `FORCE_REIMPORT` | `false` | No | Set `true` to clear and reimport all card data on next startup. User decks are preserved. |

### Mana Pool setup

Mana Pool is the preferred price source and unlocks the most powerful features. To enable it:

1. Create a Mana Pool account at [manapool.com](https://manapool.com)
2. Go to **Seller Settings → Integrations**
3. Generate an API access token
4. Set both `MANAPOOL_USER_EMAIL` (your account email) and `MANAPOOL_API_TOKEN` in your `.env` or `docker-compose.yml`

With the token set you get:
- Price monitoring that actually works
- Cart optimizer in the buy modal and shopping list
- Deck legality validator
- Per-card buy links throughout the app

### Price alert notifications (ntfy)

1. Install the [ntfy app](https://ntfy.sh) on your phone, or use the web UI
2. Pick a unique topic name (e.g. `deck-lotus-alerts-abc123`)
3. Set `NTFY_TOPIC` to that name
4. Subscribe to the same topic in the ntfy app

You'll receive a push notification whenever a watched card price drops to or below your target.

---

## Admin User Setup

On every startup, Deck Lotus checks whether an admin user exists:

- **Admin exists** → nothing happens, server starts normally
- **No admin exists + env vars set** → creates or promotes `ADMIN_USERNAME` to admin
- **No admin exists + no env vars** → auto-generates credentials and prints them to the console **once**

Auto-generated credentials look like this:

```
╔════════════════════════════════════════════════════════════╗
║  AUTO-GENERATED ADMIN CREDENTIALS                          ║
╠════════════════════════════════════════════════════════════╣
║  Username: admin                                           ║
║  Email:    admin@localhost                                 ║
║  Password: a1b2c3d4e5f6...                                 ║
╠════════════════════════════════════════════════════════════╣
║  ⚠️  SAVE THESE CREDENTIALS NOW!                           ║
║  They will not be shown again.                             ║
╚════════════════════════════════════════════════════════════╝
```

**Change the password immediately after first login.**

---

## Usage Guide

### Building a Deck

1. Go to **My Decks** → **New Deck**
2. Name your deck and optionally set a format
3. Search for cards — autocomplete shows results as you type
4. Click a card to select a printing and add it
5. Use **+/-** or the quantity field to adjust counts
6. Switch between **Mainboard**, **Sideboard**, and **Maybeboard** tabs
7. Right-click any card for the actions menu (move board, set as commander, buy on Mana Pool, remove)
8. Click **Save**

### Buying a Deck

1. Open a deck → click **Buy Deck**
2. The **Mana Pool Optimizer** tab opens by default:
   - Choose a strategy (Lowest Price, Fewest Packages, Balanced, or Gathered Shipping Only)
   - Click **Optimize Cart** — results show a per-seller breakdown with prices
   - Click **View on Mana Pool** to complete the purchase
3. Switch to **Quick Export** to copy the deck list for Mana Pool or TCGplayer mass entry

### Validating a Deck

1. Open a deck → look for **Validate Deck** in the sidebar stats panel
2. Select a format (Commander, Standard, Modern, etc.)
3. Click **Validate** — results show legality status, your commander, color identity, and any violations

### Setting Up Price Watches

1. Go to **Price Watch** in the nav
2. Click **Add Watch**
3. Start typing a card name — autocomplete suggests matching cards
4. Set a target price and condition
5. Optionally set an expiry date and notes
6. Click **Save Watch**

Prices are checked on the configured schedule. When a price hits your target you get a push notification (if ntfy is configured) and the watch shows a green "Price Hit!" badge.

Click the chart icon on any watch to see the full price history graph with your target threshold.

### Shopping List

1. Go to **Shopping List**
2. Select the decks you want to shop for
3. Use filters to narrow down by price, rarity, or color
4. Click **Optimize Cart** to run the Mana Pool optimizer across your entire list
5. Click the **Mana Pool** button on any individual card to search for it directly
6. Mark cards as **Found** during an LGS visit to track progress

### Importing Decks

1. Go to **My Decks** → **Import Deck**
2. Enter a deck name and format
3. Paste your deck list — any of these formats work:
   - `4 Lightning Bolt` (Arena / MTGO)
   - `4 Counterspell [DMR]` (Moxfield with set code)
   - `1 Black Lotus (LEA)` (set code in parentheses)
4. Click **Import Deck**

### API Keys

Generate API keys for external integrations:

1. Go to **Settings** → **Generate New API Key**
2. Enter a name → save the key (shown once only)

Use in requests:
```bash
curl -H "X-API-Key: your-api-key" http://localhost:3000/api/cards/search?q=lightning
```

---

## API Reference

All endpoints require authentication via `Authorization: Bearer <token>` or `X-API-Key: <key>` unless noted.

### Auth

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Register a new account |
| `POST` | `/api/auth/login` | Login, returns JWT |
| `GET` | `/api/auth/me` | Current user profile |
| `GET` | `/api/auth/stats` | User statistics |
| `GET` | `/api/auth/api-keys` | List API keys |
| `POST` | `/api/auth/api-keys` | Create API key |
| `DELETE` | `/api/auth/api-keys/:id` | Revoke API key |

### Cards

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/cards/search?q=&limit=` | Autocomplete search |
| `GET` | `/api/cards/browse` | Filtered card browser (name, colors, type, cmc, sets, sort, page) |
| `GET` | `/api/cards/:id` | Card details |
| `GET` | `/api/cards/:id/printings` | All printings with prices |
| `POST` | `/api/cards/:id/owned` | Toggle card ownership |

### Decks

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/decks` | List decks |
| `POST` | `/api/decks` | Create deck |
| `GET` | `/api/decks/:id` | Get deck |
| `PUT` | `/api/decks/:id` | Update deck |
| `DELETE` | `/api/decks/:id` | Delete deck |
| `POST` | `/api/decks/:id/cards` | Add card |
| `PUT` | `/api/decks/:id/cards/:cardId` | Update card quantity / board |
| `DELETE` | `/api/decks/:id/cards/:cardId` | Remove card |
| `GET` | `/api/decks/:id/stats` | Mana curve, type distribution, colors |
| `GET` | `/api/decks/:id/price` | Deck total estimated value |
| `POST` | `/api/decks/import` | Import from text |
| `POST` | `/api/decks/:id/share` | Create public share link |
| `DELETE` | `/api/decks/:id/share` | Remove share link |
| `GET` | `/api/decks/share/:token` | View shared deck (public) |
| `POST` | `/api/decks/share/:token/import` | Import shared deck |

### Price Monitoring

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/price-monitoring/status` | Check if price source and ntfy are configured |
| `GET` | `/api/price-monitoring` | List all price watches |
| `POST` | `/api/price-monitoring` | Create price watch |
| `PUT` | `/api/price-monitoring/:id` | Update watch (price, condition, active state) |
| `DELETE` | `/api/price-monitoring/:id` | Delete watch |
| `GET` | `/api/price-monitoring/:id/history` | Price check history |
| `POST` | `/api/price-monitoring/check-now` | Trigger immediate check of all active watches |

### Mana Pool

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/manapool/status` | Check if `MANAPOOL_API_TOKEN` is configured |
| `POST` | `/api/manapool/optimize` | Cart optimizer — body: `{ items, model }` |
| `POST` | `/api/manapool/validate-deck` | Deck validator — body: `{ decklist, format }` |
| `POST` | `/api/manapool/card-info` | Card info lookup — body: `{ names }` |

#### Optimizer models

| Model | Description |
|---|---|
| `lowest_price` | Minimize total spend |
| `fewest_packages` | Minimize number of sellers (saves shipping) |
| `balanced` | Balance between price and packages |
| `gathered_shipping_only` | Sellers offering combined shipping only |

#### Example: optimize a cart

```http
POST /api/manapool/optimize
Authorization: Bearer <token>
Content-Type: application/json

{
  "model": "fewest_packages",
  "items": [
    { "name": "Sol Ring", "quantity": 1 },
    { "name": "Arcane Signet", "quantity": 1 },
    { "name": "Command Tower", "quantity": 1 }
  ]
}
```

#### Example: validate a deck

```http
POST /api/manapool/validate-deck
Authorization: Bearer <token>
Content-Type: application/json

{
  "format": "commander",
  "decklist": "1 Atraxa, Praetors' Voice\n1 Sol Ring\n..."
}
```

### Admin

All admin endpoints require admin privileges.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/users` | List all users |
| `PUT` | `/api/admin/users/:id` | Update user (promote/demote admin) |
| `DELETE` | `/api/admin/users/:id` | Delete user and all their data |
| `POST` | `/api/admin/users/:id/reset-password` | Reset user password |
| `POST` | `/api/admin/sync` | Trigger MTGJSON sync |
| `GET` | `/api/admin/sync-status` | Last sync timestamp |
| `POST` | `/api/admin/backup` | Create data backup |
| `POST` | `/api/admin/restore` | Restore from backup |
| `GET` | `/api/admin/backups` | List saved backup files |

---

## Project Structure

```
deck-lotus/
├── src/
│   ├── db/
│   │   ├── migrations/            # 017 database migrations
│   │   ├── connection.js
│   │   └── index.js
│   ├── middleware/
│   │   ├── auth.js                # JWT + API key auth
│   │   └── errorHandler.js
│   ├── routes/
│   │   ├── auth.js
│   │   ├── cards.js
│   │   ├── decks.js
│   │   ├── sets.js
│   │   ├── shopping.js
│   │   ├── inventory.js
│   │   ├── priceMonitoring.js
│   │   ├── manapool.js            # Mana Pool proxy routes
│   │   └── admin.js
│   └── services/
│       ├── authService.js
│       ├── cardService.js
│       ├── deckService.js
│       ├── pricingService.js      # Local deck price calculation
│       ├── manaPoolService.js     # Mana Pool API integration
│       ├── tcgplayerService.js    # TCGPlayer fallback
│       ├── priceMonitoringService.js
│       ├── notificationService.js # ntfy integration
│       └── syncService.js
├── client/
│   ├── src/
│   │   ├── components/
│   │   │   ├── deckBuilder.js     # Deck builder + optimizer + validator
│   │   │   ├── cards.js
│   │   │   ├── shopping.js        # Shopping list + Mana Pool optimizer
│   │   │   ├── inventory.js
│   │   │   ├── priceMonitoring.js # Price watches + Chart.js history charts
│   │   │   ├── settings.js
│   │   │   └── auth.js
│   │   ├── services/api.js        # API client
│   │   ├── utils/
│   │   └── main.js
│   ├── index.html
│   └── package.json
├── scripts/
│   └── import-mtgjson.js
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── package.json
```

---

## Tech Stack

**Backend** — Node.js, Express, SQLite (better-sqlite3), JWT, bcrypt, node-cron

**Frontend** — Vanilla JavaScript (ES6+), Vite, Chart.js (price history charts), Phosphor Icons

**Data** — MTGJSON (card data, synced weekly), Mana Pool API (live prices, optimizer, validator)

---

## Backup & Restore

Admins can export and restore all user data from Settings → Backup & Restore.

Backups include: users, decks, deck cards, API keys, and share tokens. Card database data is excluded — it auto-imports from MTGJSON.

Restores can **merge** (keeps existing data, adds backup data) or **overwrite** (replaces everything). Deck integrity is maintained via stable UUIDs.

---

## Docker Build

The Dockerfile uses a three-stage build to keep the final image small (~150 MB):

1. **Frontend builder** — runs `npm run build` in the client directory
2. **Backend builder** — installs production dependencies only
3. **Final image** — Alpine Node.js with runtime files only

```bash
# Build and run locally
docker compose up -d --build

# Force a card data reimport (preserves user decks)
FORCE_REIMPORT=true docker compose up -d
```

---

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

---

## Credits

- Card data: [MTGJSON](https://mtgjson.com/)
- Prices & marketplace: [Mana Pool](https://manapool.com)
- Push notifications: [ntfy](https://ntfy.sh)
- Icons: [Phosphor Icons](https://phosphoricons.com)
- Charts: [Chart.js](https://www.chartjs.org)

---

## License

MIT — see LICENSE file for details.

---

<div align="center">
  <strong>Deck Lotus</strong> — Build decks with style.
  <br><br>
  Made with love for the Magic: The Gathering community.
</div>
