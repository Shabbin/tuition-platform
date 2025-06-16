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
} = require('../controllers/teacherPostController');

// ✅ Create new post (eligible teachers only)
router.post('/', auth('teacher'), upload.single('file'), createPost);

// ✅ Get all public posts
router.get('/', getAllPosts);

// ✅ Get posts belonging to the logged-in teacher (secure)
router.get('/mine', auth('teacher'), async (req, res, next) => {
  try {
    const posts = await require('../models/teacherPost').find({ teacher: req.user.userId }).sort({ createdAt: -1 });
    res.json(posts);
  } catch (err) {
    next(err);
  }
});

// ✅ Get all posts by a specific teacher
router.get('/teacher/:teacherId/subject/:subjectName', getTeacherPostBySubject);
router.get('/teacher/:teacherId', getPostsByTeacher);
router.get('/mine', auth('teacher'), getMyPosts);
// ✅ Get post by ID (must be after more specific routes)
router.get('/:postId', getPostById);

// ✅ Update post by ID
router.put('/:postId', auth('teacher'), updatePost);

// ✅ Delete post by ID
router.delete('/:id', auth('teacher'), deleteTeacherPost);

module.exports = router;
