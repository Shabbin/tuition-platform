const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  questionId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  studentId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  teacherId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  gross: Number,          // 40
  platformFee: Number,    // 4
  teacherNet: Number,     // 36
}, { timestamps: true });

module.exports = mongoose.models.SolvePayout || mongoose.model('SolvePayout', schema);