// server/controllers/routineChangeController.js
const Routine = require('../models/routine');
const RoutineChangeRequest = require('../models/routineChangeRequest');
const Schedule = require('../models/schedule');
const User = require('../models/user');
const Notification = require('../models/Notification');

/* ------------------------------ small helpers ------------------------------ */

function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const H = Number(m[1]), M = Number(m[2]);
  if (H < 0 || H > 23 || M < 0 || M > 59) return null;
  return { H, M };
}
const WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function sameSlot(a, b) {
  return Number(a?.weekday) === Number(b?.weekday) && String(a?.timeHHMM) === String(b?.timeHHMM);
}

/**
 * Mutates routineDoc.slots in-place for the given weekly change (add|update|remove).
 * Returns: { ok: boolean, reason?: 'target_slot_not_found' | 'unknown_op' }
 */
function applyWeeklyChange(routineDoc, changeDoc) {
  routineDoc.slots = Array.isArray(routineDoc.slots) ? routineDoc.slots : [];

  if (changeDoc.op === 'add') {
    const exists = routineDoc.slots.some((s) =>
      sameSlot(s, { weekday: changeDoc.weekday, timeHHMM: changeDoc.timeHHMM })
    );
    if (exists) return { ok: true }; // idempotent
    routineDoc.slots.push({
      weekday: Number(changeDoc.weekday),
      timeHHMM: String(changeDoc.timeHHMM),
      durationMinutes: Number(changeDoc.durationMinutes || 60),
    });
    return { ok: true };
  }

  if (changeDoc.op === 'update') {
    const idx = routineDoc.slots.findIndex((s) =>
      sameSlot(s, { weekday: changeDoc.targetWeekday, timeHHMM: changeDoc.targetTimeHHMM })
    );
    if (idx < 0) return { ok: false, reason: 'target_slot_not_found' };

    // If the new (weekday,time) matches another existing slot, collapse duplicates.
    const collidesAt = routineDoc.slots.findIndex((s, i) =>
      i !== idx && sameSlot(s, { weekday: changeDoc.weekday, timeHHMM: changeDoc.timeHHMM })
    );

    routineDoc.slots[idx].weekday = Number(changeDoc.weekday);
    routineDoc.slots[idx].timeHHMM = String(changeDoc.timeHHMM);
    if (changeDoc.durationMinutes) {
      routineDoc.slots[idx].durationMinutes = Number(changeDoc.durationMinutes);
    }

    if (collidesAt >= 0) {
      routineDoc.slots.splice(collidesAt, 1);
    }
    return { ok: true };
  }

  if (changeDoc.op === 'remove') {
    const before = routineDoc.slots.length;
    routineDoc.slots = routineDoc.slots.filter(
      (s) => !sameSlot(s, { weekday: changeDoc.targetWeekday, timeHHMM: changeDoc.targetTimeHHMM })
    );
    return {
      ok: before !== routineDoc.slots.length,
      reason: before === routineDoc.slots.length ? 'target_slot_not_found' : undefined,
    };
  }

  return { ok: false, reason: 'unknown_op' };
}

async function notifyUser(userId, payload) {
  const notif = new Notification({ userId, ...payload, read: false });
  await notif.save();
  if (global.emitToUser) {
    global.emitToUser(String(userId), 'new_notification', {
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
  return notif;
}

/* -------------------- teacher time-conflict helpers -------------------- */

/** Cross-course weekly conflict (same teacher, different routine) */
async function hasTeacherWeeklyConflict({ teacherId, excludeRoutineId, weekday, timeHHMM }) {
  if (weekday == null || !timeHHMM) return { conflict: false, conflictsWith: [] };

  const others = await Routine.find({
    teacherId,
    _id: { $ne: excludeRoutineId },
    'slots.weekday': Number(weekday),
    'slots.timeHHMM': String(timeHHMM),
  })
    .select('postId slots')
    .populate('postId', 'title')
    .lean();

  if (!others?.length) return { conflict: false, conflictsWith: [] };

  const conflictsWith = others
    .filter(r => (r.slots || []).some(s => sameSlot(s, { weekday, timeHHMM })))
    .map(r => r?.postId?.title || 'another course');

  return { conflict: conflictsWith.length > 0, conflictsWith };
}

/** Cross-course one-off conflict at an exact DateTime */
async function hasTeacherOneoffConflict({ teacherId, excludeRoutineId, when }) {
  const dt = new Date(when);
  if (Number.isNaN(dt.getTime())) return { conflict: false, conflictsWith: [] };

  const weekday = dt.getDay();
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  const timeHHMM = `${hh}:${mm}`;

  const conflictsWith = [];

  // 1) Weekly conflicts in OTHER courses at the same weekday+time
  const { conflict: weeklyConflict, conflictsWith: weeklyWith } = await hasTeacherWeeklyConflict({
    teacherId,
    excludeRoutineId,
    weekday,
    timeHHMM,
  });
  if (weeklyConflict) conflictsWith.push(...weeklyWith);

  // 2) Already scheduled one-off at the exact start time (any course)
  const scheduled = await Schedule.findOne({
    teacherId,
    date: dt,                          // exact same start
    status: { $ne: 'cancelled' },      // best-effort filter
  }).select('_id postId').populate('postId', 'title').lean();

  if (scheduled) {
    conflictsWith.push(scheduled?.postId?.title || 'another scheduled class');
  }

  return { conflict: conflictsWith.length > 0, conflictsWith };
}

/**
 * When a weekly change is accepted by a subset of students:
 *  - If the subset == all routine students → apply in-place to the routine.
 *  - Else → split the routine and apply only to the new subset routine.
 */
async function finalizeWeeklyWithPartitioning(routine, changeDoc, subsetStudentIds) {
  const subset = new Set(subsetStudentIds.map(String));
  const all = routine.studentIds.map(String);
  const isAll = all.length === subset.size && all.every((id) => subset.has(id));

  const opText =
    changeDoc.op === 'add'
      ? `Add ${WD[changeDoc.weekday]} ${changeDoc.timeHHMM}`
      : changeDoc.op === 'update'
      ? `Change ${WD[changeDoc.targetWeekday]} ${changeDoc.targetTimeHHMM} → ${WD[changeDoc.weekday]} ${changeDoc.timeHHMM}`
      : `Remove ${WD[changeDoc.targetWeekday]} ${changeDoc.targetTimeHHMM}`;

  if (isAll) {
    const result = applyWeeklyChange(routine, changeDoc);
    await routine.save();
    const audience = [...routine.studentIds.map(String), String(routine.teacherId)];
    for (const uid of audience) {
      await notifyUser(uid, {
        senderId: routine.teacherId,
        senderName: 'Teacher',
        profileImage: '/default-avatar.png',
        type: 'routine_change_applied',
        title: 'Weekly routine updated',
        message: opText,
        data: { routineId: String(routine._id), requestId: String(changeDoc._id) },
      });
      if (global.emitToUser) {
        global.emitToUser(uid, 'routine_refresh', {
          reason: 'weekly_change_applied',
          routineId: String(routine._id),
        });
      }
    }
    return { changedRoutineIds: [String(routine._id)] };
  }

  // PARTIAL: split the routine
  const subsetArr = all.filter((id) => subset.has(id));
  const othersArr = all.filter((id) => !subset.has(id));

  await Routine.updateOne(
    { _id: routine._id },
    { $set: { studentIds: othersArr } }
  );
  routine.studentIds = othersArr;
  if (othersArr.length === 0) {
    routine.status = 'paused';
    await routine.save();
  }

  const newRoutine = await Routine.create({
    teacherId: routine.teacherId,
    postId: routine.postId,
    studentIds: subsetArr,
    timezone: routine.timezone,
    startDate: routine.startDate,
    endDate: routine.endDate,
    status: routine.status,
    slots: JSON.parse(JSON.stringify(routine.slots || [])),
    requiresAcceptance: false,
    pendingBy: [],
    acceptedBy: [],
  });

  const tmp = await Routine.findById(newRoutine._id);
  applyWeeklyChange(tmp, changeDoc);
  await tmp.save();

  for (const uid of subsetArr) {
    await notifyUser(uid, {
      senderId: routine.teacherId,
      senderName: 'Teacher',
      profileImage: '/default-avatar.png',
      type: 'routine_change_applied',
      title: 'Weekly routine updated',
      message: opText,
      data: { routineId: String(tmp._id), movedFrom: String(routine._id), requestId: String(changeDoc._id) },
    });
    if (global.emitToUser) {
      global.emitToUser(uid, 'routine_refresh', {
        reason: 'weekly_change_applied',
        routineId: String(tmp._id),
      });
    }
  }
  for (const uid of othersArr) {
    await notifyUser(uid, {
      senderId: routine.teacherId,
      senderName: 'Teacher',
      profileImage: '/default-avatar.png',
      type: 'routine_change_applied',
      title: 'Routine unchanged for you',
      message: 'Other students accepted a weekly change that does not affect your times.',
      data: { routineId: String(routine._id), requestId: String(changeDoc._id) },
    });
    if (global.emitToUser) {
      global.emitToUser(uid, 'routine_refresh', {
        reason: 'weekly_change_others_moved',
        routineId: String(routine._id),
      });
    }
  }
  await notifyUser(routine.teacherId, {
    senderId: routine.teacherId,
    senderName: 'Teacher',
    profileImage: '/default-avatar.png',
    type: 'routine_change_applied',
    title: 'Weekly change applied (partial)',
    message: opText,
    data: { originalRoutineId: String(routine._id), newRoutineId: String(tmp._id), requestId: String(changeDoc._id) },
  });

  return { changedRoutineIds: [String(routine._id), String(tmp._id)] };
}

/* ------------------------------ create request ----------------------------- */
// teacher -> create request (one-off or weekly)
exports.createChangeRequest = async (req, res) => {
  try {
    const teacherId = req.user.id;
    const {
      routineId,
      studentIds = [],
      proposedDate,
      durationMinutes,
      slotIndex,
      note,

      // NEW weekly fields
      changeType = 'oneoff',
      op,
      targetWeekday,
      targetTimeHHMM,
      weekday,
      timeHHMM,
    } = req.body || {};

    if (!routineId || !Array.isArray(studentIds) || !studentIds.length) {
      return res.status(400).json({ message: 'routineId and studentIds[] are required' });
    }

    const routine = await Routine.findOne({ _id: routineId, teacherId: teacherId }).lean();
    if (!routine) return res.status(404).json({ message: 'Routine not found' });

    // only allow proposing for students that belong to the routine
    const routineStudentSet = new Set((routine.studentIds || []).map(String));
    const targetStudents = studentIds.filter((id) => routineStudentSet.has(String(id)));
    if (!targetStudents.length)
      return res.status(400).json({ message: 'No valid students in this routine' });

    // validate shapes + conflicts
    if (changeType === 'oneoff') {
      if (!proposedDate || !durationMinutes) {
        return res
          .status(400)
          .json({ message: 'proposedDate and durationMinutes are required for one-off' });
      }

      // 🔒 Cross-course one-off conflict at exact datetime
      const { conflict, conflictsWith } = await hasTeacherOneoffConflict({
        teacherId,
        excludeRoutineId: routineId,
        when: new Date(proposedDate),
      });
      if (conflict) {
        return res.status(409).json({
          code: 'TEACHER_TIME_CONFLICT',
          message: `This time conflicts with your other course${conflictsWith.length>1?'s':''}: ${conflictsWith.join(', ')}`,
        });
      }
    } else if (changeType === 'weekly') {
      if (!op) return res.status(400).json({ message: 'op is required for weekly change' });

      if ((op === 'update' || op === 'remove') && !(targetTimeHHMM && targetWeekday != null)) {
        return res
          .status(400)
          .json({ message: 'targetWeekday and targetTimeHHMM are required for update/remove' });
      }
      if ((op === 'update' || op === 'remove') && !parseHHMM(targetTimeHHMM)) {
        return res.status(400).json({ message: 'Invalid HH:mm for targetTimeHHMM' });
      }
      if (op !== 'remove') {
        if (!(weekday != null && timeHHMM)) {
          return res
            .status(400)
            .json({ message: 'weekday and timeHHMM are required for add/update' });
        }
        if (!parseHHMM(timeHHMM)) {
          return res.status(400).json({ message: 'Invalid HH:mm for timeHHMM' });
        }
        if (op === 'add' && !durationMinutes) {
          return res.status(400).json({ message: 'durationMinutes is required for add' });
        }
      }

      // routine state checks to avoid impossible requests
      if (op === 'update' || op === 'remove') {
        const exists = (routine.slots || []).some((s) =>
          sameSlot(s, { weekday: Number(targetWeekday), timeHHMM: String(targetTimeHHMM) })
        );
        if (!exists) {
          return res.status(409).json({
            code: 'TARGET_SLOT_NOT_FOUND',
            message: 'The selected slot does not exist on this routine.',
          });
        }
      }
      if (op === 'add') {
        const dup = (routine.slots || []).some((s) =>
          sameSlot(s, { weekday: Number(weekday), timeHHMM: String(timeHHMM) })
        );
        if (dup) {
          return res.status(409).json({
            code: 'SLOT_ALREADY_EXISTS',
            message: 'That weekly slot already exists on this routine.',
          });
        }
      }

      // 🔒 Cross-course weekly conflict (proposed new value)
      if (op !== 'remove') {
        const { conflict, conflictsWith } = await hasTeacherWeeklyConflict({
          teacherId,
          excludeRoutineId: routineId,
          weekday: Number(weekday),
          timeHHMM: String(timeHHMM),
        });
        if (conflict) {
          return res.status(409).json({
            code: 'TEACHER_TIME_CONFLICT',
            message: `This time conflicts with your other course${conflictsWith.length>1?'s':''}: ${conflictsWith.join(', ')}`,
          });
        }
      }
    }

    const doc = await RoutineChangeRequest.create({
      routineId,
      slotIndex: typeof slotIndex === 'number' ? slotIndex : null,
      studentIds: targetStudents,

      // one-off
      proposedDate: proposedDate ? new Date(proposedDate) : null,
      durationMinutes: durationMinutes ? Math.max(1, Number(durationMinutes)) : null,
      note: note || '',

      // weekly extras
      changeType,
      op: changeType === 'weekly' ? op : null,
      targetWeekday: changeType === 'weekly' ? (targetWeekday ?? null) : null,
      targetTimeHHMM: changeType === 'weekly' ? (targetTimeHHMM ?? null) : null,
      weekday: changeType === 'weekly' ? (weekday ?? null) : null,
      timeHHMM: changeType === 'weekly' ? (timeHHMM ?? null) : null,

      createdBy: teacherId,
      status: 'pending',
      pendingBy: targetStudents,
      acceptedBy: [],
      rejectedBy: [],
      decidedBy: null,
      decidedAt: null,
    });

    // notify all target students
    const teacher = await User.findById(teacherId).select('name profileImage').lean();

    let title = 'Proposed time change';
    let message;
    if (doc.changeType === 'oneoff') {
      message = `${teacher?.name || 'Teacher'} proposed ${doc.durationMinutes}min on ${new Date(
        doc.proposedDate
      ).toLocaleString('en-GB', { hour12: false })}.`;
    } else {
      const opText =
        doc.op === 'add'
          ? `Add ${WD[doc.weekday]} ${doc.timeHHMM}`
          : doc.op === 'update'
          ? `Change ${WD[doc.targetWeekday]} ${doc.targetTimeHHMM} → ${WD[doc.weekday]} ${doc.timeHHMM}`
          : `Remove ${WD[doc.targetWeekday]} ${doc.targetTimeHHMM}`;
      title = 'Weekly routine change';
      message = `${teacher?.name || 'Teacher'} proposed: ${opText}.`;
    }

    for (const sid of targetStudents) {
      await notifyUser(sid, {
        senderId: teacherId,
        senderName: teacher?.name || 'Teacher',
        profileImage: teacher?.profileImage || '/default-avatar.png',
        type: 'routine_change_request',
        title,
        message,
        data: { requestId: String(doc._id), routineId: String(routineId) },
      });
    }

    return res.status(201).json(doc);
  } catch (e) {
    console.error('createChangeRequest', e);
    return res.status(500).json({ message: 'Server error' });
  }
};

/* ----------------------------- student response ---------------------------- */
// student -> accept / reject (per-student). Weekly is applied only after everyone (in scope) accepts.
exports.respondChangeRequest = async (req, res) => {
  try {
    const studentId = String(req.user.id);
    const { id } = req.params;
    const { action } = req.body || {}; // 'accept' | 'reject'

    const doc = await RoutineChangeRequest.findById(id);
    if (!doc) return res.status(404).json({ message: 'Request not found' });
    if (doc.status !== 'pending') return res.status(400).json({ message: 'Already decided' });

    // ensure this student is in scope and still pending
    const inScope = doc.studentIds.map(String).includes(studentId);
    const stillPending = doc.pendingBy.map(String).includes(studentId);
    if (!inScope) return res.status(403).json({ message: 'Not allowed for this request' });
    if (!stillPending) return res.status(400).json({ message: 'You have already responded' });

    // If accepting a ONE-OFF, re-check conflicts before changing state
    if (action === 'accept' && doc.changeType === 'oneoff') {
      const routine = await Routine.findById(doc.routineId).select('teacherId postId').lean();
      if (!routine) return res.status(404).json({ message: 'Routine not found' });

      const { conflict, conflictsWith } = await hasTeacherOneoffConflict({
        teacherId: String(routine.teacherId),
        excludeRoutineId: String(doc.routineId),
        when: doc.proposedDate,
      });
      if (conflict) {
        return res.status(409).json({
          code: 'TEACHER_TIME_CONFLICT',
          message: `This time conflicts with another class (${conflictsWith.join(', ')}). Please pick a different time.`,
        });
      }
    }

    // move student from pending -> accepted/rejected
    doc.pendingBy = doc.pendingBy.filter((x) => String(x) !== studentId);
    if (action === 'accept') {
      doc.acceptedBy = [...new Set([...doc.acceptedBy.map(String), studentId])];
    } else {
      doc.rejectedBy = [...new Set([...doc.rejectedBy.map(String), studentId])];
    }

    // quick reject path: as soon as anyone rejects, the request is rejected
    if (action === 'reject') {
      doc.status = 'rejected';
      doc.decidedBy = studentId;
      doc.decidedAt = new Date();
      await doc.save();

      await notifyUser(doc.createdBy, {
        senderId: studentId,
        senderName: 'Student',
        profileImage: '/default-avatar.png',
        type: 'routine_change_decision',
        title: 'Change rejected',
        message: 'A student rejected the proposed change.',
        data: { requestId: String(doc._id), decision: 'rejected' },
      });

      return res.json({ ok: true, status: doc.status });
    }

    // Accepted by this student
    if (doc.changeType === 'oneoff') {
      // create schedule immediately for the accepting student
      const routine = await Routine.findById(doc.routineId).select('teacherId postId').lean();
      const schedule = await Schedule.create({
        teacherId: routine.teacherId,
        postId: routine.postId,
        studentIds: [studentId],
        subject: 'Class',
        type: 'regular',
        date: doc.proposedDate,
        durationMinutes: doc.durationMinutes,
        status: 'scheduled',
        sequenceNumber: null,
      });

      const teacher = await User.findById(routine.teacherId).select('name profileImage').lean();
      const payloadAccepted = {
        type: 'routine_change_decision',
        title: 'Change accepted',
        message: 'Student accepted the proposed time. A class has been scheduled.',
        data: { requestId: String(doc._id), decision: 'accepted', scheduleId: String(schedule._id) },
      };

      for (const uid of [routine.teacherId, studentId]) {
        const senderName = uid === routine.teacherId ? 'Student' : (teacher?.name || 'Teacher');
        const senderId = uid === routine.teacherId ? studentId : routine.teacherId;
        const profileImage =
          uid === routine.teacherId ? '/default-avatar.png' : (teacher?.profileImage || '/default-avatar.png');

        await notifyUser(uid, {
          senderId,
          senderName,
          profileImage,
          ...payloadAccepted,
        });

        if (global.emitToUser) {
          global.emitToUser(String(uid), 'schedules_refresh', {
            reason: 'routine_change_accept',
            scheduleId: String(schedule._id),
          });
        }
      }
    }

    // if everyone in scope has accepted now → finalize weekly
    if (doc.pendingBy.length === 0) {
      if (doc.changeType === 'weekly') {
        const routine = await Routine.findById(doc.routineId);
        if (routine) {
          const acceptedScope = doc.studentIds.map(String); // all in-scope students have accepted
          await finalizeWeeklyWithPartitioning(routine, doc, acceptedScope);
        }
      }

      // aggregate accepted
      doc.status = 'accepted';
      doc.decidedBy = null;
      doc.decidedAt = new Date();
    }

    await doc.save();
    return res.json({
      ok: true,
      status: doc.status,
      pendingLeft: doc.pendingBy.length,
      acceptedBy: doc.acceptedBy,
      rejectedBy: doc.rejectedBy,
    });
  } catch (e) {
    console.error('respondChangeRequest', e);
    return res.status(500).json({ message: 'Server error' });
  }
};

/* ---------------------------------- lists ---------------------------------- */
exports.listOutgoingForTeacher = async (req, res) => {
  try {
    const teacherId = req.user.id;
    const items = await RoutineChangeRequest.find({ createdBy: teacherId })
      .sort({ createdAt: -1 })
      .lean();
    res.json(items);
  } catch (e) {
    console.error('listOutgoingForTeacher', e);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.listIncomingForStudent = async (req, res) => {
  try {
    const studentId = req.user.id;
    const items = await RoutineChangeRequest.find({ studentIds: studentId })
      .sort({ createdAt: -1 })
      .lean();
    res.json(items);
  } catch (e) {
    console.error('listIncomingForStudent', e);
    res.status(500).json({ message: 'Server error' });
  }
};
