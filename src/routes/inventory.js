import express from 'express';
import {
  getInventory,
  getInventoryStats,
  getInventoryIndex,
  searchCardsForInventoryAdd,
  bulkAddToInventory,
  getOwnedSets,
  addScannedBatch,
} from '../services/inventoryService.js';
import { setOwnedPrintingQuantity, parseFinish } from '../services/cardService.js';
import { getContestedCards } from '../services/collectionService.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/inventory
 * Get paginated inventory list with filters
 */
router.get('/', authenticate, (req, res, next) => {
  try {
    const {
      name,
      colors,
      type,
      sets,
      finish,
      sort,
      availability,
      page = 1,
      limit = 50
    } = req.query;

    const filters = {
      name,
      colors: colors ? colors.split(',') : [],
      type,
      sets: sets ? sets.split(',') : [],
      finish: finish || 'all',
      sort: sort || 'name',
      availability: availability || 'all',
      page: parseInt(page),
      limit: parseInt(limit)
    };

    const result = getInventory(req.user.id, filters);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/inventory/index[?cards=1,2]
 * The whole collection, for searching and filtering in the browser, or just some cards of it
 */
router.get('/index', authenticate, (req, res, next) => {
  try {
    const cardIds = req.query.cards ? String(req.query.cards).split(',').map(Number).filter(Number.isInteger) : null;
    res.json(getInventoryIndex(req.user.id, { cardIds }));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/inventory/stats
 * Get collection statistics
 */
router.get('/stats', authenticate, (req, res, next) => {
  try {
    const stats = getInventoryStats(req.user.id);
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/inventory/contested
 * Cards two or more of your decks want more copies of than you own
 */
router.get('/contested', authenticate, (req, res, next) => {
  try {
    res.json(getContestedCards(req.user.id));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/inventory/search
 * Quick-add search
 */
router.get('/search', authenticate, (req, res, next) => {
  try {
    const { q, limit = 10 } = req.query;

    if (!q || q.length < 2) {
      return res.json({ cards: [] });
    }

    const cards = searchCardsForInventoryAdd(req.user.id, q, parseInt(limit));
    res.json({ cards });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/inventory/sets
 * Get sets that the user owns cards from
 */
router.get('/sets', authenticate, (req, res, next) => {
  try {
    const sets = getOwnedSets(req.user.id);
    res.json({ sets });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/inventory/bulk-add
 * Bulk import cards to inventory
 */
router.post('/bulk-add', authenticate, (req, res, next) => {
  try {
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items array is required' });
    }

    const result = bulkAddToInventory(req.user.id, items);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/inventory/quick-add
 * Quick-add a single card to inventory
 */
router.post('/quick-add', authenticate, (req, res, next) => {
  try {
    const { printingId, quantity = 1 } = req.body;

    if (!printingId) {
      return res.status(400).json({ error: 'printingId is required' });
    }

    const result = setOwnedPrintingQuantity(req.user.id, printingId, quantity, parseFinish(req.body.finish));
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/inventory/scans
 * Cards scanned by the Android app: { batchId, items: [{ scryfallId, finish, quantity }],
 * deckId?, board?, collection? }. With deckId they go in that deck too (or only, with
 * collection: false). Safe to retry with the same batchId; the cards are only added once.
 */
router.post('/scans', authenticate, (req, res, next) => {
  try {
    const { batchId, items, deckId, board, collection } = req.body;
    res.json(addScannedBatch(req.user.id, batchId, items, { deckId, board, collection }));
  } catch (error) {
    next(error);
  }
});

export default router;
