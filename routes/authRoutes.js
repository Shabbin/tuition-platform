const express = require('express');
const { register, login } = require('../controllers/authController');
const upload = require('../middleware/upload');
const studentRoutes = require('./studentRoutes');
const teacherRoutes = require('./teacherRoutes');
const router = express.Router();

// Register and login routes
router.post('/register', upload.single('profileImage'), register);
router.post('/login', login);

// Use the student and teacher routes
router.use('/student', studentRoutes);
router.use('/teacher', teacherRoutes);

module.exports = router;
