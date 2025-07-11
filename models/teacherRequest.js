const mongoose = require('mongoose');

const teacherRequestSchema = new mongoose.Schema({
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  studentName: { type: String, required: true },
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },    // For tuition post
  topic: { type: String },                                          // For topic help
  subject: { type: String },                                        // Optional, from session requests
  message: { type: String, required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  requestedAt: { type: Date, default: Date.now },                   // Optional from session requests
}, { timestamps: true });

module.exports = mongoose.models.TeacherRequest || mongoose.model('TeacherRequest', teacherRequestSchema);
