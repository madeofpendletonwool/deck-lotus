import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
// import rateLimit from 'express-rate-limit'; // Removed - not needed for self-hosted app
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { runMigrations, closeDb, getDb } from './db/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

import authRoutes from './routes/auth.js';
import cardRoutes from './routes/cards.js';
import deckRoutes from './routes/decks.js';
import setRoutes from './routes/sets.js';
import adminRoutes from './routes/admin.js';
import { setupDailySync } from './services/syncService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Rate limiting - REMOVED for self-hosted app
// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 100, // limit each IP to 100 requests per windowMs
//   standardHeaders: true,
//   legacyHeaders: false,
// });

// Middleware
app.use(helmet({
  contentSecurityPolicy: false  // Disable CSP for self-hosted app to avoid localhost/IP issues
})); // Security headers
app.use(cors()); // CORS
app.use(compression()); // Gzip compression
app.use(express.json()); // JSON body parser
// app.use(limiter); // Rate limiting - REMOVED for self-hosted app

// Serve static files from client build (in production)
// IMPORTANT: Must come before API routes to serve assets correctly
if (process.env.NODE_ENV === 'production') {
  const clientBuildPath = join(__dirname, '../client/dist');
  app.use(express.static(clientBuildPath));
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/cards', cardRoutes);
app.use('/api/decks', deckRoutes);
app.use('/api/sets', setRoutes);
app.use('/api/admin', adminRoutes);

// SPA catch-all route (MUST be last)
if (process.env.NODE_ENV === 'production') {
  const clientBuildPath = join(__dirname, '../client/dist');
  app.get('*', (req, res) => {
    res.sendFile(join(clientBuildPath, 'index.html'));
  });
}

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Initialize database and start server
async function start() {
  try {
    console.log('Initializing database...');
    await runMigrations();
    console.log('✓ Database initialized');

    // Check if we need to import card data
    const db = getDb();
    const cardCount = db.prepare('SELECT COUNT(*) as count FROM cards').get();
    const priceCount = db.prepare('SELECT COUNT(*) as count FROM prices').get();
    const setCount = db.prepare('SELECT COUNT(*) as count FROM sets').get();

    const needsImport = cardCount.count === 0 || priceCount.count === 0 || setCount.count === 0;

    if (needsImport) {
      console.log('\n⚠️  Missing data detected. Importing from MTGJSON...');
      console.log(`   Cards: ${cardCount.count}, Prices: ${priceCount.count}, Sets: ${setCount.count}`);
      console.log('   This is a one-time process and may take several minutes.');

      try {
        // Dynamic import of the import script
        const { fileURLToPath } = await import('url');
        const { dirname, join } = await import('path');
        const { execSync } = await import('child_process');

        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const scriptPath = join(__dirname, '../scripts/import-mtgjson.js');

        // Run import script
        execSync(`node "${scriptPath}"`, { stdio: 'inherit' });
        console.log('✓ Data imported successfully');
      } catch (error) {
        console.error('⚠️  Failed to auto-import data:', error.message);
        console.log('   You can manually import later by running: node scripts/import-mtgjson.js');
      }
    } else {
      console.log(`✓ Found ${cardCount.count} cards, ${priceCount.count} prices, ${setCount.count} sets in database`);
    }

    // Setup daily sync schedule
    setupDailySync();

    app.listen(PORT, () => {
      console.log(`\n🚀 Deck Lotus server running on port ${PORT}`);
      console.log(`   Health check: http://localhost:${PORT}/health`);
      console.log(`   API: http://localhost:${PORT}/api`);

      if (process.env.NODE_ENV === 'development') {
        console.log(`\n📝 Development mode enabled`);
      }
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\nSIGTERM signal received: closing HTTP server');
  closeDb();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nSIGINT signal received: closing HTTP server');
  closeDb();
  process.exit(0);
});

start();
