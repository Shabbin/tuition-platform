const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  senderId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' }, // can be student or teacher
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
});

const chatThreadSchema = new mongoose.Schema({
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'TeacherRequest' },
  messages: [messageSchema],
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('ChatThread', chatThreadSchema);
