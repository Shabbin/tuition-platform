// middleware/upload.js
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

// Configure storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/'); // make sure this folder exists
  },
  filename: function (req, file, cb) {
    // Always preserve the correct extension
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = crypto.randomBytes(16).toString('hex') + ext;
    cb(null, uniqueName);
  },
});

// Allowed file types for profile images and videos
// keep or expand these as you need (added heic/webp and mkv, optional)
const allowedImageTypes = /^(jpeg|jpg|png|webp|heic)$/i;
const allowedVideoTypes = /^(mp4|mov|avi|mkv)$/i;

const fileFilter = (req, file, cb) => {
  const ext = (path.extname(file.originalname || '').toLowerCase().replace('.', '') || '');
  const type = (file.mimetype || '').toLowerCase();

  console.log('Uploading file:', {
    fieldname: file.fieldname,
    originalname: file.originalname,
    mimetype: file.mimetype,
    ext,
  });

  // If the field is explicitly for video
  if (file.fieldname === 'videoFile') {
    const extOK = allowedVideoTypes.test(ext);
    const mimeOK = /^video\//.test(type);
    if (extOK && mimeOK) return cb(null, true);
    return cb(new Error('Only video files are allowed (mp4, mov, avi, mkv).'));
  }

  // Otherwise treat as image (e.g., 'profileImage', 'image', etc.)
  const extOK = allowedImageTypes.test(ext);
  const mimeOK = /^image\//.test(type) && /(jpeg|jpg|png|webp|heic)$/.test(type);
  if (extOK && mimeOK) return cb(null, true);

  return cb(new Error('Only image files are allowed (jpeg, jpg, png, webp, heic).'));
};

// Set upload
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max, safer for videos
  fileFilter,
});

module.exports = upload;
