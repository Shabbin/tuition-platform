const upload = require('../middleware/upload');
const express = require('express');
const { register } = require('../controllers/authController');  // Import the register function
const { login } = require('../controllers/authController');
const router = express.Router();

// Define the POST route for registration
router.post('/register',upload.single('profileImage'), register);
router.post('/login', login);
module.exports = router;
