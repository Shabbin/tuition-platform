const mongoose = require('mongoose');
const ChatThread = require('../models/chatThread');

const MONGO_URI = 'mongodb+srv://tuitionAdmin:tuitofy1234@cluster0.21atyhi.mongodb.net/tuition-platform';

async function cleanupDuplicateThreads() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Aggregate threads grouped by requestId having duplicates
    const duplicates = await ChatThread.aggregate([
      {
        $group: {
          _id: '$requestId',
          docs: {
            $push: { _id: '$_id', createdAt: '$createdAt', updatedAt: '$updatedAt' },
          },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } }, // only groups with duplicates
    ]);

    console.log(`Found ${duplicates.length} duplicate thread groups`);

    let totalDeleted = 0;

    for (const group of duplicates) {
      // Sort docs descending by updatedAt or createdAt to keep the latest
      const sortedDocs = group.docs.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

      // Keep the first (latest) doc
      const [latest, ...toDelete] = sortedDocs;

      const deleteIds = toDelete.map(doc => doc._id);

      const res = await ChatThread.deleteMany({ _id: { $in: deleteIds } });

      console.log(`Kept thread ${latest._id}, deleted ${res.deletedCount} duplicates`);
      totalDeleted += res.deletedCount;
    }

    console.log(`🎉 Duplicate chatThreads cleanup complete. Total deleted: ${totalDeleted}`);

    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  } catch (err) {
    console.error('Error during chatThreads cleanup:', err);
  }
}

cleanupDuplicateThreads();
