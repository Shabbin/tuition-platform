const TeacherPost = require('../models/teacherPost');
const User = require('../models/user');
const { flattenSubjects } = require('../utils/normalize');
const { isMeaningfulText } = require('../utils/isMeaningfulText');
const { validateEducationPath } = require('../utils/validateEducationPath');
const { checkDuplicateSubjectCombination } = require('../utils/checkDuplicateSubjectCombination');

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
    console.log("is an array?", subjects);
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
      return res.status(400).json({ message: `${educationSystem === 'English-Medium' ? 'Board' : 'Track'} is required for ${educationSystem}.` });
    }

    const teacherId = req.user.id;  // <-- changed here
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

    const videoUrl = req.file ? `/uploads/videos/${req.file.filename}` : '';

    const postData = {
      teacher: teacherId,
      title,
      description,
      subjects: normalizedSubjects,
      location,
      language,
      hourlyRate,
      videoFile: videoUrl,
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

    res.status(201).json({ message: 'Post created successfully', post });

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
    const teacherId = req.user.id; // <-- changed here

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
      TeacherPost,
      teacherId,
      normalizedSubjects,
      postId
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

    if (req.file) {
      updates.videoFile = `/uploads/videos/${req.file.filename}`;
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

    const eligiblePosts = posts.filter(post => post.teacher?.isEligible);

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

    const post = await TeacherPost.findById(postId)
      .populate('teacher', 'name email isEligible profileImage');

    if (!post || !post.teacher?.isEligible) {
      return res.status(404).json({ message: 'Post not found or teacher not eligible' });
    }

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
    const posts = await TeacherPost.find({ teacher: req.user.id }).sort({ createdAt: -1 }); // <-- changed here
    res.json(posts);
  } catch (err) {
    console.error('Error fetching my posts:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  createPost,
  updatePost,
  getAllPosts,
  getPostById,
  getPostsByTeacher,
  getTeacherPostBySubject,
  deleteTeacherPost,
  getMyPosts
};
