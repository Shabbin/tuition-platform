const mongoose = require('mongoose');
const ChatThread = require('../models/chatThread'); // adjust path if needed

async function fixLastMessages() {
  await mongoose.connect('mongodb+srv://tuitionAdmin:tuitofy1234@cluster0.21atyhi.mongodb.net/tuition-platform');

  const threads = await ChatThread.find({ lastMessage: { $exists: false } });

  console.log(`Found ${threads.length} threads without lastMessage`);

  for (const thread of threads) {
    if (thread.messages.length > 0) {
      const lastMsg = thread.messages[thread.messages.length - 1];

      thread.lastMessage = {
        text: lastMsg.text,
        senderId: lastMsg.senderId,
        timestamp: lastMsg.timestamp,
      };

      await thread.save();
      console.log(`Updated lastMessage for thread ${thread._id}`);
    } else {
      console.log(`Thread ${thread._id} has no messages, skipping`);
    }
  }

  mongoose.disconnect();
  console.log('Migration done');
}

fixLastMessages().catch(console.error);
