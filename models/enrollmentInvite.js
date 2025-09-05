const mongoose = require('mongoose');
const { Schema } = mongoose;

const EnrollmentInviteSchema = new Schema(
  {
    // relations
    postId:     { type: Schema.Types.ObjectId, ref: 'Post', required: true, index: true },
    teacherId:  { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    studentId:  { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // optional routine link
    routineId:  { type: Schema.Types.ObjectId, ref: 'Routine', default: null },

    // snapshot of course info
    courseTitle: { type: String, required: true, trim: true },
    courseFeeTk: {
      type: Number,
      required: true,
      min: [1, 'courseFeeTk must be >= 1'],
      set: v => v == null ? v : Math.round(v),
    },
    currency: { type: String, default: 'BDT', trim: true },

    // payments
    upfrontDueTk: { type: Number, default: 0,    set: v => v == null ? v : Math.round(v) },
    advanceTk:    { type: Number, default: null, set: v => v == null ? null : Math.round(v) },
    paidTk:       { type: Number, default: 0,    set: v => v == null ? v : Math.round(v) },
    paymentStatus:{ type: String, enum: ['unpaid', 'partial', 'paid'], default: 'unpaid' },

    // lifecycle
    status:     { type: String, enum: ['pending','accepted','declined','cancelled'], default: 'pending', index: true },
    note:       { type: String, default: '', trim: true },
    payByAt:    { type: Date, default: null },
    acceptedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false, strict: true }
);

// prevent duplicate invites for same course + student
EnrollmentInviteSchema.index(
  { postId: 1, studentId: 1 },
  {
    unique: true,
    partialFilterExpression: { postId: { $type: 'objectId' }, studentId: { $type: 'objectId' } },
  }
);

// 🔒 avoid stale schema in dev hot-reload
if (process.env.NODE_ENV !== 'production' && mongoose.models.EnrollmentInvite) {
  delete mongoose.models.EnrollmentInvite;
}

const Model = mongoose.model('EnrollmentInvite', EnrollmentInviteSchema);

// optional one-time sanity
if (process.env.DEBUG_INVITE_SCHEMA === '1') {
  console.log('[EnrollmentInvite] paths =', Object.keys(EnrollmentInviteSchema.paths));
}

module.exports = Model;
