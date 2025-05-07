const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { createPost, getAllPosts } = require('../controllers/teacherPostController');

// Teacher (eligible) creates a post
router.post('/', auth('teacher'), createPost);

// Anyone (students, guests) can view posts
router.get('/', getAllPosts);

module.exports = router;
