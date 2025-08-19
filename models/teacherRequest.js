//models\teacherRequest.js
const mongoose = require('mongoose');

const teacherRequestSchema = new mongoose.Schema({
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  studentName: { type: String, required: true },
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'TeacherPost' },    // For tuition post
  topic: { type: String },                                          // For topic help
  subject: { type: String },                                        // Optional, from session requests
  origin: {                        // ✅ new: where was this started from?
    type: String,
    enum: ['post', 'direct'],
    required: true,
    default: 'direct',
  },
  message: { type: String, required: true },
    lastMessageTimestamp: {
    type: Date,
    default: null,
  },
  // optionally lastMessageText, if you want
  lastMessageText: {
    type: String,
    default: '',
  },
  rejectionMessage: { type: String },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  requestedAt: { type: Date, default: Date.now },                   // Optional from session requests
}, { timestamps: true });
// ✅ helpful indexes
teacherRequestSchema.index({ teacherId: 1, postId: 1, studentId: 1, status: 1 });
teacherRequestSchema.index({ studentId: 1, status: 1 });
module.exports = mongoose.models.TeacherRequest || mongoose.model('TeacherRequest', teacherRequestSchema);
