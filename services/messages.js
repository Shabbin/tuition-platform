// services/messages.js
const mongoose = require('mongoose');
const ChatThread = require('../models/chatThread');
const ChatMessage = require('../models/chatMessage');

async function ensureParticipant(threadId, userId) {
  return !!(await ChatThread.exists({ _id: threadId, participants: userId }));
}

async function sendMessage({ threadId, senderId, text, clientKey }) {
  const trimmed = String(text || '').slice(0, 4000);
  if (!trimmed) throw new Error('EMPTY_MESSAGE');

  // fast idempotency path
  if (clientKey) {
    const existing = await ChatMessage.findOne({ clientKey }).lean();
    if (existing) return existing;
  }

  if (!await ensureParticipant(threadId, senderId)) {
    const err = new Error('FORBIDDEN');
    err.code = 403;
    throw err;
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    // insert message (handle possible dup on clientKey)
    let msg;
    try {
      [msg] = await ChatMessage.create([{
        threadId, senderId, text: trimmed, timestamp: new Date(), clientKey,
      }], { session });
    } catch (e) {
      if (e && e.code === 11000 && clientKey) {
        msg = await ChatMessage.findOne({ clientKey }).session(session);
      } else { throw e; }
    }

    // update thread snapshot
    await ChatThread.updateOne(
      { _id: threadId },
      {
        $set: {
          lastMessage: { text: trimmed, senderId, timestamp: msg.timestamp },
          updatedAt: new Date(),
        },
      },
      { session }
    );

    await session.commitTransaction();
    return msg.toObject();
  } catch (e) {
    await session.abortTransaction();
    throw e;
  } finally {
    session.endSession();
  }
}

async function listMessages({ threadId, limit = 30, before, after }) {
  const q = { threadId };
  const sort = { timestamp: -1, _id: -1 };

  if (before) {
    const b = await ChatMessage.findById(before).select('timestamp _id');
    if (b) q.$or = [
      { timestamp: { $lt: b.timestamp } },
      { timestamp: b.timestamp, _id: { $lt: b._id } },
    ];
  } else if (after) {
    const a = await ChatMessage.findById(after).select('timestamp _id');
    if (a) {
      sort.timestamp = 1; sort._id = 1; // forward
      q.$or = [
        { timestamp: { $gt: a.timestamp } },
        { timestamp: a.timestamp, _id: { $gt: a._id } },
      ];
    }
  }

  const docs = await ChatMessage.find(q)
    .sort(sort)
    .limit(Math.min(100, Math.max(1, limit)))
    .populate('senderId', 'name profileImage role')
    .lean();

  const items = (after ? docs.reverse() : docs);
  const nextBefore = items.length ? String(items[items.length - 1]._id) : undefined;
  const nextAfter  = items.length ? String(items[0]._id) : undefined;

  return { items, cursors: { before: nextBefore, after: nextAfter } };
}

async function markThreadRead({ threadId, userId }) {
  await ChatThread.updateOne(
    { _id: threadId, participants: userId },
    { $set: { [`lastSeen.${String(userId)}`]: new Date() } }
  );
}

module.exports = { sendMessage, listMessages, markThreadRead, ensureParticipant };
