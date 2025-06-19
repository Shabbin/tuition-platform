const mongoose = require('mongoose');

const teacherPostSchema = new mongoose.Schema({
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  postType: {
    type: String,
    enum: ['general', 'topic'],
    required: true
  },
  title: {
    type: String,
    trim: true,
    maxlength: 150,
  },
  description: {
    type: String,
    maxlength: 2000,
  },
  subjects: {
    type: [String],
    required: true,
  },
  location: {
    type: String,
    trim: true,
    default: ''
  },
  language: {
    type: String,
    trim: true,
    default: ''
  },
  hourlyRate: {
    type: Number,
    min: 0,
    required: true
  },
  videoFile: {
    type: String,
    default: ''
  },
  youtubeLink: {
    type: String,
    default: '',
  },
  tags: [String],
  topicDetails: {
    topicTitle: { type: String, trim: true, maxlength: 150 },
    syllabusTag: { type: String, trim: true },
    studentTypes: [String],
    weeklyPlan: [{
      week: { type: Number, min: 1 },
      title: { type: String, trim: true },
      description: { type: String, trim: true }
    }]
  }
}, {
  timestamps: true
});

// ✅ Fix: Use mongoose.models to avoid overwrite errors in dev
module.exports = mongoose.models.TeacherPost || mongoose.model('TeacherPost', teacherPostSchema);
