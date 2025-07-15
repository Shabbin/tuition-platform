const TeacherRequest = require('../models/teacherRequest');
const ChatThread = require('../models/chatThread');

// Create a new request
exports.createRequest = async (req, res) => {
  try {
    const { teacherId, studentId, studentName, postId, topic, subject, message } = req.body;

    if (!teacherId || !studentId || !studentName || !message) {
      return res.status(400).json({ message: 'teacherId, studentId, studentName, and message are required.' });
    }

    if (!postId && !topic && !subject) {
      return res.status(400).json({ message: 'Provide at least one of postId, topic, or subject.' });
    }

    // 🚫 Prevent duplicate active request per student-teacher pair (ignores posts)
    const existing = await TeacherRequest.findOne({
      studentId,
      teacherId,
      status: { $in: ['pending', 'approved'] }
    });
    if (existing) {
      return res.status(409).json({ message: 'You already have an active request with this teacher.' });
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
};

// Get all requests for logged-in teacher
exports.getRequestsForTeacher = async (req, res) => {
  try {
    const teacherId = req.user.userId || req.user._id;
    const requests = await TeacherRequest.find({ teacherId });
    res.json(requests);
  } catch (error) {
    console.error('Error fetching requests:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Approve or reject a request
exports.updateRequestStatus = async (req, res) => {
  try {
    const { id, action } = req.params;
    const { rejectionMessage } = req.body || {};
    const teacherId = req.user.userId || req.user._id;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ message: 'Invalid action' });
    }

    const request = await TeacherRequest.findOne({ _id: id, teacherId });
    if (!request) {
      return res.status(404).json({ message: 'Request not found or unauthorized' });
    }

    request.status = action === 'approve' ? 'approved' : 'rejected';
    if (action === 'reject' && rejectionMessage) {
      request.rejectionMessage = rejectionMessage;
    }

    await request.save();

    let thread = null;

    if (request.status === 'approved') {
      // Reuse existing thread if exists for this student-teacher pair
      thread = await ChatThread.findOne({
        participants: { $all: [request.studentId, request.teacherId] },
      });

      const session = {
        subject: request.subject || 'Untitled Subject',
        origin: request.postId ? `Post: ${request.postId}` : 'Direct',
        status: 'approved',
        startedAt: new Date(),
        requestId: request._id,
      };

      if (!thread) {
        // Create thread
        thread = new ChatThread({
          participants: [request.studentId, request.teacherId],
          messages: [
            {
              senderId: request.studentId,
              text: request.message || '[No message provided]',
              timestamp: request.requestedAt || new Date(),
            },
          ],
          sessions: [session],
        });
      } else {
        thread.sessions.push(session);
        thread.messages.push({
          senderId: request.studentId,
          text: request.message || '[No message provided]',
          timestamp: request.requestedAt || new Date(),
        });
      }

      await thread.save();
    }

    res.json({
      message: `Request ${request.status} successfully`,
      request,
      threadId: thread?._id || null,
    });
  } catch (error) {
    console.error('Error updating request:', error);
    res.status(500).json({ message: 'Server error while updating request' });
  }
};

// Get approved requests for logged-in student
exports.getRequestsForStudent = async (req, res) => {
  try {
    const studentId = req.user.userId || req.user._id;
    const requests = await TeacherRequest.find({ studentId, status: 'approved' });
    res.json(requests);
  } catch (error) {
    console.error('Error fetching student requests:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
