const express = require('express');
const router = express.Router();
const { streamVideo } = require('../controllers/videoController');

// GET /videos/:filename
router.get('/:filename', streamVideo);

module.exports = router;
