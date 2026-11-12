import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { getSettings } from '../services/settingsService.js';
import { getPointsList } from '../services/deckService.js';

const router = express.Router();

/**
 * GET /api/formats/canlander-points
 * The Canadian Highlander points list the server checks against, for showing points per card.
 */
router.get('/canlander-points', authenticate, (req, res, next) => {
  try {
    const list = getPointsList();
    res.json({
      points: Object.fromEntries(list),
      count: list.size,
      updatedAt: getSettings().canlanderPointsUpdatedAt || null,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
