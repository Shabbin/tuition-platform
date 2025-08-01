const ChatThread = require('../models/chatThread');
const TeacherRequest = require('../models/teacherRequest');
const ChatMessage = require('../models/chatMessage');

// Get or create thread by requestId
exports.getOrCreateThreadByRequestId = async (req, res) => {
  try {
    const { requestId } = req.params;

    const request = await TeacherRequest.findById(requestId);
    if (!request) return res.status(404).json({ message: 'Tuition request not found' });

    // Find thread where both student and teacher are participants
    let thread = await ChatThread.findOne({
      participants: { $all: [request.studentId, request.teacherId] },
    }).populate('participants', 'name profileImage email role'); // populate participants info

    if (!thread) {
      thread = new ChatThread({
        participants: [request.studentId, request.teacherId],
        messages: [
          {
            senderId: request.studentId,
            text: request.message || 'Initial request message',
            timestamp: request.createdAt,
          },
        ],
        sessions: [
          {
            subject: request.subject || 'Untitled',
            origin: request.postId ? `Post: ${request.postId}` : 'Direct',
            status: 'pending',
            requestId,
          },
        ],
        // Initialize lastSeen for both participants to now - prevents false unread counts
        lastSeen: {
          [request.studentId]: new Date(),
          [request.teacherId]: new Date(),
        },
      });

      await thread.save();
      thread = await thread.populate('participants', 'name profileImage email role');
    }

    res.json(thread);
  } catch (error) {
    console.error('[getOrCreateThreadByRequestId] Error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// GET /api/chat/threadById/:threadId
exports.getThreadById = async (req, res) => {
  try {
    const thread = await ChatThread.findById(req.params.threadId)
      .populate('participants', 'name profileImage role') // populate participants info
      .populate('messages.senderId', 'name profileImage role') // populate message senders info
      .exec();

    if (!thread) return res.status(404).json({ message: 'Thread not found' });

    res.json(thread);
  } catch (err) {
    console.error('[getThreadById] Error:', err);
    res.status(500).json({ message: 'Failed to fetch thread' });
  }
};

// GET messages by threadId (returns all messages, no filtering)
exports.getMessagesByThreadId = async (req, res) => {
  try {
    const messages = await ChatMessage.find({ threadId: req.params.threadId })
      .populate('senderId', 'name profileImage role')
      .sort({ timestamp: 1 }); // oldest first

    res.json(messages);
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ message: 'Error fetching messages' });
  }
};

// POST message to thread
exports.postMessage = async (req, res) => {
  try {
    const { threadId, senderId, text } = req.body;
    if (!threadId || !senderId || !text) {
      return res.status(400).json({ message: 'threadId, senderId, and text are required' });
    }

    const thread = await ChatThread.findById(threadId);
    if (!thread) return res.status(404).json({ message: 'Thread not found' });

    const now = new Date();

    const newEmbeddedMessage = {
      senderId,
      text,
      timestamp: now,
    };

    const newChatMessage = new ChatMessage({
      threadId,
      senderId,
      text,
      timestamp: now,
    });

    thread.messages.push(newEmbeddedMessage);
    thread.lastMessage = {
      text,
      senderId,
      timestamp: now,
    };
    thread.updatedAt = now;

    await thread.save();
    await newChatMessage.save();

    console.log('Saved thread lastMessage:', thread.lastMessage);

    // Optionally populate sender info before returning
    await newChatMessage.populate('senderId', 'name profileImage role');

    res.status(201).json(newChatMessage);
  } catch (error) {
    console.error('[postMessage] Error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get all chat threads for a student by studentId
exports.getStudentThreads = async (req, res) => {
  try {
    const { studentId } = req.params;

    const threads = await ChatThread.find({
      participants: studentId
    })
      .populate('participants', 'name profileImage role')      // populate participant users
      .populate('messages.senderId', 'name profileImage role') // populate message senders
      .exec();

    // Add lastMessage and lastMessageTimestamp property for each thread
    const threadsWithLastMessage = threads.map(thread => {
      const lastMsg = thread.messages.length > 0
        ? thread.messages[thread.messages.length - 1]
        : null;

      return {
        ...thread.toObject(),
        lastMessage: lastMsg ? lastMsg.text : '',
        lastMessageTimestamp: lastMsg ? lastMsg.timestamp : thread.updatedAt,
      };
    });

    res.json(threadsWithLastMessage);
  } catch (error) {
    console.error('[getStudentThreads] Error:', error);
    res.status(500).json({ error: "Failed to fetch student chat threads" });
  }
};

// Alias for getStudentThreads, if needed
exports.getThreadsByStudentId = async (req, res) => {
  try {
    const { studentId } = req.params;

    const threads = await ChatThread.find({
      participants: studentId,
    })
      .sort({ 'lastMessage.timestamp': -1, updatedAt: -1 }) // sort newest active first
      .populate('participants', 'name profileImage role') // populate participants info
      .populate('lastMessage.senderId', 'name profileImage role') // populate last message sender info
      .exec();

    const threadsWithTimestamp = threads.map((thread) => ({
      ...thread.toObject(),
      lastMessageTimestamp: thread.lastMessage?.timestamp || thread.updatedAt,
    }));

    res.status(200).json(threadsWithTimestamp);
  } catch (error) {
    console.error('[getThreadsByStudentId] Error:', error);
    res.status(500).json({ message: 'Failed to fetch student threads' });
  }
};

exports.getThreadsByTeacherId = async (req, res) => {
  try {
    const { teacherId } = req.params;

    const threads = await ChatThread.find({
      participants: teacherId,
    })
      .sort({ 'lastMessage.timestamp': -1, updatedAt: -1 }) // sort newest active first
      .populate('participants', 'name profileImage role') // populate participants info
      .populate('lastMessage.senderId', 'name profileImage role') // populate last message sender info
      .exec();

    const threadsWithTimestamp = threads.map((thread) => ({
      ...thread.toObject(),
      lastMessageTimestamp: thread.lastMessage?.timestamp || thread.updatedAt,
    }));

    res.status(200).json(threadsWithTimestamp);
  } catch (error) {
    console.error('[getThreadsByTeacherId] Error:', error);
    res.status(500).json({ message: 'Failed to fetch teacher threads' });
  }
};


// Get conversations for user with unreadCount calculation
exports.getConversationsForUser = async (req, res) => {
  const userId = req.params.userId;

  try {
    const conversations = await ChatThread.find({
      participants: userId,
    })
      .sort({ 'lastMessage.timestamp': -1 })
      .populate('participants', 'name profileImage')
      .populate('messages', 'senderId timestamp')
      .lean()
      .exec();

    const normalized = conversations.map(thread => {
      const others = thread.participants.filter(p => p._id.toString() !== userId);

      const lastSeenRaw = thread.lastSeen ? thread.lastSeen[userId] || thread.lastSeen.get?.(userId) : null;
      const lastSeen = lastSeenRaw ? new Date(lastSeenRaw) : null;

      console.log(`Thread ${thread._id} - lastSeen for user ${userId}:`, lastSeen);

      const unreadCount = lastSeen
        ? (thread.messages || []).filter(msg => {
            const isFromOther = msg.senderId.toString() !== userId;
            const isAfterLastSeen = new Date(msg.timestamp) > lastSeen;
            if (isFromOther && isAfterLastSeen) {
              console.log(`Unread message found: msgId=${msg._id}, timestamp=${msg.timestamp}`);
            }
            return isFromOther && isAfterLastSeen;
          }).length
        : 0;

      console.log(`Thread ${thread._id} - unreadCount:`, unreadCount);

      return {
        threadId: thread._id,
        requestId: thread.sessions?.length ? thread.sessions[thread.sessions.length - 1].requestId : null,
        participants: others,
        lastMessage: thread.lastMessage?.text || '',
        lastMessageTimestamp: thread.lastMessage?.timestamp || thread.updatedAt,
        status: thread.sessions?.length ? thread.sessions[thread.sessions.length - 1].status : null,
        unreadCount,
      };
    });

    res.json(normalized);
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ message: 'Failed to fetch conversations', error: error.message });
  }
};



// Optional: Mark thread as read by updating lastSeen[userId] to now
exports.markThreadAsRead = async (req, res) => {
  try {
    const { threadId, userId } = req.body;
    if (!threadId || !userId) {
      return res.status(400).json({ message: 'threadId and userId required' });
    }

    const thread = await ChatThread.findById(threadId);
    if (!thread) return res.status(404).json({ message: 'Thread not found' });

    thread.lastSeen = thread.lastSeen || {};
    thread.lastSeen[userId] = new Date();

    await thread.save();

    res.json({ success: true, message: 'Thread marked as read' });
  } catch (error) {
    console.error('[markThreadAsRead] Error:', error);
    res.status(500).json({ message: 'Failed to mark thread as read' });
  }
};
