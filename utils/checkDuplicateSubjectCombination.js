const areSubjectArraysEqual = (arr1, arr2) => {
  if (!Array.isArray(arr1) || !Array.isArray(arr2)) return false;
  if (arr1.length !== arr2.length) return false;

  const sorted1 = [...arr1].map(s => s.trim()).sort();
  const sorted2 = [...arr2].map(s => s.trim()).sort();

  return sorted1.every((val, i) => val === sorted2[i]);
};

/**
 * Checks whether a subject combination already exists for a teacher (excluding current post ID if provided)
 * @param {String} teacherId
 * @param {String[]} newSubjects
 * @param {String} [excludePostId]
 * @returns {Promise<{exists: Boolean, matchedSubjects?: String[]}>}
 */
const checkDuplicateSubjectCombination = async (TeacherPost, teacherId, newSubjects, excludePostId = null) => {
  if (!Array.isArray(newSubjects) || newSubjects.length === 0) {
    return { exists: false };
  }

  const posts = await TeacherPost.find({ teacher: teacherId }).lean();

  const filtered = excludePostId
    ? posts.filter(p => p._id.toString() !== excludePostId.toString())
    : posts;

  for (const post of filtered) {
    if (areSubjectArraysEqual(post.subjects, newSubjects)) {
      return { exists: true, matchedSubjects: post.subjects };
    }
  }

  return { exists: false };
};

module.exports = { checkDuplicateSubjectCombination };
