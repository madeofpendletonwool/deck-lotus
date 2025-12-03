import express from 'express';
import { getShoppingList } from '../services/shoppingService.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/shopping
 * Get shopping list for selected decks
 * Query params: deckIds (comma-separated list of deck IDs)
 */
router.get('/', authenticate, (req, res, next) => {
  try {
    const deckIdsParam = req.query.deckIds;
    let deckIds = [];

    if (deckIdsParam) {
      deckIds = deckIdsParam.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
    }

    const shoppingList = getShoppingList(req.user.id, deckIds);
    res.json(shoppingList);
  } catch (error) {
    next(error);
  }
});

export default router;
