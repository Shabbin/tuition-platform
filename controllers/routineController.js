// server/controllers/routineController.js
const crypto = require('crypto');
const { DateTime } = require('luxon');
const Routine = require('../models/routine');
const TeacherPost = require('../models/teacherPost');
const TeacherRequest = require('../models/teacherRequest');

// 👇 notifications
const Notification = require('../models/Notification');
const User = require('../models/user');

function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const H = Number(m[1]), M = Number(m[2]);
  if (H < 0 || H > 23 || M < 0 || M > 59) return null;
  return { H, M };
}
// weekday: 0=Sun..6=Sat ; luxon weekday: 1=Mon..7=Sun
function toLuxonWeekday(w) { return w === 0 ? 7 : w; }

function nextOccurrence({ weekday, timeHHMM, tz, from }) {
  const parsed = parseHHMM(timeHHMM);
  if (!parsed) return null;
  const fromDT = DateTime.fromJSDate(from, { zone: tz });
  const targetW = toLuxonWeekday(weekday);
  let candidate = fromDT.set({ hour: parsed.H, minute: parsed.M, second: 0, millisecond: 0 });
  const delta = (targetW - candidate.weekday + 7) % 7;
  if (delta > 0) candidate = candidate.plus({ days: delta });
  else if (delta === 0 && candidate < fromDT) candidate = candidate.plus({ days: 7 });
  return candidate.toJSDate();
}

function stableHash(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

// 🔹 fetch name/avatar for notifications
async function buildSenderFields(userId, fallbackName = 'User', fallbackImg = '/default-avatar.png') {
  try {
    const u = await User.findById(userId).select('name profileImage').lean();
    return {
      senderName: u?.name || fallbackName,
      senderImage: u?.profileImage || fallbackImg,
    };
  } catch {
    return { senderName: fallbackName, senderImage: fallbackImg };
  }
}

/**
 * CREATE
 * POST /api/routines
 * body: {
 *   postId,
 *   studentIds: [],
 *   timezone?,
 *   startDate?,
 *   endDate?,
 *   slots:[{weekday, timeHHMM, durationMinutes}],
 *   requireAgreement?: boolean   // if true → starts paused & waits for all accepts
 * }
 *
 * HARD RULE ENFORCED:
 *  For a given (teacherId, postId, student), there may be at most one routine
 *  that is not archived. If any provided student already has an active/paused
 *  routine for this course, we return 409 with conflict details. Teachers must
 *  use the routine-change flow to modify times, or create a separate routine
 *  only for brand-new students (batching is still possible by grouping new
 *  students together in one routine).
 */
exports.createRoutine = async (req, res) => {
  try {
    const teacherId = req.user.id;
    const { postId, studentIds, timezone, startDate, endDate, slots, requireAgreement } = req.body || {};
    if (!postId) return res.status(400).json({ message: 'postId is required' });
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ message: 'studentIds[] is required' });
    }
    if (!Array.isArray(slots) || slots.length === 0) {
      return res.status(400).json({ message: 'At least one slot is required' });
    }

    // validate post ownership
    const post = await TeacherPost
      .findOne({ _id: postId, teacher: teacherId })
      .select('_id title subjects');
    if (!post) return res.status(403).json({ message: 'Unauthorized post' });

    // validate teacher requests approved for each student
    const approvedReqs = await TeacherRequest.find({
      teacherId, postId, studentId: { $in: studentIds }, status: 'approved',
    }).select('studentId');

    const approvedIds = new Set(approvedReqs.map((r) => String(r.studentId)));
    const toUse = studentIds.filter((id) => approvedIds.has(String(id)));
    const rejected = studentIds.filter((id) => !approvedIds.has(String(id)));

    if (toUse.length === 0) {
      return res.status(400).json({ message: 'No approved students for this post', rejected });
    }

    // 🔒 conflict check BEFORE creating:
    // any of these students already in a non-archived routine for this (teacher, post)?
    const conflicts = await Routine.find({
      teacherId,
      postId,
      status: { $in: ['active', 'paused'] },
      studentIds: { $in: toUse },
    }).select('_id studentIds status slots').lean();

    if (conflicts.length > 0) {
      // build per-routine overlap info
      const overlap = conflicts.map((r) => {
        const on = r.studentIds.map(String).filter((sid) => toUse.map(String).includes(sid));
        return { routineId: String(r._id), students: on };
      });
      return res.status(409).json({
        code: 'ROUTINE_EXISTS_FOR_STUDENT',
        message: 'Some students already have a routine for this course. Use the routine-change flow to modify times, or create a separate routine for new students.',
        conflicts: overlap,
        rejected, // keep visibility of non-approved students too
      });
    }

    const tz = timezone || 'Asia/Dhaka';
    const start = startDate ? new Date(startDate) : new Date();
    const end = endDate ? new Date(endDate) : null;

    // build slots with nextRunAt
    const preparedSlots = [];
    for (const s of slots) {
      const w = Number(s.weekday);
      const t = String(s.timeHHMM || s.time || '');
      const dur = Math.max(1, Number(s.durationMinutes || 60));
      if (!(w >= 0 && w <= 6)) return res.status(400).json({ message: `Invalid weekday in slot: ${JSON.stringify(s)}` });
      if (!parseHHMM(t)) return res.status(400).json({ message: `Invalid timeHHMM in slot: ${JSON.stringify(s)}` });
      const nextRunAt = nextOccurrence({ weekday: w, timeHHMM: t, tz, from: start });
      preparedSlots.push({ weekday: w, timeHHMM: t, durationMinutes: dur, nextRunAt });
    }

    // Idempotency: accept client "Idempotency-Key" or use our own hash
    const idemKey = req.get('Idempotency-Key') || stableHash({
      teacherId, postId, toUse, tz, start, end, preparedSlots, requireAgreement: !!requireAgreement
    });
    const existing = await Routine.findOne({ teacherId, postId, _createHash: idemKey }).lean();
    if (existing) return res.status(200).json({ ...existing, _id: existing._id, idempotent: true, rejected });

    // If agreement is required, start paused until all accept; else activate immediately
    const initialStatus = requireAgreement ? 'paused' : 'active';

    const routine = await Routine.create({
      teacherId,
      postId,
      studentIds: toUse,
      timezone: tz,
      startDate: start,
      endDate: end,
      status: initialStatus,
      slots: preparedSlots,
      _createHash: idemKey,

      // acceptance state
      requiresAcceptance: !!requireAgreement,
      pendingBy: requireAgreement ? toUse : [],
      acceptedBy: [],
    });

    // notify students: proposed vs created
    try {
      const teacher = await User.findById(teacherId).select('name profileImage');
      const senderName = teacher?.name || 'Teacher';
      const senderImage = teacher?.profileImage || '/default-avatar.png';

      const subjectLabel = Array.isArray(post?.subjects) && post.subjects.length
        ? post.subjects.map(s => String(s).trim()).filter(Boolean).join(' | ')
        : (post?.title || 'your course');

      const summarySlots = (routine.slots || []).map(s => ({
        weekday: s.weekday,
        timeHHMM: s.timeHHMM,
        durationMinutes: s.durationMinutes,
        nextRunAt: s.nextRunAt
      }));

      const notifType  = requireAgreement ? 'routine_proposed' : 'routine_created';
      const notifTitle = requireAgreement ? 'Routine proposal'   : 'New Weekly Routine';
      const notifMsg   = requireAgreement
        ? `A routine was proposed for ${subjectLabel}. Please review & accept.`
        : `A weekly routine was set for ${subjectLabel}.`;

      for (const sid of routine.studentIds || []) {
        const notif = new Notification({
          userId: sid,
          senderId: teacherId,
          senderName,
          profileImage: senderImage,
          type: notifType,
          title: notifTitle,
          message: notifMsg,
          data: {
            routineId: String(routine._id),
            postId: String(routine.postId),
            timezone: routine.timezone,
            slots: summarySlots
          },
          read: false,
        });
        await notif.save();

        if (global.emitToUser) {
          global.emitToUser(String(sid), 'new_notification', {
            _id: String(notif._id),
            senderId: notif.senderId,
            senderName: notif.senderName,
            profileImage: notif.profileImage,
            type: notif.type,
            title: notif.title,
            message: notif.message,
            data: notif.data,
            read: notif.read,
            createdAt: notif.createdAt,
          });
          // let clients refresh a "Regular Routine" section
          global.emitToUser(String(sid), 'routine_refresh', { routineId: String(routine._id) });
        }
      }
    } catch (nerr) {
      console.error('routine notify failed:', nerr);
    }

    return res.status(201).json({ ...routine.toObject(), rejected });
  } catch (e) {
    // handle unique index race gracefully (teacherId+postId+studentIds partial unique)
    if (e?.code === 11000) {
      return res.status(409).json({
        code: 'ROUTINE_EXISTS_FOR_STUDENT',
        message: 'A routine already exists for at least one student in this course. Use the routine-change flow to modify times, or create a separate routine for new students.',
      });
    }
    console.error('createRoutine', e);
    return res.status(500).json({ message: 'Server error' });
  }
};


// GET /api/routines/mine?page=1&limit=20&status=active|paused|archived
exports.listMine = async (req, res) => {
  try {
    const teacherId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const status = req.query.status;
    const q = { teacherId };
    if (status && ['active', 'paused', 'archived'].includes(status)) q.status = status;

    const [items, total] = await Promise.all([
      Routine.find(q)
        .populate('postId', 'title subjects')           // ✅ give UI course title/subjects
        .populate('studentIds', 'name profileImage')    // ✅ show student names/avatars
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Routine.countDocuments(q),
    ]);

    return res.json({ items, page, limit, total });
  } catch (e) {
    console.error('listMine', e);
    return res.status(500).json({ message: 'Server error' });
  }
};

// PATCH /api/routines/:id/status  {status: 'active'|'paused'|'archived'}
exports.setStatus = async (req, res) => {
  try {
    const teacherId = req.user.id;
    const { id } = req.params;
    const { status } = req.body || {};
    if (!['active', 'paused', 'archived'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }
    const updated = await Routine.findOneAndUpdate(
      { _id: id, teacherId },
      { $set: { status } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: 'Routine not found' });
    return res.json(updated);
  } catch (e) {
    console.error('setStatus', e);
    return res.status(500).json({ message: 'Server error' });
  }
};

// DELETE /api/routines/:id
exports.remove = async (req, res) => {
  try {
    const teacherId = req.user.id;
    const { id } = req.params;
    const doc = await Routine.findOneAndDelete({ _id: id, teacherId });
    if (!doc) return res.status(404).json({ message: 'Routine not found' });
    return res.json({ ok: true });
  } catch (e) {
    console.error('remove routine', e);
    return res.status(500).json({ message: 'Server error' });
  }
};

// POST /api/routines/preview
// body: { timezone, startDate, slots:[{weekday,timeHHMM}] } → returns nextRunAt[] for UI preview
exports.preview = async (req, res) => {
  try {
    const { timezone, startDate, slots } = req.body || {};
    const tz = timezone || 'Asia/Dhaka';
    const start = startDate ? new Date(startDate) : new Date();
    if (!Array.isArray(slots) || slots.length === 0) {
      return res.status(400).json({ message: 'slots[] required' });
    }
    const out = slots.map((s) => ({
      weekday: s.weekday,
      timeHHMM: s.timeHHMM,
      nextRunAt: nextOccurrence({
        weekday: Number(s.weekday),
        timeHHMM: String(s.timeHHMM || ''),
        tz,
        from: start,
      }),
    }));
    return res.json(out);
  } catch (e) {
    console.error('preview', e);
    return res.status(500).json({ message: 'Server error' });
  }
};

// GET /api/routines/student  → list routines visible to the logged-in student
exports.listForStudent = async (req, res) => {
  try {
    const studentId = req.user.id;
    const docs = await Routine.find({
      studentIds: studentId,
      status: { $in: ['active', 'paused'] },
    })
      .populate('teacherId', 'name profileImage')
      .populate('postId', 'title subjects')
      .sort({ createdAt: -1 })
      .lean();

    const out = (docs || []).map((r) => ({
      _id: String(r._id),
      timezone: r.timezone,
      startDate: r.startDate,
      endDate: r.endDate,
      status: r.status,
      requiresAcceptance: !!r.requiresAcceptance,
      pendingBy: (r.pendingBy || []).map(String),
      acceptedBy: (r.acceptedBy || []).map(String),
      post: r.postId
        ? { _id: String(r.postId._id), title: r.postId.title, subjects: r.postId.subjects }
        : null,
      teacher: r.teacherId
        ? { _id: String(r.teacherId._id), name: r.teacherId.name, profileImage: r.teacherId.profileImage }
        : null,
      slots: (r.slots || []).map((s) => ({
        weekday: s.weekday,
        timeHHMM: s.timeHHMM,
        durationMinutes: s.durationMinutes,
        nextRunAt: s.nextRunAt,
      })),
      createdAt: r.createdAt,
    }));

    return res.json(out);
  } catch (e) {
    console.error('listForStudent', e);
    return res.status(500).json({ message: 'Server error' });
  }
};

// PUT /api/routines/:id/accept  (student)
exports.acceptRoutine = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { id } = req.params;

    const routine = await Routine.findById(id);
    if (!routine) return res.status(404).json({ message: 'Routine not found' });

    const belongs = (routine.studentIds || []).map(String).includes(String(studentId));
    if (!belongs) return res.status(403).json({ message: 'Not your routine' });
    if (!routine.requiresAcceptance) {
      return res.status(400).json({ message: 'Routine does not require acceptance' });
    }

    // Move student from pendingBy -> acceptedBy
    const pendingSet = new Set((routine.pendingBy || []).map(String));
    if (!pendingSet.has(String(studentId))) {
      return res.status(400).json({ message: 'You have already responded' });
    }
    routine.pendingBy = Array.from(pendingSet).filter((x) => x !== String(studentId));
    routine.acceptedBy = Array.from(new Set([...(routine.acceptedBy || []).map(String), String(studentId)]));

    // If everyone accepted → activate and clear requiresAcceptance
    if ((routine.pendingBy || []).length === 0) {
      routine.status = 'active';
      routine.requiresAcceptance = false;
    }

    await routine.save();

    // Notify teacher (with real student identity)
    try {
      const { senderName, senderImage } = await buildSenderFields(studentId, 'Student');
      const notif = new Notification({
        userId: routine.teacherId,
        senderId: studentId,
        senderName,
        profileImage: senderImage,
        type: 'routine_agreed',
        title: 'Routine accepted',
        message: `${senderName} accepted the routine proposal.`,
        data: { routineId: String(routine._id) },
        read: false,
      });
      await notif.save();
      if (global.emitToUser) {
        global.emitToUser(String(routine.teacherId), 'new_notification', {
          _id: String(notif._id),
          senderId: notif.senderId,
          senderName: notif.senderName,
          profileImage: notif.profileImage,
          type: notif.type,
          title: notif.title,
          message: notif.message,
          data: notif.data,
          read: notif.read,
          createdAt: notif.createdAt,
        });
      }
    } catch (e) { console.error('acceptRoutine notify teacher', e); }

    if (global.emitToUser) {
      global.emitToUser(String(studentId), 'routine_refresh', { routineId: String(routine._id) });
      global.emitToUser(String(routine.teacherId), 'routine_refresh', { routineId: String(routine._id) });
    }

    return res.json({ ok: true, status: routine.status, pendingLeft: routine.pendingBy.length });
  } catch (e) {
    console.error('acceptRoutine', e);
    return res.status(500).json({ message: 'Server error' });
  }
};

// PUT /api/routines/:id/reject  (student)
exports.rejectRoutine = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { id } = req.params;

    const routine = await Routine.findById(id);
    if (!routine) return res.status(404).json({ message: 'Routine not found' });

    const belongs = (routine.studentIds || []).map(String).includes(String(studentId));
    if (!belongs) return res.status(403).json({ message: 'Not your routine' });
    if (!routine.requiresAcceptance) {
      return res.status(400).json({ message: 'Routine does not require acceptance' });
    }

    // Policy: a single rejection removes the student; routine remains for others.
    routine.studentIds = routine.studentIds.filter(x => String(x) !== String(studentId));
    routine.pendingBy  = (routine.pendingBy || []).filter(x => String(x) !== String(studentId));
    routine.acceptedBy = (routine.acceptedBy || []).filter(x => String(x) !== String(studentId));

    // if no students left → pause
    if (routine.studentIds.length === 0) {
      routine.status = 'paused';
      routine.requiresAcceptance = false;
    }

    await routine.save();

    // Notify teacher (with real student identity)
    try {
      const { senderName, senderImage } = await buildSenderFields(studentId, 'Student');
      const notif = new Notification({
        userId: routine.teacherId,
        senderId: studentId,
        senderName,
        profileImage: senderImage,
        type: 'routine_rejected',
        title: 'Routine rejected',
        message: `${senderName} rejected the routine proposal.`,
        data: { routineId: String(routine._id) },
        read: false,
      });
      await notif.save();
      if (global.emitToUser) {
        global.emitToUser(String(routine.teacherId), 'new_notification', {
          _id: String(notif._id),
          senderId: notif.senderId,
          senderName: notif.senderName,
          profileImage: notif.profileImage,
          type: notif.type,
          title: notif.title,
          message: notif.message,
          data: notif.data,
          read: notif.read,
          createdAt: notif.createdAt,
        });
      }
    } catch (e) { console.error('rejectRoutine notify teacher', e); }

    if (global.emitToUser) {
      global.emitToUser(String(studentId), 'routine_refresh', { routineId: String(routine._id) });
      global.emitToUser(String(routine.teacherId), 'routine_refresh', { routineId: String(routine._id) });
    }

    return res.json({ ok: true, status: routine.status });
  } catch (e) {
    console.error('rejectRoutine', e);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Unified: PUT /api/routines/:id/respond  { action: 'accept' | 'reject' }
 * (Used by your student UI.)
 */
exports.respondRoutine = async (req, res) => {
  try {
    const studentId = String(req.user.id);
    const { id } = req.params;
    const { action } = req.body; // 'accept' | 'reject'

    const r = await Routine.findById(id);
    if (!r) return res.status(404).json({ message: 'Routine not found' });

    const isMember = r.studentIds.map(String).includes(studentId);
    if (!isMember) return res.status(403).json({ message: 'Not part of this routine' });
    if (!r.requiresAcceptance || r.status === 'archived') {
      return res.status(400).json({ message: 'No acceptance required' });
    }

    if (action === 'reject') {
      // remove this student from the routine
      r.studentIds = r.studentIds.filter(x => String(x) !== studentId);
      r.pendingBy  = (r.pendingBy || []).filter(x => String(x) !== studentId);
      r.acceptedBy = (r.acceptedBy || []).filter(x => String(x) !== studentId);
      if (r.studentIds.length === 0) {
        r.status = 'paused';
        r.requiresAcceptance = false;
      }
      await r.save();
    } else {
      // accept
      const pending = new Set((r.pendingBy || []).map(String));
      pending.delete(studentId);
      r.pendingBy = [...pending];

      const accepted = new Set((r.acceptedBy || []).map(String));
      accepted.add(studentId);
      r.acceptedBy = [...accepted];

      // everyone accepted?
      const allIds = r.studentIds.map(String);
      const everyoneAccepted = allIds.every(id => r.acceptedBy.map(String).includes(id));
      if (everyoneAccepted) {
        r.status = 'active';
        r.requiresAcceptance = false;
      }
      await r.save();
    }

    // notify teacher
    const { senderName, senderImage } = await buildSenderFields(studentId, 'Student');
    const notif = new Notification({
      userId: r.teacherId,
      senderId: studentId,
      senderName,
      profileImage: senderImage,
      type: 'routine_response',
      title: 'Routine response',
      message: `${senderName} ${action}ed the routine proposal.`,
      data: { routineId: String(r._id), action, state: r.status }
    });
    await notif.save();

    if (global.emitToUser) {
      global.emitToUser(String(r.teacherId), 'new_notification', {
        _id: String(notif._id),
        senderId: notif.senderId,
        senderName: notif.senderName,
        profileImage: notif.profileImage,
        type: notif.type,
        title: notif.title,
        message: notif.message,
        data: notif.data,
        read: notif.read,
        createdAt: notif.createdAt,
      });
      global.emitToUser(String(r.teacherId), 'routine_refresh', { reason: 'student_response' });
    }

    res.json({ ok: true, status: r.status, pendingBy: r.pendingBy, acceptedBy: r.acceptedBy });
  } catch (e) {
    console.error('respondRoutine', e);
    res.status(500).json({ message: 'Server error' });
  }
};

// GET /api/routines/student/pending  → routines awaiting this student's acceptance
exports.listPendingRoutinesForStudent = async (req, res) => {
  try {
    const studentId = String(req.user.id);
    const mine = await Routine.find({
      requiresAcceptance: true,
      pendingBy: studentId
    })
      .populate('teacherId','name profileImage')
      .populate('postId','title subjects')
      .lean();

    res.json(mine);
  } catch (e) {
    console.error('listPendingRoutinesForStudent', e);
    res.status(500).json({ message: 'Server error' });
  }
};
