// models/Notification.js
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true, // recipient
    },

    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User', // person who triggered the notification
    },

    senderName: {
      type: String, // snapshot of sender's name at creation time
    },

    profileImage: {
      type: String, // snapshot of sender's profile image at creation time
    },

    type: {
      type: String,
      required: true, // 'tuition_request', 'request_approved', etc.
    },

    title: {
      type: String,
      required: true,
    },

    message: {
      type: String,
    },

    // Optional extra info (e.g., requestId, teacherName, threadId, postId)
    data: mongoose.Schema.Types.Mixed,

    read: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// (Optional) helpful index for unread sorting/filtering
notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

// ✅ Guard against recompiling the model in dev/hot-reload
module.exports =
  mongoose.models.Notification ||
  mongoose.model('Notification', notificationSchema);
