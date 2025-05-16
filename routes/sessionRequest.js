const express = require('express');
const router = express.Router();
const SessionRequest = require('../models/sessionRequest');

router.post('/', async (req, res) => {
  try {
    const { studentId, teacherId, subject, message } = req.body;
    const newRequest = await SessionRequest.create({ student: studentId, teacher: teacherId, subject, message });
    res.status(201).json(newRequest);
  } catch (err) {
    console.error('Error creating session request:', err);
    res.status(500).json({ error: 'Failed to create session request' });
  }
});

module.exports = router;
