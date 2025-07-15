const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');

router.get('/thread/:requestId', chatController.getOrCreateThreadByRequestId);
router.get('/threadById/:threadId', chatController.getThreadById);
router.get('/messages/:threadId', chatController.getMessagesByThreadId);
router.post('/messages', chatController.postMessage);

module.exports = router;