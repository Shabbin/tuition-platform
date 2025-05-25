const User = require('../models/user');
const TuitionPost = require('../models/teacherPost');
// Manually approve teacher eligibility
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
const getTeacherProfileWithPosts = async (req, res) => {
  try {
    const teacherId = req.params.id;
    console.log(teacherId)

    const teacher = await User.findById(teacherId).select('-password'); // Hide password
    if (!teacher || teacher.role !== 'teacher') {
      console.log(teacher)
      return res.status(404).json({ message: 'Teacher not found or not a teacher' });
    }

    const posts = await TuitionPost.find({ teacher: teacherId });

    res.json({ teacher, posts });
  } catch (err) {
    console.error('Error fetching teacher profile:', err);
    res.status(500).json({ message: 'Server error' });
  }
};
const updateProfilePicture = async (req, res) => {
  try {
    const teacher = await User.findById(req.user.userId);

    if (!teacher) {
      return res.status(404).json({ message: 'Teacher not found' });
    }

    // Build the full image URL (e.g., http://localhost:5000/uploads/12345.png)
    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;

    teacher.profileImage = imageUrl;
    await teacher.save();

    res.status(200).json({
      message: 'Profile picture updated successfully',
      profileImage: teacher.profileImage,
    });
  } catch (err) {
    console.error('Profile picture update error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};
const updateCoverImage = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const coverImageUrl = `http://localhost:5000/uploads/${req.file.filename}`;

    const updatedTeacher = await User.findByIdAndUpdate(
      teacherId,
      { coverImage: coverImageUrl },
      { new: true }
    );

    if (!updatedTeacher) {
      return res.status(404).json({ message: 'Teacher not found' });
    }

    res.status(200).json(updatedTeacher);
  } catch (error) {
    console.error('Error updating cover image:', error);
    res.status(500).json({ message: 'Failed to update cover image' });
  }
};
const updateProfileInfo = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const { name, bio, hourlyRate, skills, location, availability } = req.body;

    if (name) user.name = name;
    if (bio) user.bio = bio;
    if (hourlyRate) user.hourlyRate = hourlyRate;
    if (skills) user.skills = Array.isArray(skills) ? skills : skills.split(',').map(s => s.trim());
    if (location) user.location = location;
    if (availability) user.availability = availability;

    await user.save();
    res.json({ message: 'Profile updated successfully', user });
  } catch (err) {
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
//temporary