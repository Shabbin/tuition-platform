// server/routes/paymentRoutes.js
const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/paymentController');
const auth = require('../middleware/auth');

// Topic pack (৳400 → 10 credits)
router.post('/initiate', ctrl.initiate);

// Tuition (FIRST half/full → 30%, RECURRING → 15%)
router.post('/tuition/initiate', auth('student'), ctrl.initiateTuition);

// Gateway callbacks (public)
router.post('/success', ctrl.success);
router.post('/fail',    ctrl.fail);
router.post('/cancel',  ctrl.cancel);

// IPN (optional)
router.post('/ipn',     ctrl.ipn);

// 🔹 Teacher monthly payment summary (real totals for current month)
router.get('/teacher/summary', auth('teacher'), ctrl.getTeacherSummary);

module.exports = router;
