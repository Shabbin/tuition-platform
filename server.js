const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const connectDB = require('./config/db');
const adminRoutes = require('./controllers/oneTimeAdminController');
const subjectRoutes = require('./routes/subjectsRoutes');
const educationTreeRoute = require('./routes/educationRoutes');
const teacherRequestsRouter = require('./routes/teacherRequestRoutes');
const ChatThread = require('./models/chatThread');
const chatRoutes = require('./routes/chatRoutes');
const ChatMessage = require('./models/chatMessage');
dotenv.config();
connectDB();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/auth', require('./routes/authRoutes'));
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
    origin: 'http://localhost:3000',  // ✅ Only your frontend
    methods: ['GET', 'POST'],         // ✅ Only allow necessary methods
    credentials: true,                // ✅ If using cookies or sessions
  },
});
global.io = io;
const userSocketsMap = new Map();

io.on('connection', (socket) => {
  const userId = socket.handshake.query.userId;
  console.log('User connected:', socket.id, 'userId:', userId);

  // Track sockets by user
  if (userId) {
    if (!userSocketsMap.has(userId)) {
      userSocketsMap.set(userId, new Set());
    }
    userSocketsMap.get(userId).add(socket.id);
  }

  socket.on('join_thread', (threadId) => {
    socket.join(threadId);
    console.log(`Socket ${socket.id} joined room ${threadId}`);
  });

  socket.on('leave_thread', (threadId) => {
    socket.leave(threadId);
    console.log(`Socket ${socket.id} left room ${threadId}`);
  });
socket.on('mark_thread_read', async ({ threadId, userId }) => {
  try {
    const thread = await ChatThread.findById(threadId);
    if (!thread) return;

    // Update the lastSeen map for this user
    thread.lastSeen.set(userId, new Date());

    await thread.save();

    console.log(`[mark_thread_read] User ${userId} marked thread ${threadId} as read`);
  } catch (err) {
    console.error('Error in mark_thread_read:', err);
  }
});


socket.on('send_message', async (data) => {
  const { threadId, senderId, text } = data;
  console.log(`[send_message] Received from senderId=${senderId} in threadId=${threadId}: ${text}`);

  try {
    // Save message
    const message = await ChatMessage.create({
      threadId,
      senderId,
      text,
      timestamp: new Date(),
    });

    await message.populate({ path: 'senderId', select: 'name profileImage role' });

    // Update thread
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

    // Refetch full thread with populated data
    const fullThread = await ChatThread.findById(threadId)
      .populate('participants', 'name profileImage role')
      .populate('messages.senderId', 'name profileImage role')
      .populate('lastMessage.senderId', 'name profileImage role')
      .lean();

    console.log(`[send_message] Refetched full thread for threadId=${threadId}`);

    // Emit new message event with message payload (to clients currently in this thread room)
    io.in(threadId).emit('new_message', message);

    // Emit full updated thread for the thread (useful for UI updates in active thread)
    io.in(threadId).emit('thread_updated', fullThread);

    // Emit to participant sockets for conversation list update and notification alerts
    fullThread.participants.forEach((participant) => {
      const participantId = participant._id.toString();
      if (userSocketsMap.has(participantId)) {
        userSocketsMap.get(participantId).forEach((sockId) => {
          console.log(`[send_message] Emitting conversation_list_updated to socket ${sockId} for participant ${participantId}`);
          io.to(sockId).emit('conversation_list_updated', fullThread);

          console.log(`[send_message] Emitting new_message_alert to socket ${sockId} for participant ${participantId}`);
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
    }
  });
});


const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
module.exports = { app, server, io };