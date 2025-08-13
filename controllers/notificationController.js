const mongoose = require('mongoose');
const Notification = require('../models/Notification');

// Get notifications for logged-in user
exports.getNotifications = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    console.log("📨 [getNotifications] Fetching notifications for user:", userId);

    const notifications = await Notification.find({ userId })
      .sort({ createdAt: -1 })
      .lean(); // lean() returns plain JS objects, better for frontend

    // No need to populate User — senderName and profileImage are already saved
    const formattedNotifications = notifications.map(n => ({
      ...n,
      senderName: n.senderName || 'Someone',
      profileImage: n.profileImage || '/default-avatar.png',
    }));

    console.log(`✅ [getNotifications] Found ${formattedNotifications.length} notifications`);
    res.json(formattedNotifications);
  } catch (err) {
    console.error('❌ [getNotifications] Error fetching notifications:', err);
    res.status(500).json({ message: 'Failed to fetch notifications' });
  }
};

// Mark notifications as read
exports.markNotificationsRead = async (req, res) => {
  try {
    const { notificationIds } = req.body; // array of ids
    const userId = req.user.id || req.user._id;

    console.log("📥 [markNotificationsRead] Request body notificationIds:", notificationIds);
    console.log("👤 [markNotificationsRead] Current userId:", userId);

    if (!Array.isArray(notificationIds)) {
      console.warn("⚠️ [markNotificationsRead] notificationIds is not an array");
      return res.status(400).json({ message: 'notificationIds must be an array' });
    }

    // Filter only valid ObjectId strings
    const validIds = notificationIds.filter(id => mongoose.Types.ObjectId.isValid(id));
    console.log("🆔 [markNotificationsRead] Valid notification IDs:", validIds);

    if (validIds.length === 0) {
      console.warn("⚠️ [markNotificationsRead] No valid notification IDs provided");
      return res.status(400).json({ message: 'No valid notification IDs provided' });
    }

    const updateResult = await Notification.updateMany(
      { _id: { $in: validIds }, userId },
      { $set: { read: true } }
    );

    console.log("✅ [markNotificationsRead] Update result:", updateResult);

    res.json({ 
      success: true, 
      message: 'Notifications marked as read', 
      readIds: validIds 
    });
  } catch (err) {
    console.error('❌ [markNotificationsRead] Error marking notifications read:', err);
    res.status(500).json({ message: 'Failed to mark notifications read' });
  }
};
