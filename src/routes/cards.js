import express from 'express';
import {
  searchCards,
  getCardById,
  getCardByName,
  getCardPrintings,
  getPrintingByUuid,
  getRandomCards,
  getCardStats,
  getAllSubtypes,
  browseCards,
  toggleCardOwnership,
  getUserOwnedCards,
  getCardOwnershipStatus,
  getCardOwnedPrintings,
  setOwnedPrintingQuantity,
  getCardOwnershipAndUsage,
} from '../services/cardService.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/cards/browse
 * Browse cards with filters, sorting, and pagination
 */
router.get('/browse', authenticate, (req, res, next) => {
  try {
    const { name, colors, type, rarities, sort, sets, subtypes, cmcMin, cmcMax, page = 1, limit = 50, onlyOwned } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = browseCards({
      name,
      colors: colors ? colors.split(',') : [],
      type,
      rarities: rarities ? rarities.split(',') : [],
      sort: sort || 'random',
      sets: sets ? sets.split(',') : [],
      subtypes: subtypes ? subtypes.split(',') : [],
      cmcMin: cmcMin ? parseInt(cmcMin) : null,
      cmcMax: cmcMax ? parseInt(cmcMax) : null,
      onlyOwned: onlyOwned === 'true',
      userId: req.user.id,
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
 * GET /api/cards/subtypes
 * Get all unique subtypes
 */
router.get('/subtypes', authenticate, (req, res, next) => {
  try {
    const subtypes = getAllSubtypes();
    res.json({ subtypes });
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

/**
 * POST /api/cards/:id/owned
 * Toggle card ownership for the authenticated user
 */
router.post('/:id/owned', authenticate, (req, res, next) => {
  try {
    const cardId = parseInt(req.params.id);
    const userId = req.user.id;

    const result = toggleCardOwnership(userId, cardId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/cards/owned
 * Get all owned cards for the authenticated user
 */
router.get('/owned/all', authenticate, (req, res, next) => {
  try {
    const userId = req.user.id;
    const ownedCards = getUserOwnedCards(userId);
    res.json({ ownedCards });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/cards/:id/owned
 * Check if a specific card is owned by the authenticated user
 */
router.get('/:id/owned', authenticate, (req, res, next) => {
  try {
    const cardId = parseInt(req.params.id);
    const userId = req.user.id;

    const status = getCardOwnershipStatus(userId, cardId);
    res.json(status);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/cards/:id/ownership-usage
 * Get comprehensive ownership and deck usage info for a card
 */
router.get('/:id/ownership-usage', authenticate, (req, res, next) => {
  try {
    const cardId = parseInt(req.params.id);
    const userId = req.user.id;

    const data = getCardOwnershipAndUsage(userId, cardId);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/cards/printings/:printingId/quantity
 * Set owned quantity for a specific printing
 */
router.post('/printings/:printingId/quantity', authenticate, (req, res, next) => {
  try {
    const printingId = parseInt(req.params.printingId);
    const userId = req.user.id;
    const { quantity } = req.body;

    if (quantity === undefined || quantity === null) {
      return res.status(400).json({ error: 'Quantity is required' });
    }

    const result = setOwnedPrintingQuantity(userId, printingId, parseInt(quantity));
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
