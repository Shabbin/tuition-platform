const TeacherRequest = require('../models/teacherRequest');
const Payment = require('../models/payment');

const ACTIVE_WINDOW_DAYS = Number(process.env.TUITION_ACTIVE_WINDOW_DAYS || 45);

exports.computeTuitionStatus = async ({ studentId, teacherId, requestId }) => {
  if (!studentId || !teacherId) {
    return { ok: false, error: 'studentId and teacherId required' };
  }

  let reqDoc = null;
  if (requestId) {
    reqDoc = await TeacherRequest.findById(requestId).select('status demoCount studentId teacherId');
  } else {
    reqDoc = await TeacherRequest
      .findOne({ studentId, teacherId, status: 'approved' })
      .sort({ updatedAt: -1 })
      .select('status demoCount studentId teacherId');
  }

  const connected = !!reqDoc && reqDoc.status === 'approved';
  const demosUsed = connected ? (reqDoc.demoCount || 0) : 0;

  const since = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const paid = await Payment.exists({
    type: 'TUITION',
    studentId, teacherId,
    status: 'PAID',
    ...(requestId ? { requestId } : {}),
    createdAt: { $gte: since },
  });

  const canSchedule = Boolean(paid || (connected && demosUsed < 3));
  const canInvite   = canSchedule;               // same rule for teacher invites
  const canTopicHelpWithThisTeacher = !(connected || paid); // blocked if connected or paid

  return {
    ok: true,
    connected, paid: !!paid, demosUsed,
    canSchedule, canInvite, canTopicHelpWithThisTeacher,
    maxDemos: 3,
    requestId: reqDoc?._id || null,
  };
};
