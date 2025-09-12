// server/controllers/teacherPostController.js
const TeacherPost = require('../models/teacherPost');
const User = require('../models/user');
const { flattenSubjects } = require('../utils/normalize');
const { isMeaningfulText } = require('../utils/isMeaningfulText');
const { validateEducationPath } = require('../utils/validateEducationPath');
const PostViewEvent = require('../models/postView');
const { checkDuplicateSubjectCombination } = require('../utils/checkDuplicateSubjectCombination');
const { getIO } = require('../socketUtils/socket');

const mongoose = require('mongoose');
const crypto = require('crypto');

// ⬇️ Cloudinary utils
const {
  cloudinary,                  // ✅ now used to build signed video URLs
  uploadBuffer,
  buildVideoUrl,
  CLOUDINARY_BASE_FOLDER,
  CLOUDINARY_VIDEOS_ACCESS,
} = require('../utils/cloudinary');

/**
 * Attach a playable `videoUrl` to a post object.
 * - If videos are `authenticated` and we have `videoPublicId`, generate a signed URL.
 * - If `videoFile` is already a full URL (public/legacy), pass it through.
 * - Else `videoUrl` is empty.
 */
function withSignedVideo(postDoc) {
  if (!postDoc) return postDoc;
  const obj = typeof postDoc.toObject === 'function' ? postDoc.toObject() : postDoc;

  const accessMode = (CLOUDINARY_VIDEOS_ACCESS || 'authenticated').toLowerCase();

  if (accessMode === 'authenticated' && obj.videoPublicId) {
    // 🔐 Signed delivery for authenticated assets
    obj.videoUrl = cloudinary.url(obj.videoPublicId, {
      resource_type: 'video',
      type: 'authenticated',
      sign_url: true,
      secure: true,
      format: 'mp4',
      transformation: [{ quality: 'auto' }],
      // version is optional; include if you add it to the schema later
      // version: obj.videoVersion,
    });
  } else if (typeof obj.videoFile === 'string' && obj.videoFile.startsWith('http')) {
    // 🌐 Public (or legacy absolute) URL
    obj.videoUrl = obj.videoFile;
  } else {
    obj.videoUrl = '';
  }
  return obj;
}

// =========================
// CREATE POST
// =========================
const createPost = async (req, res) => {
  try {
    let {
      title,
      description,
      subjects,
      location,
      language,
      hourlyRate,
      youtubeLink,
      tags,
      educationSystem,
      board,
      level,
      subLevel,
      group,
    } = req.body;

    subjects = Array.isArray(subjects) ? subjects : [subjects];
    tags = Array.isArray(tags) ? tags : [tags];

    const normalizedSubjects = flattenSubjects(subjects).map(s => s.trim()).sort();
    const normalizedTags = flattenSubjects(tags).map(t => t.trim()).filter(Boolean);

    const eduValidation = validateEducationPath({
      educationSystem,
      board,
      level,
      group,
      subjects: normalizedSubjects,
      subLevel,
    });
    if (!eduValidation.valid) {
      return res.status(400).json({ message: eduValidation.message });
    }

    const requiresBoard = educationSystem === 'English-Medium' || educationSystem === 'University-Admission';
    if (requiresBoard && (!board || board.trim() === '')) {
      return res.status(400).json({
        message: `${educationSystem === 'English-Medium' ? 'Board' : 'Track'} is required for ${educationSystem}.`,
      });
    }

    const teacherId = req.user.id;
    const teacher = await User.findById(teacherId);
    if (!teacher || teacher.role !== 'teacher' || !teacher.isEligible) {
      return res.status(403).json({ message: 'Not authorized to post' });
    }

    const comboExists = await checkDuplicateSubjectCombination(
      TeacherPost, teacherId, normalizedSubjects
    );
    if (comboExists.exists) {
      return res.status(400).json({
        message: `You have already created a post with the same subject combination: ${normalizedSubjects.join(', ')}`,
      });
    }

    if (!isMeaningfulText(description)) {
      return res.status(400).json({ message: 'Please provide meaningful description content.' });
    }

    // ⬇️ Upload video to Cloudinary (if provided)
    let videoFile = '';     // for public delivery or legacy compatibility
    let videoPublicId = ''; // for authenticated delivery & signing
    if (req.file) {
      const folder = `${CLOUDINARY_BASE_FOLDER}/posts/videos`;
      const public_id = `${teacherId}-${crypto.randomBytes(8).toString('hex')}`;

      const accessMode = (CLOUDINARY_VIDEOS_ACCESS || 'authenticated').toLowerCase();

      const uploaded = await uploadBuffer(req.file.buffer, {
        folder,
        public_id,
        resource_type: 'video',
        overwrite: true,
        access_mode: accessMode, // 'public' or 'authenticated'
        transformation: [{ quality: 'auto' }],
      });

      videoPublicId = uploaded.public_id;

      if (accessMode === 'public') {
        // Direct, cacheable public URL
        videoFile = buildVideoUrl(uploaded.public_id, { format: 'mp4', access: 'public' });
      } else {
        // Keep a reference; actual playable URL will be signed per request
        videoFile = uploaded.secure_url; // (upload URL, not directly usable without signing)
      }
    }

    const postData = {
      teacher: teacherId,
      title,
      description,
      subjects: normalizedSubjects,
      location,
      language,
      hourlyRate,
      videoFile,
      videoPublicId,
      youtubeLink,
      tags: normalizedTags,
      educationSystem,
      board,
      level,
      subLevel,
      group,
    };

    const post = new TeacherPost(postData);
    await post.save();

    res.status(201).json({ message: 'Post created successfully', post: withSignedVideo(post) });

  } catch (err) {
    console.error('Create post error:', err);
    res.status(500).json({ message: 'Error creating post' });
  }
};

// =========================
// UPDATE POST
// =========================
const updatePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const teacherId = req.user.id;

    const post = await TeacherPost.findById(postId);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    if (post.teacher.toString() !== teacherId) {
      return res.status(403).json({ message: 'You are not authorized to update this post' });
    }

    let {
      title,
      description,
      subjects,
      location,
      language,
      hourlyRate,
      youtubeLink,
      tags,
      educationSystem,
      board,
      level,
      subLevel,
      group,
    } = req.body;

    subjects = Array.isArray(subjects) ? subjects : [subjects];
    tags = Array.isArray(tags) ? tags : [tags];

    const normalizedSubjects = flattenSubjects(subjects).map(s => s.trim()).sort();
    const normalizedTags = flattenSubjects(tags).map(t => t.trim());

    const eduValidation = validateEducationPath({
      educationSystem,
      board,
      level,
      group,
      subjects: normalizedSubjects,
      subLevel,
    });
    if (!eduValidation.valid) {
      return res.status(400).json({ message: eduValidation.message });
    }

    if (!isMeaningfulText(description)) {
      return res.status(400).json({ message: 'Please provide meaningful description content.' });
    }

    const { exists, matchedSubjects } = await checkDuplicateSubjectCombination(
      TeacherPost, teacherId, normalizedSubjects, postId
    );
    if (exists) {
      return res.status(400).json({
        message: `You have already created another post with the same subject combination: ${matchedSubjects.join(', ')}`,
      });
    }

    const updates = {
      title,
      description,
      subjects: normalizedSubjects,
      location,
      language,
      hourlyRate,
      youtubeLink,
      tags: normalizedTags,
      educationSystem,
      board,
      level,
      subLevel,
      group,
    };

    // ⬇️ If a new video is uploaded, push to Cloudinary and update both fields
    if (req.file) {
      const folder = `${CLOUDINARY_BASE_FOLDER}/posts/videos`;
      const public_id = `${teacherId}-${crypto.randomBytes(8).toString('hex')}`;

      const accessMode = (CLOUDINARY_VIDEOS_ACCESS || 'authenticated').toLowerCase();

      const uploaded = await uploadBuffer(req.file.buffer, {
        folder,
        public_id,
        resource_type: 'video',
        overwrite: true,
        access_mode: accessMode,
        transformation: [{ quality: 'auto' }],
      });

      updates.videoPublicId = uploaded.public_id;
      updates.videoFile =
        accessMode === 'public'
          ? buildVideoUrl(uploaded.public_id, { format: 'mp4', access: 'public' })
          : uploaded.secure_url;
    }

    await TeacherPost.findByIdAndUpdate(postId, updates, { new: true });
    res.status(200).json({ message: 'Post updated successfully' });

  } catch (err) {
    console.error('Update post error:', err.message);
    res.status(500).json({ message: 'Error updating post' });
  }
};

// =========================
// GET ALL POSTS
// =========================
const getAllPosts = async (req, res) => {
  try {
    const subjectTags = req.query.subject;
    const teacherIds = req.query.teacher;

    const selectedSubjects = Array.isArray(subjectTags)
      ? subjectTags
      : subjectTags ? [subjectTags] : [];

    const selectedTeachers = Array.isArray(teacherIds)
      ? teacherIds
      : teacherIds ? [teacherIds] : [];

    const filter = {
      ...(selectedSubjects.length && { subjects: { $in: selectedSubjects } }),
      ...(selectedTeachers.length && { teacher: { $in: selectedTeachers } })
    };

    const posts = await TeacherPost.find(filter)
      .populate('teacher', 'name email isEligible profileImage location language');

    const eligiblePosts = posts
      .filter(post => post.teacher?.isEligible)
      .map(p => withSignedVideo(p));

    res.status(200).json(eligiblePosts);
  } catch (err) {
    console.error('Fetch posts error:', err.message);
    res.status(500).json({ message: 'Error fetching posts' });
  }
};

// =========================
// GET POST BY ID
// =========================
const getPostById = async (req, res) => {
  try {
    const { postId } = req.params;

    let post = await TeacherPost.findById(postId)
      .populate('teacher', 'name email isEligible profileImage');

    if (!post || !post.teacher?.isEligible) {
      return res.status(404).json({ message: 'Post not found or teacher not eligible' });
    }

    post = withSignedVideo(post);

    res.status(200).json(post);
  } catch (err) {
    console.error('Fetch post by ID error:', err.message);
    res.status(500).json({ message: 'Error fetching post' });
  }
};

// =========================
// GET POSTS BY TEACHER
// =========================
const getPostsByTeacher = async (req, res) => {
  try {
    const { teacherId } = req.params;

    const posts = await TeacherPost.find({ teacher: teacherId });

    res.status(200).json(posts);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// =========================
// GET TEACHER POST BY SUBJECT
// =========================
const getTeacherPostBySubject = async (req, res) => {
  const { teacherId } = req.params;
  const subjectName = req.params.subjectName?.trim().toLowerCase();

  try {
    const post = await TeacherPost.findOne({
      teacher: teacherId,
      subjects: { $elemMatch: { $regex: new RegExp(`^${subjectName}$`, 'i') } },
    }).populate('teacher', 'name profileImage isEligible');

    if (!post || !post.teacher || !post.teacher.isEligible) {
      return res.status(404).json({ message: 'Post not found or teacher not eligible' });
    }

    res.status(200).json(post);
  } catch (err) {
    console.error('Error fetching teacher subject post:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// =========================
// DELETE POST
// =========================
const deleteTeacherPost = async (req, res) => {
  try {
    const postId = req.params.id;

    const post = await TeacherPost.findById(postId);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    if (!post.teacher || typeof post.teacher.toString !== 'function') {
      return res.status(400).json({ message: 'Invalid teacher reference' });
    }

    await TeacherPost.findByIdAndDelete(postId);

    res.status(200).json({ message: 'Post deleted successfully' });
  } catch (error) {
    console.error('Error deleting post:', error);
    res.status(500).json({ message: 'Server error deleting post' });
  }
};

// =========================
// GET MY POSTS
// =========================
const getMyPosts = async (req, res) => {
  try {
    const posts = await TeacherPost.find({ teacher: req.user.id }).sort({ createdAt: -1 });
    res.json(posts);
  } catch (err) {
    console.error('Error fetching my posts:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

//=========================
// INCREMENT POST VIEW
//=========================
async function incrementPostView(req, res) {
  try {
    const postId = req.params.postId;
    const userId = req.user?.id || null;
    const visitorId = req.cookies?.visitorId || null;

    if (!postId || !mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({ error: 'Invalid post ID' });
    }

    const cooldownMinutes = 60;
    const cooldownDate = new Date(Date.now() - cooldownMinutes * 60 * 1000);

    const recentView = await PostViewEvent.findOne({
      postId,
      createdAt: { $gte: cooldownDate },
      $or: [{ userId: userId || null }, { visitorId: visitorId || null }],
    });

    if (recentView) {
      const post = await TeacherPost.findById(postId).select('viewsCount');
      if (!post) return res.status(404).json({ error: 'Post not found' });
      return res.json({
        viewsCount: post.viewsCount,
        viewEventTimestamp: recentView.createdAt,
        message: 'View already counted recently',
      });
    }

    const updatedPost = await TeacherPost.findByIdAndUpdate(
      postId,
      { $inc: { viewsCount: 1 } },
      { new: true, select: 'teacher title viewsCount' }
    );

    if (!updatedPost) return res.status(404).json({ error: 'Post not found' });

    const newViewEvent = await PostViewEvent.create({
      postId: updatedPost._id,
      userId,
      visitorId,
    });

    if (updatedPost.teacher) {
      const io = getIO();
      io.to(updatedPost.teacher.toString()).emit('post_view_event', {
        postId: updatedPost._id.toString(),
        postTitle: updatedPost.title,
        timestamp: newViewEvent.createdAt,
        viewsCount: updatedPost.viewsCount,
      });
    }

    res.json({
      viewsCount: updatedPost.viewsCount,
      viewEventTimestamp: newViewEvent.createdAt,
    });
  } catch (error) {
    console.error('Error incrementing post views:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

//..............................................
//GET RECENT VIEWS (WILL COME TO THIS PART LATER)
//..............................................
async function getUniqueViewCounts(postIds) {
  const objectIdPostIds = postIds.map(id => new mongoose.Types.ObjectId(id));

  const uniqueViewCounts = await PostViewEvent.aggregate([
    { $match: { postId: { $in: objectIdPostIds } } },
    {
      $group: {
        _id: "$postId",
        uniqueUsers: { $addToSet: "$userId" },
      },
    },
    {
      $project: {
        postId: "$_id",
        uniqueViewCount: {
          $size: {
            $filter: {
              input: "$uniqueUsers",
              as: "userId",
              cond: { $ne: ["$$userId", null] },
            },
          },
        },
      },
    },
  ]);

  const result = {};
  uniqueViewCounts.forEach(item => {
    result[item.postId.toString()] = item.uniqueViewCount;
  });

  return result;
}

async function getRecentViewEvents(req, res) {
  try {
    const { teacherId } = req.params;

    const teacherPosts = await TeacherPost.find({ teacher: teacherId }).select('_id title');
    const postIds = teacherPosts.map(p => p._id);

    const uniqueViewCounts = await getUniqueViewCounts(postIds);

    const recentEvents = await PostViewEvent.find({ postId: { $in: postIds } })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate('postId', 'title')
      .lean();

    const postsWithUpdatedViews = teacherPosts.map(post => ({
      ...post.toObject(),
      viewsCount: uniqueViewCounts[post._id.toString()] || 0,
    }));

    res.json({
      events: recentEvents,
      posts: postsWithUpdatedViews,
    });

  } catch (err) {
    console.error("❌ Error fetching recent view events:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

module.exports = {
  createPost,
  updatePost,
  getAllPosts,
  getPostById,
  getPostsByTeacher,
  getTeacherPostBySubject,
  deleteTeacherPost,
  getMyPosts,
  incrementPostView,
  getRecentViewEvents
};
