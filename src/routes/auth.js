import express from 'express';
import {
  registerUser,
  loginUser,
  generateApiKey,
  getUserApiKeys,
  revokeApiKey,
  getUserById,
} from '../services/authService.js';
import { authenticate } from '../middleware/auth.js';
import { verifyToken, generateTokens } from '../utils/jwt.js';
import db from '../db/connection.js';

const router = express.Router();

/**
 * POST /api/auth/register
 * Register a new user
 */
router.post('/register', async (req, res, next) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required' });
    }

    const result = await registerUser(username, email, password);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/login
 * Login user
 */
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = await loginUser(username, password);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
router.post('/refresh', (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token is required' });
    }

    const decoded = verifyToken(refreshToken);

    if (!decoded) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    // Generate new tokens
    const tokens = generateTokens({ userId: decoded.userId, username: decoded.username });
    res.json(tokens);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get('/me', authenticate, (req, res, next) => {
  try {
    const user = getUserById(req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/auth/stats
 * Get current user statistics
 */
router.get('/stats', authenticate, (req, res, next) => {
  try {
    // Get deck count
    const deckCount = db.get(
      'SELECT COUNT(*) as count FROM decks WHERE user_id = ?',
      [req.user.id]
    );

    // Get total cards across all decks
    const cardCount = db.get(
      `SELECT SUM(dc.quantity) as count
       FROM deck_cards dc
       JOIN decks d ON dc.deck_id = d.id
       WHERE d.user_id = ?`,
      [req.user.id]
    );

    // Get API key count
    const apiKeyCount = db.get(
      'SELECT COUNT(*) as count FROM api_keys WHERE user_id = ?',
      [req.user.id]
    );

    // Get shared deck count
    const sharedDeckCount = db.get(
      `SELECT COUNT(DISTINCT ds.deck_id) as count
       FROM deck_shares ds
       JOIN decks d ON ds.deck_id = d.id
       WHERE d.user_id = ? AND ds.is_active = 1`,
      [req.user.id]
    );

    res.json({
      stats: {
        deckCount: deckCount.count || 0,
        cardCount: cardCount.count || 0,
        apiKeyCount: apiKeyCount.count || 0,
        sharedDeckCount: sharedDeckCount.count || 0
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/auth/api-keys
 * Get user's API keys
 */
router.get('/api-keys', authenticate, (req, res, next) => {
  try {
    const keys = getUserApiKeys(req.user.id);
    res.json({ apiKeys: keys });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/api-keys
 * Generate new API key
 */
router.post('/api-keys', authenticate, (req, res, next) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'API key name is required' });
    }

    const apiKey = generateApiKey(req.user.id, name);

    res.status(201).json({
      apiKey,
      message: 'API key generated successfully. Save it now, it will not be shown again.',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/auth/api-keys/:id
 * Revoke API key
 */
router.delete('/api-keys/:id', authenticate, (req, res, next) => {
  try {
    const keyId = parseInt(req.params.id);
    const success = revokeApiKey(req.user.id, keyId);

    if (!success) {
      return res.status(404).json({ error: 'API key not found' });
    }

    res.json({ message: 'API key revoked successfully' });
  } catch (error) {
    next(error);
  }
});

export default router;
