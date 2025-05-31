const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');

const {
  approveTeacherEligibility,
  getTeacherProfileWithPosts,
  updateProfilePicture,
  updateCoverImage,
  updateProfileInfo,
} = require('../controllers/teacherController');

const User = require('../models/user');
const Post = require('../models/teacherPost'); // Make sure you have this model
const Session = require('../models/sessionRequest'); // Optional: only if you use sessions

// ✅ GET: Teacher dashboard (now includes posts and upcoming sessions)
router.get('/dashboard', auth('teacher'), async (req, res) => {
  try {
    const teacher = await User.findById(req.user.userId).select('name email role isEligible profileImage hasPaid');

    if (!teacher) {
      return res.status(404).json({ message: 'Teacher not found' });
    }

    // Get teacher's posts
    const teacherPosts = await Post.find({ teacher: teacher._id }).sort({ createdAt: -1 });

    // Optional: Get upcoming sessions
    let upcomingSessions = [];
    try {
      upcomingSessions = await Session.find({
        teacher: teacher._id,
        date: { $gte: new Date() },
      }).sort({ date: 1 });
    } catch (sessionErr) {
      console.warn('Skipping upcomingSessions — model or query failed:', sessionErr.message);
    }

    res.json({
      message: 'Welcome to the teacher dashboard',
      teacher: {
        _id: teacher._id,
        name: teacher.name,
        email: teacher.email,
        role: teacher.role,
        isEligible: teacher.isEligible,
        hasPaid: teacher.hasPaid || false, // in case it's not in DB
        profileImage: teacher.profileImage,
      },
      canApplyToTuitions: teacher.isEligible && teacher.hasPaid,
      teacherPosts,
      upcomingSessions,
    });
  } catch (err) {
    console.error('Error fetching teacher dashboard:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ GET: Tuition media listings (visible to teachers)
router.get('/tuition-media', auth('teacher'), (req, res) => {
  const mockAds = [
    { id: 1, title: 'Need Physics Teacher for Grade 11', subject: 'Physics' },
    { id: 2, title: 'Math Tutor Required (In-Person)', subject: 'Mathematics' },
  ];
  res.json(mockAds);
});

// ✅ POST: Apply to tuition ad (only if eligible)
router.post('/apply/:mediaId', auth('teacher'), async (req, res) => {
  try {
    const teacher = await User.findById(req.user.userId);

    if (!teacher || !teacher.isEligible) {
      return res.status(403).json({ message: 'You are not eligible to apply for tuitions yet' });
    }

    // TODO: Replace with real application logic
    res.status(200).json({ message: `Applied to tuition media ID ${req.params.mediaId}` });
  } catch (err) {
    console.error('Error applying to tuition media:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ GET: Public teacher profile with posts
router.get('/:id/profile', getTeacherProfileWithPosts);

// ✅ PATCH: Manually approve a teacher
router.patch('/approve/:teacherId', approveTeacherEligibility);

// ✅ PUT: Update profile picture
router.put('/profile-picture', auth('teacher'), upload.single('profileImage'), updateProfilePicture);

// ✅ PUT: Update cover image
router.put('/cover-image', auth('teacher'), upload.single('coverImage'), updateCoverImage);

// ✅ PUT: Update profile info (text fields)
router.put('/profile-info', auth('teacher'), updateProfileInfo);

module.exports = router;
