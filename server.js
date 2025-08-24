// server.js
const express = require('express');
const http = require('http');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const connectDB = require('./config/db');
const adminRoutes = require('./controllers/oneTimeAdminController');
const subjectRoutes = require('./routes/subjectsRoutes');
const educationTreeRoute = require('./routes/educationRoutes');
const teacherRequestsRouter = require('./routes/teacherRequestRoutes');
const authRoutes = require('./routes/authRoutes');
const teacherPostRoutes = require('./routes/teacherPostRoutes');
const chatRoutes = require('./routes/chatRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const videoRoutes = require('./routes/videoRoutes');
const scheduleRoutes = require('./routes/scheduleRoutes');
const tuitionGuardRoutes = require('./routes/tuitionGuardRoutes');
const paymentRoutes = require('./routes/paymentRoutes');



// ✅ ADD: credits badge + settlement routes imports
const studentPublicRoutes = require('./routes/studentPublicRoutes');
const settlementRoutes = require('./routes/settlementRoutes');

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
app.use('/api/posts', teacherPostRoutes);
app.use('/api/session-requests', require('./routes/sessionRequest'));
app.use('/api/admin', adminRoutes);
app.use('/api', subjectRoutes);
app.use('/uploads', express.static(path.join(__dirname, "uploads")));
app.use(educationTreeRoute);
app.use('/api/teacher-requests', teacherRequestsRouter);
app.use('/api/chat', chatRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/videos', videoRoutes);
app.use('/api/schedules', scheduleRoutes);

// ✅ ADD: mount credits badge + settlement routes
app.use('/api', studentPublicRoutes);           // GET /api/students/:id/credits
app.use('/api/settlement', settlementRoutes);   // POST /api/settlement/questions/settle

// ✅ ADD: mount payment routes (kept path simple and separate from /api/*)
app.use('/pay', paymentRoutes);
app.use('/api/tuition', tuitionGuardRoutes); // ✅ add
const server = http.createServer(app);

// Import and initialize Socket.IO singleton
const { init, getIO } = require('./socketUtils/socket');
const io = init(server);


// ALSO expose API-style endpoints for your frontend: /api/payments/*
app.use('/api/payments', paymentRoutes);


// keep callbacks (success/fail/cancel/ipn) working at /pay/*
app.use('/pay', paymentRoutes);


const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// declare here

// Export io if needed elsewhere
module.exports = { app, server, io, getIO };
