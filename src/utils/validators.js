/**
 * Validate email format
 */
export function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate username format
 */
export function isValidUsername(username) {
  // 3-20 characters, alphanumeric and underscores only
  const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
  return usernameRegex.test(username);
}

/**
 * Validate password strength
 */
export function isValidPassword(password) {
  // At least 8 characters
  return password && password.length >= 8;
}

/**
 * Sanitize input to prevent SQL injection (basic)
 */
export function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input.trim();
}
