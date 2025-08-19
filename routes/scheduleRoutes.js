const express = require('express');
const router = express.Router();

const {
  createSchedule,
  getSchedulesForTeacher,
  getSchedulesForStudent,
  cancelSchedule,
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

module.exports = router;
