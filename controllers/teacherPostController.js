const TeacherPost = require('../models/teacherPost');
const User = require('../models/user');
const { flattenSubjects } = require('../utils/normalize');
const isMeaningfulText = require('../utils/isMeaningfulText');
const { validateSubjectsHeuristically } = require('../utils/validateSubjectHeuristic');
// =========================
// CREATE TEACHER POST
// =========================
const createPost = async (req, res) => {
  try {
    const {
      title,
      description,
      subjects,
      location,
      language,
      hourlyRate,
      youtubeLink,
      tags,
      postType,
      topicDetails
    } = req.body;

    const teacherId = req.user.userId;
    const teacher = await User.findById(teacherId);

    if (!teacher || teacher.role !== 'teacher' || !teacher.isEligible) {
      return res.status(403).json({ message: 'Not authorized to post' });
    }

    console.log('Creating post:', { title, description, subjects, tags });

    if (!isMeaningfulText(description)) {
      return res.status(400).json({ message: 'Description appears to be nonsensical or gibberish. Please provide meaningful content.' });
    }

    const invalidSubjects = validateSubjectsHeuristically(subjects, title, description);
    const invalidTags = validateSubjectsHeuristically(tags || [], title, description);

    console.log('Invalid subjects:', invalidSubjects, 'Invalid tags:', invalidTags);

    if (invalidSubjects.length > 0 || invalidTags.length > 0) {
      return res.status(400).json({
        message: `The following subject(s) or tag(s) don't seem relevant to your content: ${[...invalidSubjects, ...invalidTags].join(', ')}. Please revise.`
      });
    }

    let videoUrl = null;
    if (req.file) {
      videoUrl = `/uploads/videos/${req.file.filename}`;
    }

    const postData = {
      teacher: teacherId,
      postType,
      title,
      description,
      subjects: flattenSubjects(subjects),
      location,
      language,
      hourlyRate,
      videoFile: videoUrl || '',
      youtubeLink,
      tags: flattenSubjects(tags || []),
      topicDetails: postType === 'topic' ? topicDetails : undefined
    };

    const post = new TeacherPost(postData);
    await post.save();

    res.status(201).json({ message: 'Post created', post });
  } catch (err) {
    console.error('Create post error:', err.message);
    res.status(500).json({ message: 'Error creating post' });
  }
};



// =========================
// UPDATE POST
// =========================
const updatePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const teacherId = req.user.userId;

    const post = await TeacherPost.findById(postId);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    if (post.teacher.toString() !== teacherId) {
      return res.status(403).json({ message: 'You are not authorized to update this post' });
    }

    const {
      title,
      description,
      subjects,
      location,
      language,
      hourlyRate,
      youtubeLink,
      tags,
      postType,
      topicDetails
    } = req.body;

    console.log('Updating post:', { title, description, subjects, tags });

    if (!isMeaningfulText(description)) {
      return res.status(400).json({ message: 'Description appears to be nonsensical or gibberish. Please provide meaningful content.' });
    }

    const invalidSubjects = validateSubjectsHeuristically(subjects, title, description);
    const invalidTags = validateSubjectsHeuristically(tags || [], title, description);

    console.log('Invalid subjects:', invalidSubjects, 'Invalid tags:', invalidTags);

    if (invalidSubjects.length > 0 || invalidTags.length > 0) {
      return res.status(400).json({
        message: `The following subject(s) or tag(s) don't seem relevant to your content: ${[...invalidSubjects, ...invalidTags].join(', ')}. Please revise.`
      });
    }

    const updates = {
      postType,
      title,
      description,
      subjects: flattenSubjects(subjects),
      location,
      language,
      hourlyRate,
      youtubeLink,
      tags: flattenSubjects(tags || []),
      topicDetails: postType === 'topic' ? topicDetails : undefined
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
// The rest of your controller stays unchanged
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
      ...(selectedTeachers.length && { teacher: { $in: selectedTeachers } }),
    };

    const posts = await TeacherPost.find(filter)
      .populate('teacher', 'name email isEligible profileImage location language')
      .exec();

    const eligiblePosts = posts.filter(post => post.teacher?.isEligible);

    res.status(200).json(eligiblePosts);
  } catch (err) {
    console.error('Fetch posts error:', err.message);
    res.status(500).json({ message: 'Error fetching posts' });
  }
};

const getTeacherPostBySubject = async (req, res) => {
  const { teacherId } = req.params;
  const subjectName = req.params.subjectName?.trim().toLowerCase();

  try {
    const post = await TeacherPost.findOne({
      teacher: teacherId,
      subjects: { $elemMatch: { $regex: new RegExp(`^${subjectName}$`, 'i') } },
    }).populate('teacher', 'name profileImage isEligible');

    if (!post || !post.teacher || !post.teacher.isEligible) {
      console.log('No post or teacher not eligible:', { teacherId, subjectName });
      return res.status(404).json({ message: 'Post not found or teacher not eligible' });
    }

    res.status(200).json(post);
  } catch (err) {
    console.error('Error fetching teacher subject post:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

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

const deleteTeacherPost = async (req, res) => {
  try {
    const postId = req.params.id;

    const post = await TeacherPost.findById(postId);

    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    if (!post.teacher || typeof post.teacher.toString !== 'function') {
      return res.status(400).json({ message: 'Post is missing valid teacher reference' });
    }

    await TeacherPost.findByIdAndDelete(postId);

    res.status(200).json({ message: 'Post deleted successfully' });
  } catch (error) {
    console.error('Error deleting post:', error);
    res.status(500).json({ message: 'Server error deleting post' });
  }
};

const getMyPosts = async (req, res) => {
  try {
    const posts = await TeacherPost.find({ teacher: req.user.userId }).sort({ createdAt: -1 });
    res.json(posts);
  } catch (err) {
    console.error('Error fetching my posts:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  createPost,
  getAllPosts,
  getTeacherPostBySubject,
  getPostsByTeacher,
  getPostById,
  updatePost,
  deleteTeacherPost,
  getMyPosts
};
