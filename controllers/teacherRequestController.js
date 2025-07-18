//controllers\teacherRequestController.js
const TeacherRequest = require('../models/teacherRequest');
const ChatThread = require('../models/chatThread');

// Create a new request
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

    // 🚫 Prevent duplicate active request per student-teacher pair
    const existing = await TeacherRequest.findOne({
      studentId,
      teacherId,
      status: { $in: ['pending', 'approved'] }
    });
    if (existing) {
      return res.status(409).json({ message: 'You already have an active request with this teacher.' });
    }

    // ✅ Create the request first
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

    // ✅ Immediately create pending chat thread if one doesn't exist
    const existingThread = await ChatThread.findOne({
      participants: { $all: [studentId, teacherId] }
    });

    if (!existingThread) {
      const session = {
        subject: subject || topic || 'Untitled Subject',
        origin: postId ? `Post: ${postId}` : 'Direct',
        status: 'pending',
        startedAt: newRequest.requestedAt,
        requestId: newRequest._id,
      };

      const thread = new ChatThread({
        participants: [studentId, teacherId],
        messages: [
          {
            senderId: studentId,
            text: message,
            timestamp: newRequest.requestedAt,
          }
        ],
        sessions: [session]
      });

      await thread.save();
    }

    res.status(201).json({ message: 'Session request created successfully', request: newRequest });
  } catch (error) {
    console.error('Error creating teacher request:', error);
    res.status(500).json({ message: 'Server error while creating request.' });
  }
};


// Get all requests for logged-in teacher
// controllers/teacherRequestController.js

exports.getRequestsForTeacher = async (req, res) => {
  try {
    const teacherId = req.user.userId || req.user._id;

    const requests = await TeacherRequest.find({ teacherId });

    // Attach threadId to each request
    const requestsWithThreadId = await Promise.all(
      requests.map(async (reqItem) => {
        const thread = await ChatThread.findOne({
          participants: { $all: [reqItem.studentId, reqItem.teacherId] },
          'sessions.requestId': reqItem._id,
        });

        return {
          ...reqItem.toObject(),
          threadId: thread ? thread._id : null,
        };
      })
    );

    res.json(requestsWithThreadId);
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

    const requestsWithThreadId = await Promise.all(
      requests.map(async (reqItem) => {
        const thread = await ChatThread.findOne({
          participants: { $all: [reqItem.studentId, reqItem.teacherId] },
          'sessions.requestId': reqItem._id,
        });

        return {
          ...reqItem.toObject(),
          threadId: thread ? thread._id : null,
        };
      })
    );

    res.json(requestsWithThreadId);
  } catch (error) {
    console.error('Error fetching student requests:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getAllRequestsForStudent = async (req, res) => {
  try {
    const studentId = req.user.userId || req.user._id;
    const requests = await TeacherRequest.find({ studentId });
    res.json(requests);
  } catch (error) {
    console.error('Error fetching all student requests:', error);
    res.status(500).json({ message: 'Server error' });
  }
};