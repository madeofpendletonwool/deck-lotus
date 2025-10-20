# Deck Lotus 🌸

A modern, self-hosted Magic: The Gathering deck builder with multi-user support, API key authentication, and a beautiful web interface.

## Features

### User Management & Authentication
- **Multi-User Support**: Secure user registration and authentication with JWT tokens
- **Admin System**: Role-based access control with admin user management
- **API Key Authentication**: Generate and manage API keys for external integrations
- **User Profiles**: Gravatar integration with fallback to colorful initials
- **User Statistics**: Track deck count, card count, API keys, and shared decks

### Deck Building & Management
- **Deck Builder**: Intuitive drag-and-drop interface for building decks
- **Multiple Printings**: Choose specific card art, set, and foil versions
- **Mainboard & Sideboard**: Full support for mainboard and sideboard management
- **Commander Support**: Mark commanders for Commander format decks
- **Deck Statistics**: Real-time visual mana curve, type distribution, and color analysis
- **Format Support**: Standard, Modern, Commander, Legacy, Vintage, Pauper
- **Deck Import/Export**: Import and export decks in multiple formats:
  - Moxfield format with set codes
  - MTG Arena format
  - MTGO format
  - Plain text format

### Card Browsing & Search
- **Fast Card Search**: Real-time autocomplete search as you type
- **Advanced Filtering**: Filter by colors, card types, CMC range, and sets
- **Smart Sorting**: Sort by name, mana value, color, price, or random
- **Set Browser**: Browse cards by specific Magic sets
- **Price Tracking**: TCGplayer pricing with low/mid/market values
- **Card Preview**: Hover to see full card images

### Enhanced Card Data (MTGJSON)
- **Scryfall Integration**: Scryfall IDs for all printings
- **Type Arrays**: Separate supertypes, types, and subtypes
- **Related Cards**: Track card relationships (tokens, meld pairs, etc.)
- **Commander Data**: Leadership skills for Commander format
- **Identifiers**: Multiple card identifiers (MTGO, TCGplayer, etc.)
- **Foreign Data**: Multi-language card names and text
- **EDHREC Metadata**: Commander popularity and ranking data

### Deck Sharing & Collaboration
- **Public Sharing**: Share decks with unique public URLs
- **Import Shared Decks**: One-click import of shared decks
- **Read-Only Views**: Public viewers can see deck lists and stats

### TCGplayer Integration
- **Price Display**: Real-time pricing for each card and total deck value
- **Mass Entry**: Export decks directly to TCGplayer with set codes
- **Copy Deck Lists**: Format deck lists for manual paste

### Admin Tools
- **User Management**: View, edit, promote/demote, and delete users
- **Backup & Restore**: Export and import all user data (decks, cards, API keys)
- **Database Sync**: Manual refresh of MTGJSON card data and pricing
- **Safe Reimport**: FORCE_REIMPORT preserves user decks using UUIDs

### Deployment & Self-Hosting
- **Self-Hosted**: Own your data with SQLite database
- **Dockerized**: Easy deployment with Docker and docker-compose
- **Database Flexibility**: Built with abstraction layer for future database options
- **Auto-Sync**: Daily automatic card data and pricing updates at 3 AM

## Tech Stack

### Backend
- Node.js + Express
- SQLite with better-sqlite3
- JWT authentication + API key support
- bcrypt password hashing
- Compression, rate limiting, security headers

### Frontend
- Vanilla JavaScript (ES6+)
- Vite for build and dev server
- Modern CSS with custom properties
- Responsive design
- Real-time search with debouncing

### Data
- MTGJSON for comprehensive Magic card data
- All card printings with artist info and set details

## Quick Start with Docker

The easiest way to run Deck Lotus:

```bash
# Clone the repository
git clone <your-repo-url>
cd deck-lotus

# Copy environment file
cp .env.example .env

# Edit .env and set a secure JWT_SECRET
nano .env

# Build and run with Docker Compose
docker-compose up -d

# Import MTG card data (first time only)
docker-compose exec deck-lotus node scripts/import-mtgjson.js
```

The app will be available at `http://localhost:3000`

## Manual Setup (Without Docker)

### Prerequisites

- Node.js 18+
- npm or yarn
- bzip2 (for decompressing MTGJSON data)

### Installation

```bash
# Install backend dependencies
npm install

# Install frontend dependencies
cd client
npm install
cd ..

# Copy environment file
cp .env.example .env

# Edit .env and configure as needed
nano .env
```

### Configuration

Edit `.env`:

```env
PORT=3000
NODE_ENV=development
DATABASE_PATH=./data/deck-lotus.db
JWT_SECRET=your-super-secret-key-change-this
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d
```

### Import Card Data

Download and import all Magic: The Gathering cards from MTGJSON:

```bash
# Initialize database
npm run init-db

# Import cards (this will download ~500MB and may take a few minutes)
npm run import-cards
```

This creates a local SQLite database with all Magic cards and printings.

### Running in Development

```bash
# Terminal 1: Run backend server
npm run dev

# Terminal 2: Run frontend dev server
npm run client:dev
```

- Backend API: `http://localhost:3000`
- Frontend: `http://localhost:5173`

### Building for Production

```bash
# Build frontend
npm run client:build

# Start production server
npm start
```

The production server serves both API and frontend on port 3000.

## Usage

### Creating an Account

1. Navigate to `http://localhost:3000`
2. Click "Register" on the login page
3. Enter username, email, and password (min 8 characters)
4. You'll be automatically logged in

### Building Decks

1. Click "New Deck" on the My Decks page
2. Enter a deck name and select a format (optional)
3. Search for cards using the search box (autocomplete appears as you type)
4. Click a card to add it to your deck
5. Use +/- buttons to adjust quantities
6. Toggle between Mainboard and Sideboard tabs
7. View live statistics (mana curve, card types, colors)
8. View real-time deck pricing with TCGplayer integration
9. Click "Save" to save your changes

### Importing Decks

Import decks from other platforms:

1. Click "Import Deck" on the My Decks page
2. Enter a deck name and format
3. Paste your deck list in any of these formats:
   - `1 Lightning Bolt` (Arena/MTGO)
   - `4 Counterspell [DMR]` (Moxfield with set codes)
   - `1 Black Lotus (LEA)` (set codes in parentheses)
4. Click "Import Deck"

The importer intelligently detects format and matches cards to printings.

### Exporting Decks

Export decks to various formats:

1. Open a deck
2. Click the export icon (download button) in the deck tabs
3. Choose your format:
   - **Moxfield**: Includes set codes and collector numbers
   - **Arena**: Simple format for MTG Arena
   - **MTGO**: Compatible with Magic Online
   - **Plain Text**: Simple quantity + name format
4. Click "Copy to Clipboard" or manually copy the text

### Sharing Decks

Share decks with friends or the community:

1. Open a deck
2. Click "Share" button
3. Copy the generated public URL
4. Anyone with the link can view (read-only)
5. Viewers can import shared decks to their account

To stop sharing:
1. Open the deck
2. Click "Share" again
3. Click "Delete Share Link"

### Browsing Cards

Explore the card database with advanced filtering:

1. Go to "Browse Cards" page
2. Use the search box for quick name search
3. Apply filters:
   - **Sort**: Alphabetical, mana value, color, price, random
   - **Type**: Creature, Instant, Sorcery, Enchantment, etc.
   - **CMC**: Set min/max mana value range
   - **Colors**: Select color combinations (W, U, B, R, G, C)
   - **Sets**: Filter by specific Magic sets
4. Hover over cards to see full preview images
5. Click cards to view all printings and prices

### Buying Decks

Purchase your decks via TCGplayer:

1. Open a deck
2. Click "Buy Deck" button
3. Choose **TCGplayer Mass Entry** (recommended)
4. Deck list with set codes opens in TCGplayer
5. Review prices and add to cart

Alternatively, use **Copy Deck List** to manually paste elsewhere.

### User Profile & Stats

Your user profile displays:
- **Gravatar**: If you have a Gravatar associated with your email, it displays automatically
- **Username & Email**: Your account details
- **Statistics**:
  - Total decks created
  - Total cards across all decks
  - API keys generated
  - Shared decks (publicly accessible)

Access your profile by clicking your avatar in the top-right corner.

### API Keys

Generate API keys for external integrations:

1. Go to Settings page
2. Click "Generate New API Key"
3. Enter a name for the key
4. Save the generated key (shown only once!)

Use API keys in requests:
```bash
curl -H "X-API-Key: your-api-key-here" http://localhost:3000/api/cards/search?q=lightning
```

### Admin Features

If you're an admin user, you have access to additional features in Settings:

**User Management**:
- View all registered users
- Promote users to admin or demote from admin
- Delete user accounts (removes all their decks and data)
- Cannot remove your own admin status or delete your own account

**Database Management**:
- Manually trigger MTGJSON sync to update card data and pricing
- View last sync timestamp
- Auto-sync runs daily at 3:00 AM

**Backup & Restore**:
- Export all user data (users, decks, API keys, shares)
- Import previously exported backups
- Choose to overwrite or merge data
- Backups preserve deck integrity using UUIDs

## API Documentation

### Authentication Endpoints

#### Register
```http
POST /api/auth/register
Content-Type: application/json

{
  "username": "player1",
  "email": "player1@example.com",
  "password": "securepass123"
}
```

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "player1",
  "password": "securepass123"
}
```

#### Get Profile
```http
GET /api/auth/me
Authorization: Bearer <jwt-token>
```

#### Get User Stats
```http
GET /api/auth/stats
Authorization: Bearer <jwt-token>
```

Returns: `{ stats: { deckCount, cardCount, apiKeyCount, sharedDeckCount } }`

#### Generate API Key
```http
POST /api/auth/api-keys
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "name": "My Integration"
}
```

#### Get API Keys
```http
GET /api/auth/api-keys
Authorization: Bearer <jwt-token>
```

#### Revoke API Key
```http
DELETE /api/auth/api-keys/:id
Authorization: Bearer <jwt-token>
```

### Card Endpoints

All card endpoints require authentication (JWT or API Key).

#### Search Cards
```http
GET /api/cards/search?q=lightning&limit=20
Authorization: Bearer <jwt-token>
```

#### Browse Cards (with filters)
```http
GET /api/cards/browse?name=bolt&colors=R&type=Instant&cmcMin=1&cmcMax=3&sets=MH2&sort=name&page=1&limit=20
Authorization: Bearer <jwt-token>
```

Query parameters:
- `name`: Card name search
- `colors`: Color filter (e.g., `W`, `UB`, `WUG`)
- `type`: Card type filter
- `cmcMin` / `cmcMax`: Mana value range
- `sets`: Comma-separated set codes
- `sort`: `name`, `cmc`, `color`, `price`, `random`
- `page`: Page number (default: 1)
- `limit`: Results per page (default: 20)

#### Get Card Details
```http
GET /api/cards/:id
Authorization: Bearer <jwt-token>
```

#### Get Card Printings
```http
GET /api/cards/:id/printings
Authorization: Bearer <jwt-token>
```

Returns all printings of a card with set info, prices, and availability.

### Deck Endpoints

#### List Decks
```http
GET /api/decks
Authorization: Bearer <jwt-token>
```

#### Create Deck
```http
POST /api/decks
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "name": "My Red Deck",
  "format": "standard",
  "description": "Aggressive red deck"
}
```

#### Get Deck
```http
GET /api/decks/:id
Authorization: Bearer <jwt-token>
```

#### Update Deck
```http
PUT /api/decks/:id
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "name": "Updated Name",
  "format": "modern"
}
```

#### Delete Deck
```http
DELETE /api/decks/:id
Authorization: Bearer <jwt-token>
```

#### Add Card to Deck
```http
POST /api/decks/:id/cards
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "printingId": 123,
  "quantity": 4,
  "isSideboard": false
}
```

#### Update Card in Deck
```http
PUT /api/decks/:id/cards/:cardId
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "quantity": 2
}
```

#### Remove Card from Deck
```http
DELETE /api/decks/:id/cards/:cardId
Authorization: Bearer <jwt-token>
```

#### Get Deck Statistics
```http
GET /api/decks/:id/stats
Authorization: Bearer <jwt-token>
```

Returns mana curve, type distribution, and color breakdown.

#### Get Deck Price
```http
GET /api/decks/:id/price
Authorization: Bearer <jwt-token>
```

Returns TCGplayer pricing for the entire deck (low, mid, market).

#### Import Deck
```http
POST /api/decks/import
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "name": "Imported Deck",
  "format": "commander",
  "deckList": "1 Lightning Bolt\n4 Counterspell [DMR]\n..."
}
```

Supports multiple formats: Arena, MTGO, Moxfield (with set codes).

#### Create Deck Share
```http
POST /api/decks/:id/share
Authorization: Bearer <jwt-token>
```

Returns: `{ token: "uuid", shareUrl: "http://..." }`

#### Delete Deck Share
```http
DELETE /api/decks/:id/share
Authorization: Bearer <jwt-token>
```

#### Get Shared Deck (Public)
```http
GET /api/decks/share/:token
```

No authentication required. Returns deck details, cards, and statistics.

#### Import Shared Deck
```http
POST /api/decks/share/:token/import
Authorization: Bearer <jwt-token>
```

Creates a copy of the shared deck in your account.

### Set Endpoints

#### Get All Sets
```http
GET /api/sets
Authorization: Bearer <jwt-token>
```

Returns all Magic sets with metadata (name, code, release date, type).

#### Get Set Details
```http
GET /api/sets/:code
Authorization: Bearer <jwt-token>
```

#### Get Set Cards
```http
GET /api/sets/:code/cards?page=1
Authorization: Bearer <jwt-token>
```

Returns paginated cards from a specific set.

### Admin Endpoints

All admin endpoints require authentication AND admin privileges.

#### Get All Users
```http
GET /api/admin/users
Authorization: Bearer <jwt-token>
```

Admin only. Returns all registered users with their roles.

#### Update User
```http
PUT /api/admin/users/:id
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "is_admin": 1
}
```

Admin only. Update user details or admin status. Cannot remove own admin status.

#### Delete User
```http
DELETE /api/admin/users/:id
Authorization: Bearer <jwt-token>
```

Admin only. Delete user and all their data (decks, cards, API keys). Cannot delete own account.

#### Create Backup
```http
POST /api/admin/backup
Authorization: Bearer <jwt-token>
```

Admin only. Creates JSON backup of all user data (users, decks, cards, API keys, shares).

#### Restore Backup
```http
POST /api/admin/restore
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "backup": { ... },
  "overwrite": false
}
```

Admin only. Restores data from backup. `overwrite: true` replaces all data, `false` merges.

#### Sync Database
```http
POST /api/admin/sync
Authorization: Bearer <jwt-token>
```

Admin only. Manually trigger MTGJSON sync to update card data and pricing.

#### Get Sync Status
```http
GET /api/admin/sync-status
Authorization: Bearer <jwt-token>
```

Admin only. Returns last sync timestamp and current sync status.

## Project Structure

```
deck-lotus/
├── src/
│   ├── db/
│   │   ├── migrations/       # Database migrations
│   │   ├── connection.js     # Database abstraction layer
│   │   └── index.js
│   ├── middleware/
│   │   ├── auth.js           # JWT + API key authentication
│   │   └── errorHandler.js
│   ├── services/
│   │   ├── authService.js    # User authentication logic
│   │   ├── cardService.js    # Card search and retrieval
│   │   └── deckService.js    # Deck management
│   ├── routes/
│   │   ├── auth.js           # Auth endpoints
│   │   ├── cards.js          # Card endpoints
│   │   └── decks.js          # Deck endpoints
│   ├── utils/
│   │   ├── jwt.js            # JWT utilities
│   │   └── validators.js     # Input validation
│   └── server.js             # Express server
├── client/
│   ├── src/
│   │   ├── components/       # UI components
│   │   ├── services/         # API client
│   │   ├── styles/           # CSS
│   │   ├── utils/            # Helper functions
│   │   └── main.js           # App entry point
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── scripts/
│   ├── import-mtgjson.js     # Import card data
│   └── init-db.js            # Initialize database
├── data/                     # SQLite database (gitignored)
├── Dockerfile                # Multi-stage Docker build
├── docker-compose.yml        # Docker Compose configuration
├── .dockerignore
├── .env.example
└── package.json
```

## Database Schema

### Users
- Authentication and user management
- Hashed passwords with bcrypt (10 rounds)
- Admin flag for role-based access control
- Email for Gravatar integration
- Created timestamp

### API Keys
- API key generation and management
- SHA-256 hashed keys with prefixes
- Named keys for easy identification
- Last used tracking
- User ownership

### Cards
- Atomic card data (shared across all printings)
- Name, mana cost, colors, types, rules text
- **Enhanced fields**:
  - `supertypes`, `types`, `subtypes` (JSON arrays)
  - `leadership` (JSON object for Commander skills)
  - Power/toughness, loyalty
  - Keywords and abilities
  - EDHREC rank and salt score

### Printings
- Set-specific card data
- Artist, collector number, set code, rarity
- Multiple printings per card
- **Enhanced fields**:
  - `uuid` (stable MTGJSON identifier)
  - `scryfallId` for Scryfall integration
  - `identifiers` (JSON: mtgoId, tcgplayerId, etc.)
  - `availability` (paper, arena, mtgo)
  - `foreignData` (JSON array of translations)
  - `relatedCards` (JSON: tokens, meld pairs, etc.)
  - `isFoil`, `isNonFoil`, `isPromo`
  - `frameVersion`, `borderColor`

### Prices
- TCGplayer pricing data (low, mid, market)
- Foil and non-foil prices
- Updated daily via auto-sync
- Historical tracking ready

### Sets
- Magic set information
- Set name, code, release date
- Type (core, expansion, masters, etc.)
- Block information

### Decks
- User's deck metadata
- Format, name, description
- Foreign key to users (CASCADE delete)
- Created/updated timestamps

### Deck Cards
- Junction table for deck composition
- Quantity, mainboard/sideboard flag
- Commander flag for Commander format
- References specific printing by UUID-mapped ID
- Foreign key CASCADE ensures data integrity

### Deck Shares
- Public sharing tokens (UUID v4)
- Active/inactive status
- Created timestamp
- Foreign key to decks

### Migrations Applied
The database includes 12 migrations:
1. Initial schema (users, cards, printings, decks, deck_cards, api_keys)
2. Pricing and sets tables
3. Rulings table
4. Deck sharing functionality
5. Scryfall IDs
6. Type arrays (supertypes, types, subtypes)
7. Related cards (tokens, transforms, etc.)
8. Leadership skills (Commander)
9. Identifiers (MTGO, TCGplayer, etc.)
10. Foreign data (translations)
11. EDHREC metadata
12. Admin users flag

All migrations are idempotent and tracked in `schema_migrations` table.

## Development

### Adding New Features

1. **Backend**: Add routes in `src/routes/`, services in `src/services/`
2. **Frontend**: Add components in `client/src/components/`
3. **Database**: Create migration in `src/db/migrations/`

### Running Tests

```bash
# Backend tests (when available)
npm test

# Frontend tests (when available)
cd client && npm test
```

## Docker Build Optimization

The Dockerfile uses multi-stage builds to minimize image size:

1. **Frontend Builder**: Builds the Vite frontend
2. **Backend Builder**: Installs production dependencies
3. **Final Image**: Alpine-based Node.js with only runtime files

Final image size: ~150MB (compared to ~800MB without optimization)

## Admin User Setup

On first startup, you can create an initial admin user via environment variables:

```bash
# Set these in docker-compose.yml or .env
ADMIN_USERNAME=admin
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=changeme123
```

The admin user is created automatically if it doesn't exist. After logging in as admin:

1. Go to **Settings** > **User Management**
2. View all users, promote/demote admins, delete accounts
3. Use **Backup & Restore** to export/import all user data

**Security Note**: Change the default admin password immediately after first login!

## Backup & Restore

Admins can backup and restore all user data from the Settings page.

### Creating a Backup

1. Log in as an admin user
2. Go to **Settings** > **Backup & Restore**
3. Click **Download Backup**
4. Save the JSON file to a safe location

Backups include:
- All users and their credentials
- All decks and deck cards (using stable UUIDs)
- API keys
- Deck sharing tokens
- Admin status for each user

**Note**: Backups do NOT include card database (MTGJSON data) - that's auto-imported.

### Restoring from Backup

1. Log in as an admin user
2. Go to **Settings** > **Backup & Restore**
3. Click **Restore from Backup**
4. Select your backup JSON file
5. Choose whether to:
   - **Overwrite** existing data (replaces everything)
   - **Merge** with existing data (may create duplicates)
6. Review the restore results

After restoration, decks will automatically link to the correct card printings using UUIDs.

## Environment Variables

Complete list of environment variables you can set in `.env` or `docker-compose.yml`:

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `PORT` | `3000` | No | Port for the web server to listen on |
| `NODE_ENV` | `development` | No | Environment mode (`development` or `production`) |
| `DATABASE_PATH` | `./data/deck-lotus.db` | No | Path to SQLite database file |
| `JWT_SECRET` | - | **Yes** | Secret key for signing JWT tokens (use a long random string) |
| `JWT_EXPIRES_IN` | `7d` | No | How long JWT access tokens are valid (e.g., `7d`, `24h`) |
| `JWT_REFRESH_EXPIRES_IN` | `30d` | No | How long refresh tokens are valid |
| `MTGJSON_URL` | (auto-detected) | No | Custom MTGJSON download URL (rarely needed) |
| `FORCE_REIMPORT` | `false` | No | Force complete database reimport on startup. Set to `true` to clear and reimport all MTGJSON data. **User decks are automatically preserved using UUIDs!** |
| `ADMIN_USERNAME` | `admin` | No | Username for initial admin account (created on first startup) |
| `ADMIN_EMAIL` | `admin@example.com` | No | Email for initial admin account |
| `ADMIN_PASSWORD` | `changeme123` | No | Password for initial admin account (**change this immediately!**) |

### Important Notes

**JWT_SECRET**: This is the only **required** variable. Generate a secure random string:
```bash
# Generate a secure JWT secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

**FORCE_REIMPORT**: When set to `true`, completely clears and reimports all card data from MTGJSON. This is useful for:
- Getting the latest card data and pricing
- Fixing corrupted card database
- Updating to new MTGJSON schema versions

**Important**: User decks, users, and API keys are automatically backed up and restored using stable UUIDs, so you won't lose your data!

**Admin Credentials**: The initial admin user is only created if:
1. No user with that username exists yet
2. The environment variables are set

After first login, **immediately change the admin password** in the user profile!

### Example .env File

```env
# Server Configuration
PORT=3000
NODE_ENV=production

# Database
DATABASE_PATH=./data/deck-lotus.db

# Security (REQUIRED - change this!)
JWT_SECRET=your-super-secret-random-string-here-at-least-64-characters-long
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d

# Admin User (created on first startup)
ADMIN_USERNAME=admin
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=changeme123

# Database Import (optional)
FORCE_REIMPORT=false
```

### Example docker-compose.yml

```yaml
version: '3.8'
services:
  deck-lotus:
    image: deck-lotus:latest
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - JWT_SECRET=${JWT_SECRET:-your-secret-key-here}
      - ADMIN_USERNAME=${ADMIN_USERNAME:-admin}
      - ADMIN_EMAIL=${ADMIN_EMAIL:-admin@example.com}
      - ADMIN_PASSWORD=${ADMIN_PASSWORD:-changeme123}
      - FORCE_REIMPORT=${FORCE_REIMPORT:-false}
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

## Troubleshooting

### Database Issues

```bash
# Reset database
rm data/deck-lotus.db
npm run init-db
npm run import-cards
```

### User Decks Disappeared After Reimport

If you lost your decks after running FORCE_REIMPORT:

**This has been fixed!** The import script now preserves user decks using UUIDs.

To prevent data loss:
1. Always create backups before reimporting (Settings > Backup & Restore)
2. The new FORCE_REIMPORT feature automatically backs up and restores deck data
3. Existing deployments should update to the latest version

To recover (if you have a backup):
1. Log in as admin
2. Go to Settings > Backup & Restore
3. Upload your backup file
4. Choose "Overwrite" if you want to replace everything
5. Your decks will be restored with correct card references

### Card Import Fails

Ensure bzip2 is installed:
```bash
# macOS
brew install bzip2

# Ubuntu/Debian
sudo apt-get install bzip2

# Alpine (Docker)
apk add bzip2
```

### Port Already in Use

Change the port in `.env`:
```env
PORT=3001
```

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - see LICENSE file for details

## Credits

- Card data provided by [MTGJSON](https://mtgjson.com/)
- Built with Node.js, Express, and Vite

## Recent Updates & Changelog

### Latest Features

**User Experience**:
- ✨ User profile with Gravatar support and colorful initials fallback
- 📊 User statistics dashboard (deck count, card count, API keys, shared decks)
- 🎨 Modern animated dropdown menu for user profile
- 🔄 Real-time stats updates

**Deck Management**:
- 📥 Import decks from Moxfield, Arena, MTGO, and plain text formats
- 📤 Export decks to multiple formats with set codes
- 🔗 Share decks publicly with unique URLs
- 💰 TCGplayer integration for deck pricing and purchasing
- ⚡ Improved deck builder performance

**Card Browsing**:
- 🔍 Advanced filtering system (colors, types, CMC, sets)
- 📑 Smart sorting options (name, CMC, color, price, random)
- 🖼️ Card preview on hover
- 💵 Real-time price display for all printings

**Enhanced Card Data** (MTGJSON):
- 🆔 Scryfall IDs for all printings
- 📋 Structured type arrays (supertypes, types, subtypes)
- 🔗 Related cards tracking (tokens, transforms, meld pairs)
- 👑 Commander leadership skills
- 🌍 Foreign language data
- 📈 EDHREC metadata (rank, salt score)
- 🎮 Multiple identifiers (MTGO, TCGplayer, etc.)

**Admin Features**:
- 👥 User management (view, promote/demote, delete)
- 💾 Backup & restore all user data
- 🔄 Manual database sync trigger
- 🛡️ Role-based access control
- 🔐 Protected admin endpoints

**Technical Improvements**:
- ✅ UUID-based deck preservation during FORCE_REIMPORT
- 🏗️ 12 database migrations for enhanced functionality
- 🔒 Admin middleware protection
- 📦 Improved error handling
- ⚡ Performance optimizations

### Migration Guide

If you're upgrading from an older version:

1. **Backup your data** before upgrading
2. Pull the latest code: `git pull origin main`
3. Rebuild Docker image: `docker-compose build`
4. Start container: `docker-compose up -d`
5. Database migrations run automatically on startup

**Important**: User decks are now preserved during reimports using UUIDs. If you lost decks in a previous version, restore from a backup via the admin panel.

## Support

For issues and questions:
- Open an issue on GitHub
- Check existing issues for solutions
- Read the troubleshooting section above

## Roadmap

Planned features for future releases:
- 📱 Mobile app (React Native)
- 🎯 Deck recommendations and suggestions
- 📈 Price history tracking and alerts
- 🤝 Deck collaboration and comments
- 🏆 Tournament tracking
- 📊 Advanced deck analytics
- 🔄 Archidekt integration
- 🎲 Goldfish playtesting

---

**Deck Lotus** - Build decks with style! 🌸

Made with ❤️ for the Magic: The Gathering community.
