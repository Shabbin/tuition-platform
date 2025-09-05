// server/routes/changeRequestRoutes.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

const {
  create,
  respond,
  cancel,
  listForTeacher,
  listForStudent,
} = require('../controllers/changeRequestController');

// anyone in the conversation (teacher or student) can create
router.post('/', auth(), create);

// accept / reject
router.post('/:id/respond', auth(), respond);

// cancel (creator only)
router.post('/:id/cancel', auth(), cancel);

// lists
router.get('/teacher', auth('teacher'), listForTeacher);
router.get('/student', auth('student'), listForStudent);

module.exports = router;
