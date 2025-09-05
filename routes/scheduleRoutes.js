// server/routes/scheduleRoutes.js
const express = require('express');
const router = express.Router();

const {
  createSchedule,
  getSchedulesForTeacher,
  getSchedulesForStudent,   // supports ?from=&to= (ISO strings), defaults to ±30 days
  cancelSchedule,
  getEligibleStudents,
  completeSchedule,         // NEW
  cancelScheduleByStudent,  // ✅ NEW
  // 👇 ADDED for agreement flow
  acceptProposedSchedule,
  rejectProposedSchedule,
  respondSchedule,               // 👈 NEW
  listPendingForStudent,
} = require('../controllers/scheduleController');

const auth = require('../middleware/auth');

// Teacher creates schedules
router.post('/', auth('teacher'), createSchedule);

// Teacher views their schedules
router.get('/teacher', auth('teacher'), getSchedulesForTeacher);

// Student views their schedules (now accepts optional ?from=&to=)
router.get('/student', auth('student'), getSchedulesForStudent);

// Teacher cancels a schedule
router.put('/:id/cancel', auth('teacher'), cancelSchedule);

// ✅ Student leaves/cancels their participation (or cancels if lone)
router.put('/:id/cancel-by-student', auth('student'), cancelScheduleByStudent);

// Mark a demo schedule completed (attended)
router.patch('/:id/complete', auth('teacher'), completeSchedule);

// Teacher fetches eligible students for a post
// GET /api/schedules/eligible-students?postId=...&type=demo|regular
router.get('/eligible-students', auth('teacher'), getEligibleStudents);

// ========= Agreement flow (regular classes) =========
// Student accepts a proposed schedule (status: 'proposed' → 'scheduled')
router.patch('/:id/accept', auth('student'), acceptProposedSchedule);

// Student rejects a proposed schedule (status: 'proposed' → 'cancelled')
router.patch('/:id/reject', auth('student'), rejectProposedSchedule);

// NEW: agreement endpoints
router.put('/:id/respond', auth('student'), respondSchedule);
router.get('/student/pending', auth('student'), listPendingForStudent);

// ====================================================

module.exports = router;
