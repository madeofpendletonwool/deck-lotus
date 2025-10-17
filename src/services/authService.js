import bcrypt from 'bcrypt';
import crypto from 'crypto';
import db from '../db/connection.js';
import { generateTokens } from '../utils/jwt.js';
import { isValidEmail, isValidUsername, isValidPassword, sanitizeInput } from '../utils/validators.js';

const SALT_ROUNDS = 10;

/**
 * Register a new user
 */
export async function registerUser(username, email, password) {
  username = sanitizeInput(username);
  email = sanitizeInput(email);

  // Validate inputs
  if (!isValidUsername(username)) {
    throw new Error('Invalid username. Must be 3-20 characters, alphanumeric and underscores only.');
  }
  if (!isValidEmail(email)) {
    throw new Error('Invalid email format.');
  }
  if (!isValidPassword(password)) {
    throw new Error('Password must be at least 8 characters long.');
  }

  // Check if user already exists
  const existingUser = db.get(
    'SELECT id FROM users WHERE username = ? OR email = ?',
    [username, email]
  );

  if (existingUser) {
    throw new Error('Username or email already exists.');
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  // Insert user
  const result = db.run(
    'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
    [username, email, passwordHash]
  );

  const userId = result.lastInsertRowid;

  // Generate tokens
  const tokens = generateTokens({ userId, username });

  return {
    user: { id: userId, username, email },
    ...tokens,
  };
}

/**
 * Login user
 */
export async function loginUser(usernameOrEmail, password) {
  const user = db.get(
    'SELECT id, username, email, password_hash FROM users WHERE username = ? OR email = ?',
    [usernameOrEmail, usernameOrEmail]
  );

  if (!user) {
    throw new Error('Invalid credentials.');
  }

  // Verify password
  const isValidPassword = await bcrypt.compare(password, user.password_hash);

  if (!isValidPassword) {
    throw new Error('Invalid credentials.');
  }

  // Generate tokens
  const tokens = generateTokens({ userId: user.id, username: user.username });

  return {
    user: { id: user.id, username: user.username, email: user.email },
    ...tokens,
  };
}

/**
 * Generate API key for user
 */
export function generateApiKey(userId, keyName) {
  // Generate random API key
  const apiKey = crypto.randomBytes(32).toString('hex');
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

  // Store hashed key in database
  db.run(
    'INSERT INTO api_keys (user_id, key_hash, name) VALUES (?, ?, ?)',
    [userId, keyHash, keyName]
  );

  // Return the plain API key (only time it's visible)
  return apiKey;
}

/**
 * Validate API key and return user
 */
export function validateApiKey(apiKey) {
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

  const result = db.get(
    `SELECT ak.id as key_id, ak.user_id, u.username, u.email
     FROM api_keys ak
     JOIN users u ON ak.user_id = u.id
     WHERE ak.key_hash = ?`,
    [keyHash]
  );

  if (result) {
    // Update last_used timestamp
    db.run('UPDATE api_keys SET last_used = CURRENT_TIMESTAMP WHERE id = ?', [result.key_id]);
  }

  return result;
}

/**
 * Get user's API keys
 */
export function getUserApiKeys(userId) {
  return db.all(
    'SELECT id, name, last_used, created_at FROM api_keys WHERE user_id = ?',
    [userId]
  );
}

/**
 * Revoke API key
 */
export function revokeApiKey(userId, keyId) {
  const result = db.run(
    'DELETE FROM api_keys WHERE id = ? AND user_id = ?',
    [keyId, userId]
  );

  return result.changes > 0;
}

/**
 * Get user by ID
 */
export function getUserById(userId) {
  const user = db.get(
    'SELECT id, username, email, created_at FROM users WHERE id = ?',
    [userId]
  );

  return user;
}
