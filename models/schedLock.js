// server/models/schedLock.js
const mongoose = require('mongoose');

const SchedLockSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    acquiredAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

// Auto-expire as a guard (e.g., 5 minutes)
SchedLockSchema.index({ createdAt: 1 }, { expireAfterSeconds: 300 });

module.exports = mongoose.model('SchedLock', SchedLockSchema);
