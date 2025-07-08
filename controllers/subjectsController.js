// subjectsController.js
const { SUBJECT_LIST, SUBJECT_KEYWORDS } = require('../utils/subjects');

const getSubjects = (req, res) => {
  res.status(200).json({ subjects: SUBJECT_LIST });
};

const getSubjectsWithKeywords = (req, res) => {
  res.status(200).json(SUBJECT_KEYWORDS);
};

// ✅ NEW: Suggestions from subject list and/or title
const getSubjectSuggestions = (req, res) => {
  const { subjects = '', title = '' } = req.query;
  const suggestions = new Set();

  const subjectArray = subjects.split(',').map(s => s.trim()).filter(Boolean);

  subjectArray.forEach(subj => {
    if (SUBJECT_KEYWORDS[subj]) {
      SUBJECT_KEYWORDS[subj].forEach(tag => suggestions.add(tag));
    }
  });

  if (title) {
    const lowerTitle = title.toLowerCase();
    Object.entries(SUBJECT_KEYWORDS).forEach(([subject, keywords]) => {
      if (keywords.some(k => lowerTitle.includes(k))) {
        suggestions.add(subject);
      }
    });
  }

  res.status(200).json({ suggestions: Array.from(suggestions) });
};

module.exports = {
  getSubjects,
  getSubjectsWithKeywords,
  getSubjectSuggestions, // ✅ Don't forget to export it
};
