const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Message = require('../models/message');

// GET all messages between two users
router.get('/all', async (req, res) => {
  try {
    const messages = await Message.find().sort({ createdAt: -1 });
    res.json(messages);
  } catch (err) {
    console.error('Error fetching all messages:', err);
    res.status(500).json({ message: 'Failed to fetch all messages' });
  }
});
router.get('/inbox/:userId', auth(), async (req, res) => {
  try {
    const userId = req.params.userId;

    const messages = await Message.find({
      $or: [
        { sender: userId },
        { receiver: userId }
      ]
    }).sort({ createdAt: -1 });

    const chatPartners = {};

    messages.forEach((msg) => {
      const partnerId = msg.sender.toString() === userId ? msg.receiver.toString() : msg.sender.toString();
      if (!chatPartners[partnerId]) {
        chatPartners[partnerId] = {
          userId: partnerId,
          lastMessage: msg.text,
          lastMessageTime: msg.createdAt
        };
      }
    });

    res.status(200).json(Object.values(chatPartners));
  } catch (err) {
    console.error('Inbox fetch error:', err);
    res.status(500).json({ message: 'Failed to fetch inbox' });
  }
});
router.get('/:userId', auth(), async (req, res) => {
  const { userId } = req.params;
  const currentUserId = req.user.userId;

  try {
    const messages = await Message.find({
      $or: [
        { sender: currentUserId, receiver: userId },
        { sender: userId, receiver: currentUserId }
      ]
    }).sort({ createdAt: 1 });

    res.json(messages);
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ message: 'Failed to fetch messages' });
  }
});
// console.log('From token:', currentUserId);
// console.log('From param:', userId);

// POST new message
router.post('/', auth(), async (req, res) => {
  try {
    const { receiverId, text } = req.body;

    // console.log('req.user:', req.user);
    // console.log('POST /api/messages', req.body);

    // ✅ Sanitize sender and receiver IDs
    const senderId = req.user.userId;

    // ✅ Create and save the message
    const newMessage = new Message({
      sender: senderId,
      receiver: receiverId,
      text,
    });

    await newMessage.save();

    res.status(201).json({ message: 'Message sent successfully', newMessage });
  } catch (error) {
    console.error('error saving Message: ', error);
    res.status(500).json({ message: 'Failed to send message' });
  }
});

module.exports = router;
