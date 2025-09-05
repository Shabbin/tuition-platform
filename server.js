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
const privateCourse = require('./routes/privateCourseRoutes')
// workers
const { startRoutineWorker } = require('../tuition-backend/services/workers/routineWorker');

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
app.use('/api/auth', authRoutes);
app.use('/api/students', require('./routes/studentRoutes'));
app.use('/api/teachers', require('./routes/teacherRoutes'));
app.use('/api/posts', teacherPostRoutes);
app.use('/api/session-requests', require('./routes/sessionRequest'));
app.use('/api/admin', adminRoutes);
app.use('/api', subjectRoutes); // e.g. /api/subjects/...
app.use(educationTreeRoute);    // keep if it already prefixes internally
app.use('/api/teacher-requests', teacherRequestsRouter);
app.use('/api/chat', chatRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/tuition', tuitionGuardRoutes);
app.use('/api/routines', routineRoutes);
app.use('/api/routine-changes', routineChanges);
app.use('/api/change-requests', changeRequestRoutes);
app.use('/api/enrollment-invites', enrollmentInviteRoutes);

// Public/student helpers
app.use('/api', studentPublicRoutes);            // GET /api/students/:id/credits
app.use('/api/settlement', settlementRoutes);    // POST /api/settlement/questions/settle

// Payments (keep one mount under /api for the app; /pay kept only if you truly need both)
app.use('/api/payments', paymentRoutes);
// If you still need the PSP callbacks under /pay/*, keep this:
app.use('/pay', paymentRoutes);

app.use('/api/private-courses',privateCourse);
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
