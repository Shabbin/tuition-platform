// controllers/videoController.js
const { s3, S3_BUCKET } = require('../utils/cloudinary');
const { GetObjectCommand } = require('@aws-sdk/client-s3');

async function streamVideo(req, res) {
  try {
    const filename = req.params.filename; // keep your existing route param
    // If you upload videos under 'videos/<filename>' on S3, build the key similarly:
    const key = `videos/${filename}`;

    const range = req.headers.range; // e.g., "bytes=0-"
    const params = { Bucket: S3_BUCKET, Key: key, Range: range };

    const command = new GetObjectCommand(params);
    const s3Response = await s3.send(command);

    // Set headers for partial content if Range was requested
    const statusCode = range ? 206 : 200;
    if (s3Response.ContentRange) res.setHeader('Content-Range', s3Response.ContentRange);
    if (s3Response.AcceptRanges) res.setHeader('Accept-Ranges', s3Response.AcceptRanges);
    if (s3Response.ContentLength) res.setHeader('Content-Length', s3Response.ContentLength);
    if (s3Response.ContentType) res.setHeader('Content-Type', s3Response.ContentType);

    res.status(statusCode);
    s3Response.Body.pipe(res);
  } catch (err) {
    console.error('Video stream error:', err);
    res.status(404).json({ message: 'Video not found' });
  }
}

module.exports = { streamVideo };
