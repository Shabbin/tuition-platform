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
  console.log('Uploading file:', file.fieldname, file.originalname, file.mimetype, file.size); // Debug

  if (file.fieldname === 'videoFile') {
    const extname = allowedVideoTypes.test(path.extname(file.originalname).toLowerCase());
    if (extname) {
      return cb(null, true);
    }
    return cb(new Error('Only video files are allowed!'));
  }

  // For image files
  const extname = allowedImageTypes.test(path.extname(file.originalname).toLowerCase());
  if (extname) {
    return cb(null, true);
  }

  return cb(new Error('Only image files are allowed!'));
};

// Set upload
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max, safer for videos
  fileFilter,
});

module.exports = upload;
