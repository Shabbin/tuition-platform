// migrateMessages.js
const mongoose = require('mongoose');
const ChatThread = require('./models/chatThread');
const ChatMessage = require('./models/chatMessage');

async function migrate() {
  await mongoose.connect('mongodb+srv://tuitionAdmin:tuitofy1234@cluster0.21atyhi.mongodb.net/tuition-platform', { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('Connected to MongoDB');

  const threads = await ChatThread.find({ messages: { $exists: true, $not: { $size: 0 } } });

  console.log(`Found ${threads.length} chat threads with embedded messages`);

  for (const thread of threads) {
    const threadId = thread._id;
    for (const msg of thread.messages) {
      const newMsg = new ChatMessage({
        threadId: threadId,
        senderId: msg.senderId,
        text: msg.text,
        timestamp: msg.timestamp,
      });

      await newMsg.save();
      console.log(`Migrated message ${newMsg._id} from thread ${threadId}`);
    }

    // Optionally: clear messages array to avoid duplication
    thread.messages = [];
    await thread.save();
    console.log(`Cleared embedded messages for thread ${threadId}`);
  }

  mongoose.disconnect();
  console.log('Migration complete and disconnected');
}

migrate().catch(console.error);
