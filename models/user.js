const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    minlength: [2, 'Name must be at least 2 characters long']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/.+\@.+\..+/, 'Please fill a valid email address']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters long']
  },
  role: {
    type: String,
    enum: ['student', 'teacher'],
    default: 'student'
  },
  profileImage: {
    type: String,
    default: null,
  },
  coverImage: {
    type: String,
    default: '',
  },

  // ➕ Extra fields for teachers
  age: {
    type: Number,
    min: [18, 'You must be at least 18 to register as a teacher'],
    required: function () {
      return this.role === 'teacher';
    },
  },
  isEligible: {
    type: Boolean,
    default: false,
  },
  bio: {
    type: String,
    maxlength: [1000, 'Bio cannot exceed 1000 characters'],
    default: '',
  },
  hourlyRate: {
    type: Number,
    min: [0, 'Hourly rate cannot be negative'],
    default: 0,
  },
  skills: {
    type: [String],
    default: [],
    validate: [arrayLimit, 'You can only add up to 10 skills']
  },
  location: {
    type: String,
    default: '',
  },
  availability: {
    type: String,
    default: '', // e.g., "Weekdays after 5 PM"
  },
}, {
  timestamps: true
});

// Helper to limit skill array size
function arrayLimit(val) {
  return val.length <= 10;
}

module.exports = mongoose.model('User', userSchema);
