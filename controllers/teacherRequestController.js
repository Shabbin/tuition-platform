// controllers/teacherRequestController.js
const TeacherRequest = require('../models/teacherRequest');
const ChatThread = require('../models/chatThread');
const User = require('../models/user');
const ChatMessage = require('../models/chatMessage');
const Notification = require('../models/Notification');
const TeacherPost = require('../models/teacherPost');

// Create a new request (direct or from a post via teacherId + postId)
exports.createRequest = async (req, res) => {
  try {
    const { teacherId, studentId, studentName, postId, topic, subject, message } = req.body;

    const existingRequest = await TeacherRequest.findOne({
      teacherId,
      studentId,
      status: { $in: ['pending', 'approved'] },
    });
    if (existingRequest) {
      return res.status(400).json({
        message: 'You already have an active request for this teacher.',
        existingRequestId: existingRequest._id,
      });
    }

    const newRequest = new TeacherRequest({
      teacherId,
      studentId,
      studentName,
      postId: postId || undefined,
      topic: topic || undefined,
      subject: subject || undefined,
      origin: postId ? 'post' : 'direct',            // ✅ enum-friendly
      message,
      status: 'pending',
      requestedAt: new Date(),
    });
    await newRequest.save();

  const session = {
  subject: newRequest.subject || 'Untitled Subject',
  origin: 'post',                         // ✅ standardized
  originPostId: postId,                   // ✅ link to the post
  status: 'pending',
  startedAt: newRequest.requestedAt,
  requestId: newRequest._id,
};

    const initialMessage = {
      senderId: studentId,
      text: message,
      timestamp: newRequest.requestedAt,
    };

    let thread;
    try {
      thread = await ChatThread.findOne({
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
    } catch (e) {
      // rollback the TeacherRequest so the user can retry, instead of seeing "already active"
      await TeacherRequest.deleteOne({ _id: newRequest._id }).catch(() => {});
      throw e;
    }

    // Notify teacher
    const student = await User.findById(studentId).select('name profileImage');
    const notificationForTeacher = new Notification({
      userId: teacherId,
      senderId: studentId,
      senderName: student?.name || 'Someone',
      profileImage: student?.profileImage || '/default-avatar.png',
      type: 'tuition_request',
      title: 'New Tuition Request',
      message: `${student?.name || 'Someone'} sent you a tuition request.`,
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

      const populatedParticipants = await User.find({
        _id: { $in: [studentId, teacherId] },
      }).select('name profileImage role');

      const payload = {
        request: newRequest,
        threadId: thread._id.toString(),
        studentId: studentId.toString(),
        studentName: student?.name || 'Student',
        teacherId: teacherId.toString(),
        teacherName:
          populatedParticipants.find(u => u._id.toString() === teacherId.toString())?.name ||
          'Teacher',
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

// Create request from a post (server derives teacherId)
exports.createRequestFromPost = async (req, res) => {
  try {
    const { postId } = req.params;
    const { message, subject } = req.body;
    const studentId = req.user.id;

    if (!message || !message.trim()) {
      return res.status(400).json({ message: 'Message is required.' });
    }

    const post = await TeacherPost.findById(postId).select('teacher title subjects');
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const teacherId = post.teacher;

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

    const studentDoc = await User.findById(studentId).select('name');
    const newRequest = new TeacherRequest({
      teacherId,
      studentId,
      studentName: studentDoc?.name || 'Student',
      postId,
      subject: subject || (Array.isArray(post.subjects) && post.subjects[0]) || undefined,
      origin: 'post',                                 // ✅ enum-friendly
      message,
      status: 'pending',
      requestedAt: new Date(),
    });
    await newRequest.save();

    const session = {
      subject: newRequest.subject || 'Untitled Subject',
      origin: 'post',                                 // ✅ enum-friendly
      status: 'pending',
      startedAt: newRequest.requestedAt,
      requestId: newRequest._id,
    };
    const initialMessage = {
      senderId: studentId,
      text: message,
      timestamp: newRequest.requestedAt,
    };

    let thread;
    try {
      thread = await ChatThread.findOne({
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
    } catch (e) {
      await TeacherRequest.deleteOne({ _id: newRequest._id }).catch(() => {});
      throw e;
    }

    // Notify teacher
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

// Approve / reject request
exports.updateRequestStatus = async (req, res) => {
  try {
    const { id, action } = req.params;
    const { rejectionMessage } = req.body || {};
    const teacherId = req.user.id || req.user.userId || req.user._id;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ message: 'Invalid action' });
    }

    const request = await TeacherRequest.findOne({ _id: id, teacherId });
    if (!request) return res.status(404).json({ message: 'Request not found or unauthorized' });

    request.status = action === 'approve' ? 'approved' : 'rejected';
    if (action === 'reject' && rejectionMessage) request.rejectionMessage = rejectionMessage;
    await request.save();

    let thread = await ChatThread.findOne({
      participants: { $all: [request.studentId, request.teacherId] },
      'sessions.requestId': request._id,
    });

    if (request.status === 'rejected' && thread) {
      await ChatMessage.deleteMany({ threadId: thread._id });
      await ChatThread.deleteOne({ _id: thread._id });
      thread = null;
    }

    if (request.status === 'approved') {
      const session = {
        subject: request.subject || 'Untitled Subject',
        origin: request.postId ? 'post' : 'direct',    // ✅ enum-friendly
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
    const notificationForStudent = new Notification({
      userId: request.studentId,
      senderId: teacher?._id || teacherId,
      senderName: teacher?.name || 'Teacher',
      profileImage: teacher?.profileImage || '/default-avatar.png',
      type: request.status === 'approved' ? 'request_approved' : 'request_rejected',
      title: request.status === 'approved' ? 'Tuition Request Approved' : 'Tuition Request Rejected',
      message:
        request.status === 'approved'
          ? 'has approved your tuition request.'
          : `has rejected your tuition request. ${request.rejectionMessage || ''}`,
      data: { requestId: request._id, threadId: thread?._id },
      read: false,
    });
    await notificationForStudent.save();

    if (global.emitToUser) {
      global.emitToUser(request.studentId.toString(), 'new_notification', {
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
      });

      const eventName = request.status === 'approved' ? 'request_approved' : 'request_rejected';
      global.emitToUser(request.studentId.toString(), eventName, {
        requestId: request._id.toString(),
        threadId: thread?._id?.toString() || null,
        senderId: teacher?._id || teacherId,
        senderName: teacher?.name || 'Teacher',
        profileImage: teacher?.profileImage || '/default-avatar.png',
        approvedBy: 'teacher',
        timestamp: Date.now(),
      });
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
