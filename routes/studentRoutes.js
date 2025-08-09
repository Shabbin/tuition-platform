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
    const student = await User.findById(req.user.id)
      .select('name email profileImage')
      .lean();

    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const topRatedTeachers = await User.find({ role: 'teacher', isEligible: true })
      .sort({ createdAt: -1 }) // or rating once available
      .limit(5)
      .select('name profileImage')
      .lean();

    const myRequests = [];
    const mySchedule = [];
    const myBookings = [];
    const news = [];

    const user = {
      id: req.user.id,
      role: req.user.role,
      iat: req.user.iat,
      exp: req.user.exp,
    };

    return res.status(200).json({
      message: 'Welcome to the student dashboard',
      student,
      user,
      topRatedTeachers,
      myRequests,
      mySchedule,
      myBookings,
      news,
    });
  } catch (error) {
    console.error('Error in student dashboard:', error.message);
    return res.status(500).json({ message: 'Failed to load student dashboard' });
  }
});




// ✅ GET: View eligible teachers
router.get('/teachers', auth('student'), getEligibleTeachers);

module.exports = router;
