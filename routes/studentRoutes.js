const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { getEligibleTeachers } = require('../controllers/studentController');

// ✅ GET: Student dashboard (protected route)
router.get('/dashboard', auth('student'), (req, res) => {
  res.json({
    message: 'Welcome, student!',
    user: {
      id: req.user.userId,
      role: req.user.role,
      email: req.user.email
    }
  });
});

// ✅ GET: View eligible teachers (only visible to students)
router.get('/teachers', auth('student'), getEligibleTeachers);

module.exports = router;
