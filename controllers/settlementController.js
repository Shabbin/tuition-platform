const mongoose = require('mongoose');
const User = require('../models/user');
const SolvePayout = require('../models/SolvePayOut');
const { PER_SOLVE_GROSS, PLATFORM_FEE_RATE } = require('../config/billing');
const { computeTuitionStatus } = require('../utils/tuitionStatus');

exports.settleTopicSolve = async (req, res) => {
  const { questionId, studentId, teacherId } = req.body;
  if (!questionId || !studentId || !teacherId)
    return res.status(400).json({ error: 'questionId, studentId, teacherId required' });

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // 🚫 Block topic-help settlement if this student-teacher pair is connected/paid (active tuition)
    const status = await computeTuitionStatus({ studentId, teacherId });
    if (!status?.ok) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ error: status?.error || 'Unable to compute tuition status' });
    }
    if (!status.canTopicHelpWithThisTeacher) {
      await session.abortTransaction(); session.endSession();
      return res.status(403).json({
        error: 'Active or connected tuition with this teacher — topic-wise settlement is disabled for this pair.'
      });
    }

    const stu = await User.findById(studentId).session(session).select('topicCredits');
    if (!stu) throw new Error('Student not found');
    if ((stu.topicCredits || 0) < 1) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ error: 'Not enough topic credits' });
    }

    const gross = PER_SOLVE_GROSS;                                // 40
    const platformFee = +(gross * PLATFORM_FEE_RATE).toFixed(2);  // 4
    const teacherNet = +(gross - platformFee).toFixed(2);         // 36

    await User.updateOne(
      { _id: studentId, topicCredits: { $gte: 1 } },
      { $inc: { topicCredits: -1 } },
      { session }
    );

    await SolvePayout.create([{
      questionId, studentId, teacherId, gross, platformFee, teacherNet
    }], { session });

    await session.commitTransaction(); session.endSession();
    res.json({ ok: true, creditsLeft: (stu.topicCredits - 1), gross, platformFee, teacherNet });
  } catch (e) {
    await session.abortTransaction(); session.endSession();
    if (e.code === 11000) return res.status(409).json({ error: 'Already settled for this question' });
    console.error(e);
    res.status(500).json({ error: 'Failed to settle solve', details: e.message });
  }
};
