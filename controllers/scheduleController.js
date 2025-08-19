// controllers/scheduleController.js
const Schedule = require("../models/schedule");
const TeacherRequest = require("../models/teacherRequest");
const User = require("../models/user");
const TeacherPost = require("../models/teacherPost");
const Notification = require("../models/Notification");

// Helpers
const toDate = (d) => (d instanceof Date ? d : new Date(d));
const uniq = (arr) => [...new Set(arr.map(String))];

// ✅ Create schedule
exports.createSchedule = async (req, res) => {
  try {
    let { postId, studentIds, subject, type, date, durationMinutes } = req.body;
    const teacherId = req.user.id;

    // Basic validation
    if (!postId || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ message: "postId and studentIds[] are required" });
    }
    if (!subject || !type || !date || !durationMinutes) {
      return res.status(400).json({ message: "subject, type, date, durationMinutes are required" });
    }

    studentIds = uniq(studentIds);
    const startTime = toDate(date);
    const durationMs = Number(durationMinutes) * 60_000;
    const endTime = new Date(startTime.getTime() + durationMs);

    // 1) Validate post ownership (active or archived ok)
    const post = await TeacherPost.findOne({ _id: postId, teacher: teacherId }).select("_id subjects title");
    if (!post) return res.status(404).json({ message: "Post not found or unauthorized" });

    // 2) Ensure all students have APPROVED requests for this post
    const approvedRequests = await TeacherRequest.find({
      teacherId,
      postId,
      studentId: { $in: studentIds },
      status: "approved",
    }).select("studentId");

    if (approvedRequests.length !== studentIds.length) {
      return res.status(400).json({ message: "Some students are not approved for this post" });
    }

    // 3) Time conflict checks
    // Teacher conflict
    const teacherConflict = await Schedule.findOne({
      teacherId,
      status: "scheduled",
      date: { $lt: endTime },
      $expr: {
        $gt: [
          { $add: ["$date", { $multiply: ["$durationMinutes", 60000] }] },
          startTime,
        ],
      },
    }).select("_id date durationMinutes");
    if (teacherConflict) {
      return res.status(400).json({ message: "Time conflict: teacher already has a class in this slot" });
    }

    // Student conflict
    const studentConflict = await Schedule.findOne({
      studentIds: { $in: studentIds },
      status: "scheduled",
      date: { $lt: endTime },
      $expr: {
        $gt: [
          { $add: ["$date", { $multiply: ["$durationMinutes", 60000] }] },
          startTime,
        ],
      },
    }).select("_id date durationMinutes studentIds");
    if (studentConflict) {
      return res.status(400).json({ message: "Time conflict: one or more students already have a class in this slot" });
    }

    // 4) Persist
    const schedule = await Schedule.create({
      teacherId,
      postId,
      studentIds,
      subject,             // single subject or combined label
      type,                // 'demo' | 'regular'
      date: startTime,     // start datetime (UTC recommended)
      durationMinutes,
      status: "scheduled",
    });

    // 5) Notify students (use teacher record to ensure sender fields are present)
    const teacher = await User.findById(teacherId).select("name profileImage");
    const senderName = teacher?.name || req.user?.name || "Teacher";
    const senderImage = teacher?.profileImage || req.user?.profileImage || "/default-avatar.png";

  for (const sid of studentIds) {
  const student = await User.findById(sid).select("name profileImage");

  const notif = new Notification({
    userId: sid,
    senderId: teacherId,
    senderName,
    profileImage: senderImage,
    type: "new_schedule",
    title: "New Class Scheduled",
    message: `Hi ${student?.name || "Student"}, ${senderName} scheduled a ${type} class for ${subject}`,
    data: { scheduleId: schedule._id, postId },
    read: false,
  });
  await notif.save();

  if (global.emitToUser) {
    global.emitToUser(String(sid), "new_notification", {
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

    return res.status(201).json({ message: "Schedule created", schedule });
  } catch (err) {
    console.error("Error creating schedule:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ✅ Get schedules for teacher
exports.getSchedulesForTeacher = async (req, res) => {
  try {
    const teacherId = req.user.id;
    const schedules = await Schedule.find({ teacherId })
      .populate("postId", "title subjects status")
      .populate("studentIds", "name profileImage");
    return res.json(schedules);
  } catch (err) {
    console.error("Error fetching teacher schedules:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ✅ Get schedules for student
exports.getSchedulesForStudent = async (req, res) => {
  try {
    const studentId = req.user.id;
    const schedules = await Schedule.find({ studentIds: studentId })
      .populate("postId", "title subjects status")
      .populate("teacherId", "name profileImage");
    return res.json(schedules);
  } catch (err) {
    console.error("Error fetching student schedules:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ✅ Cancel schedule (with notifications)
exports.cancelSchedule = async (req, res) => {
  try {
    const { id } = req.params;
    const teacherId = req.user.id;

    const schedule = await Schedule.findOne({ _id: id, teacherId });
    if (!schedule) return res.status(404).json({ message: "Schedule not found" });

    if (schedule.status === "cancelled") {
      return res.status(200).json({ message: "Schedule already cancelled", schedule });
    }

    schedule.status = "cancelled";
    await schedule.save();

    // Notify all students about cancellation
    const teacher = await User.findById(teacherId).select("name profileImage");
    const senderName = teacher?.name || req.user?.name || "Teacher";
    const senderImage = teacher?.profileImage || req.user?.profileImage || "/default-avatar.png";

    for (const sid of schedule.studentIds) {
      const notif = new Notification({
        userId: sid,
        senderId: teacherId,
        senderName,
        profileImage: senderImage,
        type: "schedule_cancelled",
        title: "Class Cancelled",
        message: `${senderName} cancelled a ${schedule.type} class for ${schedule.subject}`,
        data: { scheduleId: schedule._id, postId: schedule.postId },
        read: false,
      });
      await notif.save();

      if (global.emitToUser) {
        global.emitToUser(String(sid), "new_notification", {
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

    return res.json({ message: "Schedule cancelled", schedule });
  } catch (err) {
    console.error("Error cancelling schedule:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
