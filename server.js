// server.js
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
console.log('[ENV] region:', process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION);
console.log('[ENV] bucket:', process.env.AWS_S3_BUCKET);

const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

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



async function start() {
  // --- DB first (so we fail fast if URI is wrong) ---
  await connectDB(); // make sure connectDB returns a promise

  const app = express();

  // behind a proxy/CDN (needed if you ever set secure cookies)
  app.set('trust proxy', 1);

  // --- Security headers ---
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    })
  );

  // --- CORS allow-list (comma-separated FRONTEND_ORIGINS supported) ---
  const origins = (process.env.FRONTEND_ORIGINS || process.env.FRONTEND_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin(origin, cb) {
        if (!origin) return cb(null, true); // curl/postman
        cb(null, origins.includes(origin));
      },
      credentials: true,
    })
  );

  // --- Body/cookies, compression, basic rate limits ---
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(compression());

  // global burst limiter (tune if needed)
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 600,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  // targeted limiter on auth & chat send
  app.use('/api/auth/', rateLimit({ windowMs: 15 * 60_000, limit: 100 }));
  app.use('/api/chat/messages', rateLimit({ windowMs: 10_000, limit: 50 }));

  // Simple request logger
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

  // --- Health & readiness ---
  app.get('/healthz', (_req, res) => res.type('text/plain').send('ok'));
  app.get('/readyz', (_req, res) => {
    const mongoose = require('mongoose');
    const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    const mongoState = states[mongoose.connection.readyState] || 'unknown';
    if (mongoState !== 'connected') return res.status(503).json({ ok: false, mongo: mongoState });
    return res.json({ ok: true, mongo: mongoState });
  });

  // --- Static & non-API routes ---
  app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

  // --- Feature routes ---
  app.use('/videos', videoRoutes);

  console.log('MOUNT /api/auth');                app.use('/api/auth', authRoutes);
  console.log('MOUNT /api/students');            app.use('/api/students', require('./routes/studentRoutes'));
  console.log('MOUNT /api/teachers');            app.use('/api/teachers', require('./routes/teacherRoutes'));
  console.log('MOUNT /api/posts');               app.use('/api/posts', teacherPostRoutes);
  console.log('MOUNT /api/session-requests');    app.use('/api/session-requests', require('./routes/sessionRequest'));
  console.log('MOUNT /api/admin');               app.use('/api/admin', adminRoutes);
  console.log('MOUNT /api (subjects)');          app.use('/api', subjectRoutes);
  console.log('MOUNT educationTreeRoute');       app.use(educationTreeRoute);
  console.log('MOUNT /api/teacher-requests');    app.use('/api/teacher-requests', teacherRequestsRouter);
  console.log('MOUNT /api/chat');                app.use('/api/chat', chatRoutes);
  console.log('MOUNT /api/notifications');       app.use('/api/notifications', notificationRoutes);
  console.log('MOUNT /api/schedules');           app.use('/api/schedules', scheduleRoutes);
  console.log('MOUNT /api/tuition');             app.use('/api/tuition', tuitionGuardRoutes);
  console.log('MOUNT /api/routines');            app.use('/api/routines', routineRoutes);
  console.log('MOUNT /api/routine-changes');     app.use('/api/routine-changes', routineChanges);
  console.log('MOUNT /api/change-requests');     app.use('/api/change-requests', changeRequestRoutes);
  console.log('MOUNT /api/enrollment-invites');  app.use('/api/enrollment-invites', enrollmentInviteRoutes);
  console.log('MOUNT /api (studentPublic)');     app.use('/api', studentPublicRoutes);
  console.log('MOUNT /api/settlement');          app.use('/api/settlement', settlementRoutes);
  console.log('MOUNT /api/payments');            app.use('/api/payments', paymentRoutes);
  console.log('MOUNT /pay (callbacks)');         app.use('/pay', paymentRoutes);
  console.log('MOUNT /api/private-courses');     app.use('/api/private-courses', privateCourse);

  // 404 (after routes)
  app.use((req, res) => res.status(404).json({ ok: false, error: 'NOT_FOUND' }));

  // Error handler (JSON)
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error('[ERR]', err);
    res.status(err.status || 500).json({ ok: false, error: 'INTERNAL', message: err.message });
  });

  // --- Server & sockets ---
  const server = http.createServer(app);
  const { init, getIO, shutdown: socketShutdown } = require('./socketUtils/socket');
  const io = init(server);

  // background workers
  startRoutineWorker();

  const PORT = process.env.PORT || 5000;
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`CORS allowing origins: ${origins.join(', ')}`);
  });

  // --- graceful shutdown ---
  async function closeGracefully(signal) {
    console.log(`\n[SHUTDOWN] ${signal} received`);
    try {
      server.close(() => console.log('[SHUTDOWN] HTTP server closed'));
      if (io) await socketShutdown?.(); // closes Redis adapter if present
      const mongoose = require('mongoose');
      await mongoose.connection.close(false);
      console.log('[SHUTDOWN] Mongo connection closed');
      process.exit(0);
    } catch (e) {
      console.error('[SHUTDOWN] error', e);
      process.exit(1);
    }
  }
  process.on('SIGTERM', () => closeGracefully('SIGTERM'));
  process.on('SIGINT',  () => closeGracefully('SIGINT'));

  return { app, server, io, getIO };
}

start().catch((e) => {
  console.error('Fatal boot error:', e);
  process.exit(1);
});

module.exports = {}; // not used elsewhere now
