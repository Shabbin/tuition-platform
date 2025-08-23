const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/paymentController');

// Topic pack (৳400 → 10 credits)
router.post('/initiate', ctrl.initiate);

// Tuition (FIRST half/full → 30%, RECURRING → 15%)
router.post('/tuition/initiate', ctrl.initiateTuition);

// Gateway callbacks
router.post('/success', ctrl.success);
router.post('/fail',    ctrl.fail);
router.post('/cancel',  ctrl.cancel);

// IPN
router.post('/ipn',     ctrl.ipn);

module.exports = router;
