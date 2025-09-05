// server/controllers/privateCourseController.js
const mongoose = require('mongoose');
const Post = require('../models/post');
const TeacherRequest = require('../models/teacherRequest');
const Notification = require('../models/Notification');

const BUILD = 'PCC_NO_INVITES_RAW_INSERT_2025-09-05_03';
console.log('[PCC] LOADED', __filename, 'build=', BUILD, 'NOTE: no EnrollmentInvite is used in this controller');

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

/* ------------------------------ handlers ------------------------------ */

/**
 * POST /private-courses
 * Body:
 * {
 *   title: string,
 *   subject: string,
 *   description?: string,
 *   studentIds: string[],
 *   payBy?: ISOString,
 *   feeTk: number,
 *   currency?: 'BDT'
 * }
 *
 * Flow:
 *  1) Create a private Post (this IS the course).
 *  2) For each student, upsert TeacherRequest + notify (no EnrollmentInvite).
 *
 * IMPORTANT: We use RAW INSERT for Post to bypass any Mongoose post-save hooks
 * that might be auto-creating EnrollmentInvite. This avoids the validation error
 * you’re seeing from a hidden middleware.
 */
async function createPrivateCourse(req, res) {
  console.log('[PCC] createPrivateCourse ENTER (NO EnrollmentInvite path). Body =', {
    title: req.body?.title,
    subject: req.body?.subject,
    feeTk: req.body?.feeTk,
    students: Array.isArray(req.body?.studentIds) ? req.body.studentIds.length : 0,
  });

  const { id: teacherId, role } = resolveTeacher(req);
  if (!teacherId) return res.status(401).json({ error: 'Unauthorized', message: 'Missing user' });
  if (role && role !== 'teacher') return res.status(403).json({ error: 'Forbidden', message: 'Teacher only' });

  const {
    title,
    subject,
    description,
    studentIds = [],
    payBy,
    feeTk,
    currency = 'BDT',
  } = req.body || {};

  if (!title || !subject) {
    return res.status(400).json({ error: 'validation', message: 'title and subject are required' });
  }
  if (!Array.isArray(studentIds) || studentIds.length === 0) {
    return res.status(400).json({ error: 'validation', message: 'studentIds[] must contain at least one id' });
  }
  const feeNum = Number(feeTk);
  if (!(feeNum > 0)) {
    return res.status(400).json({ error: 'validation', message: 'feeTk must be > 0' });
  }

  try {
    // 1) Create the private course (Post) — RAW INSERT to SKIP MONGOOSE HOOKS
    const postDoc = {
      title: String(title),
      subjects: [String(subject)],
      teacherId,
      visibility: 'private',
      feeTk: Math.round(feeNum),
      currency: String(currency || 'BDT'),
      description: description ? String(description) : '',
      payByAt: parseISOorNull(payBy) || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    console.log('[PCC] RAW INSERT MODE for Post.collection.insertOne (bypasses save hooks)');
    const insertRes = await Post.collection.insertOne(postDoc);
    const postId = insertRes.insertedId;
    postDoc._id = postId;
    console.log('[PCC] Post RAW inserted:', String(postId));

    // 2) Link students via TeacherRequest + notify
    const uniqueStudentIds = Array.from(new Set(studentIds.map(String)));
    let processed = 0;
    let notified = 0;

    for (const sidStr of uniqueStudentIds) {
      const studentId = toObjectId(sidStr);
      if (!studentId) {
        console.warn('[PCC] invalid studentId in payload:', sidStr);
        return res.status(400).json({ error: 'validation', message: `Invalid studentId: ${sidStr}` });
      }

      const up = await TeacherRequest.updateOne(
        { studentId, teacherId, postId },
        { $setOnInsert: { status: 'approved' } },
        { upsert: true }
      );
      console.log('[PCC] TeacherRequest.upsert result for', String(studentId), up);
      processed++;

      // Best-effort notification
      try {
        const notif = new Notification({
          userId: studentId,
          senderId: teacherId,
          senderName: 'Teacher',
          type: 'private_course_created',
          title: 'New Private Course',
          message: `Your teacher created a private course “${title}” (৳${Math.round(feeNum)} / month).`,
          data: { postId: String(postId) },
          read: false,
        });
        await notif.save();
        if (global.emitToUser) {
          global.emitToUser(String(studentId), 'new_notification', {
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
        notified++;
      } catch (e) {
        console.warn('[PCC] notification failed for', String(studentId), e?.message);
      }
    }

    console.log('[PCC] createPrivateCourse DONE. postId=', String(postId), 'processed=', processed, 'notified=', notified);
    return res.json({ ok: true, postId, studentsProcessed: processed, studentsNotified: notified });
  } catch (err) {
    console.error('createPrivateCourse: Error:', err);
    if (err?.name === 'ValidationError') {
      return res.status(400).json({ error: 'validation', message: 'Validation failed', details: err.errors });
    }
    return res.status(500).json({ error: 'Server error' });
  }
}

/**
 * POST /private-courses/:postId/invite
 * Body: { studentIds: string[], note?: string, payBy?: ISOString }
 * Adds more students to an existing private course (Post). Still no EnrollmentInvite.
 */
async function inviteMoreToPrivateCourse(req, res) {
  console.log('[PCC] inviteMoreToPrivateCourse ENTER', { postId: req.params?.postId });
  try {
    const { id: teacherId } = resolveTeacher(req);
    const postId = toObjectId(req.params.postId);
    const { studentIds = [], note, payBy } = req.body || {};

    if (!teacherId) return res.status(401).json({ error: 'Unauthorized', message: 'Unauthorized' });
    if (!postId) return res.status(400).json({ error: 'validation', message: 'Invalid postId' });
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ error: 'validation', message: 'studentIds[] required' });
    }

    const post = await Post.findOne({ _id: postId, teacherId }).lean();
    if (!post || post.visibility !== 'private') {
      return res.status(404).json({ error: 'not_found', message: 'Private course not found' });
    }

    // Optionally refresh the course pay-by date
    if (payBy) {
      await Post.updateOne({ _id: postId }, { $set: { payByAt: parseISOorNull(payBy) } });
    }

    const unique = Array.from(new Set(studentIds.map(String)));
    let added = 0, notified = 0;

    for (const sidStr of unique) {
      const studentId = toObjectId(sidStr);
      if (!studentId) return res.status(400).json({ error: 'validation', message: `Invalid studentId: ${sidStr}` });

      const up = await TeacherRequest.updateOne(
        { studentId, teacherId, postId },
        { $setOnInsert: { status: 'approved' } },
        { upsert: true }
      );
      console.log('[PCC] TeacherRequest.upsert result (invite more) for', String(studentId), up);
      if (up?.upsertedCount > 0) added++;

      try {
        const notif = new Notification({
          userId: studentId,
          senderId: teacherId,
          senderName: 'Teacher',
          type: 'private_course_invite',
          title: 'Added to Private Course',
          message: note
            ? note
            : `You were added to the private course “${post.title}” (৳${Math.round(post.feeTk)} / month).`,
          data: { postId: String(postId) },
          read: false,
        });
        await notif.save();
        if (global.emitToUser) {
          global.emitToUser(String(studentId), 'new_notification', {
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
        notified++;
      } catch (e) {
        console.warn('[PCC] notification failed (invite more) for', String(studentId), e?.message);
      }
    }

    console.log('[PCC] inviteMoreToPrivateCourse DONE. postId=', String(postId), 'added=', added, 'notified=', notified);
    return res.json({ ok: true, added, notified });
  } catch (err) {
    console.error('inviteMoreToPrivateCourse:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

/** GET /private-courses/teacher
 * Lists teacher’s private courses (Posts) + counts from TeacherRequest.
 */
async function listTeacherPrivateCourses(req, res) {
  console.log('[PCC] listTeacherPrivateCourses ENTER');
  try {
    const { id: teacherId } = resolveTeacher(req);
    if (!teacherId) return res.status(401).json({ error: 'Unauthorized', message: 'Unauthorized' });

    const posts = await Post.find({ teacherId, visibility: 'private' })
      .select('_id title subjects feeTk currency payByAt createdAt updatedAt')
      .sort({ createdAt: -1 })
      .lean();

    const postIds = posts.map(p => p._id);
    const reqCounts = await TeacherRequest.aggregate([
      { $match: { postId: { $in: postIds }, teacherId } },
      { $group: { _id: '$postId', count: { $sum: 1 } } },
    ]);

    const byPost = new Map(reqCounts.map(r => [String(r._id), r.count]));
    const result = posts.map(p => ({
      ...p,
      requests: { approvedCount: byPost.get(String(p._id)) || 0 },
    }));

    return res.json(result);
  } catch (err) {
    console.error('listTeacherPrivateCourses:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

/** GET /private-courses/student
 * Shows student the private courses (Posts) they’re attached to via TeacherRequest.
 */
async function listStudentPrivateCourseInvites(req, res) {
  console.log('[PCC] listStudentPrivateCourseInvites ENTER');
  try {
    const id =
      (req.user && (req.user._id || req.user.id)) ||
      req.userId ||
      (req.auth && (req.auth._id || req.auth.id));
    const studentId = toObjectId(id);
    if (!studentId) return res.status(401).json({ error: 'Unauthorized', message: 'Unauthorized' });

    const tr = await TeacherRequest.find({ studentId })
      .select('postId teacherId status createdAt')
      .populate({ path: 'postId', select: '_id title subjects feeTk currency visibility payByAt', match: { visibility: 'private' } })
      .populate({ path: 'teacherId', select: '_id name profileImage' })
      .sort({ createdAt: -1 })
      .lean();

    const rows = tr
      .filter(x => x.postId && x.postId.visibility === 'private')
      .map(x => ({
        _id: x._id,
        postId: x.postId._id,
        teacherId: x.teacherId?._id,
        teacher: x.teacherId ? { _id: x.teacherId._id, name: x.teacherId.name, profileImage: x.teacherId.profileImage } : null,
        title: x.postId.title,
        subjects: x.postId.subjects,
        feeTk: x.postId.feeTk,
        currency: x.postId.currency,
        payByAt: x.postId.payByAt || null,
        status: x.status || 'approved',
        createdAt: x.createdAt,
      }));

    return res.json(rows);
  } catch (err) {
    console.error('listStudentPrivateCourseInvites:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

/** POST /private-courses/:courseId/respond  Body: { action: 'accept' | 'decline' }
 * Reflect response in TeacherRequest.status (no EnrollmentInvite involved).
 */
async function respondInvite(req, res) {
  console.log('[PCC] respondInvite ENTER', { courseId: req.params?.courseId, action: req.body?.action });
  try {
    const id =
      (req.user && (req.user._id || req.user.id)) ||
      req.userId ||
      (req.auth && (req.auth._id || req.auth.id));
    const studentId = toObjectId(id);
    if (!studentId) return res.status(401).json({ error: 'Unauthorized', message: 'Unauthorized' });

    const courseId = toObjectId(req.params.courseId);
    const { action } = req.body || {};
    if (!['accept', 'decline'].includes(String(action))) {
      return res.status(400).json({ error: 'validation', message: 'action must be accept or decline' });
    }

    const tr = await TeacherRequest.findOne({ postId: courseId, studentId });
    if (!tr) return res.status(404).json({ error: 'not_found', message: 'Relation not found' });

    tr.status = action === 'accept' ? 'accepted' : 'declined';
    await tr.save();

    try {
      const notif = new Notification({
        userId: tr.teacherId,
        senderId: studentId,
        senderName: 'Student',
        type: 'private_course_response',
        title: 'Private Course Response',
        message: `A student ${action}ed your private course.`,
        data: { postId: String(courseId), action },
        read: false,
      });
      await notif.save();
      if (global.emitToUser) {
        global.emitToUser(String(tr.teacherId), 'new_notification', {
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

    console.log('[PCC] respondInvite DONE', { status: tr.status });
    return res.json({ ok: true, status: tr.status });
  } catch (err) {
    console.error('respondInvite:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

module.exports = {
  createPrivateCourse,
  inviteMoreToPrivateCourse,
  listTeacherPrivateCourses,
  listStudentPrivateCourseInvites,
  respondInvite,
};
