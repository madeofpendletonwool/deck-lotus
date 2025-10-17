import { verifyToken } from '../utils/jwt.js';
import { validateApiKey } from '../services/authService.js';

/**
 * Authentication middleware - supports JWT and API key
 */
export function authenticate(req, res, next) {
  // Check for JWT token in Authorization header
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    if (decoded) {
      req.user = {
        id: decoded.userId,
        username: decoded.username,
      };
      return next();
    }
  }

  // Check for API key in X-API-Key header
  const apiKey = req.headers['x-api-key'];

  if (apiKey) {
    const user = validateApiKey(apiKey);

    if (user) {
      req.user = {
        id: user.user_id,
        username: user.username,
        email: user.email,
      };
      return next();
    }
  }

  // No valid authentication found
  return res.status(401).json({ error: 'Authentication required' });
}

/**
 * Optional authentication - doesn't fail if no auth provided
 */
export function optionalAuthenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    if (decoded) {
      req.user = {
        id: decoded.userId,
        username: decoded.username,
      };
    }
  } else {
    const apiKey = req.headers['x-api-key'];

    if (apiKey) {
      const user = validateApiKey(apiKey);

      if (user) {
        req.user = {
          id: user.user_id,
          username: user.username,
          email: user.email,
        };
      }
    }
  }

  next();
}
