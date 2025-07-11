const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const TeacherRequest = require('../models/TeacherRequest');

// Create a new request (used by student)
router.post('/', auth('student'), async (req, res) => {
  try {
    const { teacherId, studentId, studentName, postId, topic, subject, message } = req.body;

    // Required fields
    if (!teacherId || !studentId || !studentName || !message) {
      return res.status(400).json({ message: 'teacherId, studentId, studentName, and message are required.' });
    }

    // Ensure either postId (tuition), or topic, or subject (session) is provided - at least one
    if (!postId && !topic && !subject) {
      return res.status(400).json({ message: 'Provide at least one of postId, topic, or subject.' });
    }

    const newRequest = new TeacherRequest({
      teacherId,
      studentId,
      studentName,
      postId: postId || undefined,
      topic: topic || undefined,
      subject: subject || undefined,
      message,
      status: 'pending',
      requestedAt: new Date(),
    });

    await newRequest.save();

    res.status(201).json({ message: 'Session request created successfully', request: newRequest });
  } catch (error) {
    console.error('Error creating teacher request:', error);
    res.status(500).json({ message: 'Server error while creating request.' });
  }
});

// Get all requests for logged-in teacher
router.get('/', auth('teacher'), async (req, res) => {
  try {
    const teacherId = req.user.userId || req.user._id;
    const requests = await TeacherRequest.find({ teacherId });
    res.json(requests);
  } catch (error) {
    console.error('Error fetching requests:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update request status (approve/reject)
router.post('/:id/:action', auth('teacher'), async (req, res) => {
  try {
    const { id, action } = req.params;
    const teacherId = req.user.userId || req.user._id;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ message: 'Invalid action' });
    }

    const request = await TeacherRequest.findOne({ _id: id, teacherId });
    if (!request) {
      return res.status(404).json({ message: 'Request not found or unauthorized' });
    }

    request.status = action === 'approve' ? 'approved' : 'rejected';
    await request.save();

    res.json({ message: `Request ${request.status} successfully`, request });
  } catch (error) {
    console.error('Error updating request:', error);
    res.status(500).json({ message: 'Server error while updating request' });
  }
});

module.exports = router;
