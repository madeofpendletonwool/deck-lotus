import express from 'express';
import {
  getUserDecks,
  getDeckById,
  createDeck,
  updateDeck,
  deleteDeck,
  addCardToDeck,
  updateDeckCard,
  removeCardFromDeck,
  getDeckStats,
} from '../services/deckService.js';
import { getDeckPrice } from '../services/pricingService.js';
import { parseDeckList, importDeck } from '../services/importService.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/decks
 * Get all decks for current user
 */
router.get('/', authenticate, (req, res, next) => {
  try {
    const decks = getUserDecks(req.user.id);
    res.json({ decks });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/decks
 * Create new deck
 */
router.post('/', authenticate, (req, res, next) => {
  try {
    const { name, format, description } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Deck name is required' });
    }

    const deck = createDeck(req.user.id, name, format, description);
    res.status(201).json({ deck });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/decks/:id
 * Get deck by ID
 */
router.get('/:id', authenticate, (req, res, next) => {
  try {
    const deckId = parseInt(req.params.id);
    const deck = getDeckById(deckId, req.user.id);

    if (!deck) {
      return res.status(404).json({ error: 'Deck not found' });
    }

    res.json({ deck });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/decks/:id
 * Update deck
 */
router.put('/:id', authenticate, (req, res, next) => {
  try {
    const deckId = parseInt(req.params.id);
    const { name, format, description } = req.body;

    const deck = updateDeck(deckId, req.user.id, { name, format, description });
    res.json({ deck });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/decks/:id
 * Delete deck
 */
router.delete('/:id', authenticate, (req, res, next) => {
  try {
    const deckId = parseInt(req.params.id);
    const success = deleteDeck(deckId, req.user.id);

    if (!success) {
      return res.status(404).json({ error: 'Deck not found' });
    }

    res.json({ message: 'Deck deleted successfully' });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/decks/:id/stats
 * Get deck statistics
 */
router.get('/:id/stats', authenticate, (req, res, next) => {
  try {
    const deckId = parseInt(req.params.id);
    const stats = getDeckStats(deckId, req.user.id);

    if (!stats) {
      return res.status(404).json({ error: 'Deck not found' });
    }

    res.json(stats);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/decks/:id/price
 * Get deck total price
 */
router.get('/:id/price', authenticate, (req, res, next) => {
  try {
    const deckId = parseInt(req.params.id);
    const price = getDeckPrice(deckId);
    res.json(price);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/decks/:id/cards
 * Add card to deck
 */
router.post('/:id/cards', authenticate, (req, res, next) => {
  try {
    const deckId = parseInt(req.params.id);
    const { printingId, quantity, isSideboard, isCommander } = req.body;

    if (!printingId) {
      return res.status(400).json({ error: 'printingId is required' });
    }

    const deck = addCardToDeck(
      deckId,
      req.user.id,
      printingId,
      quantity || 1,
      isSideboard || false,
      isCommander || false
    );

    res.json({ deck });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/decks/:id/cards/:cardId
 * Update card in deck
 */
router.put('/:id/cards/:cardId', authenticate, (req, res, next) => {
  try {
    const deckId = parseInt(req.params.id);
    const deckCardId = parseInt(req.params.cardId);
    const { quantity, isSideboard, isCommander } = req.body;

    const deck = updateDeckCard(deckId, req.user.id, deckCardId, {
      quantity,
      isSideboard,
      isCommander,
    });

    res.json({ deck });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/decks/:id/cards/:cardId
 * Remove card from deck
 */
router.delete('/:id/cards/:cardId', authenticate, (req, res, next) => {
  try {
    const deckId = parseInt(req.params.id);
    const deckCardId = parseInt(req.params.cardId);

    const deck = removeCardFromDeck(deckId, req.user.id, deckCardId);

    res.json({ deck });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/decks/import
 * Import deck from text
 */
router.post('/import', authenticate, (req, res, next) => {
  try {
    const { name, format, deckList } = req.body;

    if (!name || !deckList) {
      return res.status(400).json({ error: 'Name and deck list are required' });
    }

    // Parse deck list
    const cardList = parseDeckList(deckList);

    if (cardList.length === 0) {
      return res.status(400).json({ error: 'No valid cards found in deck list' });
    }

    // Import deck
    const result = importDeck(req.user.id, name, format, cardList);

    // Return the created deck
    const deck = getDeckById(result.deckId, req.user.id);

    res.status(201).json({
      deck,
      imported: result.imported,
      notFound: result.notFound,
      message: `Successfully imported ${result.imported} cards${result.notFound > 0 ? ` (${result.notFound} not found)` : ''}`
    });
  } catch (error) {
    next(error);
  }
});

export default router;
