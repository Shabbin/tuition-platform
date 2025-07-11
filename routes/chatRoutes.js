const express = require('express');
const router = express.Router();
const ChatThread = require('../models/chatThread');
const TeacherRequest = require('../models/teacherRequest');

// Get or create chat thread for a tuition request
router.get('/thread/:requestId', async (req, res) => {
  try {
    const { requestId } = req.params;

    let thread = await ChatThread.findOne({ requestId }).populate('participants', 'name email');
    if (!thread) {
      const request = await TeacherRequest.findById(requestId);
      if (!request) return res.status(404).json({ message: 'Tuition request not found' });

      thread = new ChatThread({
        requestId,
        participants: [request.studentId, request.teacherId],
        messages: [],
      });
      await thread.save();
    }

    res.json(thread);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get messages for a thread
router.get('/messages/:threadId', async (req, res) => {
  try {
    const { threadId } = req.params;

    const thread = await ChatThread.findById(threadId);
    if (!thread) return res.status(404).json({ message: 'Thread not found' });

    res.json({ messages: thread.messages });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Post new message
router.post('/messages', async (req, res) => {
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
});

module.exports = router;
