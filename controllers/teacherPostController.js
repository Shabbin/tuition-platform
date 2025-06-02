const TeacherPost = require('../models/teacherPost');
const User = require('../models/user');

// Helper to safely normalize incoming arrays
const normalizeArrayField = (field) => {
  if (Array.isArray(field)) {
    try {
      if (field.length === 1 && typeof field[0] === 'string' && field[0].trim().startsWith('[')) {
        const parsed = JSON.parse(field[0]);
        return Array.isArray(parsed) ? parsed : [parsed];
      }
    } catch (err) {
      return field;
    }
    return field;
  }

  if (typeof field === 'string') {
    try {
      if (field.trim().startsWith('[')) {
        const parsed = JSON.parse(field);
        return Array.isArray(parsed) ? parsed : [parsed];
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
    let subjectTags = req.query.subject;
    const selectedSubjects = Array.isArray(subjectTags)
      ? subjectTags
      : subjectTags
      ? [subjectTags]
      : [];

    const filter = selectedSubjects.length
      ? { subjects: { $in: selectedSubjects } }
      : {};

    // 🔧 CLEANUP MALFORMED SUBJECTS - one-time fix
    const allPosts = await TeacherPost.find();
    for (const post of allPosts) {
      const fixedSubjects = post.subjects.flatMap(sub => {
        try {
          const parsed = JSON.parse(sub);
          return Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          return [sub];
        }
      });

      if (JSON.stringify(post.subjects) !== JSON.stringify(fixedSubjects)) {
        post.subjects = fixedSubjects;
        await post.save();
      }
    }

    // ⬇ Do not change this line as requested
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
