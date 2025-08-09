// middleware/auth.js
const jwt = require('jsonwebtoken');

const auth = (...allowedRoles) => {
  return (req, res, next) => {
    const token = req.cookies?.token; // 🔐 Get token from cookie

    if (!token) {
      return res.status(401).json({ message: 'Access token missing in cookies' });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      if (allowedRoles.length && !allowedRoles.includes(decoded.role)) {
        return res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
      }

      req.user = decoded; // Attach decoded user to request
      next();
    } catch (error) {
      console.error('JWT verification failed:', error.message);
      return res.status(401).json({ message: 'Invalid or expired token' });
    }
  };
};

module.exports = auth;
