const mongoose = require('mongoose');

const PostViewEventSchema = new mongoose.Schema({
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'TeacherPost', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // Authenticated user ID
  visitorId: { type: String, default: null }, // Anonymous visitor UUID
}, {
  timestamps: true  // adds createdAt & updatedAt automatically
});

module.exports = mongoose.model('PostViewEvent', PostViewEventSchema);
