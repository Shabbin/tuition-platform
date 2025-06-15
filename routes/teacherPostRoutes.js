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
  deleteTeacherPost
} = require('../controllers/teacherPostController');

// ✅ Create new post (eligible teachers only)
router.post('/', auth('teacher'), upload.single('file'), createPost);

// ✅ Get all public posts
router.get('/', getAllPosts);

// ✅ Get post by ID (must be before dynamic teacher routes)
router.get('/:postId', getPostById);

// ✅ Get all posts by a teacher
router.get('/teacher/:teacherId', getPostsByTeacher);

// ✅ Get specific teacher post by subject
router.get('/teacher/:teacherId/subject/:subjectName', getTeacherPostBySubject);
router.put('/:postId', auth('teacher'), updatePost);
router.delete('/:id',auth('teacher') , deleteTeacherPost);
module.exports = router;
