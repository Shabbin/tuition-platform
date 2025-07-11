const express = require('express');
const router = express.Router();
const SessionRequest = require('../models/sessionRequest');
const auth = require('../middleware/auth');

// POST: Student requests a session with a teacher
router.post('/', auth('student'), async (req, res) => {
  try {
    const { teacherId, subject, message } = req.body;
    console.log('Request body:', req.body);  // Debug log to see incoming data

    // Validate required fields (subject is optional now)
    if (!teacherId || !message) {
      return res.status(400).json({ message: 'teacherId and message are required' });
    }

    // Create new session request
    const newRequest = await SessionRequest.create({
      student: req.user.userId,  // from auth middleware
      teacher: teacherId,
      subject: subject || '',
      message,
    });

    res.status(201).json({
      message: 'Session request created successfully',
      request: newRequest,
    });
  } catch (err) {
    console.error('Error creating session request:', err);
    res.status(500).json({ message: 'Failed to create session request' });
  }
});

// Optional: GET all session requests for a teacher (for future use)
router.get('/teacher/:teacherId', auth('teacher'), async (req, res) => {
  try {
    const requests = await SessionRequest.find({ teacher: req.params.teacherId }).populate('student', 'name');
    res.json(requests);
  } catch (err) {
    console.error('Error fetching session requests:', err);
    res.status(500).json({ message: 'Failed to fetch session requests' });
  }
});

module.exports = router;