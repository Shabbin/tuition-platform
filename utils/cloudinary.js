// utils/cloudinary.js
const cloudinary = require('cloudinary').v2;

const {
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
  CLOUDINARY_BASE_FOLDER = 'tuition-platform',
  CLOUDINARY_IMAGES_ACCESS = 'public',
  CLOUDINARY_VIDEOS_ACCESS = 'authenticated',
} = process.env;

// Kill bad placeholder URLs if present
if (process.env.CLOUDINARY_URL && /your_api_key/i.test(process.env.CLOUDINARY_URL)) {
  console.warn('[Cloudinary] Removing placeholder CLOUDINARY_URL from env.');
  delete process.env.CLOUDINARY_URL;
}

if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
  throw new Error('Cloudinary env vars missing. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET');
}

cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME.trim(),
  api_key: CLOUDINARY_API_KEY.trim(),
  api_secret: CLOUDINARY_API_SECRET.trim(),
});

// ---- upload helpers ----

function uploadImageBuffer(buffer, { folder, public_id, access = CLOUDINARY_IMAGES_ACCESS }) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      {
        folder,
        public_id,
        resource_type: 'image',
        overwrite: true,
        transformation: [{ quality: 'auto', fetch_format: 'auto' }],
        access_mode: access === 'authenticated' ? 'authenticated' : 'public',
      },
      (err, res) => (err ? reject(err) : resolve(res))
    ).end(buffer);
  });
}

function uploadVideoBuffer(buffer, { folder, public_id, access = CLOUDINARY_VIDEOS_ACCESS }) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      {
        folder,
        public_id,
        resource_type: 'video',
        overwrite: true,
        transformation: [{ quality: 'auto' }],
        access_mode: access === 'authenticated' ? 'authenticated' : 'public',
      },
      (err, res) => (err ? reject(err) : resolve(res))
    ).end(buffer);
  });
}

/**
 * Generic uploader to match controllers expecting `uploadBuffer`.
 * Pass `resource_type: 'image' | 'video'` in options (defaults to 'image').
 */
function uploadBuffer(
  buffer,
  {
    folder,
    public_id,
    resource_type = 'image',
    overwrite = true,
    access_mode,          // 'public' | 'authenticated'
    transformation = [],  // optional server-side transforms
  } = {}
) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      {
        folder,
        public_id,
        resource_type,
        overwrite,
        access_mode,
        transformation,
      },
      (err, res) => (err ? reject(err) : resolve(res))
    ).end(buffer);
  });
}

// ---- URL builders ----

// public (unsigned) delivery with transformations on-the-fly
function buildImageUrl(public_id, opts = {}) {
  const { w, h, crop = 'fill', gravity = 'auto', format = 'auto', quality = 'auto' } = opts;
  return cloudinary.url(public_id, {
    secure: true,
    type: opts.access === 'authenticated' ? 'authenticated' : 'upload',
    resource_type: 'image',
    transformation: [{ width: w, height: h, crop, gravity, fetch_format: format, quality }],
  });
}

function buildVideoUrl(public_id, opts = {}) {
  const { format = 'mp4', quality = 'auto' } = opts;
  return cloudinary.url(public_id, {
    secure: true,
    type: opts.access === 'authenticated' ? 'authenticated' : 'upload',
    resource_type: 'video',
    transformation: [{ quality }],
    format,
  });
}

// signed URL (required for authenticated/private assets)
function buildSignedUrl(public_id, { resource_type = 'image', access = 'authenticated', trans = [] } = {}) {
  return cloudinary.url(public_id, {
    secure: true,
    type: access === 'authenticated' ? 'authenticated' : 'upload',
    resource_type,
    sign_url: true,
    transformation: trans,
  });
}

module.exports = {
  cloudinary,
  CLOUDINARY_BASE_FOLDER,
  CLOUDINARY_IMAGES_ACCESS,
  CLOUDINARY_VIDEOS_ACCESS,
  uploadImageBuffer,
  uploadVideoBuffer,
  uploadBuffer,          // ⬅️ added for your controller
  buildImageUrl,
  buildVideoUrl,
  buildSignedUrl,
};
