// node scripts/backfillPaymentRequestId.js
require('dotenv').config();
const mongoose = require('mongoose');
const Payment = require('../models/payment');
const TeacherRequest = require('../models/teacherRequest');

(async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);

  const cursor = Payment.find({
    type: 'TUITION',
    $or: [{ requestId: { $exists: false } }, { requestId: null }],
  }).cursor();

  let updated = 0, skipped = 0;
  for (let pay = await cursor.next(); pay; pay = await cursor.next()) {
    // try strict (student+teacher+post), then looser (student+teacher)
    const qStrict = {
      studentId: pay.studentId,
      teacherId: pay.teacherId,
      status: 'approved',
    };
    if (pay.postId) qStrict.postId = pay.postId;

    let reqDoc = await TeacherRequest
      .findOne(qStrict)
      .sort({ updatedAt: -1, createdAt: -1 })
      .select('_id');

    if (!reqDoc) {
      reqDoc = await TeacherRequest
        .findOne({
          studentId: pay.studentId,
          teacherId: pay.teacherId,
          status: 'approved',
        })
        .sort({ updatedAt: -1, createdAt: -1 })
        .select('_id');
    }

    if (!reqDoc) {
      console.warn('SKIP: no approved TeacherRequest for payment', pay._id);
      skipped++;
      continue;
    }

    pay.requestId = reqDoc._id;
    await pay.save();
    updated++;
  }

  console.log({ updated, skipped });
  await mongoose.disconnect();
  process.exit(0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
