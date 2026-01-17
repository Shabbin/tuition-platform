const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const jwt = require('jsonwebtoken');
const User = require('../models/user');

// Auth controllers
const { register, login } = require('../controllers/authController');

// Middleware to authenticate using JWT in cookie
function authenticateToken(req, res, next) {
  console.log('COOKIES:', req.cookies); // <-- add this
  const token = req.cookies?.token;

  if (!token) return res.status(401).json({ message: 'Not authenticated' });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ message: 'Invalid token' });
    req.user = decoded;
    next();
  });
}

// 📌 Auth endpoints
router.post('/register', upload.single('profileImage'), register);
router.post('/login', login);

// GET current logged-in user info
router.get('/me', authenticateToken, async (req, res) => {
  try {
    console.log('✅ /me route hit');
    console.log('👉 req.user from token:', req.user);

    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });

    res.json({ user });
  } catch (err) {
    console.error('❌ Error in /me route:', err);
    res.status(500).json({ message: 'Server error' });
  }
});


// Logout user by clearing the token cookie
const isProduction = process.env.NODE_ENV === 'production';

router.post('/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: isProduction, // true in prod, false locally
    sameSite: isProduction ? 'none' : 'lax', // none for prod (cross-site), lax for localhost
    path: '/',
  });
  res.json({ message: 'Logged out successfully' });
});


// 📌 Feature routes (modularized by role or resource)
router.use('/student', require('./studentRoutes'));
router.use('/teacher', require('./teacherRoutes'));
router.use('/posts', require('./teacherPostRoutes')); // All users can view posts
router.use('/sessions', require('./sessionRequest')); // Route to create session requests

module.exports = router;
