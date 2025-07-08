const { SUBJECT_KEYWORDS } = require('../utils/subjects');

const getTagSuggestions = (req, res) => {
  const subjectsQuery = req.query.subjects || '';
  const subjects = subjectsQuery.split(',').map(s => s.trim()).filter(Boolean);

  let suggestions = [];
  subjects.forEach(subject => {
    if (SUBJECT_KEYWORDS[subject]) {
      suggestions = suggestions.concat(SUBJECT_KEYWORDS[subject]);
    }
  });

  // Remove duplicates
  suggestions = [...new Set(suggestions)];

  res.status(200).json({ suggestions });
};

module.exports = { getTagSuggestions };
