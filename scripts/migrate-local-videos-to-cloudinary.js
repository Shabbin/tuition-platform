// scripts/cleanup-missing-local-videos.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const fs = require('fs');
const mongoose = require('mongoose');
const TeacherPost = require('../models/teacherPost');

const LOCAL_VIDEO_ROOT = (process.env.LOCAL_VIDEO_ROOT || path.resolve(__dirname, '../uploads/videos')).trim();

function fileExists(basename) {
  const candidates = [
    `${LOCAL_VIDEO_ROOT}\\${basename}`,
    `${LOCAL_VIDEO_ROOT}\\${basename}.mp4`,
    `${LOCAL_VIDEO_ROOT}\\${basename}.webm`,
    `${LOCAL_VIDEO_ROOT}\\${basename}.mov`,
    `${LOCAL_VIDEO_ROOT}\\${basename}.mkv`,
  ];
  return candidates.some(p => fs.existsSync(p));
}

(async () => {
  const uri = (process.env.MONGO_URI || process.env.MONGODB_URI || '').trim();
  if (!uri) throw new Error('Missing MONGO_URI/MONGODB_URI');
  await mongoose.connect(uri);

  const broken = await TeacherPost.find({
    $and: [
      { $or: [{ videoPublicId: { $exists: false } }, { videoPublicId: '' }] },
      { videoFile: { $regex: /^\/?uploads\/videos\// } },
    ],
  }).select('_id videoFile');

  let cleared = 0;
  for (const p of broken) {
    const base = (p.videoFile || '').split('/').pop(); // hash-like name
    if (!base) continue;
    if (fileExists(base)) continue; // keep if the file is actually there

    await TeacherPost.updateOne(
      { _id: p._id },
      { $set: { videoFile: '', videoPublicId: '' } }
    );
    cleared++;
    console.log(`🧹 cleared missing video on post ${p._id}`);
  }

  console.log(`Done. Cleared ${cleared} post(s).`);
  process.exit(0);
})();
