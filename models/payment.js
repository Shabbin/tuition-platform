const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  type: { type: String, enum: ['TOPIC_PACK', 'TUITION'], required: true },
  provider: { type: String, default: 'SSLCOMMERZ' },
  requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'TeacherRequest' }, // for tuition
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },          // tuition
  amount: { type: Number, required: true },
  commissionRate: Number,     // 0.30 or 0.15 for tuition
  yourShare: Number,          // platform share
  teacherShare: Number,       // teacher net
  phase: { type: String, enum: ['FIRST','RECURRING', null], default: null },
  monthIndex: Number,
  tran_id: String,
  bank_tran_id: String,
  status: { type: String, enum: ['PENDING','PAID','FAILED'], default: 'PAID' },
}, { timestamps: true });

schema.index({ tran_id: 1 }, { unique: true });
module.exports = mongoose.models.Payment || mongoose.model('Payment', schema);
