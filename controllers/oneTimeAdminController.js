const express = require('express');
const router = express.Router();
const TeacherPost = require('../models/teacherPost');
const { flattenSubjects } = require('../utils/normalize');

// GET /api/admin/fix-subjects
router.get('/fix-subjects', async (req, res) => {
  try {
    const posts = await TeacherPost.find();

    let updatedCount = 0;

    for (const post of posts) {
      const clean = flattenSubjects(post.subjects);

      if (JSON.stringify(post.subjects) !== JSON.stringify(clean)) {
        post.subjects = clean;
        await post.save();
        updatedCount++;
      }
    }

    res.status(200).json({ message: `Subjects cleaned for ${updatedCount} posts.` });
  } catch (err) {
    console.error('Fix subjects error:', err);
    res.status(500).json({ message: 'Error fixing subjects' });
  }
});

module.exports = router;
