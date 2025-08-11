const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

const auth = require('../middleware/auth');
const {
  createPost,
  getAllPosts,
  getPostsByTeacher,
  getTeacherPostBySubject,
  getPostById,
  updatePost,
  deleteTeacherPost,
  getMyPosts,
  incrementPostView,
  getRecentViewEvents ,
} = require('../controllers/teacherPostController');

// Create new post (authenticated & authorized teacher)
router.post('/', auth('teacher'), upload.single('file'), createPost);

// Get all public posts (no auth)
router.get('/', getAllPosts);

// Get posts by logged-in teacher (secure)
router.get('/mine', auth('teacher'), getMyPosts);

// Get posts by a specific teacher and subject
router.get('/teacher/:teacherId/subject/:subjectName', getTeacherPostBySubject);

// Get all posts by a specific teacher
router.get('/teacher/:teacherId', getPostsByTeacher);

// Get post by ID (should be after more specific routes)
router.get('/:postId', getPostById);


// POST /api/posts/:postId/view - increment view count
router.post('/:postId/view', incrementPostView);

// Update post by ID (authenticated & authorized teacher)
router.put('/:postId', auth('teacher'), updatePost);

router.get('/recent-views/:teacherId', getRecentViewEvents);

// Delete post by ID (authenticated & authorized teacher)
router.delete('/:id', auth('teacher'), deleteTeacherPost);

module.exports = router;
