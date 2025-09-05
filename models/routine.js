// server/models/routine.js
const mongoose = require('mongoose');

const SlotSchema = new mongoose.Schema(
  {
    weekday: { type: Number, min: 0, max: 6, required: true }, // 0=Sun ... 6=Sat
    timeHHMM: { type: String, required: true }, // "HH:mm"
    durationMinutes: { type: Number, default: 60, min: 1, max: 24 * 60 },
    nextRunAt: { type: Date, default: null, index: true }, // indexed for worker scan
  },
  { _id: false }
);

const RoutineSchema = new mongoose.Schema(
  {
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    postId: { type: mongoose.Schema.Types.ObjectId, ref: 'TeacherPost', required: true, index: true },
    studentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
    timezone: { type: String, default: 'Asia/Dhaka' },
    startDate: { type: Date, default: () => new Date() },
    endDate: { type: Date, default: null },

    // status is still authoritative for whether the routine runs;
    // controller sets 'paused' initially when requiresAcceptance = true.
    status: { type: String, enum: ['active', 'paused', 'archived'], default: 'active', index: true },

    slots: { type: [SlotSchema], default: [] },

    // (optional) server-managed idempotency snapshot for create de-dupe
    _createHash: { type: String, index: true, select: false },

    /* ---------- Agreement fields ---------- */
    // If true, routine starts paused until all intended students accept
    requiresAcceptance: { type: Boolean, default: false },

    // Subset of studentIds who still need to accept (server will seed this to studentIds on create if empty)
    pendingBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    // Students who accepted the proposal
    acceptedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

/** Ensure studentIds are unique & dates valid */
RoutineSchema.pre('validate', function (next) {
  // de-dup studentIds
  if (Array.isArray(this.studentIds)) {
    const uniq = [...new Set(this.studentIds.map(String))].map(
      (id) => new mongoose.Types.ObjectId(id)
    );
    this.studentIds = uniq;
  }

  // dates sanity
  if (this.endDate && this.startDate && this.endDate < this.startDate) {
    return next(new Error('endDate must be >= startDate'));
  }

  // must have at least one slot
  if (!Array.isArray(this.slots) || this.slots.length === 0) {
    return next(new Error('At least one slot is required'));
  }

  // ---------- Agreement normalization ----------
  // Ensure pendingBy/acceptedBy are subsets of studentIds and unique.
  const studentSet = new Set((this.studentIds || []).map(String));

  if (!Array.isArray(this.acceptedBy)) this.acceptedBy = [];
  if (!Array.isArray(this.pendingBy)) this.pendingBy = [];

  const uniqAccepted = [...new Set(this.acceptedBy.map(String))].filter((id) =>
    studentSet.has(id)
  );
  const uniqPending = [...new Set(this.pendingBy.map(String))].filter((id) =>
    studentSet.has(id)
  );

  // If requiresAcceptance=true and pendingBy is empty at creation/update, default to all students
  if (this.requiresAcceptance && uniqPending.length === 0) {
    this.pendingBy = this.studentIds.map((id) => new mongoose.Types.ObjectId(id));
  } else {
    this.pendingBy = uniqPending.map((id) => new mongoose.Types.ObjectId(id));
  }

  // acceptedBy should not include anyone already pending
  const pendingSet = new Set(this.pendingBy.map(String));
  this.acceptedBy = uniqAccepted
    .filter((id) => !pendingSet.has(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  next();
});

/** Compound index to speed worker scans by status + due time */
RoutineSchema.index({ status: 1, 'slots.nextRunAt': 1 });
RoutineSchema.index({ teacherId: 1, status: 1, createdAt: -1 });

// Optional helpful index if you query agreement state frequently
RoutineSchema.index({ requiresAcceptance: 1, updatedAt: -1 });

/**
 * HARD RULE: For a given (teacherId, postId, student), there can be at most one routine
 * that is not archived. This multikey unique index enforces that each student can appear
 * in only one non-archived routine for the same teacher+post.
 */
RoutineSchema.index(
  { teacherId: 1, postId: 1, studentIds: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['active', 'paused'] } }, // exclude archived
  }
);

module.exports = mongoose.model('Routine', RoutineSchema);
