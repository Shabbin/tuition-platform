const router = require('express').Router();
const { getStatus, useDemo, canTopicHelp } = require('../controllers/tuitionGuardController');

// GET current state for UI gates
// /api/tuition/status?studentId=...&teacherId=...&requestId=optional
router.get('/status', getStatus);

// POST consume one demo (server increments, blocks beyond 3 if unpaid)
router.post('/demo/use', useDemo);

// GET if topic-help to THIS teacher is allowed (blocks if connected or paid)
router.get('/can-topic-help', canTopicHelp);

module.exports = router;
