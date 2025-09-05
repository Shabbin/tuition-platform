// models/RoutineChangeRequest.js
const mongoose = require('mongoose');

/* Small helper */
function isHHMM(s) {
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(s || '').trim());
}

/**
 * Backward-compatible model with NEW fields for weekly slot edits.
 *
 * - Existing one-off fields (proposedDate, durationMinutes) stay as-is.
 * - New weekly fields:
 *     changeType: 'oneoff' | 'weekly'
 *     op:         'add' | 'update' | 'remove'     (weekly only)
 *     targetWeekday, targetTimeHHMM               (identify existing slot for update/remove)
 *     weekday, timeHHMM, durationMinutes          (new values for add/update; durationMinutes reused)
 *
 * - Per-student agreement tracking:
 *     studentIds (scope), pendingBy, acceptedBy, rejectedBy
 *
 * Aggregate `status` is automatically derived:
 *   - any rejectedBy  -> 'rejected'
 *   - pendingBy empty -> 'accepted'
 *   - otherwise       -> 'pending'
 */
const RoutineChangeRequestSchema = new mongoose.Schema(
  {
    routineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Routine', required: true, index: true },

    // Legacy hint (kept for compatibility)
    slotIndex: { type: Number, default: null },

    // Scope of the request (all these students are asked to respond)
    studentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],

    // -------------- One-off (legacy) --------------
    proposedDate: { type: Date, default: null },               // required for changeType='oneoff'
    durationMinutes: { type: Number, min: 1, default: null },  // reused by weekly add/update
    note: { type: String, default: '' },

    // -------------- NEW: Weekly edit --------------
    changeType: { type: String, enum: ['oneoff', 'weekly'], default: 'oneoff', index: true },
    op: { type: String, enum: ['add', 'update', 'remove'], default: null }, // weekly only

    // identify the existing slot for update/remove
    targetWeekday: { type: Number, min: 0, max: 6, default: null },
    targetTimeHHMM: { type: String, default: null }, // "HH:mm"

    // desired values (for add/update)
    weekday: { type: Number, min: 0, max: 6, default: null },
    timeHHMM: { type: String, default: null },       // "HH:mm"
    // durationMinutes is reused for weekly (required for add; optional for update)

    // creator & lifecycle
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // Aggregate status of the ENTIRE request
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending', index: true },

    // Per-student decision state
    pendingBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }],
    acceptedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }],
    rejectedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }],

    // (Legacy single-decider fields; kept for compatibility with older UI/services)
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

/* -------------------------- Normalization & Validation -------------------------- */
RoutineChangeRequestSchema.pre('validate', function (next) {
  const toObjectIds = (arr) =>
    [...new Set((arr || []).map(String))].map((id) => new mongoose.Types.ObjectId(id));

  // Normalize scope
  this.studentIds = toObjectIds(this.studentIds);
  if (!this.routineId) return next(new Error('routineId is required'));
  if (!Array.isArray(this.studentIds) || this.studentIds.length === 0) {
    return next(new Error('studentIds[] is required'));
  }

  // Build sets against scope
  const sSet = new Set(this.studentIds.map(String));
  const normWithinScope = (arr) => toObjectIds((arr || []).filter((id) => sSet.has(String(id))));

  // Bring decision arrays into scope before dedupe
  this.pendingBy  = normWithinScope(this.pendingBy && this.pendingBy.length ? this.pendingBy : this.studentIds);
  this.acceptedBy = normWithinScope(this.acceptedBy);
  this.rejectedBy = normWithinScope(this.rejectedBy);

  // Sets (now definitely within scope)
  const pSet = new Set(this.pendingBy.map(String));   // <-- now used
  const aSet = new Set(this.acceptedBy.map(String));
  const rSet = new Set(this.rejectedBy.map(String));

  // Priority: rejected > accepted > pending
  // 1) accepted cannot include any rejected
  this.acceptedBy = this.acceptedBy.filter((id) => !rSet.has(String(id)));
  // 2) pending := (pending ∩ scope) \ (accepted ∪ rejected)
  const bad = new Set([...aSet, ...rSet]); // union for quick lookup
  this.pendingBy = this.pendingBy.filter((id) => !bad.has(String(id)));

  // ------------ Shape checks ------------
  if (this.changeType === 'oneoff') {
    if (!this.proposedDate || !this.durationMinutes) {
      return next(new Error('proposedDate and durationMinutes are required for one-off change'));
    }
  } else if (this.changeType === 'weekly') {
    if (!this.op) return next(new Error('op is required for weekly changes (add|update|remove)'));

    if (this.op === 'remove' || this.op === 'update') {
      if (this.targetWeekday == null || !isHHMM(this.targetTimeHHMM)) {
        return next(new Error('targetWeekday and targetTimeHHMM are required for update/remove'));
      }
    }
    if (this.op !== 'remove') {
      if (this.weekday == null || !isHHMM(this.timeHHMM)) {
        return next(new Error('weekday and timeHHMM are required for add/update'));
      }
      if (this.op === 'add' && !this.durationMinutes) {
        return next(new Error('durationMinutes is required for weekly add'));
      }
      // durationMinutes for 'update' is optional; if absent, duration stays same server-side
    }
  }

  next();
});

/* Aggregate status maintenance
   - any rejectedBy -> 'rejected'
   - none pending   -> 'accepted'
   - else           -> 'pending'
*/
RoutineChangeRequestSchema.pre('save', function (next) {
  const hasRejected = Array.isArray(this.rejectedBy) && this.rejectedBy.length > 0;
  const hasPending  = Array.isArray(this.pendingBy) && this.pendingBy.length > 0;

  if (hasRejected) this.status = 'rejected';
  else if (!hasPending) this.status = 'accepted';
  else this.status = 'pending';

  next();
});

/* Helpful virtuals */
RoutineChangeRequestSchema.virtual('isWeekly').get(function () {
  return this.changeType === 'weekly';
});
RoutineChangeRequestSchema.virtual('isOneOff').get(function () {
  return this.changeType === 'oneoff';
});

/* Indexes for quicker dashboards */
RoutineChangeRequestSchema.index({ routineId: 1, createdAt: -1 });
RoutineChangeRequestSchema.index({ studentIds: 1, createdAt: -1 });
RoutineChangeRequestSchema.index({ changeType: 1, op: 1, status: 1, createdAt: -1 });

// ⛑️ Prevent OverwriteModelError on hot reloads / nodemon:
module.exports =
  mongoose.models.RoutineChangeRequest ||
  mongoose.model('RoutineChangeRequest', RoutineChangeRequestSchema);
