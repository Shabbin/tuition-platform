const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');

// Auth controllers
const { register, login } = require('../controllers/authController');

// Nested routes
const studentRoutes = require('./studentRoutes');
const teacherRoutes = require('./teacherRoutes');
const sessionRequestRoutes = require('./sessionRequest'); // Include session routes
const postRoutes = require('./teacherPostRoutes'); // Include teacher post routes

// 📌 Auth endpoints
router.post('/register', upload.single('profileImage'), register);
router.post('/login', login);

// 📌 Feature routes (modularized by role or resource)
router.use('/student', studentRoutes);
router.use('/teacher', teacherRoutes);
router.use('/posts', postRoutes); // All users can view posts
router.use('/sessions', sessionRequestRoutes); // Route to create session requests

module.exports = router;
