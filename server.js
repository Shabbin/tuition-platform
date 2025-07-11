const express = require('express');
const http = require('http');
const { Server } = require('socket.io'); // ✅ Import this BEFORE using Server
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const connectDB = require('./config/db');
const adminRoutes = require('./controllers/oneTimeAdminController');
const subjectRoutes = require('./routes/subjectsRoutes');
const educationTreeRoute = require('./routes/educationRoutes');
const teacherRequestsRouter = require('./routes/teacherRequestRoutes');
const ChatThread = require('./models/chatThread'); // import
const chatRoutes = require('./routes/chatRoutes');
// Load environment variables
dotenv.config();

// Connect to DB
connectDB();

// Init express
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
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
// Create HTTP server
const server = http.createServer(app);

// Setup Socket.IO AFTER `server` is defined
const io = new Server(server, {
  cors: { origin: '*' },
});

// Socket.IO handlers
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join_thread', ({ threadId }) => {
    socket.join(threadId);
    console.log(`Socket ${socket.id} joined room ${threadId}`);
  });

  socket.on('send_message', async (data) => {
    const { threadId, senderId, text } = data;
    try {
      const thread = await ChatThread.findById(threadId);
      if (!thread) return;

      const newMessage = { senderId, text, timestamp: new Date() };
      thread.messages.push(newMessage);
      await thread.save();

      // Emit the new message to everyone in the room
      socket.to(threadId).emit('receive_message', { message: newMessage });

      // Also emit back to sender for UI update
      socket.emit('receive_message', { message: newMessage });
    } catch (error) {
      console.error('Error saving message:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});


// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
