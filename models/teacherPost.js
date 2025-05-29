const mongoose = require('mongoose');

const teacherPostSchema = new mongoose.Schema({
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // 🔄 Updated from 'Teacher' to 'User' since you're using a unified User model
    required: true
  },
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
    maxlength: [150, 'Title can be up to 150 characters']
  },
  description: {
    type: String,
    required: [true, 'Description is required'],
    maxlength: [2000, 'Description can be up to 2000 characters']
  },
  subjects: {
    type: [String],
    required: true,
    validate: [
      {
        validator: function (arr) {
          return arr.length > 0 && arr.length <= 5;
        },
        message: 'You must select at least 1 and no more than 5 subjects'
      }
    ]
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
    min: [0, 'Hourly rate cannot be negative'],
    required: [true, 'Hourly rate is required']
  },
  videoFile: {
    type: String,
    default: ''
  },
  youtubeLink: {
    type: String,
    default: '',
    validate: {
      validator: function (v) {
        return !v || /^(https?\:\/\/)?(www\.youtube\.com|youtu\.?be)\/.+$/.test(v);
      },
      message: 'Must be a valid YouTube URL'
    }
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Post', teacherPostSchema);
