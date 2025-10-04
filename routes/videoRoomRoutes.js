'use strict';
const express = require('express');
const router = express.Router();
const video = require('../controllers/videoRoomController');
const auth = require('../middleware/auth'); // your real JWT middleware

// Health
router.get('/ping', (_req, res) => res.json({ ok: true }));

// Quick debug: prove auth() is running for this router
router.get('/whoami', auth(), (req, res) => {
  return res.json({ ok: true, where: 'video-router', user: req.user || null });
});

// No-store for status checks so clients don't cache stale "checking..."
const noStore = (_req, res, next) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  next();
};

// ✅ Can-join (GET) — must run auth()
router.get('/schedules/:id/can-join', auth(), noStore, video.canJoin);

// ✅ Issue token (POST) — must run auth()
router.post('/schedules/:id/token', auth(), video.issueJoinToken);

// Provider webhooks (Daily)
router.post(
  '/webhooks/daily',
  express.json({ type: 'application/json' }),
  video.dailyWebhook
);

module.exports = router;
