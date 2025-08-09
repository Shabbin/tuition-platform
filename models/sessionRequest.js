const mongoose = require('mongoose');

const sessionRequestSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // Changed from 'Student' to 'User'
    required: true
  },
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // Changed from 'Teacher' to 'User'
    required: true
  },
  subject: {
    type: String,
    required: [false, 'Subject is optional'],
    trim: true,
    maxlength: [100, 'Subject can be up to 100 characters']
  },
  message: {
    type: String,
    trim: true,
    maxlength: [1000, 'Message can be up to 1000 characters'],
    default: ''
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  requestedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('SessionRequest', sessionRequestSchema);
