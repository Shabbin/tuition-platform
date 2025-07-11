// const express = require('express');
// const router = express.Router();
// const Message = require('../models/Chat');
// const authMiddleware = require('../middleware/auth');

// // Get all messages between two users
// router.get('/:recipientId', authMiddleware, async (req, res) => {
//   try {
//     const messages = await Message.find({
//       $or: [
//         { sender: req.user.id, recipient: req.params.recipientId },
//         { sender: req.params.recipientId, recipient: req.user.id },
//       ],
//     }).sort({ createdAt: 1 });
//     res.json(messages);
//   } catch (err) {
//     res.status(500).json({ error: 'Failed to fetch messages' });
//   }
// });

// // Send a message
// router.post('/', authMiddleware, async (req, res) => {
//   const { recipient, message } = req.body;
//   try {
//     const newMessage = new Message({
//       sender: req.user.id,
//       recipient,
//       message,
//     });
//     await newMessage.save();
//     res.status(201).json(newMessage);
//   } catch (err) {
//     res.status(500).json({ error: 'Failed to send message' });
//   }
// });

// module.exports = router;
