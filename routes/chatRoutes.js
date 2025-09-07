// routes/chatRoutes.js
const express = require('express');
const router = express.Router();
const { z } = require('zod'); // ✅ correct CJS import
const chatController = require('../controllers/chatController');

// ---------- auth middleware (cookie `token` OR Bearer) ----------
const jwt = require('jsonwebtoken');
function auth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    let token;
    if (h.startsWith('Bearer ')) token = h.slice(7);
    if (!token && req.headers.cookie) {
      const cookie = Object.fromEntries(
        req.headers.cookie.split(';').map(c => c.trim().split('=')),
      );
      token = cookie.token;
    }
    if (!token) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: String(decoded.id) };
    return next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  }
}

// ---------- tiny zod validator helper ----------
function validate(schema, where = 'body') {
  return (req, res, next) => {
    try {
      if (!schema || typeof schema.parse !== 'function') return next(); // ✅ guard
      const val = schema.parse(req[where]);
      req[where] = val;
      next();
    } catch (e) {
      const issues = e?.issues?.map(i => `${i.path.join('.')}: ${i.message}`) || ['invalid input'];
      return res.status(400).json({ ok: false, error: 'BAD_REQUEST', details: issues });
    }
  };
}

// ---------------- ROUTES ----------------

// Get or create thread by TeacherRequest
router.get(
  '/thread/:requestId',
  auth,
  validate(z.object({ requestId: z.string().length(24) }), 'params'),
  chatController.getOrCreateThreadByRequestId
);

// Get thread by id (metadata; messages are separate)
router.get(
  '/threadById/:threadId',
  auth,
  validate(z.object({ threadId: z.string().length(24) }), 'params'),
  chatController.getThreadById
);

// List messages (cursor pagination: ?limit=30&before=_id or &after=_id)
router.get(
  '/messages/:threadId',
  auth,
  validate(z.object({ threadId: z.string().length(24) }), 'params'),
  validate(
    z.object({
      limit: z.coerce.number().int().min(1).max(100).optional(),
      before: z.string().length(24).optional(),
      after: z.string().length(24).optional(),
    }),
    'query'
  ),
  chatController.getMessagesByThreadId
);

// Legacy list for student threads (kept for compatibility)
router.get(
  '/student/:studentId',
  auth,
  validate(z.object({ studentId: z.string().length(24) }), 'params'),
  chatController.getThreadsByStudentId
);

// Legacy list for teacher threads (kept for compatibility)
router.get(
  '/teacher/:teacherId/threads',
  auth,
  validate(z.object({ teacherId: z.string().length(24) }), 'params'),
  chatController.getThreadsByTeacherId
);

// Unified conversation list with unread counts
router.get(
  '/conversations/:userId',
  auth,
  validate(z.object({ userId: z.string().length(24) }), 'params'),
  chatController.getConversationsForUser
);

// Send message (idempotency via optional clientKey UUID)
router.post(
  '/messages',
  auth,
  validate(
    z.object({
      threadId: z.string().length(24),
      senderId: z.string().length(24), // still checked against JWT server-side
      text: z.string().min(1).max(4000),
      clientKey: z.string().uuid().optional(),
    }),
    'body'
  ),
  chatController.postMessage
);

// Mark a thread as read for current user
router.post(
  '/threads/read',
  auth,
  validate(
    z.object({
      threadId: z.string().length(24),
      userId: z.string().length(24),
    }),
    'body'
  ),
  chatController.markThreadAsRead
);

module.exports = router;
