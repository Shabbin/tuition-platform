const mongoose = require('mongoose');
const scheduleSchema = new mongoose.Schema({
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  postId: { type: mongoose.Schema.Types.ObjectId, ref: "TeacherPost", required: true },
  studentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }],
  subject: { type: String, required: true },
  type: { type: String, enum: ["demo", "regular"], default: "regular" },
  date: { type: Date, required: true },             // start time
  durationMinutes: { type: Number, required: true },
  status: { type: String, enum: ["scheduled", "completed", "cancelled"], default: "scheduled" },
}, { timestamps: true });

// Index for quick lookup by teacher/date
scheduleSchema.index({ teacherId: 1, date: 1 });

module.exports = mongoose.model("Schedule", scheduleSchema);