const mongoose = require('mongoose');
const ChatThread = require('../models/chatThread');
const TeacherRequest = require('../models/teacherRequest');

const MONGO_URI = 'mongodb+srv://tuitionAdmin:tuitofy1234@cluster0.21atyhi.mongodb.net/tuition-platform';

async function fullReset() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Delete all chat threads
    const deletedThreads = await ChatThread.deleteMany({});
    console.log(`🗑️ Deleted all chat threads: ${deletedThreads.deletedCount}`);

    // Delete all teacher requests
    const deletedRequests = await TeacherRequest.deleteMany({});
    console.log(`🗑️ Deleted all teacher requests: ${deletedRequests.deletedCount}`);

    console.log('🎉 Full reset complete. All chat threads and teacher requests are removed.');

    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  } catch (err) {
    console.error('Error during full reset:', err);
  }
}

fullReset();
