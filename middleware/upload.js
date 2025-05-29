// middleware/upload.js
const multer = require('multer');
const path = require('path');

// Configure storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/'); // make sure this folder exists
  },
  filename: function (req, file, cb) {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

// Allowed file types for profile images and videos
const allowedImageTypes = /jpeg|jpg|png/;
const allowedVideoTypes = /mp4|mov|avi/;

// File filter
const fileFilter = (req, file, cb) => {
  const extname = allowedImageTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedImageTypes.test(file.mimetype);

  if (file.fieldname === 'videoFile') {
    const videoExt = allowedVideoTypes.test(path.extname(file.originalname).toLowerCase());
    const videoMime = allowedVideoTypes.test(file.mimetype);
    return videoExt && videoMime ? cb(null, true) : cb(new Error('Only video files are allowed!'));
  }

  return extname && mimetype ? cb(null, true) : cb(new Error('Only image files are allowed!'));
};

// Set upload
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter,
});

module.exports = upload;
