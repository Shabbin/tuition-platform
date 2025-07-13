const ChatMessage = require('../models/ChatMessage');
const TeacherRequest = require('../models/teacherRequest');

// GET all messages for a specific thread
exports.getThreadMessages = async (req, res) => {
  try {
    const { requestId } = req.params;

    const requestExists = await TeacherRequest.findById(requestId);
    if (!requestExists || requestExists.status !== 'approved') {
      return res.status(404).json({ message: 'Tuition request not found or not approved' });
    }

    const messages = await ChatMessage.find({ requestId }).sort({ sentAt: 1 });
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

// POST a new message
exports.sendMessage = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { senderId, text } = req.body;

    const requestExists = await TeacherRequest.findById(requestId);
    if (!requestExists || requestExists.status !== 'approved') {
      return res.status(404).json({ message: 'Tuition request not found or not approved' });
    }

    const message = new ChatMessage({ requestId, senderId, text });
    await message.save();

    res.status(201).json(message);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};
