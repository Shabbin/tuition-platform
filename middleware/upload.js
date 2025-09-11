const multer = require('multer');
const path = require('path');

// Allowed types (unchanged)
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

  if (file.fieldname === 'videoFile') {
    const extOK = allowedVideoTypes.test(ext);
    const mimeOK = /^video\//.test(type);
    if (extOK && mimeOK) return cb(null, true);
    return cb(new Error('Only video files are allowed (mp4, mov, avi, mkv).'));
  }

  const extOK = allowedImageTypes.test(ext);
  const mimeOK = /^image\//.test(type) && /(jpeg|jpg|png|webp|heic)$/.test(type);
  if (extOK && mimeOK) return cb(null, true);

  return cb(new Error('Only image files are allowed (jpeg, jpg, png, webp, heic).'));
};

// ✅ Use memory storage so we can upload buffer → S3
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter,
});

module.exports = upload;
