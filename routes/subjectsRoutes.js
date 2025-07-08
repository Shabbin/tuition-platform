const express = require('express');
const router = express.Router();
const {
  getSubjects,
  getSubjectsWithKeywords,
  getSubjectSuggestions, // ✅ Import the new controller
} = require('../controllers/subjectsController');

router.get('/subjects', getSubjects);
router.get('/subjects/full', getSubjectsWithKeywords);

// ✅ New route for suggestions
router.get('/subjects/suggestions', getSubjectSuggestions);

module.exports = router;
