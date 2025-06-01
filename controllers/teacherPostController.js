const TeacherPost = require('../models/teacherPost');
const User = require('../models/user');

// Helper to safely normalize incoming arrays
const normalizeArrayField = (field) => {
  if (Array.isArray(field)) return field;
  if (typeof field === 'string') {
    try {
      // Handle JSON string or comma-separated
      if (field.trim().startsWith('[')) {
        return JSON.parse(field);
      } else {
        return field.split(',').map(f => f.trim());
      }
    } catch (err) {
      return [field];
    }
  }
  return [field];
};

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
      tags
    } = req.body;

    const teacherId = req.user.userId;

    const teacher = await User.findById(teacherId);
    if (!teacher || teacher.role !== 'teacher' || !teacher.isEligible) {
      return res.status(403).json({ message: 'Not authorized to post' });
    }

    let videoUrl = null;
    if (req.file) {
      videoUrl = `/uploads/videos/${req.file.filename}`;
    }

    const post = new TeacherPost({
      teacher: teacherId,
      title,
      description,
      subjects: normalizeArrayField(subjects),
      location,
      language,
      hourlyRate,
      videoUrl,
      youtubeLink,
      tags: normalizeArrayField(tags),
    });

    await post.save();
    res.status(201).json({ message: 'Post created', post });

  } catch (err) {
    console.error('Create post error:', err.message);
    res.status(500).json({ message: 'Error creating post' });
  }
};

// =========================
// GET ALL POSTS
// =========================
const getAllPosts = async (req, res) => {
  try {
    const tags = req.query.tag;
    let filter = {};

    if (tags) {
      const selectedTags = Array.isArray(tags) ? tags : [tags];
      filter.subjects = { $in: selectedTags };
    }

    const posts = await TeacherPost.find(filter)
      .populate('teacher', 'name email isEligible profileImage')
      .exec();

    const filtered = posts.filter(post => post.teacher.isEligible);

    res.status(200).json(filtered);
  } catch (err) {
    console.error('Fetch posts error:', err.message);
    res.status(500).json({ message: 'Error fetching posts' });
  }
};

module.exports = {
  createPost,
  getAllPosts
};
