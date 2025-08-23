// controllers/tuitionGuardController.js
const TeacherRequest = require('../models/teacherRequest');
const { computeTuitionStatus } = require('../utils/tuitionStatus');

exports.getStatus = async (req, res) => {
  try {
    const { studentId, teacherId, requestId } = req.query;
    const s = await computeTuitionStatus({ studentId, teacherId, requestId });
    if (!s.ok) return res.status(400).json({ error: s.error });
    return res.json(s);
  } catch (e) {
    console.error('getStatus', e);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.useDemo = async (req, res) => {
  try {
    const { requestId } = req.body;
    if (!requestId) return res.status(400).json({ error: 'requestId required' });

    // ⬇️ pull the new fields (with student/teacher IDs for status check)
    const reqDoc = await TeacherRequest.findById(requestId)
      .select('status demosUsed maxDemos demoCount studentId teacherId');

    if (!reqDoc) {
      return res.status(404).json({ error: 'Request not found' });
    }
    if (reqDoc.status !== 'approved') {
      return res.status(400).json({ error: 'Request must be approved' });
    }

    // If already paid, demos no longer apply
    const s = await computeTuitionStatus({
      studentId: reqDoc.studentId,
      teacherId: reqDoc.teacherId,
      requestId
    });
    if (!s.ok) return res.status(400).json({ error: s.error });
    if (s.paid) {
      return res.status(400).json({ error: 'Tuition already paid; demos not applicable' });
    }

    // ✅ Use new fields, but remain backward compatible with old demoCount
    const used = Number(reqDoc.demosUsed ?? reqDoc.demoCount ?? 0);
    const cap  = Number(reqDoc.maxDemos ?? 3);

    if (used >= cap) {
      return res.status(403).json({ error: 'Demo limit reached. Please make a payment to continue.' });
    }

    const nextUsed = used + 1;
    reqDoc.demosUsed = nextUsed;
    // keep the legacy field in sync (no harm if you drop it later)
    reqDoc.demoCount = nextUsed;

    await reqDoc.save();

    return res.json({
      ok: true,
      demosUsed: nextUsed,
      remaining: Math.max(cap - nextUsed, 0),
      maxDemos: cap
    });
  } catch (e) {
    console.error('useDemo', e);
    res.status(500).json({ error: 'Server error' });
  }
};

// Hard block topic-help to same teacher if connected OR paid
exports.canTopicHelp = async (req, res) => {
  try {
    const { studentId, teacherId, requestId } = req.query;
    const s = await computeTuitionStatus({ studentId, teacherId, requestId });
    if (!s.ok) return res.status(400).json({ error: s.error });

    if (!s.canTopicHelpWithThisTeacher) {
      return res.json({
        allow: false,
        reason: 'You are connected or have paid tuition with this teacher. Topic-wise help is disabled for this pair.'
      });
    }
    return res.json({ allow: true });
  } catch (e) {
    console.error('canTopicHelp', e);
    res.status(500).json({ error: 'Server error' });
  }
};
