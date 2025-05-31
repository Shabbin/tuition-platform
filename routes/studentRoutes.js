const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/user');
const { getEligibleTeachers } = require('../controllers/studentController');

// ⬇️ Import models if they exist
// const TuitionRequest = require('../models/tuitionRequest');
// const Booking = require('../models/booking');
// const Session = require('../models/session');

// ✅ GET: Full student dashboard
router.get('/dashboard', auth('student'), async (req, res) => {
  try {
    const student = await User.findById(req.user.userId).select('-password');

    // Get top 5 eligible teachers (dummy rating sort for now)
    const topRatedTeachers = await User.find({ role: 'teacher', isEligible: true })
      .sort({ createdAt: -1 }) // You can change this to `.sort({ rating: -1 })` once you add ratings
      .limit(5)
      .select('name subject profileImage isEligible');

    // TODO: Fetch student-specific data from other models
    const myRequests = []; // await TuitionRequest.find({ studentId: req.user.userId });
    const mySchedule = []; // await Session.find({ studentId: req.user.userId });
    const myBookings = []; // await Booking.find({ studentId: req.user.userId });

    return res.status(200).json({
      message: 'Welcome to the student dashboard',
      student,
      topRatedTeachers,
      myRequests,
      mySchedule,
      myBookings,
      news: [] // Placeholder
    });
  } catch (error) {
    console.error('Error in student dashboard:', error.message);
    return res.status(500).json({ message: 'Failed to load student dashboard' });
  }
});

// ✅ GET: View eligible teachers
router.get('/teachers', auth('student'), getEligibleTeachers);

module.exports = router;
