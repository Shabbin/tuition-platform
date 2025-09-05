// server/workers/routineWorker.js
const { DateTime } = require('luxon');
const mongoose = require('mongoose');

const Routine       = require('../../models/routine');
const Schedule      = require('../../models/schedule');
const TeacherPost   = require('../../models/teacherPost');
const Notification  = require('../../models/Notification');
const User          = require('../../models/user');
const SchedLock     = require('../../models/schedLock');

function uniqStr(arr) { return [...new Set((arr || []).map(String))]; }
function nowPlus(ms) { return new Date(Date.now() + ms); }
function fmtDhaka(jsDate) {
  return DateTime.fromJSDate(jsDate).setZone('Asia/Dhaka').toFormat('EEE, dd LLL, HH:mm');
}

async function getSubjectString(postId) {
  const post = await TeacherPost.findById(postId).select('subjects title');
  if (!post) return 'Class';
  const subjects = Array.isArray(post.subjects) ? post.subjects : (post.subjects ? [post.subjects] : []);
  const clean = [...new Set(subjects.map((s) => String(s).trim()).filter(Boolean))];
  return clean.length ? clean.join(' | ') : (post.title || 'Class');
}

async function notify(userId, { senderId, senderName, profileImage, type, title, message, data }) {
  const notif = new Notification({
    userId, senderId, senderName, profileImage, type, title, message, data, read: false,
  });
  await notif.save();
  if (global.emitToUser) {
    global.emitToUser(String(userId), 'new_notification', {
      _id: String(notif._id),
      senderId: notif.senderId,
      senderName: notif.senderName,
      profileImage: notif.profileImage,
      type: notif.type, title: notif.title, message: notif.message,
      data: notif.data, read: notif.read, createdAt: notif.createdAt,
    });
  }
}

/** Batch conflicts: find overlaps for teacher and all students in two queries */
async function conflictFilterBatch({ teacherId, studentIds, start, durationMinutes }) {
  const end = new Date(start.getTime() + durationMinutes * 60000);
  const overlapQuery = {
    status: 'scheduled',
    date: { $lt: end },
    $expr: { $gt: [{ $add: ['$date', { $multiply: ['$durationMinutes', 60000] }] }, start] },
  };

  const [teacherBusyDoc, studentBusyDocs] = await Promise.all([
    Schedule.findOne({ ...overlapQuery, teacherId }).select('_id'),
    Schedule.find({ ...overlapQuery, studentIds: { $in: studentIds } }).select('studentIds').lean(),
  ]);

  if (teacherBusyDoc) return { teacherBusy: true, allowedStudents: [], blockedStudents: studentIds.map(String) };

  const busySet = new Set();
  for (const doc of studentBusyDocs) {
    for (const sid of doc.studentIds || []) busySet.add(String(sid));
  }
  const allowed = [];
  const blocked = [];
  for (const sid of studentIds) {
    if (busySet.has(String(sid))) blocked.push(String(sid));
    else allowed.push(String(sid));
  }
  return { teacherBusy: false, allowedStudents: allowed, blockedStudents: blocked };
}

async function sendReminderWindows() {
  // Deduped by unique (type, data.key)
  const now = DateTime.now();
  const windowStart = now.plus({ minutes: 15 }).minus({ minutes: 1 }).toJSDate();
  const windowEnd = now.plus({ minutes: 15 }).plus({ minutes: 1 }).toJSDate();

  const upcoming = await Schedule.find({
    status: 'scheduled',
    date: { $gte: windowStart, $lte: windowEnd },
  }).select('_id teacherId studentIds date subject').lean();

  for (const s of upcoming) {
    const key = `reminder_15_${String(s._id)}`;
    const exists = await Notification.findOne({ 'data.key': key, type: 'schedule_reminder' }).select('_id');
    if (exists) continue;

    const teacher = await User.findById(s.teacherId).select('name profileImage').lean();
    const teacherName = teacher?.name || 'Teacher';
    const senderImage = teacher?.profileImage || '/default-avatar.png';
    const when = fmtDhaka(new Date(s.date));
    const subject = s.subject || 'Class';

    const payload = {
      type: 'schedule_reminder',
      title: 'Class starts in 15 min',
      message: `${subject} with ${teacherName} at ${when}.`,
      data: { key, scheduleId: s._id },
    };

    await notify(String(s.teacherId), { senderId: s.teacherId, senderName: teacherName, profileImage: senderImage, ...payload });
    for (const sid of s.studentIds || []) {
      await notify(String(sid), { senderId: s.teacherId, senderName: teacherName, profileImage: senderImage, ...payload });
    }
  }
}

async function tick() {
  const horizon = nowPlus(60 * 1000);
  const now = new Date();

  // find active routines with any slot due in next minute
  const routines = await Routine.find({
    status: 'active',
    'slots.nextRunAt': { $ne: null, $lte: horizon },
  }).lean();

  for (const r of routines) {
    const zone = r.timezone || 'Asia/Dhaka';
    const subject = await getSubjectString(r.postId);

    for (let i = 0; i < (r.slots || []).length; i++) {
      const s = r.slots[i];
      if (!s?.nextRunAt || s.nextRunAt > horizon) continue;
      if (r.endDate && new Date(s.nextRunAt) > new Date(r.endDate)) continue;

      const start = new Date(s.nextRunAt);
      const duration = Number(s.durationMinutes) || 60;

      // Acquire idempotent lock for this occurrence
      const lockKey = `routine:${r._id}:slot:${i}:at:${start.toISOString()}`;
      try {
        await SchedLock.create({ key: lockKey });
      } catch {
        // lock exists — another worker/node processed it
        continue;
      }

      // conflicts (batched)
      const { teacherBusy, allowedStudents, blockedStudents } = await conflictFilterBatch({
        teacherId: r.teacherId,
        studentIds: uniqStr(r.studentIds),
        start,
        durationMinutes: duration,
      });

      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          if (teacherBusy || allowedStudents.length === 0) {
            await notify(String(r.teacherId), {
              senderId: r.teacherId,
              senderName: 'System',
              profileImage: '/default-avatar.png',
              type: 'routine_conflict',
              title: 'Routine conflict',
              message: teacherBusy
                ? 'You already have a class at this time.'
                : 'All selected students are busy at this time.',
              data: { routineId: r._id, slotIndex: i, start, blockedStudents },
            });
          } else {
            const sched = await Schedule.create([{
              teacherId: r.teacherId,
              postId: r.postId,
              studentIds: uniqStr(allowedStudents).map((id) => new mongoose.Types.ObjectId(String(id))),
              subject,
              type: 'regular',
              date: start,
              durationMinutes: duration,
              status: 'scheduled',
            }], { session }).then(([doc]) => doc);

            const teacher = await User.findById(r.teacherId).select('name profileImage').session(session);
            const senderName = teacher?.name || 'Teacher';
            const senderImage = teacher?.profileImage || '/default-avatar.png';

            for (const sid of allowedStudents) {
              await notify(String(sid), {
                senderId: r.teacherId,
                senderName,
                profileImage: senderImage,
                type: 'new_schedule',
                title: 'New Class Scheduled',
                message: `A class was scheduled for ${subject}`,
                data: { scheduleId: String(sched._id), routineId: String(r._id) },
              });
            }
            if (blockedStudents?.length) {
              await notify(String(r.teacherId), {
                senderId: r.teacherId,
                senderName: 'System',
                profileImage: '/default-avatar.png',
                type: 'routine_partial',
                title: 'Some students couldn’t be added',
                message: 'A routine occurrence was created without some students due to conflicts.',
                data: { routineId: r._id, slotIndex: i, start, blockedStudents },
              });
            }
          }

          // advance slot +7d only if nextRunAt still equals current (protect against race)
          await Routine.updateOne(
            { _id: r._id, [`slots.${i}.nextRunAt`]: s.nextRunAt },
            { $set: { [`slots.${i}.nextRunAt`]: DateTime.fromJSDate(start, { zone }).plus({ weeks: 1 }).toJSDate() } },
            { session }
          );
        });
      } catch (err) {
        console.error('routine tick txn error:', err);
      } finally {
        await session.endSession();
      }
    }
  }

  await sendReminderWindows();
}

let interval = null;
exports.startRoutineWorker = function startRoutineWorker() {
  if (interval) return;
  setTimeout(() => {
    interval = setInterval(() => tick().catch((e) => console.error('routine tick error:', e)), 30 * 1000);
  }, 5 * 1000);
};

exports.stopRoutineWorker = function stopRoutineWorker() {
  if (interval) clearInterval(interval);
  interval = null;
};
