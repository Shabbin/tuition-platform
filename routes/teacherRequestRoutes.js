// routes/teacherRequestRoutes.js
const express = require('express');
const router = express.Router();

// --- auth can be exported as a function or { auth }
const authMod = require('../middleware/auth');
const auth = typeof authMod === 'function' ? authMod : authMod?.auth;

// --- controller (support both CommonJS and default export)
const ctrlMod = require('../controllers/teacherRequestController');
const ctrl = ctrlMod?.default || ctrlMod;

// safe fallback so the app boots even if a handler is missing
const nope = (name) => (req, res) => {
  console.error(`[teacherRequestRoutes] Missing handler: ${name}`);
  res.status(500).json({ message: `Handler "${name}" not implemented.` });
};

// pick handlers or fallback
const createRequest             = ctrl.createRequest             || nope('createRequest');
const createRequestFromPost     = ctrl.createRequestFromPost     || nope('createRequestFromPost');
const getRequestsForTeacher     = ctrl.getRequestsForTeacher     || nope('getRequestsForTeacher');
const updateRequestStatus       = ctrl.updateRequestStatus       || nope('updateRequestStatus');
const getRequestsForStudent     = ctrl.getRequestsForStudent     || nope('getRequestsForStudent');
const getAllRequestsForStudent  = ctrl.getAllRequestsForStudent  || nope('getAllRequestsForStudent');
const getApprovedStudentsForPost= ctrl.getApprovedStudentsForPost|| nope('getApprovedStudentsForPost');

// helpful boot log
console.log('[teacherRequestRoutes] Loaded controller keys:', Object.keys(ctrl));

// ===== Student creates a request (direct)
router.post('/', auth('student'), createRequest);

// ===== Student creates a request FROM a post
router.post('/from-post/:postId', auth('student'), createRequestFromPost);

// ===== Teacher: list my requests
router.get('/teacher', auth('teacher'), getRequestsForTeacher);

// ===== Teacher: approve / reject  (NO inline regex!)
router.patch('/:id/approve', auth('teacher'), (req, res, next) => {
  req.params.action = 'approve';
  return updateRequestStatus(req, res, next);
});

router.patch('/:id/reject', auth('teacher'), (req, res, next) => {
  req.params.action = 'reject';
  return updateRequestStatus(req, res, next);
});

// ===== Student: list my requests (all)
router.get('/student', auth('student'), getAllRequestsForStudent);

// ===== Student: list my APPROVED requests
router.get('/student/approved', auth('student'), getRequestsForStudent);

// ===== Teacher: approved students for a post (?postId=...)
router.get('/approved-students', auth('teacher'), getApprovedStudentsForPost);

module.exports = router;
