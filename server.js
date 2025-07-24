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
  cors: { origin: '*' },
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join_thread', (threadId) => {
    socket.join(threadId);
    console.log(`Socket ${socket.id} joined room ${threadId}`);
  });

  socket.on('leave_thread', (threadId) => {
    socket.leave(threadId);
    console.log(`Socket ${socket.id} left room ${threadId}`);
  });

socket.on('send_message', async (data) => {
  const { threadId, senderId, text } = data;
  try {
    // 1. Save message as standalone document
    const message = await ChatMessage.create({
      threadId,
      senderId,
      text,
      timestamp: new Date(), // explicitly add timestamp
    });

    // 2. Populate sender data for frontend convenience
    await message.populate({ path: 'senderId', select: 'name profileImage role' });

    // 3. Update the ChatThread's embedded messages and lastMessage, updatedAt
    const thread = await ChatThread.findById(threadId);
    if (thread) {
      // Add to embedded messages array
      thread.messages.push({
        senderId,
        text,
        timestamp: message.timestamp,
      });

      // Update lastMessage and updatedAt
      thread.lastMessage = {
        text,
        senderId,
        timestamp: message.timestamp,
      };
      thread.updatedAt = new Date();

      await thread.save();

      // Populate lastMessage sender and participants for broadcasting
      await thread.populate('lastMessage.senderId', 'name profileImage role');
      await thread.populate('participants', 'name profileImage role');
    }

    // 4. Emit the new message to clients in the thread room
    io.in(threadId).emit('new_message', message);

    // 5. Emit the updated thread info (with lastMessage) to update conversation headlines
    io.in(threadId).emit('thread_updated', thread);
  } catch (error) {
    console.error('Error sending message:', error);
  }
});



  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});


const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
