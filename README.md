# Deck Lotus 🌸

A modern, self-hosted Magic: The Gathering deck builder with multi-user support, API key authentication, and a beautiful web interface.

## Features

- **Multi-User Support**: Secure user registration and authentication with JWT tokens
- **API Key Authentication**: Generate API keys for external integrations
- **Fast Card Search**: Real-time autocomplete search as you type
- **Deck Builder**: Intuitive interface for building and managing decks
- **Multiple Printings**: Choose specific card art and printings for your deck
- **Deck Statistics**: Visual mana curve, type distribution, and color analysis
- **Format Support**: Standard, Modern, Commander, Legacy, Vintage, Pauper
- **Mainboard & Sideboard**: Full support for mainboard and sideboard management
- **Self-Hosted**: Own your data with SQLite database
- **Dockerized**: Easy deployment with Docker and docker-compose
- **Database Flexibility**: Built with abstraction layer for future database options

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
2. Enter a deck name
3. Search for cards using the search box (autocomplete appears as you type)
4. Click a card to add it to your deck
5. Use +/- buttons to adjust quantities
6. Toggle between Mainboard and Sideboard tabs
7. View live statistics (mana curve, card types, colors)
8. Click "Save" to save your changes

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

#### Generate API Key
```http
POST /api/auth/api-keys
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "name": "My Integration"
}
```

### Card Endpoints

All card endpoints require authentication (JWT or API Key).

#### Search Cards
```http
GET /api/cards/search?q=lightning&limit=20
Authorization: Bearer <jwt-token>
```

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
- Hashed passwords with bcrypt

### API Keys
- API key generation and management
- SHA-256 hashed keys

### Cards
- Atomic card data (shared across all printings)
- Name, mana cost, colors, types, rules text

### Printings
- Set-specific card data
- Artist, collector number, set code, rarity
- Multiple printings per card

### Decks
- User's deck metadata
- Format, name, description

### Deck Cards
- Junction table for deck composition
- Quantity, mainboard/sideboard flag
- References specific card printing

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

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `NODE_ENV` | development | Environment (development/production) |
| `DATABASE_PATH` | ./data/deck-lotus.db | Path to SQLite database |
| `JWT_SECRET` | (required) | Secret key for JWT tokens |
| `JWT_EXPIRES_IN` | 7d | JWT token expiration |
| `JWT_REFRESH_EXPIRES_IN` | 30d | Refresh token expiration |
| `MTGJSON_URL` | (auto) | MTGJSON download URL |

## Troubleshooting

### Database Issues

```bash
# Reset database
rm data/deck-lotus.db
npm run init-db
npm run import-cards
```

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

## Support

For issues and questions:
- Open an issue on GitHub
- Check existing issues for solutions

---

**Deck Lotus** - Build decks with style! 🌸
