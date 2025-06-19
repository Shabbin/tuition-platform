const express = require('express');
const router = express.Router();
const { fixSubjectsInPosts } = require('../controllers/adminController');

router.get('/fix-subjects', fixSubjectsInPosts);

module.exports = router;
