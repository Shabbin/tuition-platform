// server/routes/scheduleRoutes.js
const express = require('express');
const router = express.Router();

const {
  createSchedule,
  getSchedulesForTeacher,
  getSchedulesForStudent,
  cancelSchedule,
  getEligibleStudents,
  completeSchedule, // NEW
} = require('../controllers/scheduleController');

const auth = require('../middleware/auth');

// Teacher creates schedules
router.post('/', auth('teacher'), createSchedule);

// Teacher views their schedules
router.get('/teacher', auth('teacher'), getSchedulesForTeacher);

// Student views their schedules
router.get('/student', auth('student'), getSchedulesForStudent);

// Teacher cancels a schedule
router.put('/:id/cancel', auth('teacher'), cancelSchedule);

// Mark a demo schedule completed (attended)
router.patch('/:id/complete', auth('teacher'), completeSchedule);

// Teacher fetches eligible students for a post
// GET /api/schedules/eligible-students?postId=...&type=demo|regular
router.get('/eligible-students', auth('teacher'), getEligibleStudents);

module.exports = router;
