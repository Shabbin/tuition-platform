// server/routes/routineRoutes.js
const express = require('express');
const router = express.Router();

const {
  createRoutine,
  listMine,
  setStatus,
  remove,
  preview,
  listForStudent, // 👈 add this import
  acceptRoutine,
  rejectRoutine,
  respondRoutine,       // 👈 NEW
  listPendingRoutinesForStudent, // New
} = require('../controllers/routineController');

const auth = require('../middleware/auth');

// Teacher creates routines
router.post('/', auth('teacher'), createRoutine);

// Teacher lists own routines
router.get('/mine', auth('teacher'), listMine);

// Teacher updates routine status
router.patch('/:id/status', auth('teacher'), setStatus);

// Teacher deletes a routine
router.delete('/:id', auth('teacher'), remove);

// Preview nextRunAt for given slots
router.post('/preview', auth('teacher'), preview);

// Student lists routines they’re part of
router.get('/student', auth('student'), listForStudent); // 👈 your existing line, now defined

// student accepts/rejects a proposed routine
router.put('/:id/accept', auth('student'), acceptRoutine);
router.put('/:id/reject', auth('student'), rejectRoutine);
// NEW: agreement endpoints
router.put('/:id/respond', auth('student'), respondRoutine);
router.get('/student/pending', auth('student'), listPendingRoutinesForStudent);
module.exports = router;
