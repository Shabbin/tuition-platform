const mongoose = require('mongoose');
const TeacherRequest = require('../models/teacherRequest');

async function main() {
  await mongoose.connect('mongodb+srv://tuitionAdmin:tuitofy1234@cluster0.21atyhi.mongodb.net/tuition-platform', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  console.log('✅ Connected to MongoDB');

  // Deduplication logic example:
  const duplicates = await TeacherRequest.aggregate([
    {
      $match: { status: 'approved' },
    },
    {
      $group: {
        _id: { teacherId: '$teacherId', studentId: '$studentId', postId: '$postId' },
        ids: { $push: '$_id' },
        count: { $sum: 1 },
      },
    },
    {
      $match: { count: { $gt: 1 } },
    },
  ]);

  console.log(`Found ${duplicates.length} duplicate groups`);

  for (const group of duplicates) {
    const [keep, ...remove] = group.ids.sort(); // Keep first, remove rest
    console.log(`Keeping ${keep} and removing ${remove.length} duplicates`);

    await TeacherRequest.deleteMany({ _id: { $in: remove } });
  }

  console.log('🎉 Deduplication complete');
  process.exit(0);
}

main().catch(console.error);
