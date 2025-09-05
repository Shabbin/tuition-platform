// server/models/changeRequest.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * A single flow to cover both:
 *  - schedule changes (targetType='schedule', targetId=<Schedule._id>)
 *  - routine slot changes or one-off from routine (targetType='routine', targetId=<Routine._id>, slotIndex?)
 */
const changeRequestSchema = new Schema(
  {
    targetType: { type: String, enum: ['schedule', 'routine'], required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },

    // optional for routine slot edit
    slotIndex: { type: Number, default: null },

    // who’s involved
    teacherId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    studentIds: [{ type: Schema.Types.ObjectId, ref: 'User', required: true }], // 1..n
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },   // teacher or student

    // the proposed occurrence (local agreement always creates/updates this one)
    proposedDate: { type: Date, required: true },
    durationMinutes: { type: Number, default: 60, min: 1 },

    note: { type: String, default: '' },

    status: { type: String, enum: ['pending', 'accepted', 'rejected', 'cancelled'], default: 'pending' },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ChangeRequest', changeRequestSchema);
