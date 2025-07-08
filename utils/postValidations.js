// const { isMeaningfulText, isValidTitle } = require('./isMeaningfulText');


// const TOPIC_KEYWORDS = {
//   math: ['algebra', 'geometry', 'calculus', 'trigonometry', 'vectors'],
//   physics: ['force', 'motion', 'electricity', 'magnetism', 'thermodynamics'],
//   chemistry: ['acid', 'base', 'compound', 'reaction'],
//   biology: ['cell', 'photosynthesis', 'genetics', 'organism'],
//   english: ['literature', 'grammar', 'writing', 'essay'],
  
//   // Add more for your real list
// };

// function matchesSubjectKeywords(subjects, description) {
//   const content = description.toLowerCase();
//   for (const subject of subjects) {
//     const keywords = TOPIC_KEYWORDS[subject.toLowerCase()] || [];
//     const found = keywords.some(keyword => content.includes(keyword));
//     if (!found) return false;
//   }
//   return true;
// }

// function validatePostByType(postType, data) {
//   const {
//     title,
//     description,
//     tags = [],
//     subjects = [],
//     topicDetails = {},
//   } = data;

//   // General posts
//   if (postType === 'general') {
//     if (!isValidTitle(title, tags.concat(subjects))) {
//       return { valid: false, message: 'Title must be meaningful and include a relevant subject or tag.' };
//     }
//     if (!isMeaningfulText(description)) {
//       return { valid: false, message: 'Description is too short or gibberish.' };
//     }
//     return { valid: true };
//   }

//   // Topic posts
//   if (postType === 'topic') {
//     if (!isValidTitle(title, tags.concat(subjects))) {
//       return { valid: false, message: 'Title must include all tags or subject terms.' };
//     }
//     if (!isMeaningfulText(description)) {
//       return { valid: false, message: 'Description is too short or gibberish.' };
//     }
//     if (!topicDetails?.studentType || !topicDetails?.topicTitle) {
//       console.log(topicDetails.studentType, topicDetails.topicName, "validas")
//       return { valid: false, message: 'Missing topic details: topic name or student type.' };
//     }
//     if (!matchesSubjectKeywords(subjects, description)) {
//       console.log(subjects,description,"Ulala")
//       return { valid: false, message: 'The content does not align with selected subjects.' };
//     }

//     return { valid: true };
//   }

//   return { valid: false, message: 'Unknown post type.' };
// }

// module.exports = {
//   validatePostByType
// };
