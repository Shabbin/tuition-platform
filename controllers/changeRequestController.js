// server/controllers/changeRequestController.js
const ChangeRequest = require('../models/RoutineChangeRequest');
const Schedule = require('../models/schedule');
const Routine = require('../models/routine');
const User = require('../models/user');
const Notification = require('../models/Notification');

// who can create a change request?
function isParticipant({ teacherId, studentIds }, userId) {
  const u = String(userId);
  if (String(teacherId) === u) return true;
  return (studentIds || []).map(String).includes(u);
}

// normalize notify
async function notify(userId, payload) {
  const n = new Notification({ userId, ...payload, read: false });
  await n.save();
  if (global.emitToUser) {
    global.emitToUser(String(userId), 'new_notification', {
      _id: String(n._id),
      senderId: n.senderId,
      senderName: n.senderName,
      profileImage: n.profileImage,
      type: n.type,
      title: n.title,
      message: n.message,
      data: n.data,
      read: n.read,
      createdAt: n.createdAt,
    });
  }
}

// CREATE (teacher or student can propose)
exports.create = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      targetType,        // 'schedule' | 'routine'
      targetId,          // scheduleId or routineId
      slotIndex,         // optional for routine slot
      studentIds,        // required array (even if one)
      proposedDate,
      durationMinutes,
      note,
    } = req.body || {};

    if (!['schedule', 'routine'].includes(targetType)) {
      return res.status(400).json({ message: 'targetType must be schedule or routine' });
    }
    if (!targetId) return res.status(400).json({ message: 'targetId is required' });
    if (!Array.isArray(studentIds) || !studentIds.length) {
      return res.status(400).json({ message: 'studentIds[] is required' });
    }
    if (!proposedDate) return res.status(400).json({ message: 'proposedDate is required' });

    let teacherId;
    if (targetType === 'schedule') {
      const s = await Schedule.findById(targetId).select('teacherId studentIds postId subject type');
      if (!s) return res.status(404).json({ message: 'Schedule not found' });
      if (!isParticipant({ teacherId: s.teacherId, studentIds: s.studentIds }, userId)) {
        return res.status(403).json({ message: 'Not a participant of this schedule' });
      }
      teacherId = s.teacherId;
    } else {
      const r = await Routine.findById(targetId).select('teacherId studentIds');
      if (!r) return res.status(404).json({ message: 'Routine not found' });
      if (!isParticipant({ teacherId: r.teacherId, studentIds: r.studentIds }, userId)) {
        return res.status(403).json({ message: 'Not a participant of this routine' });
      }
      teacherId = r.teacherId;
    }

    const doc = await ChangeRequest.create({
      targetType,
      targetId,
      slotIndex: typeof slotIndex === 'number' ? slotIndex : null,
      teacherId,
      studentIds,
      createdBy: userId,
      proposedDate: new Date(proposedDate),
      durationMinutes: Math.max(1, Number(durationMinutes || 60)),
      note: note || '',
      status: 'pending',
    });

    // notify others (everyone except creator)
    const creator = await User.findById(userId).select('name profileImage');
    const basePayload = {
      type: 'change_request_created',
      title: 'Time change proposed',
      message: `${creator?.name || 'Someone'} proposed ${doc.durationMinutes}m on ${new Date(doc.proposedDate).toLocaleString('en-GB', { hour12: false })}`,
      data: { requestId: String(doc._id), targetType, targetId, slotIndex: doc.slotIndex },
      senderId: userId,
      senderName: creator?.name || 'User',
      profileImage: creator?.profileImage || '/default-avatar.png',
    };

    // notify teacher (if not creator)
    if (String(teacherId) !== String(userId)) {
      await notify(teacherId, basePayload);
    }
    // notify students (except creator)
    for (const sid of studentIds) {
      if (String(sid) === String(userId)) continue;
      await notify(sid, basePayload);
    }

    return res.status(201).json(doc);
  } catch (e) {
    console.error('changeRequest.create', e);
    res.status(500).json({ message: 'Server error' });
  }
};

// RESPOND (accept/reject) — only a counterparty can decide
exports.respond = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { action } = req.body || {}; // 'accept' | 'reject'

    const doc = await ChangeRequest.findById(id);
    if (!doc) return res.status(404).json({ message: 'Request not found' });
    if (doc.status !== 'pending') return res.status(400).json({ message: 'Already decided' });

    // only someone other than the creator AND who is a participant can decide
    if (String(doc.createdBy) === String(userId)) {
      return res.status(403).json({ message: 'Creator cannot decide own request' });
    }
    if (!isParticipant({ teacherId: doc.teacherId, studentIds: doc.studentIds }, userId)) {
      return res.status(403).json({ message: 'Not a participant' });
    }

    if (action !== 'accept' && action !== 'reject') {
      return res.status(400).json({ message: 'action must be accept or reject' });
    }

    doc.status = action === 'accept' ? 'accepted' : 'rejected';
    doc.decidedBy = userId;
    doc.decidedAt = new Date();
    await doc.save();

    // If accepted -> apply effect:
    //  - for schedule: update the schedule's date/duration
    //  - for routine: create a one-off schedule occurrence (single-student or group based on studentIds length)
    let scheduleId = null;

    if (doc.status === 'accepted') {
      if (doc.targetType === 'schedule') {
        const sched = await Schedule.findById(doc.targetId);
        if (sched) {
          // only allow if participant check passes (already done)
          sched.date = doc.proposedDate;
          sched.durationMinutes = doc.durationMinutes;
          await sched.save();
          scheduleId = sched._id;

          // hint both sides to refresh schedules
          for (const uid of [sched.teacherId, ...sched.studentIds]) {
            if (global.emitToUser) {
              global.emitToUser(String(uid), 'schedules_refresh', { reason: 'change_request_accept', scheduleId: String(sched._id) });
            }
          }
        }
      } else {
        // routine -> one-off schedule for the selected studentIds at proposed time
        const r = await Routine.findById(doc.targetId).select('teacherId postId');
        if (r) {
          const created = await Schedule.create({
            teacherId: r.teacherId,
            postId: r.postId,
            studentIds: doc.studentIds, // could be 1..n
            subject: 'Class',           // (optional: compute from post subjects if you prefer)
            type: 'regular',
            date: doc.proposedDate,
            durationMinutes: doc.durationMinutes,
            status: 'scheduled',
            sequenceNumber: null,
          });
          scheduleId = created._id;
          // notify refresh
          for (const uid of [r.teacherId, ...doc.studentIds]) {
            if (global.emitToUser) {
              global.emitToUser(String(uid), 'schedules_refresh', { reason: 'routine_change_accept', scheduleId: String(created._id) });
            }
          }
        }
      }
    }

    // notify all participants about the decision
    const decider = await User.findById(userId).select('name profileImage');
    const payload = {
      type: 'change_request_decision',
      title: doc.status === 'accepted' ? 'Change accepted' : 'Change rejected',
      message:
        doc.status === 'accepted'
          ? `${decider?.name || 'User'} accepted the proposed time.`
          : `${decider?.name || 'User'} rejected the proposed time.`,
      data: { requestId: String(doc._id), decision: doc.status, scheduleId: scheduleId ? String(scheduleId) : null },
      senderId: userId,
      senderName: decider?.name || 'User',
      profileImage: decider?.profileImage || '/default-avatar.png',
    };

    // teacher
    await notify(doc.teacherId, payload);
    // students
    for (const sid of doc.studentIds) await notify(sid, payload);

    return res.json({ ok: true, status: doc.status, scheduleId });
  } catch (e) {
    console.error('changeRequest.respond', e);
    res.status(500).json({ message: 'Server error' });
  }
};

// CANCEL (whoever created it can cancel while pending)
exports.cancel = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const doc = await ChangeRequest.findById(id);
    if (!doc) return res.status(404).json({ message: 'Request not found' });
    if (doc.status !== 'pending') return res.status(400).json({ message: 'Only pending requests can be cancelled' });
    if (String(doc.createdBy) !== String(userId)) {
      return res.status(403).json({ message: 'Only creator can cancel' });
    }

    doc.status = 'cancelled';
    doc.decidedBy = userId;
    doc.decidedAt = new Date();
    await doc.save();

    // broadcast info
    const canceller = await User.findById(userId).select('name profileImage');
    const payload = {
      type: 'change_request_cancelled',
      title: 'Change request cancelled',
      message: `${canceller?.name || 'User'} cancelled the proposed change.`,
      data: { requestId: String(doc._id) },
      senderId: userId,
      senderName: canceller?.name || 'User',
      profileImage: canceller?.profileImage || '/default-avatar.png',
    };

    await notify(doc.teacherId, payload);
    for (const sid of doc.studentIds) await notify(sid, payload);

    return res.json({ ok: true });
  } catch (e) {
    console.error('changeRequest.cancel', e);
    res.status(500).json({ message: 'Server error' });
  }
};

// LISTS
exports.listForTeacher = async (req, res) => {
  try {
    const teacherId = req.user.id;
    const items = await ChangeRequest.find({ teacherId }).sort({ createdAt: -1 }).lean();
    res.json(items);
  } catch (e) {
    console.error('changeRequest.listForTeacher', e);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.listForStudent = async (req, res) => {
  try {
    const studentId = req.user.id;
    const items = await ChangeRequest.find({ studentIds: studentId }).sort({ createdAt: -1 }).lean();
    res.json(items);
  } catch (e) {
    console.error('changeRequest.listForStudent', e);
    res.status(500).json({ message: 'Server error' });
  }
};
