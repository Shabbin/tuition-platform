// models/chatThread.js
const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema(
  {
    subject: String,

    // Accept both legacy (capitalized) and new (lowercase) values
    origin: {
      type: String,
      enum: ['Post', 'Direct', 'post', 'direct'],
      default: 'Direct',
    },

    // Link to a post when origin is/was started from a post (optional)
    originPostId: { type: mongoose.Schema.Types.ObjectId, ref: 'TeacherPost', default: null },

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'completed'],
      default: 'pending',
    },
    startedAt: Date,
    requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'TeacherRequest' },
  },
  { _id: false }
);

const chatThreadSchema = new mongoose.Schema(
  {
    participants: [
      { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    ],
    sessions: [sessionSchema],

    lastMessage: {
      text: String,
      senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      timestamp: Date,
    },

    // maps string(userId) -> Date
    lastSeen: { type: Map, of: Date, default: {} },
    lastOpened: { type: Map, of: Date, default: {} },
  },
  { timestamps: true, versionKey: false }
);

chatThreadSchema.index({ updatedAt: -1 });
chatThreadSchema.index({ 'lastMessage.timestamp': -1 });
// Helpful for request lookups
chatThreadSchema.index({ 'sessions.requestId': 1 });

module.exports =
  mongoose.models.ChatThread || mongoose.model('ChatThread', chatThreadSchema);
