const User = require('../models/User');

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

module.exports = {
  approveTeacherEligibility
};
//temporary