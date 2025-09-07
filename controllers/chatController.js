// controllers/chatController.js
const mongoose = require('mongoose');
const ChatThread = require('../models/chatThread');
const TeacherRequest = require('../models/teacherRequest');
const ChatMessage = require('../models/chatMessage');
const { sendMessage, listMessages, markThreadRead, ensureParticipant } = require('../services/messages');

// Get or create thread by requestId
exports.getOrCreateThreadByRequestId = async (req, res) => {
  try {
    const { requestId } = req.params;
    const request = await TeacherRequest.findById(requestId).lean();
    if (!request) return res.status(404).json({ message: 'Tuition request not found' });

    let thread = await ChatThread.findOne({
      participants: { $all: [request.studentId, request.teacherId] },
    })
      .populate('participants', 'name profileImage email role')
      .lean();

    if (!thread) {
      // create thread (no embedded messages)
      thread = await ChatThread.create({
        participants: [request.studentId, request.teacherId],
        sessions: [{
          subject: request.subject || 'Untitled',
          origin: request.postId ? 'Post' : 'Direct',
          status: 'pending',
          requestId,
        }],
        // initialize read maps so unread starts at 0
        lastSeen:   new Map([[String(request.studentId), new Date()], [String(request.teacherId), new Date()]]),
        lastOpened: new Map(),
      });

      // seed the very first message (optional)
      await ChatMessage.create({
        threadId: thread._id,
        senderId: request.studentId,
        text: request.message || 'Initial request message',
        timestamp: request.createdAt || new Date(),
      });

      // set lastMessage snapshot
      await ChatThread.updateOne({ _id: thread._id }, {
        $set: {
          lastMessage: {
            text: request.message || 'Initial request message',
            senderId: request.studentId,
            timestamp: request.createdAt || new Date(),
          },
        },
      });

      // re-load populated
      thread = await ChatThread.findById(thread._id)
        .populate('participants', 'name profileImage email role')
        .lean();
    }

    res.json(thread);
  } catch (error) {
    console.error('[getOrCreateThreadByRequestId] Error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Thread detail (no embedded messages to populate now)
exports.getThreadById = async (req, res) => {
  try {
    const thread = await ChatThread.findById(req.params.threadId)
      .populate('participants', 'name profileImage role')
      .populate('lastMessage.senderId', 'name profileImage role')
      .lean();
    if (!thread) return res.status(404).json({ message: 'Thread not found' });
    res.json(thread);
  } catch (err) {
    console.error('[getThreadById] Error:', err);
    res.status(500).json({ message: 'Failed to fetch thread' });
  }
};

// Messages (paginated)
exports.getMessagesByThreadId = async (req, res) => {
  try {
    const { threadId } = req.params;
    const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 100); // default 50, max 100
    const before = req.query.before; // optional cursor (message _id) to page older

    const q = { threadId: new mongoose.Types.ObjectId(threadId) };
    if (before) q._id = { $lt: new mongoose.Types.ObjectId(before) };

    // 👉 Fetch latest first, then reverse for chronological rendering
    const docs = await ChatMessage.find(q)
      .populate('senderId', 'name profileImage role')
      .sort({ _id: -1 })  // newest → oldest
      .limit(limit)
      .lean();

    const messages = docs.reverse(); // oldest → newest for UI

    // Helpful log
    console.log(
      `[getMessagesByThreadId] thread=${threadId} returned=${messages.length} (limit=${limit}) before=${before || '-'}`
    );

    res.json(messages);
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ message: 'Error fetching messages' });
  }
};

// Post message via service (HTTP)
exports.postMessage = async (req, res) => {
  try {
    const { threadId, senderId, text, clientKey } = req.body;
    if (!threadId || !senderId || !text) {
      return res.status(400).json({ message: 'threadId, senderId, and text are required' });
    }
    if (!await ensureParticipant(threadId, senderId)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const msg = await sendMessage({ threadId, senderId, text, clientKey });
    const populated = await ChatMessage.findById(msg._id).populate('senderId', 'name profileImage role').lean();
    res.status(201).json(populated);
  } catch (error) {
    console.error('[postMessage] Error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// List threads for a user (with lastMessage + unreadCount)
exports.getConversationsForUser = async (req, res) => {
  try {
    const userId = String(req.params.userId);

    const threads = await ChatThread.find({ participants: userId })
      .sort({ 'lastMessage.timestamp': -1, updatedAt: -1 })
      .populate('participants', 'name profileImage role')
      .populate('lastMessage.senderId', 'name profileImage role')
      .lean();

    // compute unreadCount using ChatMessage collection (fast and accurate)
    const threadIds = threads.map(t => t._id);
    const lastSeens = new Map(threads.map(t => [String(t._id), new Date(t.lastSeen?.get?.(userId) || t.lastSeen?.[userId] || 0)]));

    // aggregation to count messages newer than lastSeen and not by user
    const counts = await ChatMessage.aggregate([
      { $match: { threadId: { $in: threadIds }, senderId: { $ne: new mongoose.Types.ObjectId(userId) } } },
      {
        $group: {
          _id: '$threadId',
          msgs: { $push: { ts: '$timestamp' } },
        }
      }
    ]);

    const unreadByThread = new Map();
    for (const c of counts) {
      const lastSeen = lastSeens.get(String(c._id)) || new Date(0);
      unreadByThread.set(String(c._id), c.msgs.reduce((acc, m) => acc + (m.ts > lastSeen ? 1 : 0), 0));
    }

    const normalized = threads.map(thread => {
      const others = (thread.participants || []).filter(p => String(p._id) !== userId);
      const otherUser = others[0] || null;
      return {
        threadId: thread._id,
        requestId: thread.sessions?.length ? thread.sessions[thread.sessions.length - 1].requestId : null,
        participants: others,
        displayName: otherUser?.name || 'No Name',
        displayImage: otherUser?.profileImage || null,
        lastMessage: thread.lastMessage?.text || '',
        lastMessageTimestamp: thread.lastMessage?.timestamp || thread.updatedAt,
        status: thread.sessions?.length ? thread.sessions[thread.sessions.length - 1].status : null,
        unreadCount: unreadByThread.get(String(thread._id)) || 0,
      };
    });

    res.json(normalized);
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ message: 'Failed to fetch conversations', error: error.message });
  }
};

exports.markThreadAsRead = async (req, res) => {
  try {
    const { threadId, userId } = req.body;
    if (!threadId || !userId) return res.status(400).json({ message: 'threadId and userId required' });
    await markThreadRead({ threadId, userId });
    res.json({ success: true, message: 'Thread marked as read' });
  } catch (error) {
    console.error('[markThreadAsRead] Error:', error);
    res.status(500).json({ message: 'Failed to mark thread as read' });
  }
};
// Get threads by student (legacy endpoint kept for compatibility)
exports.getThreadsByStudentId = async (req, res) => {
  try {
    const { studentId } = req.params;

    const threads = await ChatThread.find({ participants: studentId })
      .sort({ 'lastMessage.timestamp': -1, updatedAt: -1 })
      .populate('participants', 'name profileImage role')
      .populate('lastMessage.senderId', 'name profileImage role')
      .lean();

    // Backward-compatible shape with lastMessageTimestamp
    const data = threads.map(t => ({
      ...t,
      lastMessageTimestamp: t.lastMessage?.timestamp || t.updatedAt,
    }));

    res.status(200).json(data);
  } catch (error) {
    console.error('[getThreadsByStudentId] Error:', error);
    res.status(500).json({ message: 'Failed to fetch student threads' });
  }
};

// Get threads by teacher (legacy endpoint kept for compatibility)
exports.getThreadsByTeacherId = async (req, res) => {
  try {
    const { teacherId } = req.params;

    const threads = await ChatThread.find({ participants: teacherId })
      .sort({ 'lastMessage.timestamp': -1, updatedAt: -1 })
      .populate('participants', 'name profileImage role')
      .populate('lastMessage.senderId', 'name profileImage role')
      .lean();

    const data = threads.map(t => ({
      ...t,
      lastMessageTimestamp: t.lastMessage?.timestamp || t.updatedAt,
    }));

    res.status(200).json(data);
  } catch (error) {
    console.error('[getThreadsByTeacherId] Error:', error);
    res.status(500).json({ message: 'Failed to fetch teacher threads' });
  }
};
