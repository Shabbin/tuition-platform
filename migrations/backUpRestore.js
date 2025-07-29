const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const ChatThread = require('../models/chatThread');
const TeacherRequest = require('../models/teacherRequest');

mongoose.connect("mongodb+srv://tuitionAdmin:tuitofy1234@cluster0.21atyhi.mongodb.net/tuition-platform", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  console.log('✅ Connected to MongoDB');
  return cleanup();
})
.then(() => {
  console.log('🎉 Cleanup complete');
  mongoose.disconnect();
})
.catch((err) => {
  console.error('❌ Cleanup failed:', err);
  mongoose.disconnect();
});

async function cleanup() {
  // Delete chat threads which link to requests that do not exist or are not approved
  const threads = await ChatThread.find();

  for (const thread of threads) {
    const req = await TeacherRequest.findById(thread.requestId);
    if (!req) {
      // No related request found, delete thread
      await ChatThread.findByIdAndDelete(thread._id);
      console.log(`🗑️ Deleted thread ${thread._id} (no request)`);
    } else if (req.status !== 'approved') {
      // Request exists but not approved — skip deletion here (or optionally delete thread)
      // To be safe, do NOT delete threads for pending or rejected requests,
      // so you keep chat history until requests are resolved.
      console.log(`⚠️ Skipped thread ${thread._id} linked to unapproved request`);
    }
  }

  // OPTIONAL: You can clean junk requests manually, but don't mass delete without backup
  // For example, delete only very old pending or rejected requests (e.g., older than 30 days)
  /*
  const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const result = await TeacherRequest.deleteMany({
    status: { $ne: 'approved' },
    updatedAt: { $lt: cutoffDate }
  });
  console.log(`🧹 Deleted ${result.deletedCount} old unapproved requests`);
  */
}
