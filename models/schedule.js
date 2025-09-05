// server/models/schedule.js
const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema(
  {
    teacherId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User',        required: true },
    postId:      { type: mongoose.Schema.Types.ObjectId, ref: 'TeacherPost', required: true },
    studentIds:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'User',       required: true }],

    subject:         { type: String, required: true },
    type:            { type: String, enum: ['demo', 'regular'], default: 'regular' },
    date:            { type: Date, required: true }, // UTC start time
    durationMinutes: { type: Number, required: true },

    // ⬇️ STATUS now includes 'proposed' for agreement flow
    status: { type: String, enum: ['proposed', 'scheduled', 'completed', 'cancelled'], default: 'proposed' },

    // Persistent label for “Demo class-N” (per teacher↔student)
    sequenceNumber: { type: Number, default: null },

    // ⬇️ Agreement workflow (used mainly for regular classes when teacher checks “Require agreement”)
    requiresAcceptance: { type: Boolean, default: false },
    pendingBy:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // users who still need to accept
    agreedBy:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // users who already accepted
  },
  { timestamps: true }
);

// Index for quick lookup by teacher/date
scheduleSchema.index({ teacherId: 1, date: 1 });

// Helpful for label/gating queries
scheduleSchema.index({ teacherId: 1, type: 1, status: 1 });
scheduleSchema.index({ teacherId: 1, 'studentIds': 1, type: 1, status: 1 });

// ⬇️ Fast filter for “awaiting agreement” lists
scheduleSchema.index({ status: 1, requiresAcceptance: 1, date: 1 });

module.exports = mongoose.model('Schedule', scheduleSchema);
