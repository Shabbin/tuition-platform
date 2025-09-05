// // socket.js (socketUtils/socket.js)
// const { Server } = require('socket.io');
// const cookie = require('cookie');
// const jwt = require('jsonwebtoken');
// const { createAdapter } = require('@socket.io/redis-adapter');
// const { createClient } = require('redis');
// const ChatThread = require('../models/chatThread');
// const ChatMessage = require('../models/chatMessage');

// let io;
// let pubClient;
// let subClient;

// const userSocketsMap = new Map();

// function arraysEqual(a, b) {
//   if (a.length !== b.length) return false;
//   const s1 = new Set(a);
//   const s2 = new Set(b);
//   if (s1.size !== s2.size) return false;
//   for (const v of s1) if (!s2.has(v)) return false;
//   return true;
// }

// let lastOnlineUsersSet = new Set();
// let onlineUsersBroadcastTimeout = null;

// async function getConversationUserIds(userId) {
//   try {
//     const threads = await ChatThread.find({ participants: userId }).lean();
//     const partnersSet = new Set();

//     threads.forEach(thread => {
//       thread.participants.forEach(p => {
//         const pStr = p.toString();
//         if (pStr !== userId) {
//           partnersSet.add(pStr);
//         }
//       });
//     });

//     return Array.from(partnersSet);
//   } catch (err) {
//     console.error('Error fetching conversation partners:', err);
//     return [];
//   }
// }

// async function broadcastOnlineUsersDebounced() {
//   if (onlineUsersBroadcastTimeout) return;

//   onlineUsersBroadcastTimeout = setTimeout(async () => {
//     const currentOnlineUsers = Array.from(userSocketsMap.keys());

//     if (!arraysEqual(currentOnlineUsers, Array.from(lastOnlineUsersSet))) {
//       lastOnlineUsersSet = new Set(currentOnlineUsers);

//       for (const userId of currentOnlineUsers) {
//         const conversationUserIds = await getConversationUserIds(userId);
//         const filteredOnline = conversationUserIds.filter(id => lastOnlineUsersSet.has(id));

//         if (userSocketsMap.has(userId)) {
//           userSocketsMap.get(userId).forEach(socketId => {
//             io.to(socketId).emit('online_users', filteredOnline);
//           });
//         }
//       }

//       console.log('[broadcast] Sent filtered online_users to each client');
//     }
//     onlineUsersBroadcastTimeout = null;
//   }, 1000);
// }

// function emitToUser(userId, event, data) {
//   if (userSocketsMap.has(userId)) {
//     userSocketsMap.get(userId).forEach(socketId => {
//       io.to(socketId).emit(event, data);
//     });
//   } else {
//     console.warn(`No active sockets for userId ${userId}. Event '${event}' not sent.`);
//   }
// }

// function init(server) {
//   io = new Server(server, {
//     cors: {
//       // 👉 allow overriding in production
//       origin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
//       methods: ['GET', 'POST'],
//       credentials: true,
//     },
//   });

//   // -------------------- Redis adapter (Railway/Upstash) --------------------
//   // IMPORTANT: do NOT default to localhost in production. Use env only.
//   const redisUrl = process.env.REDIS_URL;
//   if (redisUrl) {
//     (async () => {
//       try {
//         pubClient = createClient({ url: redisUrl });
//         subClient = pubClient.duplicate();

//         pubClient.on('error', (e) => console.error('[Redis pub] error:', e));
//         subClient.on('error', (e) => console.error('[Redis sub] error:', e));

//         await pubClient.connect();
//         await subClient.connect();

//         io.adapter(createAdapter(pubClient, subClient));
//         console.log('Socket.IO Redis adapter connected');
//       } catch (err) {
//         console.error('Failed to connect to Redis. Continuing without adapter.', err);
//         // keep server running even if Redis is unavailable
//       }
//     })();
//   } else {
//     console.warn('REDIS_URL not set — running without Redis adapter.');
//   }
//   // ------------------------------------------------------------------------

//   // Socket.IO middleware for JWT from cookies
//   io.use((socket, next) => {
//     try {
//       const rawCookie = socket.handshake.headers.cookie;
//       if (!rawCookie) return next(new Error('No cookies found'));

//       const parsedCookies = cookie.parse(rawCookie);
//       const token = parsedCookies.token;
//       if (!token) return next(new Error('No token cookie'));

//       const decoded = jwt.verify(token, process.env.JWT_SECRET);
//       socket.request.userId = decoded.id;
//       next();
//     } catch (err) {
//       console.error('Socket auth failed:', err.message);
//       next(new Error('Authentication error'));
//     }
//   });

//   io.on('connection', (socket) => {
//     const userId = socket.request.userId;

//     console.log('User connected:', socket.id, 'userId:', userId);

//     if (userId) {
//       if (!userSocketsMap.has(userId)) {
//         userSocketsMap.set(userId, new Set());
//       }
//       userSocketsMap.get(userId).add(socket.id);

//       if (!socket.rooms.has(userId)) {
//         socket.join(userId);
//       }

//       broadcastOnlineUsersDebounced();
//     }

//     socket.on('join_thread', (threadId) => {
//       if (!socket.rooms.has(threadId)) {
//         socket.join(threadId);
//         console.log(`Socket ${socket.id} joined room ${threadId}`);
//       }
//     });

//     socket.on('leave_thread', (threadId) => {
//       socket.leave(threadId);
//       console.log(`Socket ${socket.id} left room ${threadId}`);
//     });

//     socket.on('mark_thread_read', async ({ threadId, userId }) => {
//       try {
//         const thread = await ChatThread.findById(threadId);
//         if (!thread) return;

//         thread.lastSeen.set(userId, new Date());
//         await thread.save();

//         console.log(`[mark_thread_read] User ${userId} marked thread ${threadId} as read`);
//       } catch (err) {
//         console.error('Error in mark_thread_read:', err);
//       }
//     });

//     socket.on('send_message', async (data) => {
//       const { threadId, text } = data;
//       const senderId = socket.request.userId;
//       console.log(`[send_message] Received from senderId=${senderId} in threadId=${threadId}: ${text}`);

//       try {
//         const message = await ChatMessage.create({
//           threadId,
//           senderId,
//           text,
//           timestamp: new Date(),
//         });

//         await message.populate({ path: 'senderId', select: 'name profileImage role' });

//         const thread = await ChatThread.findById(threadId);
//         if (thread) {
//           thread.messages.push({
//             senderId,
//             text,
//             timestamp: message.timestamp,
//           });

//           thread.lastMessage = {
//             text,
//             senderId,
//             timestamp: message.timestamp,
//           };
//           thread.updatedAt = new Date();

//           await thread.save();
//           console.log(`[send_message] Updated thread ${threadId} with new message`);
//         }

//         const fullThread = await ChatThread.findById(threadId)
//           .populate('participants', 'name profileImage role')
//           .populate('messages.senderId', 'name profileImage role')
//           .populate('lastMessage.senderId', 'name profileImage role')
//           .lean();

//         console.log(`[send_message] Refetched full thread for threadId=${threadId}`);

//         const normalizedMessage = {
//           _id: message._id,
//           threadId: message.threadId,
//           text: message.text,
//           timestamp: message.timestamp,
//           sender: {
//             _id: message.senderId._id,
//             name: message.senderId.name,
//             profileImage: message.senderId.profileImage,
//             role: message.senderId.role,
//           },
//         };

//         io.in(threadId).emit('new_message', normalizedMessage);
//         io.in(threadId).emit('thread_updated', fullThread);

//         fullThread.participants.forEach((participant) => {
//           const participantId = participant._id.toString();
//           if (userSocketsMap.has(participantId)) {
//             userSocketsMap.get(participantId).forEach((sockId) => {
//               io.to(sockId).emit('conversation_list_updated', fullThread);
//               io.to(sockId).emit('new_message_alert', {
//                 threadId,
//                 from: {
//                   _id: message.senderId._id,
//                   name: message.senderId.name,
//                 },
//                 text: message.text,
//               });
//             });
//           }
//         });
//       } catch (error) {
//         console.error('Error sending message:', error);
//       }
//     });

//     socket.on('disconnect', () => {
//       console.log('User disconnected:', socket.id);
//       if (userId && userSocketsMap.has(userId)) {
//         userSocketsMap.get(userId).delete(socket.id);
//         if (userSocketsMap.get(userId).size === 0) {
//           userSocketsMap.delete(userId);
//         }
//         broadcastOnlineUsersDebounced();
//       }
//     });
//   });

//   global.emitToUser = emitToUser;

//   return io;
// }

// function getIO() {
//   if (!io) {
//     throw new Error('Socket.IO not initialized!');
//   }
//   return io;
// }

// module.exports = { init, getIO };


























// // socketUtils/socket.js
// const { Server } = require('socket.io');
// const cookie = require('cookie');
// const jwt = require('jsonwebtoken');
// const { createAdapter } = require('@socket.io/redis-adapter');
// const { createClient } = require('redis');
// const ChatThread = require('../models/chatThread');
// const ChatMessage = require('../models/chatMessage');

// let io;
// let pubClient;
// let subClient;

// const userSocketsMap = new Map();

// function arraysEqual(a, b) {
//   if (a.length !== b.length) return false;
//   const s1 = new Set(a);
//   const s2 = new Set(b);
//   if (s1.size !== s2.size) return false;
//   for (const v of s1) if (!s2.has(v)) return false;
//   return true;
// }

// let lastOnlineUsersSet = new Set();
// let onlineUsersBroadcastTimeout = null;

// async function getConversationUserIds(userId) {
//   try {
//     const threads = await ChatThread.find({ participants: userId }).lean();
//     const partnersSet = new Set();

//     threads.forEach(thread => {
//       thread.participants.forEach(p => {
//         const pStr = p.toString();
//         if (pStr !== userId) partnersSet.add(pStr);
//       });
//     });

//     return Array.from(partnersSet);
//   } catch (err) {
//     console.error('Error fetching conversation partners:', err);
//     return [];
//   }
// }

// async function broadcastOnlineUsersDebounced() {
//   if (onlineUsersBroadcastTimeout) return;

//   onlineUsersBroadcastTimeout = setTimeout(async () => {
//     const currentOnlineUsers = Array.from(userSocketsMap.keys());

//     if (!arraysEqual(currentOnlineUsers, Array.from(lastOnlineUsersSet))) {
//       lastOnlineUsersSet = new Set(currentOnlineUsers);

//       for (const userId of currentOnlineUsers) {
//         const conversationUserIds = await getConversationUserIds(userId);
//         const filteredOnline = conversationUserIds.filter(id => lastOnlineUsersSet.has(id));

//         if (userSocketsMap.has(userId)) {
//           userSocketsMap.get(userId).forEach(socketId => {
//             io.to(socketId).emit('online_users', filteredOnline);
//           });
//         }
//       }

//       console.log('[broadcast] Sent filtered online_users to each client');
//     }
//     onlineUsersBroadcastTimeout = null;
//   }, 1000);
// }

// // ✅ Only change here: try per-socket; if none, fall back to the user room (we join it on connect)
// function emitToUser(userId, event, data) {
//   const uid = String(userId);
//   const set = userSocketsMap.get(uid);
//   if (set && set.size) {
//     set.forEach(socketId => io.to(socketId).emit(event, data));
//   } else {
//     // Room fallback (works across nodes with Redis adapter)
//     io.to(uid).emit(event, data);
//   }
// }

// function init(server) {
//   io = new Server(server, {
//     cors: {
//       origin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
//       methods: ['GET', 'POST'],
//       credentials: true,
//     },
//   });

//   // ✅ Make Redis optional & safe
//   const redisUrl = process.env.REDIS_URL;
//   if (redisUrl) {
//     (async () => {
//       try {
//         pubClient = createClient({ url: redisUrl });
//         subClient = pubClient.duplicate();
//         pubClient.on('error', (e) => console.error('[Redis pub] error:', e));
//         subClient.on('error', (e) => console.error('[Redis sub] error:', e));
//         await pubClient.connect();
//         await subClient.connect();
//         io.adapter(createAdapter(pubClient, subClient));
//         console.log('Socket.IO Redis adapter connected');
//       } catch (err) {
//         console.error('Failed to connect to Redis. Continuing without adapter.', err);
//       }
//     })();
//   } else {
//     console.warn('REDIS_URL not set — running without Redis adapter.');
//   }

//   // Socket.IO middleware for JWT from cookies
//   io.use((socket, next) => {
//     try {
//       const rawCookie = socket.handshake.headers.cookie;
//       if (!rawCookie) return next(new Error('No cookies found'));
//       const parsedCookies = cookie.parse(rawCookie);
//       const token = parsedCookies.token;
//       if (!token) return next(new Error('No token cookie'));
//       const decoded = jwt.verify(token, process.env.JWT_SECRET);
//       socket.request.userId = decoded.id;
//       next();
//     } catch (err) {
//       console.error('Socket auth failed:', err.message);
//       next(new Error('Authentication error'));
//     }
//   });

//   io.on('connection', (socket) => {
//     const userId = socket.request.userId;

//     console.log('User connected:', socket.id, 'userId:', userId);

//     if (userId) {
//       if (!userSocketsMap.has(userId)) userSocketsMap.set(userId, new Set());
//       userSocketsMap.get(userId).add(socket.id);

//       // Join the user’s personal room (string id)
//       if (!socket.rooms.has(String(userId))) socket.join(String(userId));

//       broadcastOnlineUsersDebounced();
//     }

//     socket.on('join_thread', (threadId) => {
//       if (!socket.rooms.has(threadId)) {
//         socket.join(threadId);
//         console.log(`Socket ${socket.id} joined room ${threadId}`);
//       }
//     });

//     socket.on('leave_thread', (threadId) => {
//       socket.leave(threadId);
//       console.log(`Socket ${socket.id} left room ${threadId}`);
//     });

//     socket.on('mark_thread_read', async ({ threadId, userId }) => {
//       try {
//         const thread = await ChatThread.findById(threadId);
//         if (!thread) return;
//         thread.lastSeen.set(userId, new Date());
//         await thread.save();
//         console.log(`[mark_thread_read] User ${userId} marked thread ${threadId} as read`);
//       } catch (err) {
//         console.error('Error in mark_thread_read:', err);
//       }
//     });

//     socket.on('send_message', async (data) => {
//       const { threadId, text } = data;
//       const senderId = socket.request.userId;
//       console.log(`[send_message] Received from senderId=${senderId} in threadId=${threadId}: ${text}`);

//       try {
//         const message = await ChatMessage.create({
//           threadId,
//           senderId,
//           text,
//           timestamp: new Date(),
//         });

//         await message.populate({ path: 'senderId', select: 'name profileImage role' });

//         const thread = await ChatThread.findById(threadId);
//         if (thread) {
//           thread.messages.push({ senderId, text, timestamp: message.timestamp });
//           thread.lastMessage = { text, senderId, timestamp: message.timestamp };
//           thread.updatedAt = new Date();
//           await thread.save();
//           console.log(`[send_message] Updated thread ${threadId} with new message`);
//         }

//         const fullThread = await ChatThread.findById(threadId)
//           .populate('participants', 'name profileImage role')
//           .populate('messages.senderId', 'name profileImage role')
//           .populate('lastMessage.senderId', 'name profileImage role')
//           .lean();

//         console.log(`[send_message] Refetched full thread for threadId=${threadId}`);

//         const normalizedMessage = {
//           _id: message._id,
//           threadId: message.threadId,
//           text: message.text,
//           timestamp: message.timestamp,
//           sender: {
//             _id: message.senderId._id,
//             name: message.senderId.name,
//             profileImage: message.senderId.profileImage,
//             role: message.senderId.role,
//           },
//         };

//         io.in(threadId).emit('new_message', normalizedMessage);
//         io.in(threadId).emit('thread_updated', fullThread);

//         fullThread.participants.forEach((participant) => {
//           const participantId = participant._id.toString();
//           const set = userSocketsMap.get(participantId);
//           if (set && set.size) {
//             set.forEach((sockId) => {
//               io.to(sockId).emit('conversation_list_updated', fullThread);
//               io.to(sockId).emit('new_message_alert', {
//                 threadId,
//                 from: { _id: message.senderId._id, name: message.senderId.name },
//                 text: message.text,
//               });
//             });
//           } else {
//             io.to(participantId).emit('conversation_list_updated', fullThread);
//             io.to(participantId).emit('new_message_alert', {
//               threadId,
//               from: { _id: message.senderId._id, name: message.senderId.name },
//               text: message.text,
//             });
//           }
//         });
//       } catch (error) {
//         console.error('Error sending message:', error);
//       }
//     });

//     socket.on('disconnect', () => {
//       console.log('User disconnected:', socket.id);
//       if (userId && userSocketsMap.has(userId)) {
//         userSocketsMap.get(userId).delete(socket.id);
//         if (userSocketsMap.get(userId).size === 0) userSocketsMap.delete(userId);
//         broadcastOnlineUsersDebounced();
//       }
//     });
//   });

//   global.emitToUser = emitToUser;
//   return io;
// }

// function getIO() {
//   if (!io) throw new Error('Socket.IO not initialized!');
//   return io;
// }

// module.exports = { init, getIO };



// socketUtils/socket.js
const { Server } = require('socket.io');
const cookie = require('cookie');
const jwt = require('jsonwebtoken');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');
const ChatThread = require('../models/chatThread');
const ChatMessage = require('../models/chatMessage');

let io;
let pubClient;
let subClient;

const userSocketsMap = new Map();

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  const s1 = new Set(a);
  const s2 = new Set(b);
  if (s1.size !== s2.size) return false;
  for (const v of s1) if (!s2.has(v)) return false;
  return true;
}

let lastOnlineUsersSet = new Set();
let onlineUsersBroadcastTimeout = null;

async function getConversationUserIds(userId) {
  try {
    const threads = await ChatThread.find({ participants: userId }).lean();
    const partnersSet = new Set();

    threads.forEach(thread => {
      (thread.participants || []).forEach(p => {
        const pStr = String(p);
        if (pStr !== String(userId)) partnersSet.add(pStr);
      });
    });

    return Array.from(partnersSet);
  } catch (err) {
    console.error('Error fetching conversation partners:', err);
    return [];
  }
}

async function broadcastOnlineUsersDebounced() {
  if (onlineUsersBroadcastTimeout) return;

  onlineUsersBroadcastTimeout = setTimeout(async () => {
    const currentOnlineUsers = Array.from(userSocketsMap.keys());

    if (!arraysEqual(currentOnlineUsers, Array.from(lastOnlineUsersSet))) {
      lastOnlineUsersSet = new Set(currentOnlineUsers);

      for (const userId of currentOnlineUsers) {
        const conversationUserIds = await getConversationUserIds(userId);
        const filteredOnline = conversationUserIds.filter(id => lastOnlineUsersSet.has(id));

        if (userSocketsMap.has(userId)) {
          userSocketsMap.get(userId).forEach(socketId => {
            io.to(socketId).emit('online_users', filteredOnline);
          });
        }
      }

      console.log('[broadcast] Sent filtered online_users to each client');
    }
    onlineUsersBroadcastTimeout = null;
  }, 1000);
}

// ---- Hardened helpers (kept local; structure unchanged) ----
function emitToUser(userId, event, data) {
  const uid = String(userId);
  const set = userSocketsMap.get(uid);
  if (set && set.size) {
    set.forEach(socketId => io.to(socketId).emit(event, data));
  } else {
    // Room fallback (works across nodes with Redis adapter)
    io.to(uid).emit(event, data);
  }
}

function makeRateLimiter({ capacity = 30, refillPerSec = 12 } = {}) {
  const buckets = new Map();
  return function take(socketId, weight = 1) {
    const now = Date.now();
    const b = buckets.get(socketId) || { tokens: capacity, ts: now };
    const elapsed = (now - b.ts) / 1000;
    b.tokens = Math.max(0, Math.min(capacity, b.tokens + elapsed * refillPerSec));
    b.ts = now;
    if (b.tokens >= weight) {
      b.tokens -= weight;
      buckets.set(socketId, b);
      return true;
    }
    return false;
  };
}
const allowSend = makeRateLimiter({ capacity: 30, refillPerSec: 12 });

async function ensureParticipant(threadId, userId) {
  try {
    const exists = await ChatThread.exists({ _id: threadId, participants: userId });
    return !!exists;
  } catch (e) {
    console.error('ensureParticipant error:', e);
    return false;
  }
}
// ------------------------------------------------------------

function init(server) {
  io = new Server(server, {
    cors: {
      // 👉 allow overriding in production
      origin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // -------------------- Redis adapter (Railway/Upstash) --------------------
  // IMPORTANT: do NOT default to localhost in production. Use env only.
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    (async () => {
      try {
        pubClient = createClient({ url: redisUrl });
        subClient = pubClient.duplicate();

        pubClient.on('error', (e) => console.error('[Redis pub] error:', e));
        subClient.on('error', (e) => console.error('[Redis sub] error:', e));

        await pubClient.connect();
        await subClient.connect();

        io.adapter(createAdapter(pubClient, subClient));
        console.log('Socket.IO Redis adapter connected');
      } catch (err) {
        console.error('Failed to connect to Redis. Continuing without adapter.', err);
        // keep server running even if Redis is unavailable
      }
    })();
  } else {
    console.warn('REDIS_URL not set — running without Redis adapter.');
  }
  // ------------------------------------------------------------------------

  // Socket.IO middleware for JWT from cookies
  io.use((socket, next) => {
    try {
      const rawCookie = socket.handshake.headers.cookie;
      if (!rawCookie) return next(new Error('No cookies found'));

      const parsedCookies = cookie.parse(rawCookie);
      const token = parsedCookies.token;
      if (!token) return next(new Error('No token cookie'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.request.userId = decoded.id;
      next();
    } catch (err) {
      console.error('Socket auth failed:', err.message);
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    const userId = String(socket.request.userId);

    console.log('User connected:', socket.id, 'userId:', userId);

    if (userId) {
      if (!userSocketsMap.has(userId)) {
        userSocketsMap.set(userId, new Set());
      }
      userSocketsMap.get(userId).add(socket.id);

      if (!socket.rooms.has(userId)) {
        socket.join(userId);
      }

      broadcastOnlineUsersDebounced();
    }

    socket.on('join_thread', async (threadId) => {
      try {
        if (!(await ensureParticipant(threadId, userId))) return;
        if (!socket.rooms.has(threadId)) {
          socket.join(threadId);
          console.log(`Socket ${socket.id} joined room ${threadId}`);
        }
      } catch (e) {
        console.error('join_thread error:', e);
      }
    });

    socket.on('leave_thread', (threadId) => {
      socket.leave(threadId);
      console.log(`Socket ${socket.id} left room ${threadId}`);
    });

    // ⚠️ Do NOT trust client userId; derive from token
    socket.on('mark_thread_read', async ({ threadId }) => {
      try {
        if (!(await ensureParticipant(threadId, userId))) return;
        const thread = await ChatThread.findById(threadId);
        if (!thread) return;

        thread.lastSeen.set(userId, new Date());
        await thread.save();

        console.log(`[mark_thread_read] User ${userId} marked thread ${threadId} as read`);
      } catch (err) {
        console.error('Error in mark_thread_read:', err);
      }
    });

    socket.on('send_message', async (data) => {
      const { threadId, text } = data || {};
      const senderId = userId;
      const trimmed = String(text || '').slice(0, 4000); // cap length

      if (!trimmed) return;
      if (!allowSend(socket.id)) return; // rate-limited
      if (!(await ensureParticipant(threadId, senderId))) return;

      console.log(`[send_message] Received from senderId=${senderId} in threadId=${threadId}: ${trimmed}`);

      try {
        const message = await ChatMessage.create({
          threadId,
          senderId,
          text: trimmed,
          timestamp: new Date(),
        });

        await message.populate({ path: 'senderId', select: 'name profileImage role' });

        const thread = await ChatThread.findById(threadId);
        if (thread) {
          thread.messages.push({
            senderId,
            text: message.text,
            timestamp: message.timestamp,
          });

          thread.lastMessage = {
            text: message.text,
            senderId,
            timestamp: message.timestamp,
          };
          thread.updatedAt = new Date();

          await thread.save();
          console.log(`[send_message] Updated thread ${threadId} with new message`);
        }

        const fullThread = await ChatThread.findById(threadId)
          .populate('participants', 'name profileImage role')
          .populate('messages.senderId', 'name profileImage role')
          .populate('lastMessage.senderId', 'name profileImage role')
          .lean();

        console.log(`[send_message] Refetched full thread for threadId=${threadId}`);

        const normalizedMessage = {
          _id: message._id,
          threadId: message.threadId,
          text: message.text,
          timestamp: message.timestamp,
          sender: {
            _id: message.senderId._id,
            name: message.senderId.name,
            profileImage: message.senderId.profileImage,
            role: message.senderId.role,
          },
        };

        io.in(threadId).emit('new_message', normalizedMessage);
        io.in(threadId).emit('thread_updated', fullThread);

        fullThread.participants.forEach((participant) => {
          const participantId = participant._id.toString();
          const set = userSocketsMap.get(participantId);
          if (set && set.size) {
            set.forEach((sockId) => {
              io.to(sockId).emit('conversation_list_updated', fullThread);
              io.to(sockId).emit('new_message_alert', {
                threadId,
                from: {
                  _id: message.senderId._id,
                  name: message.senderId.name,
                },
                text: message.text,
              });
            });
          } else {
            io.to(participantId).emit('conversation_list_updated', fullThread);
            io.to(participantId).emit('new_message_alert', {
              threadId,
              from: {
                _id: message.senderId._id,
                name: message.senderId.name,
              },
              text: message.text,
            });
          }
        });
      } catch (error) {
        console.error('Error sending message:', error);
      }
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
      if (userId && userSocketsMap.has(userId)) {
        userSocketsMap.get(userId).delete(socket.id);
        if (userSocketsMap.get(userId).size === 0) {
          userSocketsMap.delete(userId);
        }
        broadcastOnlineUsersDebounced();
      }
    });
  });

  global.emitToUser = emitToUser;

  return io;
}

function getIO() {
  if (!io) {
    throw new Error('Socket.IO not initialized!');
  }
  return io;
}

module.exports = { init, getIO };
