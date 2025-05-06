const express = require('express');
const auth = require('../middleware/auth');
const router = express.Router();
const User = require('../models/User'); // Assuming you're using this model
const { approveTeacherEligibility } = require('../controllers/teacherController');
// Teacher dashboard
router.get('/dashboard', auth('teacher'), async (req, res) => {
  try {
    const teacher = await User.findById(req.user.userId).select('name email role isEligible');
    if (!teacher) {
      return res.status(404).json({ message: 'Teacher not found' });
    }

    res.json({
      message: 'Welcome to the teacher dashboard',
      teacher,
      canApplyToTuitions: teacher.isEligible === true,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Tuition media ads (visible to all teachers)
router.get('/tuition-media', auth('teacher'), (req, res) => {
  // Dummy data for now
  res.json([
    { id: 1, title: 'Need Physics Teacher for Grade 11', subject: 'Physics' },
    { id: 2, title: 'Math Tutor Required (In-Person)', subject: 'Mathematics' },
  ]);
});

// Tuition application route (only for eligible teachers)
router.post('/apply/:mediaId', auth('teacher'), async (req, res) => {
  try {
    const teacher = await User.findById(req.user.userId);

    if (!teacher.isEligible) {
      return res.status(403).json({ message: 'You are not eligible to apply for tuitions yet' });
    }

    // Logic to apply to the tuition media with ID req.params.mediaId
    res.status(200).json({ message: `Applied to tuition media ID ${req.params.mediaId}` });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});
router.patch('/approve/:teacherId', approveTeacherEligibility);
module.exports = router;





