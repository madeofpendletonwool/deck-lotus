import express from 'express';
import { runSync, getSyncStatus } from '../services/syncService.js';
import {
  createBackup,
  restoreBackup,
  createScheduledBackup,
  listBackups,
  loadBackupFile,
  deleteBackupFile,
  configureScheduledBackups,
  getBackupConfig
} from '../services/backupService.js';
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
router.post('/backup', authenticate, (req, res, next) => {
  try {
    // Admins can backup all users or specific user, regular users only their own data
    const backupUserId = req.user.is_admin && req.query.userId
      ? parseInt(req.query.userId)
      : req.user.is_admin ? null : req.user.id;

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
router.post('/restore', authenticate, (req, res, next) => {
  try {
    const { backup, overwrite = false } = req.body;

    if (!backup || !backup.data) {
      return res.status(400).json({ error: 'Invalid backup data' });
    }

    // Admins can restore all users, regular users only their own data
    const restoreUserId = req.user.is_admin ? null : req.user.id;

    const results = restoreBackup(backup, {
      overwrite,
      userId: restoreUserId
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
 * GET /api/admin/backups
 * List all available backup files
 */
router.get('/backups', authenticate, (req, res, next) => {
  try {
    const backups = listBackups();
    res.json({ backups });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/backups/:filename
 * Download a specific backup file
 */
router.get('/backups/:filename', authenticate, (req, res, next) => {
  try {
    const { filename } = req.params;
    const backup = loadBackupFile(filename);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(backup);
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/admin/backups/:filename
 * Delete a backup file
 */
router.delete('/backups/:filename', authenticate, (req, res, next) => {
  try {
    const { filename } = req.params;
    deleteBackupFile(filename);
    res.json({ success: true, message: 'Backup deleted successfully' });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/backup/create
 * Manually create a scheduled backup
 */
router.post('/backup/create', authenticate, (req, res, next) => {
  try {
    const result = createScheduledBackup();
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/restore-from-file
 * Restore from a backup file in the backups directory
 * Body: { filename: string, overwrite: boolean }
 */
router.post('/restore-from-file', authenticate, (req, res, next) => {
  try {
    const { filename, overwrite = false } = req.body;

    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }

    const backup = loadBackupFile(filename);

    // Admins can restore all users, regular users only their own data
    const restoreUserId = req.user.is_admin ? null : req.user.id;

    const results = restoreBackup(backup, {
      overwrite,
      userId: restoreUserId
    });

    res.json({
      success: true,
      message: `Restored from ${filename}`,
      results
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/backup-config
 * Get backup schedule configuration
 */
router.get('/backup-config', authenticate, (req, res, next) => {
  try {
    const config = getBackupConfig();
    res.json(config);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/backup-config
 * Configure backup schedule
 * Body: { enabled: boolean, frequency: string, retainCount: number }
 */
router.post('/backup-config', authenticate, requireAdmin, (req, res, next) => {
  try {
    const config = configureScheduledBackups(req.body);
    res.json({
      success: true,
      message: 'Backup configuration updated',
      config
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
