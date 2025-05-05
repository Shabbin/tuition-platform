const upload = require('../middleware/upload');
const express = require('express');
const { register } = require('../controllers/authController');  // Import the register function
const { login } = require('../controllers/authController');
const router = express.Router();
const auth = require('../middleware/auth');
// Define the POST route for registration
router.post('/register',upload.single('profileImage'), register);
router.post('/login', login);
router.get('/student/dashboard', auth('student'), (req, res) => {
    res.json({ message: 'Welcome Student', user: req.user });
  });
  
  router.get('/teacher/dashboard', auth('teacher'), (req, res) => {
    res.json({ message: 'Welcome Teacher', user: req.user });
  });
module.exports = router;
