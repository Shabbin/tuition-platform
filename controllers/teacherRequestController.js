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
      status: { $in: ['pending', 'approved'] },
    });

    if (existingRequest) {
      console.log('⚠️ Duplicate active request found:', existingRequest._id);
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
    console.log('✅ New TeacherRequest saved:', newRequest._id);

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
        messages: [initialMessage], // embedded message
        sessions: [session],
      });
      await thread.save();
      console.log('✅ New ChatThread created:', thread._id);
    } else {
      thread.sessions.push(session);
      thread.messages.push(initialMessage);
      await thread.save();
      console.log('✅ Existing ChatThread updated:', thread._id);
    }

    const chatMessage = new ChatMessage({
      threadId: thread._id,
      senderId: studentId,
      text: message,
      timestamp: newRequest.requestedAt,
    });

    await chatMessage.save();
    console.log('✅ New ChatMessage saved:', chatMessage._id);

    thread.lastMessage = {
      text: chatMessage.text,
      senderId: chatMessage.senderId,
      timestamp: chatMessage.timestamp,
    };
    thread.updatedAt = new Date();
    await thread.save();
    console.log('✅ ChatThread lastMessage updated:', thread._id);

    // SOCKET.IO EMIT — notify only the intended teacher about the new request
    if (global.emitToUser) {
      // Fetch full user details for participants (name, profileImage, role)
      const populatedParticipants = await User.find({
        _id: { $in: [studentId, teacherId] }
      }).select('name profileImage role');

      const student = populatedParticipants.find(u => u._id.toString() === studentId.toString());
      const teacher = populatedParticipants.find(u => u._id.toString() === teacherId.toString());

      const payload = {
        request: newRequest,
        threadId: thread._id.toString(),
        studentId: studentId.toString(),
        studentName: student?.name || 'Student',
        teacherId: teacherId.toString(),
        teacherName: teacher?.name || 'Teacher',
        participants: populatedParticipants.map(u => ({
          _id: u._id.toString(),
          name: u.name,
          role: u.role,
          profileImage: u.profileImage,
        })),
        lastMessageText: thread.lastMessage?.text || '',
        lastMessageTimestamp: thread.lastMessage?.timestamp || '',
      };

      console.log('🌐 Emitting new_tuition_request with payload:', payload);
      global.emitToUser(teacherId.toString(), 'new_tuition_request', payload);
      console.log('✅ Emitted new_tuition_request only to intended teacher:', teacherId);
    } else {
      console.warn('⚠️ global.emitToUser is undefined — cannot emit new_tuition_request');
    }

    res.status(201).json({ message: 'Session request created successfully', request: newRequest, threadId: thread._id });
  } catch (error) {
    console.error('❌ Error creating teacher request:', error);
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

if (request.status === 'rejected') {
  const thread = await ChatThread.findOne({
    participants: { $all: [request.studentId, request.teacherId] },
    'sessions.requestId': request._id,
  });

  if (thread) {
    await ChatMessage.deleteMany({ threadId: thread._id });
    await ChatThread.deleteOne({ _id: thread._id });
  }
}

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

  // ✅ Emit to student that request is approved
  if (global.emitToUser && thread) {
    global.emitToUser(request.studentId.toString(), 'request_approved', {
      requestId: request._id.toString(),
      threadId: thread._id.toString(),
      approvedBy: 'teacher',
      timestamp: Date.now(),
    });

    console.log(`✅ Emitted request_approved to studentId: ${request.studentId}`);
  }
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
