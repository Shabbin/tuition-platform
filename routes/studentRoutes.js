const express = require('express');
const auth = require('../middleware/auth');
const router = express.Router();

// Route protected by the 'student' role
router.get('/dashboard', auth('student'), (req, res) => {
  res.json({ message: 'Welcome Student', user: req.user });
});

module.exports = router;
