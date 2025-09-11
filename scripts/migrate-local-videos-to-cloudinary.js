// scripts/migrate-local-videos-to-cloudinary.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const fs = require('fs/promises');
const fssync = require('fs');
const crypto = require('crypto');
const mongoose = require('mongoose');

const TeacherPost = require('../models/teacherPost');
const {
  cloudinary,
  buildVideoUrl,
  CLOUDINARY_BASE_FOLDER,
  CLOUDINARY_VIDEOS_ACCESS,
} = require('../utils/cloudinary');

function splitRoots(str) {
  return (str || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(p => path.resolve(p));
}

async function walkDir(root) {
  const results = [];
  async function _walk(current) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) {
        await _walk(full);
      } else if (ent.isFile()) {
        results.push(full);
      }
    }
  }
  await _walk(root);
  return results;
}

async function buildIndex(roots) {
  const index = [];
  for (const root of roots) {
    try {
      const files = await walkDir(root);
      index.push(...files);
    } catch (e) {
      console.warn(`⚠️  Could not read root: ${root} – ${e.message}`);
    }
  }
  return index;
}

function findCandidateFile(index, dbPath) {
  const base = path.basename(dbPath).replace(/[/\\]/g, '');
  if (!base) return null;

  // exact
  let hit = index.find(p => path.basename(p) === base);
  if (hit) return hit;

  // starts-with (missing extension case)
  hit = index.find(p => path.basename(p).startsWith(base));
  if (hit) return hit;

  // contains (last resort)
  hit = index.find(p => path.basename(p).includes(base));
  if (hit) return hit;

  return null;
}

/** Derive Cloudinary public_id from a secure_url when SDK response lacks it */
function derivePublicIdFromUrl(url) {
  if (typeof url !== 'string') return '';
  // Matches: .../upload/(type/)?v12345/<public_id>(.ext?)
  const m = url.match(/\/upload\/(?:[^/]+\/)?v\d+\/(.+?)(?:\.\w+)?$/);
  return m ? m[1] : '';
}

async function uploadVideoLocal(localPath, public_id, accessMode) {
  const stat = fssync.statSync(localPath);
  const isLarge = stat.size >= 20 * 1024 * 1024; // 20MB threshold

  const commonOpts = {
    folder: `${CLOUDINARY_BASE_FOLDER}/posts/videos`,
    public_id,
    resource_type: 'video',
    overwrite: true,
    access_mode: accessMode, // 'public' or 'authenticated'
    eager: [{ format: 'mp4', quality: 'auto' }],
    eager_async: true,
  };

  if (isLarge) {
    return cloudinary.uploader.upload_large(localPath, {
      ...commonOpts,
      chunk_size: 6 * 1024 * 1024,
    });
  } else {
    return cloudinary.uploader.upload(localPath, commonOpts);
  }
}

async function main() {
  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!MONGO_URI) {
    console.error('Missing MONGO_URI/MONGODB_URI');
    process.exit(1);
  }

  const multiRoots = splitRoots(process.env.LOCAL_VIDEO_ROOTS);
  if (multiRoots.length === 0) {
    const single = process.env.LOCAL_VIDEO_ROOT || path.resolve(__dirname, '../uploads/videos');
    multiRoots.push(path.resolve(single));
  }

  console.log('Using .env at:', path.resolve(__dirname, '../.env'));
  console.log('Search roots:', multiRoots);
  const accessMode = (CLOUDINARY_VIDEOS_ACCESS || 'authenticated').toLowerCase();
  console.log('CLOUDINARY_VIDEOS_ACCESS:', accessMode);

  await mongoose.connect(MONGO_URI);
  console.log('✓ Connected to MongoDB');

  console.log('Indexing local files (this may take a moment)…');
  const index = await buildIndex(multiRoots);
  console.log(`Indexed ${index.length} files across ${multiRoots.length} root(s).`);
  try { console.log('Sample files:', index.slice(0, 5)); } catch {}

  // Find posts that still reference local videos
  const candidates = await TeacherPost.find({
    videoFile: { $regex: /\/uploads\/videos\// },
  }).lean();

  console.log(`Found ${candidates.length} local-video posts to migrate`);

  const migrated = [];
  const missing = [];

  for (const post of candidates) {
    try {
      const cand = findCandidateFile(index, post.videoFile);
      if (!cand) {
        missing.push({ _id: post._id.toString(), dbPath: post.videoFile });
        console.error(`✗ Missing: post ${post._id} (DB: ${post.videoFile})`);
        continue;
      }

      const teacherId = post.teacher?.toString() || 'unknown';
      const public_id = `${teacherId}-${crypto.randomBytes(8).toString('hex')}`;

      const uploaded = await uploadVideoLocal(cand, public_id, accessMode);

      // Robustly determine public_id
      let publicId = uploaded?.public_id || derivePublicIdFromUrl(uploaded?.secure_url || uploaded?.url || '');
      if (!publicId) {
        console.warn('⚠️  Could not read public_id; raw response:', uploaded);
      }

      const update = { videoPublicId: publicId };
      if (accessMode === 'public') {
        update.videoFile = buildVideoUrl(publicId, { format: 'mp4', access: 'public' });
      } else {
        update.videoFile = uploaded?.secure_url || uploaded?.url || '';
      }

      await TeacherPost.updateOne({ _id: post._id }, { $set: update });
      migrated.push({ _id: post._id.toString(), local: cand, public_id: publicId });
      console.log(`✓ Migrated post ${post._id} ← ${path.basename(cand)} → ${publicId || 'unknown'}`);
    } catch (e) {
      missing.push({ _id: post._id.toString(), dbPath: post.videoFile, error: e.message });
      console.error(`✗ Failed: post ${post._id} – ${e.message}`);
    }
  }

  console.log('— Summary —');
  console.log(`Migrated: ${migrated.length}`);
  console.log(`Missing : ${missing.length}`);
  if (missing.length) {
    console.log('Missing details (first 20):', missing.slice(0, 20));
  }

  await mongoose.disconnect();
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
