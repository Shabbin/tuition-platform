// server/routes/routineChangeRoutes.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

const {
  createChangeRequest,
  respondChangeRequest,
  listOutgoingForTeacher,
  listIncomingForStudent,
} = require('../controllers/routineChangeController');

// teacher creates a one-off change proposal for students in a routine
router.post('/', auth('teacher'), createChangeRequest);

// student accepts/rejects a proposal
router.post('/:id/respond', auth('student'), respondChangeRequest);

// teacher’s sent proposals
router.get('/outgoing', auth('teacher'), listOutgoingForTeacher);

// student’s incoming proposals
router.get('/incoming', auth('student'), listIncomingForStudent);

module.exports = router;
