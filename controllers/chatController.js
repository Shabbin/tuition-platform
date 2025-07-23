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

// GET messages by threadId


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

    // 1. Create new embedded message
    const newEmbeddedMessage = {
      senderId,
      text,
      timestamp: new Date(),
    };

    // 2. Create new ChatMessage document
    const newChatMessage = new ChatMessage({
      threadId,
      senderId,
      text,
      timestamp: newEmbeddedMessage.timestamp,
    });

    // Save both
    thread.messages.push(newEmbeddedMessage);
    await thread.save();
    await newChatMessage.save();

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

    // Add lastMessage property for each thread
    const threadsWithLastMessage = threads.map(thread => {
      const lastMsg = thread.messages.length > 0
        ? thread.messages[thread.messages.length - 1].text
        : '';
      return {
        ...thread.toObject(),
        lastMessage: lastMsg,
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
      participants: studentId
    })
      .populate('participants', 'name profileImage role')
      .populate('messages.senderId', 'name profileImage role')
      .exec();

    // Add lastMessage property for each thread
    const threadsWithLastMessage = threads.map(thread => {
      const lastMsg = thread.messages.length > 0
        ? thread.messages[thread.messages.length - 1].text
        : '';
      return {
        ...thread.toObject(),
        lastMessage: lastMsg,
      };
    });

    res.status(200).json(threadsWithLastMessage);
  } catch (error) {
    console.error('[getThreadsByStudentId] Error:', error);
    res.status(500).json({ message: 'Failed to fetch student threads' });
  }
};

exports.getThreadsByTeacherId = async (req, res) => {
  try {
    const { teacherId } = req.params;

    const threads = await ChatThread.find({
      participants: teacherId
    })
      .populate('participants', 'name profileImage role')
      .populate('messages.senderId', 'name profileImage role')
      .populate('sessions')
      .exec();

    // Add lastMessage property for each thread
    const threadsWithLastMessage = threads.map(thread => {
      const lastMsg = thread.messages.length > 0
        ? thread.messages[thread.messages.length - 1].text
        : '';
      return {
        ...thread.toObject(),
        lastMessage: lastMsg,
      };
    });

    res.json(threadsWithLastMessage);
  } catch (err) {
    console.error('[getThreadsByTeacherId] Error:', err);
    res.status(500).json({ message: 'Failed to fetch teacher chat threads' });
  }
};
