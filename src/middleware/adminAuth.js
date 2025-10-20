/**
 * Middleware to check if the authenticated user is an admin
 * Must be used after the authenticate middleware
 */
export function requireAdmin(req, res, next) {
  // Check if user is authenticated
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Check if user is an admin
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  next();
}
