const TeacherPost = require('../models/teacherPost');
const User = require('../models/user');

// Create a post (only for eligible teachers)
const createPost = async (req, res) => {
  try {
    const { title, subject, description } = req.body;
    const teacherId = req.user.userId;

    const teacher = await User.findById(teacherId);
    if (!teacher || teacher.role !== 'teacher' || !teacher.isEligible) {
      return res.status(403).json({ message: 'Not authorized to post' });
    }

    const post = new TeacherPost({
      teacher: teacherId,
      title,
      subject,
      description
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
      .populate('teacher', 'name email isEligible profileImage') // 👈 added profileImage
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
