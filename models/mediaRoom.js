// models/mediaRoom.js
'use strict';

const mongoose = require('mongoose');

const MediaRoomSchema = new mongoose.Schema(
  {
    scheduleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Schedule',
      required: true,
      unique: true,
      index: true,
    },
    // ⬇️ ALLOW BOTH DAILY and JITSI
    provider: {
      type: String,
      enum: ['DAILY', 'JITSI'],
      required: true,
      default: 'DAILY',
    },
    roomName: { type: String, required: true },
    providerRoomId: { type: String, default: null },
    joinUrl: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('MediaRoom', MediaRoomSchema);
