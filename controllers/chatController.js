//controllers\chatController.js
const ChatThread = require('../models/chatThread');
const TeacherRequest = require('../models/teacherRequest');

// Get or create thread by requestId (not used in new logic, but left intact)
exports.getOrCreateThreadByRequestId = async (req, res) => {
  try {
    const { requestId } = req.params;

    const request = await TeacherRequest.findById(requestId);
    if (!request) return res.status(404).json({ message: 'Tuition request not found' });

    let thread = await ChatThread.findOne({
      participants: { $all: [request.studentId, request.teacherId] },
    }).populate('participants', 'name email');

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
exports.getStudentThreads = async (req, res) => {
  try {
    const { studentId } = req.params;
    const threads = await ChatThread.find({ "participants.student": studentId })
      .populate("participants.teacher", "name email")
      .populate("participants.student", "name email")
      .populate("messages.sender", "name role");

    res.json(threads);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch student chat threads" });
  }
};
exports.getThreadsByStudentId = async (req, res) => {
  try {
    const { studentId } = req.params;

    const threads = await ChatThread.find({
      participants: studentId
    }).populate('participants', 'name role'); // populate participant names and roles

    res.status(200).json(threads);
  } catch (error) {
    console.error('Error fetching student threads:', error);
    res.status(500).json({ message: 'Failed to fetch student threads' });
  }
};
