import express from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  getWatches,
  createWatch,
  updateWatch,
  deleteWatch,
  getWatchHistory,
  runPriceChecks,
  getPriceCheckSchedule,
  setPriceCheckSchedule,
} from '../services/priceMonitoringService.js';
import { isConfigured as tcgConfigured } from '../services/tcgplayerService.js';
import { isConfigured as manaPoolConfigured } from '../services/manaPoolService.js';
import { isConfigured as ntfyConfigured } from '../services/notificationService.js';

const router = express.Router();

router.get('/status', authenticate, (req, res) => {
  res.json({
    tcgplayer: tcgConfigured(),
    manapool: manaPoolConfigured(),
    ntfy: ntfyConfigured(),
    schedule: process.env.PRICE_CHECK_SCHEDULE || '0 */6 * * *',
  });
});

router.get('/', authenticate, (req, res, next) => {
  try {
    res.json(getWatches(req.user.id));
  } catch (err) {
    next(err);
  }
});

router.post('/', authenticate, (req, res, next) => {
  try {
    const watch = createWatch(req.user.id, {
      cardName: req.body.card_name,
      maxPrice: req.body.max_price,
      condition: req.body.condition,
      notes: req.body.notes,
      expiresAt: req.body.expires_at,
      cardId: req.body.card_id,
      scryfallId: req.body.scryfall_id,
      imageUrl: req.body.image_url,
      setCode: req.body.set_code,
      setName: req.body.set_name,
    });
    res.status(201).json(watch);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', authenticate, (req, res, next) => {
  try {
    const watch = updateWatch(req.user.id, parseInt(req.params.id), {
      maxPrice: req.body.max_price,
      condition: req.body.condition,
      notes: req.body.notes,
      expiresAt: req.body.expires_at,
      isActive: req.body.is_active,
    });
    res.json(watch);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', authenticate, (req, res, next) => {
  try {
    deleteWatch(req.user.id, parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/history', authenticate, (req, res, next) => {
  try {
    const history = getWatchHistory(req.user.id, parseInt(req.params.id));
    res.json(history);
  } catch (err) {
    next(err);
  }
});

// Manually trigger a price check run (checks all active watches for this server)
router.post('/check-now', authenticate, async (req, res, next) => {
  try {
    const results = await runPriceChecks();
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

router.get('/schedule', authenticate, (req, res) => {
  res.json({ schedule: getPriceCheckSchedule() });
});

router.post('/schedule', authenticate, (req, res, next) => {
  try {
    const { schedule } = req.body;
    if (!schedule) return res.status(400).json({ error: 'schedule is required' });
    setPriceCheckSchedule(schedule);
    res.json({ schedule });
  } catch (err) {
    next(err);
  }
});

export default router;
