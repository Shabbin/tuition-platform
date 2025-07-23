const TeacherRequest = require('../models/teacherRequest');
const ChatThread = require('../models/chatThread');
const User = require('../models/user'); // ✅ make sure this path matches your User model location
const ChatMessage = require('../models/chatMessage');
// Create a new request
exports.createRequest = async (req, res) => {
  try {
    const { teacherId, studentId, studentName, postId, topic, subject, message } = req.body;

    // Prevent duplicate active requests by this student to this teacher
    const existingRequest = await TeacherRequest.findOne({
      teacherId,
      studentId,
      status: { $in: ['pending', 'approved'] }, // only active requests
      // Uncomment below if you want to limit per post as well
      // postId: postId || undefined,
    });

    if (existingRequest) {
      return res.status(400).json({
        message: 'You already have an active request for this teacher.',
        existingRequestId: existingRequest._id,
      });
    }

    // Proceed with creating the new request
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

    const session = {
      subject: subject || topic || 'Untitled Subject',
      origin: postId ? `Post: ${postId}` : 'Direct',
      status: 'pending',
      startedAt: newRequest.requestedAt,
      requestId: newRequest._id,
    };

    const initialMessage = {
      senderId: studentId,
      text: message,
      timestamp: newRequest.requestedAt,
    };

    let thread = await ChatThread.findOne({
      participants: { $all: [studentId, teacherId] },
      'sessions.requestId': newRequest._id,
    });

    if (!thread) {
      thread = new ChatThread({
        participants: [studentId, teacherId],
        messages: [initialMessage],      // embedded message
        sessions: [session],
      });
      await thread.save();
    } else {
      thread.sessions.push(session);
      thread.messages.push(initialMessage);
      await thread.save();
    }

    // Save the initial message as a separate ChatMessage document too
    const chatMessage = new ChatMessage({
      threadId: thread._id,
      senderId: studentId,
      text: message,
      timestamp: newRequest.requestedAt,
    });
    await chatMessage.save();

    res.status(201).json({ message: 'Session request created successfully', request: newRequest, threadId: thread._id });
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

    const requestsWithThreadId = await Promise.all(
      requests.map(async (reqItem) => {
        const thread = await ChatThread.findOne({
          participants: { $all: [reqItem.studentId, reqItem.teacherId] },
          'sessions.requestId': reqItem._id,
        });

        const student = await User.findById(reqItem.studentId).select('name image');
        const teacher = await User.findById(reqItem.teacherId).select('name image');

        return {
          ...reqItem.toObject(),
          threadId: thread ? thread._id : null,
          student,
          teacher,
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
  thread = new ChatThread({
    participants: [request.studentId, request.teacherId],
    messages: [], // 👈 No duplicate message
    sessions: [session],
  });
} else {
  thread.sessions.push(session);
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

        const student = await User.findById(reqItem.studentId).select('name image');
        const teacher = await User.findById(reqItem.teacherId).select('name image');

        return {
          ...reqItem.toObject(),
          threadId: thread ? thread._id : null,
          student,
          teacher,
        };
      })
    );

    res.json(requestsWithThreadId);
  } catch (error) {
    console.error('Error fetching student requests:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get all requests (any status) for a student
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
