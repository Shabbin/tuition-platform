// server/controllers/scheduleController.js
const Schedule = require('../models/schedule');
const TeacherRequest = require('../models/teacherRequest');
const User = require('../models/user');
const TeacherPost = require('../models/teacherPost');
const Notification = require('../models/Notification');
const Payment = require('../models/payment');

// Helpers
const toDate = (d) => (d instanceof Date ? d : new Date(d));
const uniq = (arr) => [...new Set(arr.map(String))];

// normalize subjects → single combined string (e.g., "Physics | Chemistry | Mathematics")
function combineSubjects(input) {
  if (!input) return '';
  let list = [];
  if (Array.isArray(input)) list = input;
  else if (typeof input === 'string') list = input.split('|');
  else list = [String(input)];
  const cleaned = list.map((s) => String(s).trim()).filter(Boolean);
  return uniq(cleaned).join(' | ');
}

// next sequence for (teacher ↔ student) across all posts, demo only
async function nextDemoSequence(teacherId, studentId) {
  const existing = await Schedule.find({ teacherId, studentIds: studentId, type: 'demo' })
    .select('sequenceNumber')
    .lean();
  const maxSeq = existing.reduce(
    (m, s) => (typeof s.sequenceNumber === 'number' ? Math.max(m, s.sequenceNumber) : m),
    0
  );
  const baseline = maxSeq || existing.length; // legacy fallback
  return baseline + 1;
}

// completed demo count for gating (kept for reference/metrics)
async function completedDemoCount(teacherId, studentId) {
  return Schedule.countDocuments({
    teacherId,
    studentIds: studentId,
    type: 'demo',
    status: 'completed',
  });
}

// NEW: active-or-completed demo count (hard cap uses this)
async function demoCount(teacherId, studentId) {
  return Schedule.countDocuments({
    teacherId,
    studentIds: studentId,
    type: 'demo',
    status: { $in: ['scheduled', 'completed'] }, // cancelled does NOT count
  });
}

// Create schedule
exports.createSchedule = async (req, res) => {
  try {
    let { postId, studentIds, subject, subjects, type, date, durationMinutes } = req.body;
    const teacherId = req.user.id;

    if (!postId || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ message: 'postId and studentIds[] are required' });
    }
    if (!type || !date || !durationMinutes) {
      return res.status(400).json({ message: 'type, date, durationMinutes are required' });
    }

    studentIds = uniq(studentIds);
    const startTime = toDate(date);
    const durationMs = Number(durationMinutes) * 60_000;
    const endTime = new Date(startTime.getTime() + durationMs);

    // 1) Validate post ownership
    const post = await TeacherPost.findOne({ _id: postId, teacher: teacherId }).select('_id subjects title');
    if (!post) return res.status(404).json({ message: 'Post not found or unauthorized' });

    // Build combined subject string
    let combinedSubject =
      combineSubjects(subjects) || combineSubjects(subject) || combineSubjects(post?.subjects);
    if (!combinedSubject) return res.status(400).json({ message: 'At least one subject is required' });

    // 2) Ensure all students have APPROVED requests for this post
    const approvedRequests = await TeacherRequest.find({
      teacherId,
      postId,
      studentId: { $in: studentIds },
      status: 'approved',
    }).select('studentId');
    if (approvedRequests.length !== studentIds.length) {
      return res.status(400).json({ message: 'Some students are not approved for this post' });
    }

    // DEMO GATE — HARD CAP: block if (scheduled OR completed) >= 3 for any selected student
    if (type === 'demo') {
      const overCap = [];
      for (const sid of studentIds) {
        const total = await demoCount(teacherId, sid); // counts scheduled+completed
        if (total >= 3) overCap.push(sid);
      }
      if (overCap.length > 0) {
        return res.status(409).json({
          message: 'Demo limit reached (max 3 demo classes per student).',
          blockedStudentIds: overCap,
        });
      }
    }

    // 3) Time conflict checks
    // Teacher conflict
    const teacherConflict = await Schedule.findOne({
      teacherId,
      status: 'scheduled',
      date: { $lt: endTime },
      $expr: {
        $gt: [{ $add: ['$date', { $multiply: ['$durationMinutes', 60000] }] }, startTime],
      },
    }).select('_id date durationMinutes');
    if (teacherConflict) {
      return res
        .status(400)
        .json({ message: 'Time conflict: teacher already has a class in this slot' });
    }

    // Student conflict
    const studentConflict = await Schedule.findOne({
      studentIds: { $in: studentIds },
      status: 'scheduled',
      date: { $lt: endTime },
      $expr: {
        $gt: [{ $add: ['$date', { $multiply: ['$durationMinutes', 60000] }] }, startTime],
      },
    }).select('_id date durationMinutes studentIds');
    if (studentConflict) {
      return res
        .status(400)
        .json({ message: 'Time conflict: one or more students already have a class in this slot' });
    }

    // 4) Persist
    // For DEMO create one schedule per student (per-pair sequenceNumber)
    let created = [];
    if (type === 'demo') {
      for (const sid of studentIds) {
        const seq = await nextDemoSequence(teacherId, sid);
        const schedule = await Schedule.create({
          teacherId,
          postId,
          studentIds: [sid],
          subject: combinedSubject,
          type,
          date: startTime,
          durationMinutes,
          status: 'scheduled',
          sequenceNumber: seq,
        });
        created.push(schedule);
      }
    } else {
      // regular: single schedule can include multiple students
      const schedule = await Schedule.create({
        teacherId,
        postId,
        studentIds,
        subject: combinedSubject,
        type,
        date: startTime,
        durationMinutes,
        status: 'scheduled',
        sequenceNumber: null,
      });
      created.push(schedule);
    }

    // 5) Notify students
    const teacher = await User.findById(teacherId).select('name profileImage');
    const senderName = teacher?.name || req.user?.name || 'Teacher';
    const senderImage = teacher?.profileImage || req.user?.profileImage || '/default-avatar.png';

    for (const schedule of created) {
      for (const sid of schedule.studentIds) {
        const student = await User.findById(sid).select('name profileImage');

        const notif = new Notification({
          userId: sid,
          senderId: teacherId,
          senderName,
          profileImage: senderImage,
          type: 'new_schedule',
          title: 'New Class Scheduled',
          message: `Hi ${student?.name || 'Student'}, ${senderName} scheduled a ${schedule.type} class for ${schedule.subject}`,
          data: {
            scheduleId: schedule._id,
            postId,
            schedule: {
              id: String(schedule._id),
              type: schedule.type,
              date: schedule.date,
              subject: schedule.subject,
              sequenceNumber: schedule.sequenceNumber,
            },
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
        }
      }
    }

    return res.status(201).json({
      message: 'Schedule created',
      schedule: created.length === 1 ? created[0] : created,
    });
  } catch (err) {
    console.error('Error creating schedule:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// GET /api/schedules/eligible-students?postId=...&type=demo|regular
exports.getEligibleStudents = async (req, res) => {
  try {
    const { postId, type } = req.query;
    if (!postId) return res.status(400).json({ error: 'postId is required' });

    // sanity: ensure the requesting teacher owns this post
    const post = await TeacherPost.findById(postId).select('_id teacher');
    if (!post) return res.status(404).json({ error: 'Post not found' });
    const teacherId = String(post.teacher);

    // all approved requests for this post
    const approved = await TeacherRequest.find({
      postId,
      status: 'approved',
    })
      .select('_id studentId teacherId')
      .populate('studentId', 'name profileImage')
      .populate('teacherId', '_id');

    const requestIds = approved.map((r) => r._id);
    const studentIds = approved.map((r) => r.studentId?._id || r.studentId);

    // 1) payments that reference the requestId (new, correct way)
    const paidByRequest = await Payment.find({
      type: 'TUITION',
      status: 'PAID',
      requestId: { $in: requestIds },
    }).select('requestId');

    const paidReqSet = new Set(paidByRequest.map((p) => String(p.requestId)));

    // 2) legacy payments without requestId: fallback by (studentId + teacherId) pair
    const pairPaid = await Payment.find({
      type: 'TUITION',
      status: 'PAID',
      requestId: null,
      studentId: { $in: studentIds },
      teacherId, // same teacher as the post owner
    }).select('studentId teacherId');

    const pairPaidKeys = new Set(
      pairPaid.map((p) => `${String(p.studentId)}::${String(p.teacherId)}`)
    );

    const toThinItem = (r) => ({
      requestId: r._id,
      studentId: r.studentId, // {_id,name,profileImage}
      teacherId: r.teacherId?._id || r.teacherId,
    });

    const paidList = [];
    const demoList = [];

    for (const r of approved) {
      const rid = String(r._id);
      const sid = String(r.studentId?._id || r.studentId);
      const tid = String(r.teacherId?._id || r.teacherId);

      const isPaidByRequest = paidReqSet.has(rid);
      const isPaidByPair = pairPaidKeys.has(`${sid}::${tid}`);

      if (isPaidByRequest || isPaidByPair) {
        paidList.push(toThinItem(r));
      } else {
        demoList.push(toThinItem(r));
      }
    }

    if (type === 'demo') return res.json(demoList);
    if (type === 'regular') return res.json(paidList);
    return res.json({ demo: demoList, regular: paidList });
  } catch (err) {
    console.error('getEligibleStudents', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// Get schedules for teacher
exports.getSchedulesForTeacher = async (req, res) => {
  try {
    const teacherId = req.user.id;
    const schedules = await Schedule.find({ teacherId })
      .populate('postId', 'title subjects status')
      .populate('studentIds', 'name profileImage');
    return res.json(schedules);
  } catch (err) {
    console.error('Error fetching teacher schedules:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Get schedules for student (privacy: no other students’ identities)
exports.getSchedulesForStudent = async (req, res) => {
  try {
    const studentId = req.user.id;
    const schedules = await Schedule.find({ studentIds: studentId })
      .populate('postId', 'title subjects status')
      .populate('teacherId', 'name profileImage')
      .select(
        '_id teacherId postId studentIds subject type date durationMinutes status sequenceNumber createdAt updatedAt'
      );

    const sanitized = schedules.map((s) => ([
      s._id,
      s.postId ? { _id: s.postId._id, title: s.postId.title } : null,
      s.teacherId
        ? { _id: s.teacherId._id, name: s.teacherId.name, profileImage: s.teacherId.profileImage }
        : null,
      s.subject,
      s.type,
      s.date,
      s.durationMinutes,
      s.status,
      typeof s.sequenceNumber === 'number' ? s.sequenceNumber : null,
      Array.isArray(s.studentIds) ? s.studentIds.length : 1,
      s.createdAt,
      s.updatedAt,
    ])).map(([id, postId, teacher, subject, type, date, durationMinutes, status, seq, count, createdAt, updatedAt]) => ({
      _id: id,
      postId,
      teacherId: teacher,
      subject,
      type,
      date,
      durationMinutes,
      status,
      sequenceNumber: seq,
      participantsCount: count,
      createdAt,
      updatedAt,
    }));

    return res.json(sanitized);
  } catch (err) {
    console.error('Error fetching student schedules:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Cancel schedule (with notifications)
exports.cancelSchedule = async (req, res) => {
  try {
    const { id } = req.params;
    const teacherId = req.user.id;

    const schedule = await Schedule.findOne({ _id: id, teacherId });
    if (!schedule) return res.status(404).json({ message: 'Schedule not found' });

    if (schedule.status === 'cancelled') {
      return res.status(200).json({ message: 'Schedule already cancelled', schedule });
    }

    schedule.status = 'cancelled';
    await schedule.save();

    const teacher = await User.findById(teacherId).select('name profileImage');
    const senderName = teacher?.name || req.user?.name || 'Teacher';
    const senderImage = teacher?.profileImage || req.user?.profileImage || '/default-avatar.png';

    for (const sid of schedule.studentIds) {
      const notif = new Notification({
        userId: sid,
        senderId: teacherId,
        senderName,
        profileImage: senderImage,
        type: 'schedule_cancelled',
        title: 'Class Cancelled',
        message: `${senderName} cancelled a ${schedule.type} class for ${schedule.subject}`,
        data: { scheduleId: schedule._id, postId: schedule.postId },
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
      }
    }

    return res.json({ message: 'Schedule cancelled', schedule });
  } catch (err) {
    console.error('Error cancelling schedule:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Mark schedule completed (attended) → used for the 3-demo gate (metrics/UX)
exports.completeSchedule = async (req, res) => {
  try {
    const { id } = req.params;
    const teacherId = req.user.id;

    const schedule = await Schedule.findOne({ _id: id, teacherId });
    if (!schedule) return res.status(404).json({ message: 'Schedule not found' });

    if (schedule.type !== 'demo') {
      return res.status(400).json({ message: 'Only demo classes can be completed via this endpoint' });
    }

    if (schedule.status === 'completed') {
      return res.status(200).json({ message: 'Already completed', schedule });
    }

    schedule.status = 'completed';
    await schedule.save();

    return res.json({ message: 'Schedule marked completed', schedule });
  } catch (err) {
    console.error('Error completing schedule:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
