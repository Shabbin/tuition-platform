const mongoose = require('mongoose');
const { Schema } = mongoose;

const chatSchema = new Schema({
  sender: {
    type: Schema.Types.ObjectId,
    ref: 'User', // or 'Teacher' if you're using separate models
    required: true,
  },
  recipient: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  seen: {
    type: Boolean,
    default: false,
  },
}, { timestamps: true });

module.exports = mongoose.model('Chat', chatSchema);
