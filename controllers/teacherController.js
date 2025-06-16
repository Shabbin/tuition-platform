const User = require('../models/user');
const TuitionPost = require('../models/teacherPost');
const delay = require('../utils/delay');

// ==============================
// MANUALLY APPROVE TEACHER
// ==============================
const approveTeacherEligibility = async (req, res) => {
  try {
    const { teacherId } = req.params;

    const teacher = await User.findById(teacherId);
    if (!teacher || teacher.role !== 'teacher') {
      return res.status(404).json({ message: 'Teacher not found' });
    }

    teacher.isEligible = true;
    await teacher.save();

    res.status(200).json({ message: 'Teacher marked as eligible', teacher });
  } catch (error) {
    console.error('Eligibility approval error:', error.message);
    res.status(500).json({ message: 'Error approving teacher eligibility' });
  }
};

// ==============================
// GET TEACHER PROFILE + POSTS
// ==============================
const getTeacherProfileWithPosts = async (req, res) => {
  try {
    const teacherId = req.params.id;
    const teacher = await User.findById(teacherId).select('-password');

    if (!teacher || teacher.role !== 'teacher') {
      return res.status(404).json({ message: 'Teacher not found or not a teacher' });
    }

    const posts = await TuitionPost.find({ teacher: teacherId });
    res.json({ teacher, posts });
  } catch (err) {
    console.error('Error fetching teacher profile:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// UPDATE PROFILE PICTURE
// ==============================
const updateProfilePicture = async (req, res) => {
  try {
    const teacher = await User.findById(req.user.userId);

    if (!teacher || teacher.role !== 'teacher') {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    teacher.profileImage = imageUrl;
    await teacher.save();

    await delay(1500); // optional delay simulation
    res.status(200).json({
      message: 'Profile picture updated successfully',
      profileImage: teacher.profileImage,
    });
  } catch (err) {
    console.error('Profile picture update error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// UPDATE COVER IMAGE
// ==============================
const updateCoverImage = async (req, res) => {
  try {
    const teacherId = req.user.userId;

    const teacher = await User.findById(teacherId);
    if (!teacher || teacher.role !== 'teacher') {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const coverImageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    teacher.coverImage = coverImageUrl;
    await teacher.save();

    await delay(1500);
    res.status(200).json({ message: 'Cover image updated', coverImage: teacher.coverImage });
  } catch (error) {
    console.error('Error updating cover image:', error);
    res.status(500).json({ message: 'Failed to update cover image' });
  }
};

// ==============================
// UPDATE PROFILE INFO
// ==============================
const updateProfileInfo = async (req, res) => {
  try {
    const teacher = await User.findById(req.user.userId);
    if (!teacher || teacher.role !== 'teacher') {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const { name, bio, hourlyRate, skills, location, availability } = req.body;

    if (name) teacher.name = name;
    if (bio) teacher.bio = bio;
    if (hourlyRate) teacher.hourlyRate = hourlyRate;
    if (skills) teacher.skills = Array.isArray(skills) ? skills : skills.split(',').map(s => s.trim());
    if (location) teacher.location = location;
    if (availability) teacher.availability = availability;

    await teacher.save();
    res.json({ message: 'Profile updated successfully', user: teacher });
  } catch (err) {
    console.error('Update profile info error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  approveTeacherEligibility,
  getTeacherProfileWithPosts,
  updateProfilePicture,
  updateCoverImage,
  updateProfileInfo
};
