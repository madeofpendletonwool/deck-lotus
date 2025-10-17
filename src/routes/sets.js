import express from 'express';
import { getAllSets, getSetByCode, getSetCards, searchSets } from '../services/setService.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/sets
 * Get all sets
 */
router.get('/', authenticate, (req, res, next) => {
  try {
    const sets = getAllSets();
    res.json({ sets });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/sets/search
 * Search sets
 */
router.get('/search', authenticate, (req, res, next) => {
  try {
    const { q } = req.query;
    const sets = searchSets(q || '');
    res.json({ sets });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/sets/:code
 * Get set by code
 */
router.get('/:code', authenticate, (req, res, next) => {
  try {
    const set = getSetByCode(req.params.code);
    if (!set) {
      return res.status(404).json({ error: 'Set not found' });
    }
    res.json({ set });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/sets/:code/cards
 * Get cards in a set
 */
router.get('/:code/cards', authenticate, (req, res, next) => {
  try {
    const { page = 1, limit = 100 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = getSetCards(req.params.code, parseInt(limit), offset);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
