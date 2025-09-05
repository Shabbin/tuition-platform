// server/routes/privateCourseRoutes.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const ctrl = require('../controllers/privateCourseController');

// Create a new private course + send invites
router.post('/', auth('teacher'), ctrl.createPrivateCourse);

// Invite more students to an existing private course
router.post('/:postId/invite', auth('teacher'), ctrl.inviteMoreToPrivateCourse);

// Teacher views their private courses
router.get('/teacher', auth('teacher'), ctrl.listTeacherPrivateCourses);

// Student views invites
router.get('/student', auth('student'), ctrl.listStudentPrivateCourseInvites);

// Student accepts/declines
router.post('/:courseId/respond', auth('student'), ctrl.respondInvite);

module.exports = router;
