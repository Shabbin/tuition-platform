// server/controllers/enrollmentInviteController.js
const mongoose = require('mongoose');

const Routine = require('../models/routine');
const EnrollmentInvite = require('../models/enrollmentInvite');
const TeacherRequest = require('../models/teacherRequest');
const Notification = require('../models/Notification');

/* ------------------------------ utils ------------------------------ */
const toObjectId = (v) => {
  if (!v) return null;
  try { return new mongoose.Types.ObjectId(String(v)); } catch { return null; }
};

const parseISOorNull = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

function computeUpfrontDue({ feeTk, advanceTk }) {
  const fee = Number(feeTk || 0);
  const adv = Number(advanceTk || 0);
  if (adv > 0) return Math.round(adv);
  return fee > 0 ? Math.round(fee * 0.15) : 0;
}

function resolveTeacher(req) {
  const id =
    (req.user && (req.user._id || req.user.id)) ||
    req.userId ||
    (req.auth && (req.auth._id || req.auth.id)) ||
    null;

  const role =
    (req.user && req.user.role) ||
    req.role ||
    (req.auth && req.auth.role) ||
    null;

  return { id: toObjectId(id), role };
}

function resolveUserId(req) {
  const id =
    (req.user && (req.user._id || req.user.id)) ||
    req.userId ||
    (req.auth && (req.auth._id || req.auth.id)) ||
    null;
  return toObjectId(id);
}

function summarizeValidation(err) {
  if (err?.name !== 'ValidationError') return null;
  const msgs = Object.values(err.errors || {})
    .map((e) => e?.message || e?.properties?.message)
    .filter(Boolean);
  return msgs.length ? msgs.join(' • ') : 'Validation failed';
}

function isDupKey(err) {
  return err?.code === 11000 || /duplicate key/i.test(String(err?.message));
}

/* ------------------------------ controllers (match routes) ------------------------------ */

/**
 * POST /enrollment-invites
 * Body:
 * {
 *   routineId: string (REQUIRED)  -> used to derive postId
 *   studentId: string (REQUIRED)
 *   courseTitle: string (REQUIRED)
 *   courseFeeTk: number (REQUIRED, >=1)
 *   advanceTk?: number
 *   note?: string
 *   expiresAt?: string|Date  -> payByAt
 * }
 */
async function createEnrollmentInvite(req, res) {
  try {
    const { id: teacherId, role } = resolveTeacher(req);
    if (!teacherId) return res.status(401).json({ error: 'unauthorized', message: 'Unauthorized' });
    if (role && role !== 'teacher') return res.status(403).json({ error: 'forbidden', message: 'Teacher only' });

    const {
      routineId,
      studentId,
      courseTitle,
      courseFeeTk,
      advanceTk,
      note,
      expiresAt,
    } = req.body || {};

    const rid = toObjectId(routineId);
    if (!rid) return res.status(400).json({ error: 'validation', message: 'routineId is required' });

    const sid = toObjectId(studentId);
    if (!sid) return res.status(400).json({ error: 'validation', message: 'studentId is required' });

    if (!courseTitle || typeof courseTitle !== 'string' || !courseTitle.trim()) {
      return res.status(400).json({ error: 'validation', message: 'courseTitle is required' });
    }

    const feeNum = Number(courseFeeTk);
    if (!(feeNum > 0)) {
      return res.status(400).json({ error: 'validation', message: 'courseFeeTk must be > 0' });
    }

    // Routine must exist and belong to this teacher; we need its postId
    const routine = await Routine.findOne({ _id: rid, teacherId })
      .select('_id postId teacherId')
      .lean();

    if (!routine) {
      return res.status(404).json({ error: 'not_found', message: 'Routine not found (or not owned by this teacher)' });
    }
    if (!routine.postId) {
      return res.status(500).json({ error: 'server_error', message: 'Routine is missing postId' });
    }

    const postId = routine.postId;

    // Keep relation aligned (idempotent helper)
    await TeacherRequest.updateOne(
      { studentId: sid, teacherId, postId },
      { $setOnInsert: { status: 'approved' } },
      { upsert: true }
    );

    const upfrontDueTk = computeUpfrontDue({ feeTk: feeNum, advanceTk });
    const payByAt = parseISOorNull(expiresAt);

    const invite = await EnrollmentInvite.create({
      postId,
      routineId: rid,
      teacherId,
      studentId: sid,
      courseTitle: String(courseTitle).trim(),
      courseFeeTk: Math.round(feeNum),
      currency: 'BDT',
      upfrontDueTk,
      advanceTk: advanceTk == null ? null : Math.round(Number(advanceTk)),
      paidTk: 0,
      paymentStatus: 'unpaid',
      status: 'pending',
      note: note ? String(note) : '',
      payByAt,
    });

    // Notify student (best-effort)
    try {
      const notif = new Notification({
        userId: sid,
        senderId: teacherId,
        senderName: 'Teacher',
        type: 'enrollment_invite_created',
        title: 'New Course Invite',
        message: `You’ve been invited to join “${invite.courseTitle}”.`,
        data: { postId: String(postId), inviteId: String(invite._id) },
        read: false,
      });
      await notif.save();
      if (global.emitToUser) {
        global.emitToUser(String(sid), 'new_notification', {
          _id: String(notif._id),
          senderId: notif.senderId,
          senderName: notif.senderName,
          profileImage: notif.profileImage || '/default-avatar.png',
          type: notif.type,
          title: notif.title,
          message: notif.message,
          data: notif.data,
          read: notif.read,
          createdAt: notif.createdAt,
        });
      }
    } catch {}

    return res.json({ ok: true, invite });
  } catch (err) {
    console.error('[createEnrollmentInvite] Error:', err);

    if (isDupKey(err)) {
      return res.status(409).json({ error: 'conflict', message: 'Invite already exists for this student and course' });
    }

    const summary = summarizeValidation(err);
    if (summary) return res.status(400).json({ error: 'validation', message: summary, details: err.errors });

    return res.status(500).json({ error: 'server_error', message: 'Server error' });
  }
}

/** GET /enrollment-invites/incoming (student) */
async function listIncomingEnrollmentInvites(req, res) {
  try {
    const studentId = resolveUserId(req);
    if (!studentId) return res.status(401).json({ error: 'unauthorized', message: 'Unauthorized' });

    const invites = await EnrollmentInvite.find({ studentId })
      .select('_id postId routineId teacherId courseTitle courseFeeTk currency upfrontDueTk advanceTk paidTk paymentStatus status note payByAt createdAt updatedAt')
      .populate({ path: 'teacherId', select: '_id name profileImage' })
      .sort({ createdAt: -1 })
      .lean();

    return res.json(invites);
  } catch (err) {
    console.error('[listIncomingEnrollmentInvites] Error:', err);
    return res.status(500).json({ error: 'server_error', message: 'Server error' });
  }
}

/** GET /enrollment-invites/outgoing (teacher) */
async function listOutgoingEnrollmentInvites(req, res) {
  try {
    const { id: teacherId } = resolveTeacher(req);
    if (!teacherId) return res.status(401).json({ error: 'unauthorized', message: 'Unauthorized' });

    const invites = await EnrollmentInvite.find({ teacherId })
      .select('_id postId routineId studentId courseTitle courseFeeTk currency upfrontDueTk advanceTk paidTk paymentStatus status note payByAt createdAt updatedAt')
      .populate({ path: 'studentId', select: '_id name profileImage' })
      .sort({ createdAt: -1 })
      .lean();

    return res.json(invites);
  } catch (err) {
    console.error('[listOutgoingEnrollmentInvites] Error:', err);
    return res.status(500).json({ error: 'server_error', message: 'Server error' });
  }
}

/**
 * POST /enrollment-invites/:inviteId/initiate  (student)
 * Returns: { ok, url, paymentId } (mock session)
 */
async function initiateInvitePayment(req, res) {
  try {
    const studentId = resolveUserId(req);
    if (!studentId) return res.status(401).json({ error: 'unauthorized', message: 'Unauthorized' });

    const inviteId = toObjectId(req.params.inviteId);
    if (!inviteId) return res.status(400).json({ error: 'validation', message: 'Invalid inviteId' });

    const invite = await EnrollmentInvite.findOne({ _id: inviteId, studentId });
    if (!invite) return res.status(404).json({ error: 'not_found', message: 'Invite not found' });
    if (invite.status !== 'pending') {
      return res.status(400).json({ error: 'validation', message: `Invite status must be 'pending' to initiate payment` });
    }

    const paymentId = `PMT_${inviteId}_${Date.now()}`;
    const url = `https://pay.example/checkout?paymentId=${encodeURIComponent(paymentId)}&invite=${inviteId}`;

    return res.json({ ok: true, url, paymentId });
  } catch (err) {
    console.error('[initiateInvitePayment] Error:', err);
    return res.status(500).json({ error: 'server_error', message: 'Server error' });
  }
}

/**
 * POST /enrollment-invites/:inviteId/mark-paid  (teacher/admin)
 * Body: { amountTk: number }
 */
async function markInvitePaid(req, res) {
  try {
    const { id: teacherId, role } = resolveTeacher(req);
    if (!teacherId) return res.status(401).json({ error: 'unauthorized', message: 'Unauthorized' });

    const inviteId = toObjectId(req.params.inviteId);
    if (!inviteId) return res.status(400).json({ error: 'validation', message: 'Invalid inviteId' });

    const amountTkNum = Math.round(Number(req.body?.amountTk || 0));
    if (!(amountTkNum > 0)) {
      return res.status(400).json({ error: 'validation', message: 'amountTk must be > 0' });
    }

    const invite = await EnrollmentInvite.findOne({ _id: inviteId });
    if (!invite) return res.status(404).json({ error: 'not_found', message: 'Invite not found' });

    if (String(invite.teacherId) !== String(teacherId) && role !== 'admin') {
      return res.status(403).json({ error: 'forbidden', message: 'Not allowed' });
    }

    invite.paidTk = Math.max(0, Math.round(Number(invite.paidTk || 0) + amountTkNum));
    if (invite.paidTk >= invite.courseFeeTk) invite.paymentStatus = 'paid';
    else if (invite.paidTk > 0) invite.paymentStatus = 'partial';
    await invite.save();

    return res.json({ ok: true, invite });
  } catch (err) {
    console.error('[markInvitePaid] Error:', err);
    const summary = summarizeValidation(err);
    if (summary) return res.status(400).json({ error: 'validation', message: summary, details: err.errors });
    return res.status(500).json({ error: 'server_error', message: 'Server error' });
  }
}

/** POST /enrollment-invites/:inviteId/cancel  (teacher) */
async function cancelEnrollmentInvite(req, res) {
  try {
    const { id: teacherId } = resolveTeacher(req);
    if (!teacherId) return res.status(401).json({ error: 'unauthorized', message: 'Unauthorized' });

    const inviteId = toObjectId(req.params.inviteId);
    if (!inviteId) return res.status(400).json({ error: 'validation', message: 'Invalid inviteId' });

    const invite = await EnrollmentInvite.findOne({ _id: inviteId, teacherId });
    if (!invite) return res.status(404).json({ error: 'not_found', message: 'Invite not found' });

    if (invite.status !== 'pending') {
      return res.status(400).json({ error: 'validation', message: `Only 'pending' invites can be cancelled` });
    }

    invite.status = 'cancelled';
    await invite.save();
    return res.json({ ok: true, status: invite.status });
  } catch (err) {
    console.error('[cancelEnrollmentInvite] Error:', err);
    return res.status(500).json({ error: 'server_error', message: 'Server error' });
  }
}

/** POST /enrollment-invites/:inviteId/decline  (student) */
async function declineEnrollmentInvite(req, res) {
  try {
    const studentId = resolveUserId(req);
    if (!studentId) return res.status(401).json({ error: 'unauthorized', message: 'Unauthorized' });

    const inviteId = toObjectId(req.params.inviteId);
    if (!inviteId) return res.status(400).json({ error: 'validation', message: 'Invalid inviteId' });

    const invite = await EnrollmentInvite.findOne({ _id: inviteId, studentId });
    if (!invite) return res.status(404).json({ error: 'not_found', message: 'Invite not found' });

    if (invite.status !== 'pending') {
      return res.status(400).json({ error: 'validation', message: `Only 'pending' invites can be declined` });
    }

    invite.status = 'declined';
    await invite.save();
    return res.json({ ok: true, status: invite.status });
  } catch (err) {
    console.error('[declineEnrollmentInvite] Error:', err);
    return res.status(500).json({ error: 'server_error', message: 'Server error' });
  }
}

module.exports = {
  createEnrollmentInvite,            // POST /
  listIncomingEnrollmentInvites,     // GET  /incoming
  listOutgoingEnrollmentInvites,     // GET  /outgoing
  initiateInvitePayment,             // POST /:inviteId/initiate
  markInvitePaid,                    // POST /:inviteId/mark-paid
  cancelEnrollmentInvite,            // POST /:inviteId/cancel
  declineEnrollmentInvite,           // POST /:inviteId/decline
};
