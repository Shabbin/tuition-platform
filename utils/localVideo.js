// server/utils/localVideo.js
// const path = require('path');

const API_BASE_URL =
  process.env.PUBLIC_BASE_URL ||
  process.env.API_BASE_URL ||
  `http://localhost:${process.env.PORT || 5000}`;

/**
 * Turn a stored local path like "/uploads/videos/foo.mp4" into an absolute URL
 * that the browser can fetch (served via static/express route).
 */
function absoluteLocalVideoUrl(storedPath = '') {
  if (!storedPath) return '';
  if (/^https?:\/\//i.test(storedPath)) return storedPath; // already absolute
  // normalize leading slash
  const clean = storedPath.startsWith('/') ? storedPath : `/${storedPath}`;
  return `${API_BASE_URL}${clean}`;
}

module.exports = { absoluteLocalVideoUrl };
