const TeacherPost = require('../models/teacherPost');
const User = require('../models/user');

// Create a post (only for eligible teachers)
const createPost = async (req, res) => {
  try {
    const {
      title,
      description,
      subjects, // Expecting an array
      location,
      language,
      hourlyRate,
      youtubeLink
    } = req.body;

    const teacherId = req.user.userId;

    const teacher = await User.findById(teacherId);
    if (!teacher || teacher.role !== 'teacher' || !teacher.isEligible) {
      return res.status(403).json({ message: 'Not authorized to post' });
    }

    // Handle file upload (optional)
    let videoUrl = null;
    if (req.file) {
      videoUrl = `/uploads/videos/${req.file.filename}`;
    }

    const post = new TeacherPost({
      teacher: teacherId,
      title,
      description,
      subjects: Array.isArray(subjects) ? subjects : [subjects],
      location,
      language,
      hourlyRate,
      videoUrl,
      youtubeLink
    });

    await post.save();
    res.status(201).json({ message: 'Post created', post });

  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Error creating post' });
  }
};

// Students can view all posts from eligible teachers
const getAllPosts = async (req, res) => {
  try {
    const posts = await TeacherPost.find()
      .populate('teacher', 'name email isEligible profileImage')
      .exec();

    const filtered = posts.filter(post => post.teacher.isEligible);

    res.status(200).json(filtered);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Error fetching posts' });
  }
};

module.exports = {
  createPost,
  getAllPosts
};
