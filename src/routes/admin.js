import express from 'express';
import { runSync, getSyncStatus } from '../services/syncService.js';
import { createBackup, restoreBackup } from '../services/backupService.js';
import { getAllUsers, updateUser, deleteUser } from '../services/authService.js';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/adminAuth.js';

const router = express.Router();

/**
 * POST /api/admin/sync
 * Trigger manual database sync (admin only)
 */
router.post('/sync', authenticate, requireAdmin, async (req, res, next) => {
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
 * Get sync status (admin only)
 */
router.get('/sync-status', authenticate, requireAdmin, (req, res, next) => {
  try {
    const status = getSyncStatus();
    res.json(status);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/backup
 * Create a backup of user data (admin only)
 * Optional query param: userId (if not provided, backs up all users)
 */
router.post('/backup', authenticate, requireAdmin, (req, res, next) => {
  try {
    const userId = req.query.userId ? parseInt(req.query.userId) : null;

    // Only allow users to backup their own data unless they're admin
    // For now, we'll allow any authenticated user to backup their own data
    const backupUserId = userId || req.user.id;

    const backup = createBackup(backupUserId);

    // Set headers for file download
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="deck-lotus-backup-${new Date().toISOString().split('T')[0]}.json"`);

    res.json(backup);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/restore
 * Restore user data from a backup (admin only)
 * Body: { backup: {...}, overwrite: boolean }
 */
router.post('/restore', authenticate, requireAdmin, (req, res, next) => {
  try {
    const { backup, overwrite = false } = req.body;

    if (!backup || !backup.data) {
      return res.status(400).json({ error: 'Invalid backup data' });
    }

    // Admins can restore any user's data, or all users
    const results = restoreBackup(backup, {
      overwrite,
      userId: null // Restore all users in the backup
    });

    res.json({
      success: true,
      message: 'Backup restored successfully',
      results
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/users
 * Get all users (admin only)
 */
router.get('/users', authenticate, requireAdmin, (req, res, next) => {
  try {
    const users = getAllUsers();
    res.json({ users });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/admin/users/:id
 * Update user (admin only)
 * Body: { username?, email?, is_admin? }
 */
router.put('/users/:id', authenticate, requireAdmin, (req, res, next) => {
  try {
    const userId = parseInt(req.params.id);
    const updates = req.body;

    // Prevent admin from removing their own admin status
    if (userId === req.user.id && updates.is_admin === 0) {
      return res.status(400).json({ error: 'Cannot remove your own admin status' });
    }

    const success = updateUser(userId, updates);

    if (!success) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User updated successfully' });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/admin/users/:id
 * Delete user (admin only)
 */
router.delete('/users/:id', authenticate, requireAdmin, (req, res, next) => {
  try {
    const userId = parseInt(req.params.id);

    // Prevent admin from deleting themselves
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const success = deleteUser(userId);

    if (!success) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    next(error);
  }
});

export default router;
