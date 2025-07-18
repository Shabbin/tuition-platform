//routes\teacherRequestRoutes.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const teacherRequestController = require('../controllers/teacherRequestController');

// Create a new request (student)
router.post('/', auth('student'), teacherRequestController.createRequest);

// Get all requests for student
router.get('/student', auth('student'), teacherRequestController.getRequestsForStudent);
router.get('/student/all', auth('student'), teacherRequestController.getAllRequestsForStudent);
// Get all requests for teacher
router.get('/teacher', auth('teacher'), teacherRequestController.getRequestsForTeacher);

// Approve or reject a request (teacher)
router.post('/:id/:action', auth('teacher'), teacherRequestController.updateRequestStatus);

module.exports = router;
