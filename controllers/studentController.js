// controllers/studentController.js
const crypto = require('crypto');
const User = require('../models/user');

// ⬇️ Cloudinary helpers (same style as your teacher controller)
const { cloudinary, uploadBuffer } = require('../utils/cloudinary');

const BASE_FOLDER = process.env.CLOUDINARY_BASE_FOLDER || 'tuition-platform';
const IMAGES_ACCESS = (process.env.CLOUDINARY_IMAGES_ACCESS || 'public').toLowerCase(); // 'public' | 'authenticated'

// Small helper to safely destroy an existing Cloudinary asset by public_id
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

// Build a transformed image URL for display (face-cropped avatar)
function buildImageUrl(publicId, { w, h, crop = 'fill', gravity = 'auto' } = {}) {
  return cloudinary.url(publicId, {
    secure: true,
    resource_type: 'image',
    type: IMAGES_ACCESS === 'authenticated' ? 'authenticated' : 'upload',
    sign_url: IMAGES_ACCESS === 'authenticated', // sign if private
    transformation: [{ width: w, height: h, crop, gravity, quality: 'auto', fetch_format: 'auto' }],
  });
}

// ------------------------------------
// Existing: Fetch eligible teachers
// ------------------------------------
const getEligibleTeachers = async (req, res) => {
  try {
    const teachers = await User.find({ role: 'teacher', isEligible: true }).select('-password');
    return res.status(200).json(teachers);
  } catch (error) {
    console.error('Error fetching teachers:', error.message);
    return res.status(500).json({ message: 'Failed to fetch teachers' });
  }
};

// ------------------------------------
// NEW: Update student profile picture
// ------------------------------------
// PUT /api/students/profile-picture
// field name: profileImage (multipart/form-data)
const updateStudentProfilePicture = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId || req.user?._id;
    if (!userId) return res.status(401).json({ message: 'Not authenticated' });

    const student = await User.findById(userId);
    if (!student || student.role !== 'student') {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Keep old publicId to clean up after successful upload
    const oldPublicId = student.profileImagePublicId || '';

    // Cloudinary target (mirrors teacher structure)
    const folder = `${BASE_FOLDER}/images/profile`;
    const public_id = `${userId}-${crypto.randomBytes(8).toString('hex')}`;

    // Upload buffer → Cloudinary (access from env)
    const uploaded = await uploadBuffer(req.file.buffer, {
      folder,
      public_id,
      resource_type: 'image',
      overwrite: true,
      access_mode: IMAGES_ACCESS === 'authenticated' ? 'authenticated' : 'public',
      transformation: [{ quality: 'auto', fetch_format: 'auto' }],
    });

    // Face-focused square 300x300 URL for UI
    const displayUrl = buildImageUrl(uploaded.public_id, { w: 300, h: 300, crop: 'fill', gravity: 'face' });

    // Save new refs
    student.profileImage = displayUrl;
    student.profileImagePublicId = uploaded.public_id;
    await student.save();

    // Best-effort cleanup of old asset
    if (oldPublicId && oldPublicId !== uploaded.public_id) {
      destroyIfExists(oldPublicId, 'image').catch(() => {});
    }

    return res.status(200).json({
      message: 'Profile picture updated successfully',
      profileImage: student.profileImage,
    });
  } catch (err) {
    console.error('Student profile picture update error:', err);
    return res.status(500).json({ message: 'Upload failed', detail: err.message });
  }
};

module.exports = {
  // existing
  getEligibleTeachers,
  // new
  updateStudentProfilePicture,
};
