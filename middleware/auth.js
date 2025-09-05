// middleware/auth.js
const jwt = require('jsonwebtoken');

/**
 * Backward-compatible auth middleware.
 *
 * Supports:
 *   - auth                  (no roles)
 *   - auth()                (no roles, legacy style)
 *   - auth('teacher', ...)  (role-gated)
 *   - used directly by Express (app.use(auth))
 */
function makeAuth(requiredRoles = []) {
  return function authMiddleware(req, res, next) {
    try {
      // Let CORS preflights through
      if (req.method === 'OPTIONS') return res.sendStatus(200);

      // Accept token from cookie OR Authorization header
      const cookieToken = req?.cookies?.token;
      const authz = (req?.headers?.authorization || '').trim();
      const bearerToken = authz.startsWith('Bearer ') ? authz.slice(7) : null;

      const token = cookieToken || bearerToken;
      if (!token) {
        return res.status(401).json({ message: 'Unauthenticated: token missing' });
      }

      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
      } catch (e) {
        console.error('[auth] JWT verification failed:', e.message);
        return res.status(401).json({ message: 'Invalid or expired token' });
      }

      req.user = {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role,
        iat: decoded.iat,
        exp: decoded.exp,
      };

      // Optional role gate
      if (Array.isArray(requiredRoles) && requiredRoles.length > 0) {
        if (!requiredRoles.includes(req.user.role)) {
          return res.status(403).json({ message: 'Forbidden: insufficient permissions' });
        }
      }

      return next();
    } catch (err) {
      // Extremely defensive: only use res if it exists
      console.error('[auth] unexpected error:', err);
      if (res && typeof res.status === 'function') {
        try {
          return res.status(500).json({ message: 'Auth middleware error' });
        } catch (_) {}
      }
      // if res isn't available (shouldn't happen in Express pipeline), rethrow
      throw err;
    }
  };
}

/**
 * Export a function that can be:
 *   - called with roles => returns middleware
 *   - called with (req,res,next) by Express directly => runs middleware
 *   - called with no args => returns middleware (legacy auth())
 */
function auth(...args) {
  // No args => legacy `auth()` usage: return plain middleware
  if (args.length === 0) {
    return makeAuth([]);
  }

  // If looks like Express (req,res,next), execute immediately
  // (e.g., someone did `app.use(auth)` and Express invoked it)
  const [a, b, c] = args;
  const looksLikeExpress = a && b && c && typeof a === 'object' && typeof b === 'object' && typeof c === 'function';
  if (looksLikeExpress) {
    return makeAuth([])(a, b, c);
  }

  // Otherwise treat args as role names: auth('teacher','admin')
  return makeAuth(args);
}

module.exports = auth;
