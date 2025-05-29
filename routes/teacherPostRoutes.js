const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ dest: 'uploads/' }); // or configure memory storage as needed

const auth = require('../middleware/auth');
const {
  createPost,
  getAllPosts
} = require('../controllers/teacherPostController');

// ✅ POST: Create a new post (only by eligible teachers)
router.post('/', auth('teacher'), upload.single('file'), createPost);

// ✅ GET: Public route - fetch all teacher posts
router.get('/', getAllPosts);

module.exports = router;
