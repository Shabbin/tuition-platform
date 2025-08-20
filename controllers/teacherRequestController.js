const TeacherRequest = require('../models/teacherRequest');
const ChatThread = require('../models/chatThread');
const User = require('../models/User'); // ✅ make sure this path matches your User model location
const ChatMessage = require('../models/chatMessage');
const Notification = require('../models/Notification');
const TeacherPost = require('../models/teacherPost'); // ✅ added

// Create a new request (existing, keep as-is for direct / ad-hoc requests)
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
        messages: [initialMessage],
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

    // *** NEW: Create Notification for Teacher ***
    const student = await User.findById(studentId).select('name profileImage');
    const notificationForTeacher = new Notification({
      userId: teacherId,
      senderId: studentId,
      senderName: student?.name || 'Someone',
      profileImage: student?.profileImage || '/default-avatar.png',
      type: 'tuition_request',
      title: 'New Tuition Request',
      message: `${student?.name || 'Someone'} sent you a tuition request.`,
      data: { requestId: newRequest._id, threadId: thread._id },
      read: false,
    });
    await notificationForTeacher.save();
    console.log('✅ Notification created for teacher:', teacherId.toString());

    // Emit notification to teacher
    if (global.emitToUser) {
      global.emitToUser(teacherId.toString(), 'new_notification', {
        _id: notificationForTeacher._id.toString(),
        senderName: notificationForTeacher.senderName,
        profileImage: notificationForTeacher.profileImage,
        type: notificationForTeacher.type,
        title: notificationForTeacher.title,
        message: notificationForTeacher.message,
        data: notificationForTeacher.data,
        read: notificationForTeacher.read,
        createdAt: notificationForTeacher.createdAt,
      });
      console.log('✅ Emitted new_notification to teacher:', teacherId);
    }

    // Emit new tuition request payload
    if (global.emitToUser) {
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

      global.emitToUser(teacherId.toString(), 'new_tuition_request', payload);
      console.log('✅ Emitted new_tuition_request only to intended teacher:', teacherId);
    }

    res.status(201).json({
      message: 'Session request created successfully',
      request: newRequest,
      threadId: thread._id,
    });
  } catch (error) {
    console.error('❌ Error creating teacher request:', error);
    res.status(500).json({ message: 'Server error while creating request.' });
  }
};

/**
 * ✅ NEW: Create request *from a post* (server derives teacherId from post)
 * Route example:
 *   POST /api/teacherRequests/from-post/:postId
 *   (or POST /api/posts/:postId/request if you prefer it under post routes)
 * Auth:
 *   auth('student')
 */
exports.createRequestFromPost = async (req, res) => {
  try {
    const { postId } = req.params;
    const { message, subject } = req.body;
    const studentId = req.user.id; // authenticated student

    if (!message || !message.trim()) {
      return res.status(400).json({ message: 'Message is required.' });
    }

    // 1) Validate post & derive teacherId
    const post = await TeacherPost.findById(postId).select('teacher title subjects');
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const teacherId = post.teacher;

    // 2) Prevent duplicate active request for this post (pending/approved)
    const existing = await TeacherRequest.findOne({
      teacherId,
      studentId,
      postId,
      status: { $in: ['pending', 'approved'] },
    });
    if (existing) {
      return res.status(400).json({
        message: 'You already have an active request for this post.',
        existingRequestId: existing._id,
      });
    }

    // 3) Create request (origin: post). Keep same shape as your existing createRequest
    const studentDoc = await User.findById(studentId).select('name');
    const newRequest = new TeacherRequest({
      teacherId,
      studentId,
      studentName: studentDoc?.name || 'Student',
      postId,
      topic: undefined,
      subject: subject || (Array.isArray(post.subjects) && post.subjects[0]) || undefined,
      message,
      status: 'pending',
      requestedAt: new Date(),
    });
    await newRequest.save();

    // 4) Thread bootstrap (same pattern as your existing flow)
    const session = {
      subject: newRequest.subject || 'Untitled Subject',
      origin: `Post: ${postId}`,
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
        messages: [initialMessage],
        sessions: [session],
      });
      await thread.save();
    } else {
      thread.sessions.push(session);
      thread.messages.push(initialMessage);
      await thread.save();
    }

    const chatMessage = new ChatMessage({
      threadId: thread._id,
      senderId: studentId,
      text: message,
      timestamp: newRequest.requestedAt,
    });
    await chatMessage.save();

    thread.lastMessage = {
      text: chatMessage.text,
      senderId: chatMessage.senderId,
      timestamp: chatMessage.timestamp,
    };
    thread.updatedAt = new Date();
    await thread.save();

    // 5) Notify teacher
    const student = await User.findById(studentId).select('name profileImage');
    const notificationForTeacher = new Notification({
      userId: teacherId,
      senderId: studentId,
      senderName: student?.name || 'Someone',
      profileImage: student?.profileImage || '/default-avatar.png',
      type: 'tuition_request',
      title: 'New Tuition Request',
      message: `${student?.name || 'Someone'} sent you a tuition request about "${post.title}".`,
      data: { requestId: newRequest._id, threadId: thread._id, postId },
      read: false,
    });
    await notificationForTeacher.save();

    if (global.emitToUser) {
      global.emitToUser(teacherId.toString(), 'new_notification', {
        _id: notificationForTeacher._id.toString(),
        senderName: notificationForTeacher.senderName,
        profileImage: notificationForTeacher.profileImage,
        type: notificationForTeacher.type,
        title: notificationForTeacher.title,
        message: notificationForTeacher.message,
        data: notificationForTeacher.data,
        read: notificationForTeacher.read,
        createdAt: notificationForTeacher.createdAt,
      });
    }

    return res.status(201).json({
      message: 'Request created from post',
      request: newRequest,
      threadId: thread._id,
    });
  } catch (err) {
    console.error('❌ createRequestFromPost error:', err);
    return res.status(500).json({ message: 'Server error while creating request.' });
  }
};

// Get all requests for logged-in teacher
exports.getRequestsForTeacher = async (req, res) => {
  try {
    const teacherId = req.user.id || req.user.userId || req.user._id;

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
  console.log('updateRequestStatus params:', req.params);
  console.log('Authenticated user:', req.user);

  try {
    const { id, action } = req.params;
    const { rejectionMessage } = req.body || {};
    const teacherId = req.user.id || req.user.userId || req.user._id;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ message: 'Invalid action' });
    }

    const request = await TeacherRequest.findOne({ _id: id, teacherId });
    if (!request) {
      return res.status(404).json({ message: 'Request not found or unauthorized' });
    }

    // Set request status
    request.status = action === 'approve' ? 'approved' : 'rejected';
    if (action === 'reject' && rejectionMessage) {
      request.rejectionMessage = rejectionMessage;
    }
    await request.save();

    // Fetch existing chat thread if any
    let thread = await ChatThread.findOne({
      participants: { $all: [request.studentId, request.teacherId] },
      'sessions.requestId': request._id,
    });

    // Handle rejection: delete thread/messages if exists
    if (request.status === 'rejected' && thread) {
      await ChatMessage.deleteMany({ threadId: thread._id });
      await ChatThread.deleteOne({ _id: thread._id });
      thread = null; // Thread no longer exists
    }

    // Handle approval: create session in thread
    if (request.status === 'approved') {
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
          messages: [],
          sessions: [session],
        });
      } else {
        thread.sessions.push(session);
      }
      await thread.save();
    }
    const teacher = await User.findById(teacherId).select('name profileImage');
    // Create notification for student (approved or rejected)
    const notificationForStudent = new Notification({
      userId: request.studentId,
      senderId: teacher?._id || teacherId,
      senderName: teacher?.name || 'Teacher',
      profileImage: teacher?.profileImage || '/default-avatar.png',
      type: request.status === 'approved' ? 'request_approved' : 'request_rejected',
      title: request.status === 'approved' ? 'Tuition Request Approved' : 'Tuition Request Rejected',
      message: request.status === 'approved' 
        ? 'has approved your tuition request.'
        : `has rejected your tuition request. ${request.rejectionMessage || ''}`,
      data: {
        requestId: request._id,
        threadId: thread?._id,
      },
      read: false,
    });
    await notificationForStudent.save();
    console.log(`✅ Notification created for student: ${request.studentId}`);

    // Emit notification to student
    if (global.emitToUser) {
      global.emitToUser(
        request.studentId.toString(),
        'new_notification', // NotificationBell listens for this
        {
          _id: notificationForStudent._id.toString(),
          senderId: notificationForStudent.senderId,
          senderName: notificationForStudent.senderName,
          profileImage: notificationForStudent.profileImage,
          type: notificationForStudent.type,
          title: notificationForStudent.title,
          message: notificationForStudent.message,
          data: notificationForStudent.data,
          read: notificationForStudent.read,
          createdAt: notificationForStudent.createdAt,
        }
      );
      console.log(`✅ Emitted new_notification to student: ${request.studentId}`);
    }

    // Emit socket event for approval/rejection (optional, for chat logic)
    if (thread && global.emitToUser) {
      const eventName = request.status === 'approved' ? 'request_approved' : 'request_rejected';
      global.emitToUser(
        request.studentId.toString(),
        eventName,
        {
          requestId: request._id.toString(),
          threadId: thread?._id?.toString() || null,
          senderId: teacher?._id || teacherId,
          senderName: teacher?.name || 'Teacher',
          profileImage: teacher?.profileImage || '/default-avatar.png',
          approvedBy: 'teacher',
          timestamp: Date.now(),
        }
      );
      console.log(`✅ Emitted ${eventName} to studentId: ${request.studentId}`);
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
    const studentId = req.user.id || req.user.userId || req.user._id;
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
    const studentId = req.user.id || req.user.userId || req.user._id;
    const requests = await TeacherRequest.find({ studentId });
    res.json(requests);
  } catch (error) {
    console.error('Error fetching all student requests:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * ✅ Get approved students for a post
 * - Verifies the authenticated teacher owns the post
 * - Returns only approved requests for that post+teacher
 */
exports.getApprovedStudentsForPost = async (req, res) => {
  try {
    const { postId } = req.query;
    const teacherId = req.user.id || req.user.userId || req.user._id; // auth('teacher')

    if (!postId) return res.status(400).json({ message: "postId is required" });

    // ensure the post belongs to this teacher
    const post = await TeacherPost.findOne({ _id: postId, teacher: teacherId }).select('_id');
    if (!post) return res.status(403).json({ message: 'Unauthorized for this post' });

    const requests = await TeacherRequest.find({
      postId,
      teacherId,
      status: "approved",
    }).populate("studentId", "name profileImage");

    res.json(requests);
  } catch (err) {
    console.error("Error fetching approved students:", err);
    res.status(500).json({ message: "Server error" });
  }
};
