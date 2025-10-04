// controllers/videoRoomController.js
'use strict';

const MediaRoom       = require('../models/mediaRoom');
const JoinToken       = require('../models/joinToken');
const Schedule        = require('../models/schedule');
const TeacherRequest  = require('../models/teacherRequest');
const Payment         = require('../models/payment');
const User            = require('../models/user');
const { provider }    = require('../services/video');

const JOIN_OPEN_BEFORE_MS = (parseInt(process.env.VIDEO_JOIN_OPEN_BEFORE_MIN, 10) || 10) * 60 * 1000;
const JOIN_AFTER_GRACE_MS = (parseInt(process.env.VIDEO_JOIN_AFTER_GRACE_MIN, 10) || 15) * 60 * 1000;
const TOKEN_TTL_MS        = (parseInt(process.env.VIDEO_TOKEN_TTL_MIN, 10) || 5)  * 60 * 1000;

// ── helpers ────────────────────────────────────────────────────────────────────
function ensureUser(req) {
  const uid = req?.user?.id || req?.user?._id;
  if (!uid) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }
  return uid;
}

function parseScheduleMs(dateVal) {
  if (typeof dateVal === 'number') return dateVal;

  const s = String(dateVal || '');
  if (!s) return NaN;

  const hasTz = /[zZ]|[+\-]\d{2}:\d{2}$/.test(s);
  if (hasTz) {
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? ms : NaN;
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) {
    const ms = Date.parse(s + '+06:00'); // assume Dhaka if no TZ
    return Number.isFinite(ms) ? ms : NaN;
  }

  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : NaN;
}

function resolveParticipantRole(schedule, userId) {
  const uid = String(userId);
  if (String(schedule.teacherId) === uid) return 'HOST';
  if ((schedule.studentIds || []).map(String).includes(uid)) return 'ATTENDEE';
  return null;
}

function computeWindow(schedule) {
  const startMs = parseScheduleMs(schedule?.date);
  const durationMin = Number(schedule?.durationMinutes || 0);
  if (!Number.isFinite(startMs) || !durationMin) {
    return { ok: false };
  }
  const classStartMs = startMs;
  const classEndMs   = classStartMs + durationMin * 60_000;
  const windowOpenMs = classStartMs - JOIN_OPEN_BEFORE_MS;
  const windowCloseMs= classEndMs   + JOIN_AFTER_GRACE_MS;
  const nowMs        = Date.now();

  const within = nowMs >= windowOpenMs && nowMs <= windowCloseMs;

  return {
    ok: true,
    within,
    nowMs,
    classStartMs,
    classEndMs,
    windowOpenMs,
    windowCloseMs,
    openBeforeMin: JOIN_OPEN_BEFORE_MS / 60000,
    afterGraceMin: JOIN_AFTER_GRACE_MS / 60000,
  };
}

async function isPaidForPair({ postId, studentId, teacherId }) {
  if (!postId || !studentId || !teacherId) return false;

  const reqs = await TeacherRequest.find({
    postId, studentId, teacherId, status: { $in: ['approved', 'accepted'] }
  }).select('_id').lean();
  const requestIds = reqs.map(r => r._id);

  if (requestIds.length) {
    const byReq = await Payment.findOne({
      type: 'TUITION', status: 'PAID', requestId: { $in: requestIds }
    }).select('_id');
    if (byReq) return true;
  }
  const byPair = await Payment.findOne({
    type: 'TUITION', status: 'PAID', requestId: null, studentId, teacherId
  }).select('_id');

  return !!byPair;
}

// ── handlers ──────────────────────────────────────────────────────────────────
async function issueJoinToken(req, res) {
  const t0 = Date.now();
  try {
    console.log('[video:issueJoinToken:entry]', {
      ts: new Date().toISOString(),
      ip: req.ip,
      method: req.method,
      url: req.originalUrl,
      origin: req.headers?.origin || null,
      providerClass: provider?.constructor?.name || 'unknown',
      cookie: req.cookies?.token ? 'present' : 'none',
      authz: req.headers?.authorization ? 'present' : 'none'
    });

    const userId = ensureUser(req);
    const scheduleId = req.params.id;
    console.log('[video:issueJoinToken] scheduleId=', scheduleId, 'userId=', userId);

    const schedule = await Schedule.findById(scheduleId)
      .select('_id teacherId studentIds postId type date durationMinutes status')
      .lean();

    if (!schedule) {
      console.warn('[video:issueJoinToken] schedule not_found');
      return res.status(404).json({ error: 'not_found', message: 'Schedule not found' });
    }
    console.log('[video:issueJoinToken] schedule found=', {
      id: String(schedule._id),
      teacherId: String(schedule.teacherId),
      studentCount: (schedule.studentIds || []).length,
      type: schedule.type,
      status: schedule.status,
      date: schedule.date,
      durationMinutes: schedule.durationMinutes
    });

    if (String(schedule.status) !== 'scheduled') {
      console.warn('[video:issueJoinToken] invalid_state', schedule.status);
      return res.status(400).json({ error: 'invalid_state', message: 'Schedule is not joinable yet' });
    }

    const role = resolveParticipantRole(schedule, userId);
    console.log('[video:issueJoinToken] resolved role=', role, ' userId=', userId);
    if (!role) return res.status(403).json({ error: 'forbidden', message: 'Not allowed' });

    if (schedule.type === 'regular' && role === 'ATTENDEE') {
      const ok = await isPaidForPair({ postId: schedule.postId, studentId: userId, teacherId: schedule.teacherId });
      if (!ok) return res.status(402).json({ error: 'payment_required', message: 'Please complete payment to join this class' });
    }

    const win = computeWindow(schedule);
    console.log('[video:issueJoinToken] window=', win);
    if (!win.ok) {
      return res.status(400).json({ error: 'invalid_schedule_time', message: 'Schedule has invalid date/duration' });
    }
    if (!win.within) {
      return res.status(403).json({
        error: 'too_early_or_late',
        message: 'Join is only allowed shortly before until shortly after the class window',
        joinWindow: { ...win },
      });
    }

    if (!provider || typeof provider.createRoom !== 'function' || typeof provider.createToken !== 'function') {
      console.error('[video:issueJoinToken] provider not configured');
      return res.status(500).json({ error: 'server_error', message: 'Video provider is not configured' });
    }

    // Resolve provider display name once
    const providerName = provider?.constructor?.name?.toUpperCase().includes('JITSI') ? 'JITSI' : 'DAILY';

    let room = await MediaRoom.findOne({ scheduleId: schedule._id });
    if (!room) {
      const roomName = `sched_${String(schedule._id)}`;
      console.log('[video:issueJoinToken] creating provider room name=', roomName);

      try {
        const created = await provider.createRoom({ name: roomName });
        room = await MediaRoom.create({
          scheduleId: schedule._id,
          provider: providerName, // <— enum-friendly
          roomName: created.roomName,
          providerRoomId: created.providerRoomId || null,
          joinUrl: created.joinUrl || null,
        });
      } catch (e) {
        const status = e?.response?.status || e?.status || 'unknown';
        const msg = e?.response?.data?.error || e?.message || 'room-create-failed';
        console.error('[video:issueJoinToken] provider.createRoom error', {
          status, msg, body: e?.response?.data
        });
        throw e;
      }
    }

    const me = await User.findById(userId).select('name').lean();

    let tokenResp;
    try {
      tokenResp = await provider.createToken({
        roomName: room.roomName,
        isOwner: role === 'HOST',
        userName: me?.name || 'User',
      });
    } catch (e) {
      const status = e?.response?.status || e?.status || 'unknown';
      const msg = e?.response?.data?.error || e?.message || 'token-create-failed';
      console.error('[video:issueJoinToken] provider.createToken error', {
        status, msg, body: e?.response?.data
      });
      throw e;
    }

    const tokenStr = tokenResp?.token || null;

    // Persist token only if we actually have one (e.g. Daily)
    if (tokenStr) {
      await JoinToken.create({
        scheduleId: schedule._id,
        userId,
        role,
        provider: providerName, // <— was 'DAILY'
        token: tokenStr,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      });
    } else {
      console.log('[video:issueJoinToken] provider returned no token — skipping JoinToken.save');
    }

    // Normalize join URL
    const subdomain = process.env.DAILY_SUBDOMAIN && String(process.env.DAILY_SUBDOMAIN).trim();
    let joinUrl = room.joinUrl || null;
    if (!joinUrl) {
      joinUrl = provider.buildRoomUrl?.(room.roomName) || null;
      if (!joinUrl && providerName === 'DAILY' && subdomain) {
        joinUrl = `https://${subdomain}.daily.co/${room.roomName}`;
      }
    }

    const payload = {
      provider: providerName,
      roomName: room.roomName,
      token: tokenStr,           // can be null for providers that don’t use tokens
      joinUrl,
      expiresInSec: tokenStr ? Math.floor(TOKEN_TTL_MS / 1000) : null,
      joinWindow: computeWindow(schedule),
      role,
    };
    console.log('[video:issueJoinToken] RESPOND 200 payload=', {
      ...payload,
      token: tokenStr ? '***' : null, // don’t log raw token
    }, 'in', (Date.now() - t0) + 'ms');

    return res.json(payload);
  } catch (err) {
    const status = err.status || err?.response?.status || 500;
    const msg = err?.response?.data?.message || err?.message || 'Server error';
    console.error('[video:issueJoinToken] error', { status, msg, stack: err?.stack });
    if (status === 401) return res.status(401).json({ error: 'unauthorized', message: 'Unauthorized' });
    return res.status(500).json({ error: 'server_error', message: msg });
  }
}

async function canJoin(req, res) {
  try {
    console.log('[video:canJoin:entry]', {
      ts: new Date().toISOString(),
      ip: req.ip,
      method: req.method,
      url: req.originalUrl,
      origin: req.headers?.origin || null,
      providerClass: provider?.constructor?.name || 'unknown',
      cookie: req.cookies?.token ? 'present' : 'none',
      authz: req.headers?.authorization ? 'present' : 'none',
      user: req.user ? { id: req.user.id || req.user._id, role: req.user.role, email: req.user.email } : null,
    });

    const userId = ensureUser(req);
    const scheduleId = req.params.id;
    console.log('[video:canJoin] scheduleId=', scheduleId);

    const schedule = await Schedule.findById(scheduleId)
      .select('_id teacherId studentIds postId type date durationMinutes status')
      .lean();

    if (!schedule) return res.status(404).json({ error: 'not_found' });

    console.log('[video:canJoin] schedule found=', {
      id: String(schedule._id),
      teacherId: String(schedule.teacherId),
      studentCount: (schedule.studentIds || []).length,
      type: schedule.type,
      status: schedule.status,
      date: schedule.date,
      durationMinutes: schedule.durationMinutes
    });

    const role = resolveParticipantRole(schedule, userId);
    console.log('[video:canJoin] resolved role=', role, ' userId=', userId);
    if (!role) return res.json({ canJoin: false, reason: 'not_participant' });

    if (String(schedule.status) !== 'scheduled') {
      return res.json({ canJoin: false, reason: 'invalid_state' });
    }

    if (schedule.type === 'regular' && role === 'ATTENDEE') {
      const ok = await isPaidForPair({ postId: schedule.postId, studentId: userId, teacherId: schedule.teacherId });
      if (!ok) return res.json({ canJoin: false, reason: 'payment_required' });
    }

    const win = computeWindow(schedule);
    console.log('[video:canJoin] window=', win);

    const payload = {
      canJoin: win.ok && win.within,
      reason: win.ok && win.within ? 'ok' : (win.ok ? 'window' : 'invalid_schedule_time'),
      joinWindow: win,
      role,
    };
    console.log('[video:canJoin] RESPOND 200 payload=', payload);
    return res.json(payload);
  } catch (err) {
    const status = err.status || 500;
    console.error('[video:canJoin] error', { status, msg: err?.message, stack: err?.stack });
    if (status === 401) return res.status(401).json({ error: 'unauthorized', message: 'Unauthorized' });
    return res.status(500).json({ error: 'server_error' });
  }
}

async function dailyWebhook(req, res) {
  try {
    const event = req.body || {};
    if (event && event.type) {
      console.log('[dailyWebhook]', event.type, event?.data?.room?.name || '');
    }
    return res.json({ ok: true });
  } catch (_e) {
    return res.status(200).json({ ok: true });
  }
}

module.exports = { issueJoinToken, canJoin, dailyWebhook };
