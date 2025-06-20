const SUBJECT_KEYWORDS = {
  math: ['algebra', 'geometry', 'calculus', 'trigonometry', 'math', 'equation'],
  physics: ['motion', 'force', 'energy', 'physics', 'electricity'],
  chemistry: ['molecule', 'acid', 'compound', 'chemistry'],
  biology: ['photosynthesis', 'cell', 'biology', 'organism', 'genetics'],
  english: ['grammar', 'essay', 'literature', 'english', 'writing'],
  economics: ['economics', 'market', 'inflation', 'demand'],
  computerScience: ['code', 'algorithm', 'python', 'java', 'computer'],
  history: ['history', 'war', 'empire'],
  geography: ['river', 'continent', 'map', 'climate'],
};

function validateSubjectsHeuristically(subjects, title, description) {
  const content = `${title} ${description}`.toLowerCase();
  const invalidSubjects = [];

  for (const subject of subjects) {
    const keywords = SUBJECT_KEYWORDS[subject.toLowerCase()];
    if (!keywords) {
      invalidSubjects.push(subject); // unknown subject
      continue;
    }

    const found = keywords.some(word => content.includes(word));
    if (!found) {
      invalidSubjects.push(subject); // didn't detect even 1 relevant word
    }
  }

  return invalidSubjects;
}

module.exports = { validateSubjectsHeuristically };
