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
      'Public-University', 'Engineering', 'Medical', 'IBA', 'Preliminary', 'Written', 'Viva' 
    ],
    required: function() {
      // board required only if educationSystem !== 'Bangla-Medium'
      return this.educationSystem !== 'Bangla-Medium' && this.educationSystem !== 'GED';
    }
  },

  group: {
    type: String,
    // you can keep the wider enum if you have legacy docs,
    // but since BCS group is gone in the UI, it's safe to reduce it to BM groups + "".
    enum: ['Science', 'Commerce', 'Arts', ''], 
    required: false,
    default: undefined,
    validate: {
      validator: function (value) {
        // Bangla-Medium still requires a valid group
        if (this.educationSystem === 'Bangla-Medium') {
          return ['Science', 'Commerce', 'Arts'].includes(value);
        }
        // ✅ BCS: group is NOT used anymore (allow undefined or empty string)
        if (this.educationSystem === 'BCS') {
          return value === undefined || value === '';
        }
        // Others: also allow empty/undefined
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

  // Public (or legacy) URL reference (may be empty when using authenticated videos)
  videoFile: {
    type: String,
    default: '',
  },

  // ⬇️ NEW: keep Cloudinary public_id so server can generate signed URLs when needed
  videoPublicId: {
    type: String,
    default: '',
  },

  youtubeLink: {
    type: String,
    default: '',
  },

  viewsCount: {
    type: Number,
    default: 0,
  },

  tags: [String],

}, {
  timestamps: true,
});

module.exports = mongoose.models.TeacherPost || mongoose.model('TeacherPost', teacherPostSchema);
