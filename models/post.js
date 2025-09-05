// server/models/EnrollmentInvite.js
const mongoose = require('mongoose');

const EnrollmentInviteSchema = new mongoose.Schema(
  {
    // Always tie an invite to a private course (post)
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Post',
      required: true,
      index: true,
    },

    // ✅ NOT required — a private course can exist before a routine is created
    routineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Routine',
      default: null,
    },

    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // Display / payment fields
    courseTitle: { type: String, required: true },

    // ✅ Not required (controller/UI enforces positive fee)
    courseFeeTk: { type: Number, default: 0, min: 0 },

    currency: { type: String, default: 'BDT' },

    // Upfront (15% by default or custom advance)
    upfrontDueTk: { type: Number, default: 0, min: 0 },
    advanceTk: { type: Number, default: null },

    // Payment tracking
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'partial', 'paid'],
      default: 'unpaid',
    },
    paidTk: { type: Number, default: 0, min: 0 },

    // Invite lifecycle
    status: {
      type: String,
      enum: ['pending', 'accepted', 'declined', 'cancelled'],
      default: 'pending',
    },
    acceptedAt: { type: Date, default: null },

    // Misc
    note: { type: String, default: '' },
    payByAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Avoid duplicate invites per (postId, studentId)
EnrollmentInviteSchema.index({ postId: 1, studentId: 1 }, { unique: true });

// ✅ Remove any custom pre-validate hooks that throw “courseFeeTk is required”
// (none here)

module.exports =
  mongoose.models.EnrollmentInvite ||
  mongoose.model('EnrollmentInvite', EnrollmentInviteSchema);
