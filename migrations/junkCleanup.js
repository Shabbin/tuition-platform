// junkCleanup.js
const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config(); // Make sure .env file is loaded if you're using one

const ChatThread = require('../models/chatThread');
const TeacherRequest = require('../models/teacherRequest');

// ✅ Connect to MongoDB
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
  console.error('❌ DB connection or cleanup failed:', err);
  mongoose.disconnect();
});

// 🚀 Cleanup Function
async function cleanup() {
  const threads = await ChatThread.find();

  for (const thread of threads) {
    const req = await TeacherRequest.findById(thread.requestId);
    if (!req || req.status !== 'approved') {
      await ChatThread.findByIdAndDelete(thread._id);
      console.log(`🗑️ Deleted thread ${thread._id}`);
    }
  }

  // Optional: remove requests that are not approved
  await TeacherRequest.deleteMany({ status: { $ne: 'approved' } });
  console.log('🧹 Deleted all unapproved requests.');
}
