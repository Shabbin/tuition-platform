const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true
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
  coverImage: { type: String, default: '' },

  // ➕ New fields for teachers
  age: {
    type: Number,
    required: function () {
      return this.role === 'teacher';
    },
    min: 18
    
  },
  
  isEligible: {
    type: Boolean,
    default: false // teacher must pass exam to become eligible
  },
  bio: {
  type: String,
  default: '',
},
hourlyRate: {
  type: Number,
  default: 0,
},
skills: {
  type: [String],
  default: [],
},
location: {
  type: String,
  default: '',
},
availability: {
  type: String,
  default: '', // e.g., "Weekdays after 5 PM"
},

}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
