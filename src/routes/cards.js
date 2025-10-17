import express from 'express';
import {
  searchCards,
  getCardById,
  getCardByName,
  getCardPrintings,
  getPrintingByUuid,
  getRandomCards,
  getCardStats,
  browseCards,
} from '../services/cardService.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/cards/browse
 * Browse cards with filters, sorting, and pagination
 */
router.get('/browse', authenticate, (req, res, next) => {
  try {
    const { name, colors, type, sort, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = browseCards({
      name,
      colors: colors ? colors.split(',') : [],
      type,
      sort: sort || 'random',
      limit: parseInt(limit),
      offset
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/cards/search
 * Search cards by name (autocomplete)
 */
router.get('/search', authenticate, (req, res, next) => {
  try {
    const { q, limit } = req.query;

    if (!q || q.length < 2) {
      return res.json({ cards: [] });
    }

    const cards = searchCards(q, limit ? parseInt(limit) : 20);
    res.json({ cards });
  } catch (error) {
    next(error);
  }
});


/**
 * GET /api/cards/random
 * Get random cards
 */
router.get('/random', authenticate, (req, res, next) => {
  try {
    const { count } = req.query;
    const cards = getRandomCards(count ? parseInt(count) : 10);
    res.json({ cards });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/cards/stats
 * Get card statistics
 */
router.get('/stats', authenticate, (req, res, next) => {
  try {
    const stats = getCardStats();
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/cards/:id
 * Get card by ID with all printings
 */
router.get('/:id', authenticate, (req, res, next) => {
  try {
    const cardId = parseInt(req.params.id);
    const card = getCardById(cardId);

    if (!card) {
      return res.status(404).json({ error: 'Card not found' });
    }

    res.json({ card });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/cards/:id/printings
 * Get all printings for a card
 */
router.get('/:id/printings', authenticate, (req, res, next) => {
  try {
    const cardId = parseInt(req.params.id);
    const printings = getCardPrintings(cardId);
    res.json({ printings });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/cards/name/:name
 * Get card by exact name
 */
router.get('/name/:name', authenticate, (req, res, next) => {
  try {
    const card = getCardByName(req.params.name);

    if (!card) {
      return res.status(404).json({ error: 'Card not found' });
    }

    res.json({ card });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/cards/printing/:uuid
 * Get specific printing by UUID
 */
router.get('/printing/:uuid', authenticate, (req, res, next) => {
  try {
    const printing = getPrintingByUuid(req.params.uuid);

    if (!printing) {
      return res.status(404).json({ error: 'Printing not found' });
    }

    res.json({ printing });
  } catch (error) {
    next(error);
  }
});

export default router;
