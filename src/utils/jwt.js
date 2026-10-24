import jwt from 'jsonwebtoken';

const KNOWN_DEFAULT_SECRETS = new Set([
  'your-secret-key-change-this-in-production',
  'change-this-to-a-long-random-secret',
]);

const JWT_SECRET = process.env.JWT_SECRET;

// A missing or published-default secret lets anyone forge tokens for any user, so refuse to start
if (!JWT_SECRET || KNOWN_DEFAULT_SECRETS.has(JWT_SECRET) || JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be set to a random value of at least 32 characters (e.g. `openssl rand -hex 32`).');
  process.exit(1);
}
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '30d';

/**
 * Generate access token
 */
export function generateAccessToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Generate refresh token
 */
export function generateRefreshToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_REFRESH_EXPIRES_IN });
}

/**
 * Verify and decode token
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

/**
 * Generate both access and refresh tokens
 */
export function generateTokens(payload) {
  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken(payload),
  };
}
