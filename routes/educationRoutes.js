const express = require('express');
const router = express.Router();
const educationTree = require('../full_syllabus_all_subjects.json');

router.get('/api/education-tree', (req, res) => {
  res.status(200).json(educationTree);
});

module.exports = router;
