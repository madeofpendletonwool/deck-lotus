import express from 'express';
import { runSync, getSyncStatus } from '../services/syncService.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

/**
 * POST /api/admin/sync
 * Trigger manual database sync
 */
router.post('/sync', authenticate, async (req, res, next) => {
  try {
    const result = await runSync();
    res.json(result);
  } catch (error) {
    if (error.message === 'Sync already in progress') {
      return res.status(409).json({ error: error.message });
    }
    next(error);
  }
});

/**
 * GET /api/admin/sync-status
 * Get sync status
 */
router.get('/sync-status', authenticate, (req, res, next) => {
  try {
    const status = getSyncStatus();
    res.json(status);
  } catch (error) {
    next(error);
  }
});

export default router;
