// models/chatMessage.js
const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema({
  threadId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatThread', index: true, required: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
  text:     { type: String, required: true, maxlength: 4000 },
  timestamp:{ type: Date, default: Date.now, index: true },

  // 👇 optional: client-generated UUID to dedupe retries
  clientKey: { type: String, index: true, unique: true, sparse: true },
}, {
  timestamps: false, // using explicit timestamp field
  versionKey: false,
});

chatMessageSchema.index({ threadId: 1, timestamp: -1, _id: -1 }); // pagination
chatMessageSchema.index({ senderId: 1, timestamp: -1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
