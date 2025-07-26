const mongoose = require('mongoose');
const ChatThread = require('../models/chatThread'); // adjust path

async function backfillLastMessage() {
  try {
    // Find threads with missing or null lastMessage.text
    const threads = await ChatThread.find({
      $or: [
        { lastMessage: { $exists: false } },
        { 'lastMessage.text': { $exists: false } },
        { lastMessage: null }
      ]
    });

    for (const thread of threads) {
      if (thread.messages && thread.messages.length > 0) {
        const lastMsg = thread.messages[thread.messages.length - 1];
        thread.lastMessage = {
          text: lastMsg.text,
          senderId: lastMsg.senderId,
          timestamp: lastMsg.timestamp,
        };
      } else {
        // No messages, so lastMessage can be null or a placeholder
        thread.lastMessage = null;
      }
      await thread.save();
      console.log(`Updated lastMessage for thread ${thread._id}`);
    }

    console.log('Migration complete!');
  } catch (err) {
    console.error('Migration error:', err);
  }
}

mongoose.connect('mongodb+srv://tuitionAdmin:tuitofy1234@cluster0.21atyhi.mongodb.net/tuition-platform', { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => backfillLastMessage())
  .finally(() => mongoose.disconnect());
