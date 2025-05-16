const express = require('express');
const http = require('http');
const { Server } = require('socket.io'); // ✅ Import this BEFORE using Server
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const connectDB = require('./config/db');

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
app.use('/api/chat', require('./routes/chat'));
app.use('/api/messages', require('./routes/messageRoutes'));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Create HTTP server
const server = http.createServer(app);

// Setup Socket.IO AFTER `server` is defined
const io = new Server(server, {
  cors: { origin: '*' },
});

// Socket.IO handlers
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('send_message', (data) => {
    socket.to(data.receiverSocketId).emit('receive_message', data);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
