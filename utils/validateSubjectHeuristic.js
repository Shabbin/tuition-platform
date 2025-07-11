// const SUBJECT_KEYWORDS = {
//   'Math': ['algebra', 'geometry', 'calculus', 'trigonometry', 'equation', 'math'],
//   'Physics': ['motion', 'force', 'energy', 'electricity', 'gravity', 'magnetism'],
//   'Chemistry': ['molecule', 'acid', 'compound', 'reaction', 'chemistry'],
//   'Biology': ['photosynthesis', 'cell', 'biology', 'organism', 'genetics', 'ecosystem'],
//   'English': ['grammar', 'essay', 'literature', 'english', 'writing', 'vocabulary'],
//   'Economics': ['economics', 'market', 'inflation', 'demand', 'supply'],
//   'Computer Science': ['computer', 'code', 'algorithm', 'processor', 'ram', 'hardware', 'software'],
//   'Programming': ['programming', 'code', 'function', 'loop', 'variable', 'python', 'java', 'debug'],
//   'History': ['history', 'war', 'empire', 'ancient', 'revolution'],
//   'Geography': ['geography', 'earth', 'climate', 'region', 'map', 'continent', 'location', 'environment'],
// };
// function validateSubjectsHeuristically(subjects, title, description) {
//   const content = `${title} ${description}`.toLowerCase();
//   const invalidSubjects = [];

//   for (const subject of subjects) {
//     const keywords = SUBJECT_KEYWORDS[subject]; // Match with exact casing
//     if (!keywords) {
//       console.warn(`Unrecognized subject: ${subject}`);
//       invalidSubjects.push(subject);
//       continue;
//     }

//     const found = keywords.some(word => content.includes(word));
//     if (!found) {
//       invalidSubjects.push(subject); // didn't detect even 1 relevant word
//     }
//   }

//   return invalidSubjects;
// }
// module.exports = { validateSubjectsHeuristically };
