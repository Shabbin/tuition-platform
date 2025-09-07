// scripts/migrate-embedded-messages.js
const mongoose = require('mongoose');
const ChatThread = require('../models/chatThread');
const ChatMessage = require('../models/chatMessage');

(async function run() {
  await mongoose.connect('mongodb+srv://tuitionAdmin:tuitofy1234@cluster0.21atyhi.mongodb.net/tuition-platform');

  const cursor = ChatThread.find({ 'messages.0': { $exists: true } }).cursor();
  for (let thread = await cursor.next(); thread; thread = await cursor.next()) {
    const docs = (thread.messages || []).map(m => ({
      threadId: thread._id,
      senderId: m.senderId,
      text: m.text,
      timestamp: m.timestamp || new Date(),
    }));
    if (docs.length) {
      console.log(`Migrating ${docs.length} messages from thread ${thread._id}`);
      await ChatMessage.insertMany(docs, { ordered: false });
      await ChatThread.updateOne({ _id: thread._id }, { $set: { messages: [] } });
    }
  }

  await mongoose.disconnect();
  console.log('Done.');
})().catch(e => { console.error(e); process.exit(1); });
