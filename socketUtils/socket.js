// socketUtils/socket.js
const { Server } = require('socket.io');
const cookie = require('cookie');
const jwt = require('jsonwebtoken');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');

const ChatMessage = require('../models/chatMessage');
const { sendMessage, ensureParticipant, markThreadRead } = require('../services/messages');

let io; let pubClient; let subClient;
const userSocketsMap = new Map();

function tokenBucket({ capacity = 30, refillPerSec = 12 } = {}) {
  const buckets = new Map();
  return (id, weight = 1) => {
    const now = Date.now();
    const b = buckets.get(id) || { tokens: capacity, ts: now };
    const elapsed = (now - b.ts) / 1000;
    b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerSec);
    b.ts = now;
    if (b.tokens >= weight) { b.tokens -= weight; buckets.set(id, b); return true; }
    return false;
  };
}
const allowSend = tokenBucket({ capacity: 30, refillPerSec: 12 });

function emitToUser(userId, event, data) {
  const uid = String(userId);
  const set = userSocketsMap.get(uid);
  if (set && set.size) set.forEach(socketId => io.to(socketId).emit(event, data));
  else io.to(uid).emit(event, data); // room fallback for multi-node
}

function init(server) {
  io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // Optional Redis adapter (multi-instance scale)
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) (async () => {
    try {
      pubClient = createClient({ url: redisUrl });
      subClient = pubClient.duplicate();
      await pubClient.connect(); await subClient.connect();
      io.adapter(createAdapter(pubClient, subClient));
      console.log('Socket.IO Redis adapter connected');
    } catch (e) { console.error('Redis adapter init failed; continuing without.', e); }
  })();

  // Auth from cookie.token (HttpOnly)
  io.use((socket, next) => {
    try {
      const raw = socket.handshake.headers.cookie;
      if (!raw) return next(new Error('No cookies'));
      const { token } = cookie.parse(raw);
      if (!token) return next(new Error('No token'));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.request.userId = String(decoded.id);
      next();
    } catch { next(new Error('Authentication error')); }
  });

  io.on('connection', (socket) => {
    const userId = socket.request.userId;
    if (!userSocketsMap.has(userId)) userSocketsMap.set(userId, new Set());
    userSocketsMap.get(userId).add(socket.id);
    socket.join(userId);

    socket.on('join_thread', async (threadId) => {
      try { if (await ensureParticipant(threadId, userId)) socket.join(threadId); } catch {}
    });

    socket.on('leave_thread', (threadId) => socket.leave(threadId));

    socket.on('mark_thread_read', async ({ threadId }, ack) => {
      try { await markThreadRead({ threadId, userId }); ack?.({ ok: true }); }
      catch { ack?.({ ok: false }); }
    });

    socket.on('send_message', async ({ threadId, text, clientKey }, ack) => {
      try {
        if (!allowSend(socket.id)) return ack?.({ ok: false, error: 'RATE_LIMITED' });
        if (!await ensureParticipant(threadId, userId)) return ack?.({ ok: false, error: 'FORBIDDEN' });

        const msg = await sendMessage({ threadId, senderId: userId, text, clientKey });
        const populated = await ChatMessage.findById(msg._id).populate('senderId', 'name profileImage role').lean();

        const payload = {
          _id: populated._id,
          threadId,
          text: populated.text,
          timestamp: populated.timestamp,
          sender: {
            _id: populated.senderId._id,
            name: populated.senderId.name,
            profileImage: populated.senderId.profileImage,
            role: populated.senderId.role,
          },
        };

        io.in(threadId).emit('new_message', payload);
        io.in(threadId).emit('thread_updated', {
          threadId,
          lastMessage: { text: payload.text, timestamp: payload.timestamp, senderId: payload.sender._id },
        });

        ack?.({ ok: true, id: String(payload._id) });
      } catch (e) {
        console.error('send_message error:', e);
        ack?.({ ok: false, error: 'SEND_FAILED' });
      }
    });

    socket.on('disconnect', () => {
      const set = userSocketsMap.get(userId);
      if (set) { set.delete(socket.id); if (!set.size) userSocketsMap.delete(userId); }
    });
  });

  global.emitToUser = emitToUser;
  return io;
}
async function shutdown() {
  try {
    if (io) {
      await new Promise(res => io.close(res));
      console.log('[Socket] closed');
    }
    if (subClient) { await subClient.quit(); console.log('[Redis sub] quit'); }
    if (pubClient) { await pubClient.quit(); console.log('[Redis pub] quit'); }
  } catch (e) {
    console.error('[Socket shutdown] error', e);
  }
}

function getIO() { if (!io) throw new Error('Socket.IO not initialized!'); return io; }

module.exports = { init, getIO, shutdown };
