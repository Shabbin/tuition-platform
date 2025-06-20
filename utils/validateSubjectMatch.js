// utils/validateSubjectMatch.js
const SUBJECT_KEYWORDS = {
  math: ['math', 'algebra', 'geometry', 'calculus', 'trigonometry'],
  physics: ['physics', 'motion', 'energy', 'quantum', 'relativity'],
  chemistry: ['chemistry', 'reaction', 'acid', 'base', 'organic', 'inorganic'],
  biology: ['biology', 'cell', 'genetics', 'anatomy', 'organism'],
  english: ['english', 'literature', 'grammar', 'essay'],
  economics: ['economics', 'demand', 'supply', 'macro', 'micro'],
  computer: ['programming', 'coding', 'computer', 'javascript', 'python', 'algorithm'],
  // ... more mappings
};

function subjectMatchesContent(subjects, title, description) {
  const content = `${title} ${description}`.toLowerCase();

  const invalidSubjects = [];

  for (const subject of subjects) {
    const keywords = SUBJECT_KEYWORDS[subject.toLowerCase()];
    if (!keywords) continue;

    const matched = keywords.some((kw) => content.includes(kw));
    if (!matched) {
      invalidSubjects.push(subject);
    }
  }

  return invalidSubjects; // ❌ these don't match content
}

module.exports = { subjectMatchesContent };
