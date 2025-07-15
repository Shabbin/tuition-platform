const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
});

const sessionSchema = new mongoose.Schema({
  subject: String,
  origin: String, // e.g., Post or Direct
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'completed'], default: 'pending' },
  startedAt: Date,
  requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'TeacherRequest' },
});

const chatThreadSchema = new mongoose.Schema({
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  messages: [messageSchema],
  sessions: [sessionSchema],
}, { timestamps: true });

module.exports = mongoose.model('ChatThread', chatThreadSchema);
