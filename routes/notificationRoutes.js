const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const notificationController = require('../controllers/notificationController');

router.get('/', auth(), notificationController.getNotifications);
router.post('/mark-read', auth(), notificationController.markNotificationsRead);

module.exports = router;
