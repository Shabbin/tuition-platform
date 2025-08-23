const express = require('express');
const router = express.Router();

const {
  createSchedule,
  getSchedulesForTeacher,
  getSchedulesForStudent,
  cancelSchedule,
  getEligibleStudents, // ✅ NEW: returns approved students split by paid/unpaid
} = require('../controllers/scheduleController');

const auth = require('../middleware/auth'); // <-- same as teacherPostRoutes

// Teacher creates schedules
router.post('/', auth('teacher'), createSchedule);

// Teacher views their schedules
router.get('/teacher', auth('teacher'), getSchedulesForTeacher);

// Student views their schedules
router.get('/student', auth('student'), getSchedulesForStudent);

// Teacher cancels a schedule
router.put('/:id/cancel', auth('teacher'), cancelSchedule);

// ✅ NEW: Teacher fetches eligible students for a post
// GET /api/schedules/eligible-students?postId=...&type=demo|regular
router.get('/eligible-students', auth('teacher'), getEligibleStudents);

module.exports = router;
