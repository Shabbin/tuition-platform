//models\joinToken.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const JoinTokenSchema = new Schema({
  scheduleId: { type: Schema.Types.ObjectId, ref: 'Schedule', index: true, required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', index: true, required: true },
  role: { type: String, enum: ['HOST','ATTENDEE'], required: true },
  provider: { type: String, enum: ['DAILY'], required: true },
  token: { type: String, required: true },
  expiresAt: { type: Date, index: { expires: 0 } }, // TTL
}, { timestamps: true });

module.exports = mongoose.model('JoinToken', JoinTokenSchema);
