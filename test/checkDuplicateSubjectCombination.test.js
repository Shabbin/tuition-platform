// test/checkDuplicateSubjectCombination.test.js

const { checkDuplicateSubjectCombination } = require('../utils/checkDuplicateSubjectCombination');
const mongoose = require('mongoose');
const TeacherPost = require('../models/teacherPost');

describe('checkDuplicateSubjectCombination', () => {
  it('detects exact match even in different order', async () => {
    const result = await checkDuplicateSubjectCombination(
      TeacherPost,
      'someTeacherId',
      ['Physics', 'Chemistry']
    );
    expect(result.exists).toBe(true);
  });

  it('ignores current post when updating', async () => {
    const result = await checkDuplicateSubjectCombination(
      TeacherPost,
      'someTeacherId',
      ['Physics', 'Chemistry'],
      'currentPostId'
    );
    expect(result.exists).toBe(false);
  });
});
