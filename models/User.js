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
  }

}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
