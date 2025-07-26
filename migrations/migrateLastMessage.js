// migrateLastMessage.js

const mongoose = require('mongoose');

// Replace with your MongoDB connection string
const MONGO_URI = 'mongodb+srv://tuitionAdmin:tuitofy1234@cluster0.21atyhi.mongodb.net/tuition-platform';

// Define ChatThread schema (minimal for this script)
const chatThreadSchema = new mongoose.Schema({}, { strict: false });
const ChatThread = mongoose.model('ChatThread', chatThreadSchema, 'chatthreads'); // make sure collection name matches

async function migrateLastMessage() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    // Find all threads missing lastMessage or with lastMessage null
    const cursor = ChatThread.find({
      $or: [
        { lastMessage: { $exists: false } },
        { lastMessage: null }
      ]
    }).cursor();

    let updatedCount = 0;

    for (let thread = await cursor.next(); thread != null; thread = await cursor.next()) {
      if (thread.messages && thread.messages.length > 0) {
        const lastMsg = thread.messages[thread.messages.length - 1];
        thread.lastMessage = lastMsg;
        await thread.save();
        updatedCount++;
        console.log(`Updated lastMessage for thread ${thread._id}`);
      } else {
        // Optionally, set lastMessage explicitly to null (or skip)
        thread.lastMessage = null;
        await thread.save();
        updatedCount++;
        console.log(`Set lastMessage to null for thread ${thread._id}`);
      }
    }

    console.log(`Migration completed. Updated ${updatedCount} documents.`);
    process.exit(0);
  } catch (error) {
    console.error('Migration error:', error);
    process.exit(1);
  }
}

migrateLastMessage();
