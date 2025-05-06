const User = require('../models/User');

// Fetch eligible teachers
const getEligibleTeachers = async (req, res) => {
  try {
    const teachers = await User.find({ role: 'teacher', isEligible: true }).select('-password');
    return res.status(200).json(teachers);
  } catch (error) {
    console.error('Error fetching teachers:', error.message);
    return res.status(500).json({ message: 'Failed to fetch teachers' });
  }
};

module.exports = {
  getEligibleTeachers,
};
