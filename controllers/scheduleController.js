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

exports.createSchedule = async (req, res) => {
  try {
    let { postId, studentIds, subject, subjects, type, date, durationMinutes, requireAgreement } = req.body;
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

    // DEMO GATE — HARD CAP
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

    // 3) Time conflict checks (only against already scheduled)
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
    const created = [];
    const teacher = await User.findById(teacherId).select('name profileImage');
    const senderName = teacher?.name || req.user?.name || 'Teacher';
    const senderImage = teacher?.profileImage || req.user?.profileImage || '/default-avatar.png';

    if (type === 'demo') {
      // DEMO
      const wantsAgreement = Boolean(requireAgreement);
      if (wantsAgreement) {
        // Create one proposed invite PER student (simpler acceptance + later sequence assignment)
        for (const sid of studentIds) {
          const schedule = await Schedule.create({
            teacherId,
            postId,
            studentIds: [sid],
            subject: combinedSubject,
            type,
            date: startTime,
            durationMinutes,
            status: 'proposed',
            sequenceNumber: null,       // assign on acceptance
            requiresAcceptance: true,
            pendingBy: [sid],           // student must accept
            agreedBy: [teacherId],      // teacher already agreed by proposing
          });
          created.push(schedule);
        }
      } else {
        // Immediate demo scheduling (legacy)
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
            requiresAcceptance: false,
            pendingBy: [],
            agreedBy: [],
          });
          created.push(schedule);
        }
      }
    } else {
      // REGULAR
      const wantsAgreement = Boolean(requireAgreement);
      if (wantsAgreement) {
        // Create a single proposed schedule (multi-student) requiring acceptance
        const schedule = await Schedule.create({
          teacherId,
          postId,
          studentIds,
          subject: combinedSubject,
          type,
          date: startTime,
          durationMinutes,
          status: 'proposed',              // 👈 not locked yet
          sequenceNumber: null,
          requiresAcceptance: true,        // 👈 agreement flow enabled
          pendingBy: studentIds,           // students must accept
          agreedBy: [teacherId],           // teacher already agreed by proposing
        });
        created.push(schedule);
      } else {
        // Immediate regular scheduling (previous behavior)
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
          requiresAcceptance: false,
          pendingBy: [],
          agreedBy: [],
        });
        created.push(schedule);
      }
    }

    // 5) Notify students
    for (const schedule of created) {
      // choose the right notification type + message
      const isProposed = schedule.status === 'proposed' && schedule.requiresAcceptance;
      const notifType = isProposed ? 'schedule_proposed' : 'new_schedule';
      const notifTitle = isProposed ? 'Class Proposal' : 'New Class Scheduled';
      const notifMessage = isProposed
        ? `Hi, ${senderName} proposed a ${schedule.type} class for ${schedule.subject}. Please review and accept.`
        : `Hi, ${senderName} scheduled a ${schedule.type} class for ${schedule.subject}.`;

      for (const sid of schedule.studentIds) {
        const student = await User.findById(sid).select('name profileImage');

        const notif = new Notification({
          userId: sid,
          senderId: teacherId,
          senderName,
          profileImage: senderImage,
          type: notifType,
          title: notifTitle,
          message: notifMessage,
          data: {
            scheduleId: String(schedule._id),
            postId: String(postId),
            schedule: {
              id: String(schedule._id),
              type: schedule.type,
              date: schedule.date,
              subject: schedule.subject,
              sequenceNumber: schedule.sequenceNumber,
              requiresAcceptance: schedule.requiresAcceptance,
              status: schedule.status,
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
          // If proposed → let client open “awaiting your acceptance”
          global.emitToUser(String(sid), 'schedules_refresh', {
            reason: isProposed ? 'schedule_proposed' : 'new_schedule',
            scheduleId: String(schedule._id),
          });
        }
      }
    }

    return res.status(201).json({
      message: created.length === 1
        ? (created[0].status === 'proposed' ? 'Schedule proposed (awaiting acceptance)' : 'Schedule created')
        : 'Schedules created',
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

// ---- New tiny helper for ranged queries (used below) ----
function parseRange(req) {
  const now = new Date();
  const startDefault = new Date(now); startDefault.setDate(startDefault.getDate() - 30);
  const endDefault = new Date(now);   endDefault.setDate(endDefault.getDate() + 30);

  const from = req.query.from ? new Date(req.query.from) : startDefault;
  const to   = req.query.to   ? new Date(req.query.to)   : endDefault;

  // guard invalids
  const fromValid = !isNaN(from.getTime()) ? from : startDefault;
  const toValid   = !isNaN(to.getTime())   ? to   : endDefault;

  return { from: fromValid, to: toValid };
}

// Get schedules for student (privacy: no other students’ identities)
// NOW SUPPORTS ?from=&to= (ISO dates); defaults to ±30 days window.
exports.getSchedulesForStudent = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { from, to } = parseRange(req);

    const q = {
      studentIds: studentId,
      date: { $gte: from, $lte: to },
      status: { $in: ['scheduled', 'completed', 'cancelled'] },
    };

    const schedules = await Schedule.find(q)
      .sort({ date: 1 })
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
      // 👉 stays: also push a direct schedules-refresh ping
      if (global.emitToUser) {
        global.emitToUser(String(sid), 'schedules_refresh', {
          reason: 'schedule_cancelled',
          scheduleId: String(schedule._id),
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

    // ✅ require it to be scheduled first
    if (schedule.status !== 'scheduled') {
      return res.status(400).json({ message: 'Only scheduled classes can be completed' });
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

// ✅ NEW: student cancels their participation / or the whole class if lone participant
exports.cancelScheduleByStudent = async (req, res) => {
  try {
    const { id } = req.params;
    const studentId = req.user.id;

    const schedule = await Schedule.findOne({ _id: id, studentIds: studentId });
    if (!schedule) return res.status(404).json({ message: 'Schedule not found' });
    if (schedule.status === 'cancelled') return res.json({ message: 'Already cancelled', schedule });

    // If more than one student, remove only this student
    if (Array.isArray(schedule.studentIds) && schedule.studentIds.length > 1) {
      await Schedule.updateOne({ _id: id }, { $pull: { studentIds: studentId } });
      // Also clean up proposal trackers so nothing is stranded
      await Schedule.updateOne({ _id: id }, { $pull: { pendingBy: studentId, agreedBy: studentId } });

      const notif = new Notification({
        userId: schedule.teacherId,
        senderId: studentId,
        senderName: 'Student',
        profileImage: '/default-avatar.png',
        type: 'schedule_cancelled',
        title: 'Student left a class',
        message: 'A student removed themselves from a scheduled class.',
        data: { scheduleId: schedule._id, partial: true, by: 'student' },
        read: false,
      });
      await notif.save();

      if (global.emitToUser) {
        global.emitToUser(String(schedule.teacherId), 'new_notification', {
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

      return res.json({ message: 'You left the class', partial: true });
    }

    // single-student class → cancel whole schedule
    schedule.status = 'cancelled';
    await schedule.save();

    const payload = {
      type: 'schedule_cancelled',
      title: 'Class Cancelled',
      message: 'The student cancelled the class.',
      data: { scheduleId: schedule._id, by: 'student' },
      read: false,
    };

    const notifTeacher = new Notification({
      userId: schedule.teacherId,
      senderId: studentId,
      senderName: 'Student',
      profileImage: '/default-avatar.png',
      ...payload,
    });
    await notifTeacher.save();

    const notifStudent = new Notification({
      userId: studentId,
      senderId: schedule.teacherId,
      senderName: 'Teacher',
      profileImage: '/default-avatar.png',
      ...payload,
    });
    await notifStudent.save();

    if (global.emitToUser) {
      global.emitToUser(String(schedule.teacherId), 'new_notification', {
        _id: String(notifTeacher._id),
        senderId: notifTeacher.senderId,
        senderName: notifTeacher.senderName,
        profileImage: notifTeacher.profileImage,
        type: notifTeacher.type,
        title: notifTeacher.title,
        message: notifTeacher.message,
        data: notifTeacher.data,
        read: notifTeacher.read,
        createdAt: notifTeacher.createdAt,
      });
      global.emitToUser(String(studentId), 'new_notification', {
        _id: String(notifStudent._id),
        senderId: notifStudent.senderId,
        senderName: notifStudent.senderName,
        profileImage: notifStudent.profileImage,
        type: notifStudent.type,
        title: notifStudent.title,
        message: notifStudent.message,
        data: notifStudent.data,
        read: notifStudent.read,
        createdAt: notifStudent.createdAt,
      });
    }

    return res.json({ message: 'Class cancelled', schedule });
  } catch (err) {
    console.error('cancelScheduleByStudent', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// server/controllers/scheduleController.js (more)
exports.acceptProposedSchedule = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { id } = req.params;

    const s = await Schedule.findById(id);
    if (!s) return res.status(404).json({ message: 'Schedule not found' });
    if (!s.requiresAcceptance || s.status !== 'proposed')
      return res.status(400).json({ message: 'Schedule is not awaiting agreement' });
    if (!s.studentIds.map(String).includes(String(studentId)))
      return res.status(403).json({ message: 'Not allowed' });

    // 🔒 Idempotency guard
    const isPending = (s.pendingBy || []).map(String).includes(String(studentId));
    const alreadyAgreed = (s.agreedBy || []).map(String).includes(String(studentId));
    if (!isPending && alreadyAgreed) {
      return res.status(409).json({ message: 'You have already accepted this proposal' });
    }
    if (!isPending && !alreadyAgreed) {
      return res.status(409).json({ message: 'You have already responded to this proposal' });
    }

    // move this student from pending to agreed
    s.pendingBy = (s.pendingBy || []).filter(x => String(x) !== String(studentId));
    if (!s.agreedBy) s.agreedBy = [];
    if (!s.agreedBy.map(String).includes(String(studentId))) s.agreedBy.push(studentId);

    // if all accepted -> re-check caps & conflicts, then schedule
    if ((s.pendingBy || []).length === 0) {
      const startTime = s.date;
      const endTime   = new Date(s.date.getTime() + s.durationMinutes * 60000);

      // DEMO: enforce cap again at acceptance time
      if (s.type === 'demo') {
        const total = await demoCount(String(s.teacherId), String(studentId)); // scheduled+completed
        if (total >= 3) {
          await s.save(); // persist acceptance but keep state
          return res.status(409).json({ message: 'Demo limit reached at acceptance time.', code: 'DEMO_CAP' });
        }
      }

      // re-check teacher conflicts (excluding this doc)
      const teacherConflict = await Schedule.findOne({
        _id: { $ne: s._id },
        teacherId: s.teacherId,
        status: 'scheduled',
        date: { $lt: endTime },
        $expr: {
          $gt: [{ $add: ['$date', { $multiply: ['$durationMinutes', 60000] }] }, startTime],
        },
      }).select('_id');

      // re-check any student conflicts (excluding this doc)
      const studentConflict = await Schedule.findOne({
        _id: { $ne: s._id },
        studentIds: { $in: s.studentIds },
        status: 'scheduled',
        date: { $lt: endTime },
        $expr: {
          $gt: [{ $add: ['$date', { $multiply: ['$durationMinutes', 60000] }] }, startTime],
        },
      }).select('_id');

      if (teacherConflict || studentConflict) {
        // save acceptance but keep proposed; tell client to choose a new time
        await s.save();
        return res.status(409).json({ message: 'Time conflict detected. Please propose a new time.', pendingBy: s.pendingBy, agreedBy: s.agreedBy });
      }

      // For demo invites, assign sequence number at the moment it becomes scheduled
      if (s.type === 'demo') {
        const seq = await nextDemoSequence(String(s.teacherId), String(studentId));
        s.sequenceNumber = seq;
      }

      s.status = 'scheduled';
      s.requiresAcceptance = false;
      s.pendingBy = [];
    }

    await s.save();

    // notify teacher
    const notif = new Notification({
      userId: s.teacherId,
      senderId: studentId,
      senderName: 'Student',
      profileImage: '/default-avatar.png',
      type: 'schedule_proposal_update',
      title: 'Proposal accepted',
      message: 'A student accepted the proposed class time.',
      data: { scheduleId: String(s._id), state: s.status },
      read: false,
    });
    await notif.save();
    if (global.emitToUser) {
      global.emitToUser(String(s.teacherId), 'new_notification', {
        _id: String(notif._id), senderId: notif.senderId, senderName: notif.senderName,
        profileImage: notif.profileImage, type: notif.type, title: notif.title,
        message: notif.message, data: notif.data, read: notif.read, createdAt: notif.createdAt,
      });
      // both sides refresh lists
      global.emitToUser(String(s.teacherId), 'schedules_refresh', { scheduleId: String(s._id) });
      for (const sid of s.studentIds) {
        global.emitToUser(String(sid), 'schedules_refresh', { scheduleId: String(s._id) });
      }
    }

    res.json({ ok: true, status: s.status, pendingBy: s.pendingBy, agreedBy: s.agreedBy });
  } catch (e) {
    console.error('acceptProposal', e);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.rejectProposedSchedule = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { id } = req.params;

    const s = await Schedule.findById(id);
    if (!s) return res.status(404).json({ message: 'Schedule not found' });
    if (!s.requiresAcceptance || s.status !== 'proposed')
      return res.status(400).json({ message: 'Schedule is not awaiting agreement' });
    if (!s.studentIds.map(String).includes(String(studentId)))
      return res.status(403).json({ message: 'Not allowed' });

    // 🔒 Idempotency guard (already not pending?)
    const isPending = (s.pendingBy || []).map(String).includes(String(studentId));
    if (!isPending) {
      return res.status(409).json({ message: 'You have already responded to this proposal' });
    }

    // Remove rejecting student from participants and trackers
    s.studentIds = (s.studentIds || []).filter(x => String(x) !== String(studentId));
    s.pendingBy  = (s.pendingBy  || []).filter(x => String(x) !== String(studentId));
    s.agreedBy   = (s.agreedBy   || []).filter(x => String(x) !== String(studentId));

    if (s.studentIds.length === 0) {
      // No one left → cancel the proposal entirely
      s.status = 'cancelled';
    } else {
      // If all remaining students have agreed, try to schedule now
      const everyoneAccepted = s.studentIds
        .map(String)
        .every(id => (s.agreedBy || []).map(String).includes(id));

      if (everyoneAccepted) {
        const startTime = s.date;
        const endTime   = new Date(s.date.getTime() + s.durationMinutes * 60000);

        const teacherConflict = await Schedule.findOne({
          _id: { $ne: s._id },
          teacherId: s.teacherId,
          status: 'scheduled',
          date: { $lt: endTime },
          $expr: {
            $gt: [{ $add: ['$date', { $multiply: ['$durationMinutes', 60000] }] }, startTime],
          },
        }).select('_id');

        const studentConflict = await Schedule.findOne({
          _id: { $ne: s._id },
          studentIds: { $in: s.studentIds },
          status: 'scheduled',
          date: { $lt: endTime },
          $expr: {
            $gt: [{ $add: ['$date', { $multiply: ['$durationMinutes', 60000] }] }, startTime],
          },
        }).select('_id');

        if (!teacherConflict && !studentConflict) {
          s.status = 'scheduled';
          s.requiresAcceptance = false;
          s.pendingBy = [];
        } else {
          s.status = 'proposed';
        }
      } else {
        s.status = 'proposed';
      }
    }

    await s.save();

    // notify teacher
    const notif = new Notification({
      userId: s.teacherId,
      senderId: studentId,
      senderName: 'Student',
      profileImage: '/default-avatar.png',
      type: 'schedule_proposal_update',
      title: 'Proposal rejected',
      message: 'A student rejected the proposed class time.',
      data: { scheduleId: String(s._id), state: s.status },
      read: false,
    });
    await notif.save();
    if (global.emitToUser) {
      global.emitToUser(String(s.teacherId), 'new_notification', {
        _id: String(notif._id), senderId: notif.senderId, senderName: notif.senderName,
        profileImage: notif.profileImage, type: notif.type, title: notif.title,
        message: notif.message, data: notif.data, read: notif.read, createdAt: notif.createdAt,
      });
      global.emitToUser(String(s.teacherId), 'schedules_refresh', { scheduleId: String(s._id) });
      for (const sid of s.studentIds) {
        global.emitToUser(String(sid), 'schedules_refresh', { scheduleId: String(s._id) });
      }
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('rejectProposal', e);
    res.status(500).json({ message: 'Server error' });
  }
};

// --- RESPOND (student accept/reject) ---
exports.respondSchedule = async (req, res) => {
  try {
    const studentId = String(req.user.id);
    const { id } = req.params;
    const { action } = req.body; // 'accept' | 'reject'

    const sc = await Schedule.findById(id);
    if (!sc) return res.status(404).json({ message: 'Schedule not found' });

    if (!sc.studentIds.map(String).includes(studentId)) {
      return res.status(403).json({ message: 'Not part of this schedule' });
    }
    if (!sc.requiresAcceptance || sc.status !== 'proposed') {
      return res.status(400).json({ message: 'Not awaiting acceptance' });
    }

    const wasPending = (sc.pendingBy || []).map(String).includes(studentId);
    const alreadyAgreed = (sc.agreedBy || []).map(String).includes(studentId);

    // 🔒 Idempotency guard
    if (!wasPending && alreadyAgreed && action === 'accept') {
      return res.status(409).json({ message: 'You have already accepted this proposal' });
    }
    if (!wasPending && action === 'reject') {
      return res.status(409).json({ message: 'You have already responded to this proposal' });
    }

    if (action === 'reject') {
      // partial reject: remove student and trackers; only cancel if no one left
      sc.studentIds = (sc.studentIds || []).filter(x => String(x) !== String(studentId));
      sc.pendingBy  = (sc.pendingBy  || []).filter(x => String(x) !== String(studentId));
      sc.agreedBy   = (sc.agreedBy   || []).filter(x => String(x) !== String(studentId));

      if (sc.studentIds.length === 0) {
        sc.status = 'cancelled';
      } else {
        // If all remaining accepted, try to schedule after conflict checks
        const everyoneAccepted = sc.studentIds
          .map(String)
          .every(id => (sc.agreedBy || []).map(String).includes(id));

        if (everyoneAccepted) {
          const startTime = sc.date;
          const endTime   = new Date(sc.date.getTime() + sc.durationMinutes * 60000);

          const teacherConflict = await Schedule.findOne({
            _id: { $ne: sc._id },
            teacherId: sc.teacherId,
            status: 'scheduled',
            date: { $lt: endTime },
            $expr: {
              $gt: [{ $add: ['$date', { $multiply: ['$durationMinutes', 60000] }] }, startTime],
            },
          }).select('_id');

          const studentConflict = await Schedule.findOne({
            _id: { $ne: sc._id },
            studentIds: { $in: sc.studentIds },
            status: 'scheduled',
            date: { $lt: endTime },
            $expr: {
              $gt: [{ $add: ['$date', { $multiply: ['$durationMinutes', 60000] }] }, startTime],
            },
          }).select('_id');

          if (!teacherConflict && !studentConflict) {
            sc.status = 'scheduled';
            sc.requiresAcceptance = false;
            sc.pendingBy = [];
          } else {
            sc.status = 'proposed';
          }
        } else {
          sc.status = 'proposed';
        }
      }

      await sc.save();
    } else {
      // accept → remove from pending, add to agreed
      const pending = new Set(sc.pendingBy.map(String));
      pending.delete(studentId);
      sc.pendingBy = [...pending];

      const agreed = new Set((sc.agreedBy || []).map(String));
      agreed.add(studentId);
      sc.agreedBy = [...agreed];

      // if *all* students accepted → re-check caps & conflicts then go live
      const allStudentIds = sc.studentIds.map(String);
      const everyoneAccepted = allStudentIds.every(id => sc.agreedBy.map(String).includes(id));
      if (everyoneAccepted) {
        const startTime = sc.date;
        const endTime   = new Date(sc.date.getTime() + sc.durationMinutes * 60000);

        // DEMO: enforce cap again at acceptance time
        if (sc.type === 'demo') {
          const total = await demoCount(String(sc.teacherId), String(studentId));
          if (total >= 3) {
            await sc.save(); // persist acceptance but keep state
            return res.status(409).json({ message: 'Demo limit reached at acceptance time.', code: 'DEMO_CAP' });
          }
        }

        const teacherConflict = await Schedule.findOne({
          _id: { $ne: sc._id },
          teacherId: sc.teacherId,
          status: 'scheduled',
          date: { $lt: endTime },
          $expr: {
            $gt: [{ $add: ['$date', { $multiply: ['$durationMinutes', 60000] }] }, startTime],
          },
        }).select('_id');

        const studentConflict = await Schedule.findOne({
          _id: { $ne: sc._id },
          studentIds: { $in: sc.studentIds },
          status: 'scheduled',
          date: { $lt: endTime },
          $expr: {
            $gt: [{ $add: ['$date', { $multiply: ['$durationMinutes', 60000] }] }, startTime],
          },
        }).select('_id');

        if (teacherConflict || studentConflict) {
          await sc.save(); // save acceptance changes but keep as proposed
          return res.status(409).json({ message: 'Time conflict detected. Please propose a new time.', pendingBy: sc.pendingBy, agreedBy: sc.agreedBy });
        }

        // For demo invites, assign sequence number now
        if (sc.type === 'demo') {
          const seq = await nextDemoSequence(String(sc.teacherId), String(studentId));
          sc.sequenceNumber = seq;
        }

        sc.status = 'scheduled';
        sc.requiresAcceptance = false;
        sc.pendingBy = [];
      }

      await sc.save();
    }

    // ✅ persist a Notification so bell shows proper sender & date (and avoid dup emits)
    const notif = new Notification({
      userId: sc.teacherId,
      senderId: studentId,
      senderName: 'Student',
      profileImage: '/default-avatar.png',
      type: 'schedule_response',
      title: 'Schedule response',
      message: `A student ${action}ed the class proposal.`,
      data: { scheduleId: String(sc._id), action, state: sc.status },
      read: false,
    });
    await notif.save();

    // notify teacher (+ refresh both sides)
    if (global.emitToUser) {
      global.emitToUser(String(sc.teacherId), 'new_notification', {
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
      global.emitToUser(String(sc.teacherId), 'schedules_refresh', { reason: 'student_response' });
      for (const sid of sc.studentIds) {
        global.emitToUser(String(sid), 'schedules_refresh', { scheduleId: String(sc._id) });
      }
    }

    return res.json({ ok: true, status: sc.status, pendingBy: sc.pendingBy, agreedBy: sc.agreedBy });
  } catch (e) {
    console.error('respondSchedule', e);
    res.status(500).json({ message: 'Server error' });
  }
};

// --- LIST pending schedules for the logged-in student ---
exports.listPendingForStudent = async (req, res) => {
  try {
    const studentId = String(req.user.id);
    const items = await Schedule.find({
      requiresAcceptance: true,
      status: 'proposed',
      pendingBy: studentId
    })
    .populate('teacherId','name profileImage')
    .populate('postId','title subjects')
    .lean();

    res.json(items);
  } catch (e) {
    console.error('listPendingForStudent', e);
    res.status(500).json({ message: 'Server error' });
  }
};
