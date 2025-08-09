// controllers/authController.js

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/user');

const generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      email: user.email,
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
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

    const profileImage = req.file
      ? `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`
      : null;

    const user = new User({
      name,
      email,
      password: hashedPassword,
      role,
      age: role === 'teacher' ? age : undefined,
      profileImage,
    });

    await user.save();

    const token = generateToken(user);

res.cookie('token', token, {
  httpOnly: true,
  secure: false,        // must be false on localhost (no HTTPS)
  sameSite: 'lax',      // lax is best for dev, strict blocks cross-site cookies
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
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
        coverImage: user.coverImage,
      },
    });
  } catch (err) {
    console.error('Register error:', err.message);
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
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = generateToken(user);

  res.cookie('token', token, {
  httpOnly: true,
  secure: false,         // ✅ must be false for localhost
  sameSite: 'Lax',       // ✅ this allows it to work across localhost ports
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
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
        coverImage: user.coverImage,
      },
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ message: 'Server error during login' });
  }
};

module.exports = { register, login };
