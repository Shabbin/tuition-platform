const router = require('express').Router();
const { settleTopicSolve } = require('../controllers/settlementController');
router.post('/questions/settle', settleTopicSolve);
module.exports = router;
