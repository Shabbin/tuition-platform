// controllers/authController.js
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const streamifier = require('streamifier');
const User = require('../models/user'); // keep your existing path
const cloudinary = require('../config/cloudinary');

const generateToken = (user) => {
  return jwt.sign(
    { id: user._id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

// helper: upload a buffer to cloudinary
const uploadToCloudinary = (fileBuffer, folder) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (err, result) => {
        if (err) return reject(err);
        resolve(result); // has secure_url and public_id
      }
    );
    streamifier.createReadStream(fileBuffer).pipe(stream);
  });
};

const register = async (req, res) => {
  try {
    const { name, email, password, role, age } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    if (role === 'teacher') {
      if (!age) return res.status(400).json({ message: 'Age is required for teachers' });
      if (isNaN(age) || Number(age) < 20) {
        return res.status(400).json({ message: 'Teachers must be at least 20 years old' });
      }
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // ⬇️ NEW: if avatar file present, upload to Cloudinary
    let profileImage = null;
    let profileImagePublicId = '';

    if (req.file && req.file.buffer) {
      const folder =
        (process.env.CLOUDINARY_BASE_FOLDER || 'tuition-platform') + '/avatars';
      const result = await uploadToCloudinary(req.file.buffer, folder);
      profileImage = result.secure_url;
      profileImagePublicId = result.public_id;
    }

    const user = new User({
      name,
      email,
      password: hashedPassword,
      role,
      age: role === 'teacher' ? age : undefined,
      profileImage,
      profileImagePublicId,
    });

    await user.save();

    const token = generateToken(user);

    res.cookie('token', token, {
      httpOnly: true,
      secure: false,  // keep false for localhost; set true behind HTTPS in prod
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        age: user.age,
        isEligible: user.isEligible,
        profileImage: user.profileImage,
        profileImagePublicId: user.profileImagePublicId,
        coverImage: user.coverImage,
        coverImagePublicId: user.coverImagePublicId,
      },
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ message: 'Server error during registration' });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: 'Invalid email or password' });

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) return res.status(401).json({ message: 'Invalid email or password' });

    const token = generateToken(user);

    res.cookie('token', token, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(200).json({
      message: 'Login successful',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        age: user.age,
        isEligible: user.isEligible,
        profileImage: user.profileImage,
        profileImagePublicId: user.profileImagePublicId,
        coverImage: user.coverImage,
        coverImagePublicId: user.coverImagePublicId,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error during login' });
  }
};

module.exports = { register, login };
