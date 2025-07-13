// controllers/chatController.js
const ChatThread = require('../models/chatThread');
const TeacherRequest = require('../models/teacherRequest');

exports.getOrCreateThreadByRequestId = async (req, res) => {
  console.log("API HIT: /api/chat/thread/", req.params.requestId);
  try {
    const { requestId } = req.params;

    let thread = await ChatThread.findOne({ requestId }).populate('participants', 'name email');
console.log("Checking thread existence for requestId:", requestId);
    if (!thread) {
      const request = await TeacherRequest.findById(requestId);
      if (!request) return res.status(404).json({ message: 'Tuition request not found' });
console.log("Creating thread with message:", request.message);
      // Create thread with initial message from the tuition request's message
      thread = new ChatThread({
        requestId,
        participants: [request.studentId, request.teacherId],
        messages: [
          {
            senderId: request.studentId,
            text: request.message || 'Initial request message',
            timestamp: request.createdAt,
          },
        ],
        
      }
      
    );
      await thread.save();

      thread = await thread.populate('participants', 'name email');
    }

    res.json(thread);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getThreadById = async (req, res) => {
  try {
    const { threadId } = req.params;
    const thread = await ChatThread.findById(threadId).populate('participants', 'name email');
    if (!thread) return res.status(404).json({ message: 'Chat thread not found' });

    res.json(thread);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getMessagesByThreadId = async (req, res) => {
  try {
    const { threadId } = req.params;
    const thread = await ChatThread.findById(threadId);
    if (!thread) return res.status(404).json({ message: 'Thread not found' });

    res.json({ messages: thread.messages });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.postMessage = async (req, res) => {
  try {
    const { threadId, senderId, text } = req.body;
    if (!threadId || !senderId || !text) {
      return res.status(400).json({ message: 'threadId, senderId, and text are required' });
    }

    const thread = await ChatThread.findById(threadId);
    if (!thread) return res.status(404).json({ message: 'Thread not found' });

    const newMessage = { senderId, text, timestamp: new Date() };
    thread.messages.push(newMessage);
    await thread.save();

    res.status(201).json(newMessage);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};
