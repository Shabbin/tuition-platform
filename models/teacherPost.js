const mongoose = require('mongoose');

function arrayLimit(val) {
  return val.length <= 5;
}

const teacherPostSchema = new mongoose.Schema({
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  title: { type: String, required: true, trim: true },

  description: { type: String, required: true, trim: true },

  // Remove single 'subject' field

  subjects: {
    type: [String],
    required: true,
    validate: [arrayLimit, '{PATH} exceeds the limit of 5'],
  },

  educationSystem: {
    type: String,
    enum: ['English-Medium', 'Bangla-Medium', 'University-Admission', 'GED', 'Entrance-Exams', 'BCS'],
    required: true,
  },

board: {
  type: String,
  enum: [
    'CIE', 'Edexcel', 'IB', 'Others', 
    'IELTS', 'PTE', 'SAT', 'GRE', 'GMAT', 'TOEFL', // add Entrance-Exams here
    'Public-University', 'Engineering', 'Medical', 'IBA',"Preliminary","Written","Viva" 
  ],
  required: function() {
    // board required only if educationSystem !== 'Bangla-Medium'
    return this.educationSystem !== 'Bangla-Medium' && this.educationSystem !== 'GED';
  }
},
group: {
  type: String,
  enum: ['Science', 'Commerce', 'Arts', 'General', 'Technical', 'Both', ""], // Add BCS groups
  required: false,
  default: undefined,
  validate: {
    validator: function (value) {
      if (this.educationSystem === 'Bangla-Medium') {
        return ['Science', 'Commerce', 'Arts'].includes(value);
      }
      if (this.educationSystem === 'BCS') {
        return ['General', 'Technical', 'Both'].includes(value);
      }
      // For others, allow empty/undefined
      return value === undefined || value === '';
    },
    message: props => `Invalid group "${props.value}" for education system "${props.instance.educationSystem}"`
  }
},
level: {
  type: String,
  required: function () {
    return this.educationSystem === 'English-Medium' || this.educationSystem === 'Bangla-Medium';
  },
  default: undefined,
},

  subLevel: {
    type: String,
    enum: ['AS_Level', 'A_Level', 'Both', ''], // allow '' if not required
    default: '',
  },

  location: {
    type: String,
    trim: true,
    default: '',
  },

  language: {
    type: String,
    trim: true,
    default: '',
  },

  hourlyRate: {
    type: Number,
    min: 0,
    required: true,
  },

  videoFile: {
    type: String,
    default: '',
  },

  youtubeLink: {
    type: String,
    default: '',
  },

  tags: [String],


},

{
  timestamps: true,
});

module.exports = mongoose.models.TeacherPost || mongoose.model('TeacherPost', teacherPostSchema);
