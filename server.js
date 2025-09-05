// server.js
const express = require('express');
const http = require('http');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');

const connectDB = require('./config/db');

// Routes
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
const routineRoutes = require('./routes/routineRoutes');
const routineChanges = require('./routes/routineChangeRoutes');
const studentPublicRoutes = require('./routes/studentPublicRoutes');
const settlementRoutes = require('./routes/settlementRoutes');
const changeRequestRoutes = require('./routes/changeRequestRoutes');
const enrollmentInviteRoutes = require('./routes/enrollmentInviteRoutes');
const privateCourse = require('./routes/privateCourseRoutes');
// workers
const { startRoutineWorker } = require(path.join(__dirname, 'services', 'workers', 'routineWorker'));

dotenv.config();
connectDB();

const app = express();

// --- Security headers (tune CSP separately if needed) ---
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// --- CORS BEFORE routes & auth ---
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';
app.use(
  cors({
    origin: FRONTEND_ORIGIN, // must be exact, not '*'
    credentials: true,       // allow cookies/credentials
  })
);

// --- Body parsers & cookies BEFORE routes ---
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Simple request logger (after cookieParser so cookies are visible)
app.use((req, _res, next) => {
  const hasToken = !!req.cookies?.token;
  console.log(
    '[REQ]',
    req.method,
    req.originalUrl,
    `origin=${req.headers.origin || '-'}`,
    `cookieToken=${hasToken ? 'yes' : 'no'}`,
    `authz=${req.headers.authorization ? 'present' : 'none'}`,
    `time=${new Date().toISOString()}`
  );
  next();
});

// --- Static files ---
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/videos', videoRoutes);

// --- API routes (mounted once) ---
console.log('MOUNT /api/auth');
app.use('/api/auth', authRoutes);

console.log('MOUNT /api/students');
app.use('/api/students', require('./routes/studentRoutes'));

console.log('MOUNT /api/teachers');
app.use('/api/teachers', require('./routes/teacherRoutes'));

console.log('MOUNT /api/posts');
app.use('/api/posts', teacherPostRoutes);

console.log('MOUNT /api/session-requests');
app.use('/api/session-requests', require('./routes/sessionRequest'));

console.log('MOUNT /api/admin');
app.use('/api/admin', adminRoutes);

console.log('MOUNT /api (subjects)');
app.use('/api', subjectRoutes); // e.g. /api/subjects/...

console.log('MOUNT educationTreeRoute');
app.use(educationTreeRoute);    // keep if it already prefixes internally

console.log('MOUNT /api/teacher-requests');
app.use('/api/teacher-requests', teacherRequestsRouter);

console.log('MOUNT /api/chat');
app.use('/api/chat', chatRoutes);

console.log('MOUNT /api/notifications');
app.use('/api/notifications', notificationRoutes);

console.log('MOUNT /api/schedules');
app.use('/api/schedules', scheduleRoutes);

console.log('MOUNT /api/tuition');
app.use('/api/tuition', tuitionGuardRoutes);

console.log('MOUNT /api/routines');
app.use('/api/routines', routineRoutes);

console.log('MOUNT /api/routine-changes');
app.use('/api/routine-changes', routineChanges);

console.log('MOUNT /api/change-requests');
app.use('/api/change-requests', changeRequestRoutes);

console.log('MOUNT /api/enrollment-invites');
app.use('/api/enrollment-invites', enrollmentInviteRoutes);

// Public/student helpers
console.log('MOUNT /api (studentPublicRoutes)');
app.use('/api', studentPublicRoutes);            // GET /api/students/:id/credits

console.log('MOUNT /api/settlement');
app.use('/api/settlement', settlementRoutes);    // POST /api/settlement/questions/settle

// Payments (keep one mount under /api for the app; /pay kept only if you truly need both)
console.log('MOUNT /api/payments');
app.use('/api/payments', paymentRoutes);

// If you still need the PSP callbacks under /pay/*, keep this:
console.log('MOUNT /pay (callbacks)');
app.use('/pay', paymentRoutes);

console.log('MOUNT /api/private-courses');
app.use('/api/private-courses', privateCourse);

// --- Create server & init sockets ---
const server = http.createServer(app);
const { init, getIO } = require('./socketUtils/socket');
const io = init(server);

// --- Start workers after sockets are up ---
startRoutineWorker();

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`CORS allowing origin: ${FRONTEND_ORIGIN}`);
});

module.exports = { app, server, io, getIO };
