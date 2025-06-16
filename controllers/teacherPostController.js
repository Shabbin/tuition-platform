const TeacherPost = require('../models/teacherPost');
const User = require('../models/user');
const Post = require('../models/teacherPost');
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

    const updates = {
      title: req.body.title,
      description: req.body.description,
      subjects: normalizeArrayField(req.body.subjects),
      location: req.body.location,
      language: req.body.language,
      hourlyRate: req.body.hourlyRate,
      youtubeLink: req.body.youtubeLink,
      tags: normalizeArrayField(req.body.tags)
    };

    await TeacherPost.findByIdAndUpdate(postId, updates, { new: true });
    res.status(200).json({ message: 'Post updated successfully' });

  } catch (err) {
    console.error('Update post error:', err.message);
    res.status(500).json({ message: 'Error updating post' });
  }
};
// DELETE /api/posts/:id
const deleteTeacherPost = async (req, res) => {
  try {
    const postId = req.params.id;

    const post = await Post.findById(postId);

    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    // Ensure teacher field exists before comparing
   if (!post.teacher || typeof post.teacher.toString !== 'function') {
  return res.status(400).json({ message: 'Post is missing valid teacher reference' });
}

    await Post.findByIdAndDelete(postId);

    res.status(200).json({ message: 'Post deleted successfully' });
  } catch (error) {
    console.error('Error deleting post:', error);
    res.status(500).json({ message: 'Server error deleting post' });
  }
};
const getMyPosts = async (req, res) => {
  try {
    const posts = await Post.find({ teacher: req.user.userId }).sort({ createdAt: -1 });
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
