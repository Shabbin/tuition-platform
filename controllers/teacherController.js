// controllers/teacherController.js
const User = require('../models/user');
const TuitionPost = require('../models/teacherPost');
const delay = require('../utils/delay');
const crypto = require('crypto');

// ⬇️ from your Cloudinary helper (make sure it exports cloudinary + uploadBuffer)
const { cloudinary, uploadBuffer } = require('../utils/cloudinary');

const BASE_FOLDER = process.env.CLOUDINARY_BASE_FOLDER || 'tuition-platform';
const IMAGES_ACCESS = (process.env.CLOUDINARY_IMAGES_ACCESS || 'public').toLowerCase();         // 'public' | 'authenticated'
const VIDEOS_ACCESS = (process.env.CLOUDINARY_VIDEOS_ACCESS || 'authenticated').toLowerCase();  // 'public' | 'authenticated'

// small helper to safely destroy an existing Cloudinary asset by public_id
async function destroyIfExists(publicId, resource_type = 'image') {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, {
      resource_type,
      type: resource_type === 'image' ? 'upload' : 'upload',
      invalidate: true,
    });
  } catch (e) {
    console.warn('[Cloudinary] destroy failed (non-fatal):', e?.message || e);
  }
}

// build a transformed image URL for display (e.g., face-cropped avatar)
function buildImageUrl(publicId, { w, h, crop = 'fill', gravity = 'auto' } = {}) {
  return cloudinary.url(publicId, {
    secure: true,
    resource_type: 'image',
    type: IMAGES_ACCESS === 'authenticated' ? 'authenticated' : 'upload',
    sign_url: IMAGES_ACCESS === 'authenticated', // sign if private
    transformation: [{ width: w, height: h, crop, gravity, quality: 'auto', fetch_format: 'auto' }],
  });
}

// ==============================
// MANUALLY APPROVE TEACHER
// ==============================
const approveTeacherEligibility = async (req, res) => {
  try {
    const { teacherId } = req.params;

    const teacher = await User.findById(teacherId);
    if (!teacher || teacher.role !== 'teacher') {
      return res.status(404).json({ message: 'Teacher not found' });
    }

    teacher.isEligible = true;
    await teacher.save();

    res.status(200).json({ message: 'Teacher marked as eligible', teacher });
  } catch (error) {
    console.error('Eligibility approval error:', error.message);
    res.status(500).json({ message: 'Error approving teacher eligibility' });
  }
};

// ==============================
// GET TEACHER PROFILE + POSTS
// ==============================
const getTeacherProfileWithPosts = async (req, res) => {
  try {
    const teacherId = req.params.id;
    const teacher = await User.findById(teacherId).select('-password');

    if (!teacher || teacher.role !== 'teacher') {
      return res.status(404).json({ message: 'Teacher not found or not a teacher' });
    }

    const posts = await TuitionPost.find({ teacher: teacherId });
    res.json({ teacher, posts });
  } catch (err) {
    console.error('Error fetching teacher profile:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// UPDATE PROFILE PICTURE (Cloudinary + transform + old cleanup)
// ==============================
const updateProfilePicture = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId || req.userId || req.user?._id;
    if (!userId) return res.status(401).json({ message: 'Not authenticated' });

    const teacher = await User.findById(userId);
    if (!teacher || teacher.role !== 'teacher') {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // keep the old publicId to clean up after successful upload
    const oldPublicId = teacher.profileImagePublicId || '';

    // Cloudinary target
    const folder = `${BASE_FOLDER}/images/profile`;
    const public_id = `${userId}-${crypto.randomBytes(8).toString('hex')}`;

    // Upload buffer → Cloudinary (set access mode from env)
    const uploaded = await uploadBuffer(req.file.buffer, {
      folder,
      public_id,
      resource_type: 'image',
      overwrite: true,
      access_mode: IMAGES_ACCESS === 'authenticated' ? 'authenticated' : 'public',
      transformation: [{ quality: 'auto', fetch_format: 'auto' }],
    });

    // Build a nice, face-focused square 300x300 URL for UI
    const displayUrl = buildImageUrl(uploaded.public_id, { w: 300, h: 300, crop: 'fill', gravity: 'face' });

    // Save new refs
    teacher.profileImage = displayUrl;
    teacher.profileImagePublicId = uploaded.public_id;
    await teacher.save();

    // best-effort cleanup of old asset (non-blocking for UX)
    if (oldPublicId && oldPublicId !== uploaded.public_id) {
      destroyIfExists(oldPublicId, 'image').catch(() => {});
    }

    await delay(200);
    res.status(200).json({
      message: 'Profile picture updated successfully',
      profileImage: teacher.profileImage,
    });
  } catch (err) {
    console.error('Profile picture update error:', err);
    res.status(500).json({ message: 'Server error', detail: err.message });
  }
};

// ==============================
// UPDATE COVER IMAGE (Cloudinary + transform + old cleanup)
// ==============================
const updateCoverImage = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId || req.userId || req.user?._id;
    if (!userId) return res.status(401).json({ message: 'Not authenticated' });

    const teacher = await User.findById(userId);
    if (!teacher || teacher.role !== 'teacher') {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const oldPublicId = teacher.coverImagePublicId || '';

    const folder = `${BASE_FOLDER}/images/cover`;
    const public_id = `${userId}-${crypto.randomBytes(8).toString('hex')}`;

    const uploaded = await uploadBuffer(req.file.buffer, {
      folder,
      public_id,
      resource_type: 'image',
      overwrite: true,
      access_mode: IMAGES_ACCESS === 'authenticated' ? 'authenticated' : 'public',
      transformation: [{ quality: 'auto', fetch_format: 'auto' }],
    });

    // Wide banner 1500x500 for UI
    const bannerUrl = buildImageUrl(uploaded.public_id, { w: 1500, h: 500, crop: 'fill', gravity: 'auto' });

    teacher.coverImage = bannerUrl;
    teacher.coverImagePublicId = uploaded.public_id;
    await teacher.save();

    if (oldPublicId && oldPublicId !== uploaded.public_id) {
      destroyIfExists(oldPublicId, 'image').catch(() => {});
    }

    await delay(200);
    res.status(200).json({ message: 'Cover image updated', coverImage: teacher.coverImage });
  } catch (error) {
    console.error('Error updating cover image:', error);
    res.status(500).json({ message: 'Failed to update cover image', detail: error.message });
  }
};

// ==============================
// (OPTIONAL) INTRO VIDEO UPLOAD  — add a route later if needed
// field name: videoFile
// ==============================
const uploadIntroVideo = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId || req.userId || req.user?._id;
    if (!userId) return res.status(401).json({ message: 'Not authenticated' });

    const teacher = await User.findById(userId);
    if (!teacher || teacher.role !== 'teacher') {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const oldPublicId = teacher.introVideoPublicId || '';

    const folder = `${BASE_FOLDER}/videos/intro`;
    const public_id = `${userId}-${crypto.randomBytes(8).toString('hex')}`;

    // Upload video; set access from env (defaults to 'authenticated')
    const uploaded = await uploadBuffer(req.file.buffer, {
      folder,
      public_id,
      resource_type: 'video',
      overwrite: true,
      access_mode: VIDEOS_ACCESS === 'authenticated' ? 'authenticated' : 'public',
      transformation: [{ quality: 'auto' }],
    });

    // If public, we can build a direct URL; for private we’ll sign on demand
    const videoUrl =
      VIDEOS_ACCESS === 'public'
        ? cloudinary.url(uploaded.public_id, { secure: true, resource_type: 'video', type: 'upload', format: 'mp4' })
        : '';

    // Save new refs
    teacher.introVideoPublicId = uploaded.public_id;
    teacher.introVideoAccess = VIDEOS_ACCESS;
    teacher.introVideoUrl = videoUrl;
    await teacher.save();

    // cleanup old video if replaced
    if (oldPublicId && oldPublicId !== uploaded.public_id) {
      destroyIfExists(oldPublicId, 'video').catch(() => {});
    }

    res.status(200).json({
      message: 'Intro video uploaded',
      publicId: uploaded.public_id,
      url: videoUrl || null,
      access: VIDEOS_ACCESS,
    });
  } catch (err) {
    console.error('Intro video upload error:', err);
    res.status(500).json({ message: 'Failed to upload video', detail: err.message });
  }
};

// ==============================
// (OPTIONAL) SIGNED URL for private media
// GET /api/teachers/media/:publicId/signed?type=image|video
// ==============================
const getSignedMediaUrl = async (req, res) => {
  try {
    const { publicId } = req.params;
    const type = (req.query.type || 'image').toLowerCase(); // 'image' | 'video'
    const resource_type = type === 'video' ? 'video' : 'image';

    // Build a signed delivery URL (short-lived; signature on the URL)
    const url = cloudinary.url(publicId, {
      secure: true,
      resource_type,
      type: 'authenticated',
      sign_url: true,
      transformation:
        resource_type === 'image'
          ? [{ width: 1500, height: 500, crop: 'fill', gravity: 'auto', quality: 'auto', fetch_format: 'auto' }]
          : [{ quality: 'auto' }],
    });

    res.json({ ok: true, url });
  } catch (err) {
    console.error('Signed URL error:', err);
    res.status(500).json({ ok: false, message: 'Failed to build signed URL', detail: err.message });
  }
};

// ==============================
// UPDATE PROFILE INFO (unchanged)
// ==============================
const MAX_BIO = 10000;

const updateProfileInfo = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId || req.userId || req.user?._id;
    if (!userId) return res.status(401).json({ message: 'Not authenticated' });

    const teacher = await User.findById(userId);
    if (!teacher || teacher.role !== 'teacher') {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const { name, bio, hourlyRate, skills, location, availability } = req.body;

    if (name !== undefined) teacher.name = String(name).trim();

    if (bio !== undefined) {
      const trimmed = String(bio).trim();
      if (trimmed.length > MAX_BIO) {
        return res.status(400).json({ message: `Bio cannot exceed ${MAX_BIO} characters (got ${trimmed.length}).` });
      }
      teacher.bio = trimmed;
    }

    if (hourlyRate !== undefined) teacher.hourlyRate = Number(hourlyRate);
    if (skills !== undefined) {
      teacher.skills = Array.isArray(skills)
        ? skills
        : String(skills).split(',').map(s => s.trim()).filter(Boolean);
    }
    if (location !== undefined) teacher.location = String(location).trim();
    if (availability !== undefined) teacher.availability = availability;

    await teacher.save();
    return res.json({ message: 'Profile updated successfully', user: teacher });
  } catch (err) {
    console.error('Update profile info error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  approveTeacherEligibility,
  getTeacherProfileWithPosts,
  updateProfilePicture,
  updateCoverImage,
  updateProfileInfo,

  // ⬇️ optional extras (only use if you add routes for them)
  uploadIntroVideo,
  getSignedMediaUrl,
};
