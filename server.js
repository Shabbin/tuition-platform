const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const cookie = require('cookie');
const jwt = require('jsonwebtoken');
const connectDB = require('./config/db');
const adminRoutes = require('./controllers/oneTimeAdminController');
const subjectRoutes = require('./routes/subjectsRoutes');
const educationTreeRoute = require('./routes/educationRoutes');
const teacherRequestsRouter = require('./routes/teacherRequestRoutes');
const authRoutes = require('./routes/authRoutes');
const ChatThread = require('./models/chatThread');
const chatRoutes = require('./routes/chatRoutes');
const ChatMessage = require('./models/chatMessage');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');

dotenv.config();
connectDB();

const app = express();

app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/students', require('./routes/studentRoutes'));
app.use('/api/teachers', require('./routes/teacherRoutes'));
app.use('/api/posts', require('./routes/teacherPostRoutes'));
app.use('/api/session-requests', require('./routes/sessionRequest'));
app.use('/api/admin', adminRoutes);
app.use('/api', subjectRoutes);
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(educationTreeRoute);
app.use('/api/teacher-requests', teacherRequestsRouter);
app.use('/api/chat', chatRoutes);

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

const pubClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
const subClient = pubClient.duplicate();

(async () => {
  await pubClient.connect();
  await subClient.connect();
  io.adapter(createAdapter(pubClient, subClient));
  console.log('Socket.IO Redis adapter connected');
})();

// 🔹 Socket.IO middleware for JWT from cookies
io.use((socket, next) => {
  try {
    const rawCookie = socket.handshake.headers.cookie;
    if (!rawCookie) return next(new Error("No cookies found"));

    const parsedCookies = cookie.parse(rawCookie);
    const token = parsedCookies.token; // Change if your cookie name is different
    if (!token) return next(new Error("No token cookie"));

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.request.userId = decoded.id; // set userId for later use
    next();
  } catch (err) {
    console.error("Socket auth failed:", err.message);
    next(new Error("Authentication error"));
  }
});

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
      thread.participants.forEach(p => {
        const pStr = p.toString();
        if (pStr !== userId) {
          partnersSet.add(pStr);
        }
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

io.on('connection', (socket) => {
  const userId = socket.request.userId; // ✅ now set via middleware

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

  socket.on('join_thread', (threadId) => {
    if (!socket.rooms.has(threadId)) {
      socket.join(threadId);
      console.log(`Socket ${socket.id} joined room ${threadId}`);
    }
  });

  socket.on('leave_thread', (threadId) => {
    socket.leave(threadId);
    console.log(`Socket ${socket.id} left room ${threadId}`);
  });

  socket.on('mark_thread_read', async ({ threadId, userId }) => {
    try {
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
    const { threadId, text } = data;
  const senderId = socket.request.userId;
    console.log(`[send_message] Received from senderId=${senderId} in threadId=${threadId}: ${text}`);

    try {
      const message = await ChatMessage.create({
        threadId,
        senderId,
        text,
        timestamp: new Date(),
      });

      await message.populate({ path: 'senderId', select: 'name profileImage role' });

      const thread = await ChatThread.findById(threadId);
      if (thread) {
        thread.messages.push({
          senderId,
          text,
          timestamp: message.timestamp,
        });

        thread.lastMessage = {
          text,
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
        if (userSocketsMap.has(participantId)) {
          userSocketsMap.get(participantId).forEach((sockId) => {
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

function emitToUser(userId, event, data) {
  if (userSocketsMap.has(userId)) {
    userSocketsMap.get(userId).forEach(socketId => {
      io.to(socketId).emit(event, data);
    });
  }
}

global.emitToUser = emitToUser;

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = { app, server, io };
