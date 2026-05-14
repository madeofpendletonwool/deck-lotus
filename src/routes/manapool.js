import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { isConfigured, optimizeCart, validateDeck, getCardInfoBulk } from '../services/manaPoolService.js';

const router = express.Router();

router.get('/status', authenticate, (req, res) => {
  res.json({ configured: isConfigured() });
});

// Proxy to POST /buyer/optimizer
// Body: { items: [{ name, quantity, condition?, foil? }], model? }
router.post('/optimize', authenticate, async (req, res, next) => {
  try {
    const { items, model } = req.body;
    if (!items?.length) return res.status(400).json({ error: 'items array is required' });
    const result = await optimizeCart(items, model || 'lowest_price');
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Proxy to POST /deck
// Body: { decklist, format? }
router.post('/validate-deck', authenticate, async (req, res, next) => {
  try {
    const { decklist, format } = req.body;
    if (!decklist) return res.status(400).json({ error: 'decklist is required' });
    const result = await validateDeck(decklist, format || 'commander');
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Proxy to POST /card_info
// Body: { names: string[] }
router.post('/card-info', authenticate, async (req, res, next) => {
  try {
    const { names } = req.body;
    if (!names?.length) return res.status(400).json({ error: 'names array is required' });
    const result = await getCardInfoBulk(names);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
