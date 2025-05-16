const User = require('../models/user');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const register = async (req, res) => {
  try {
    const { name, email, password, role,age } = req.body;
    // const {profileImage} = req.file ? req.file.path : null;
    // Basic validation
    if (!name || !email || !password || (role === 'teacher' && !age)) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    if (role === 'teacher') {
      if (!age) {
        return res.status(400).json({ message: 'Age is required for teachers' });
      }
      if (parseInt(age) < 18) {
        return res.status(403).json({ message: 'Teachers must be at least 18 years old' });
      }
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: 'Email already registered' });
    }
    const hashedPassword = await bcrypt.hash(password, 10); 
    // Save user
    const newUser = new User({ name, email, password: hashedPassword, role: role || 'student',
      age: role === 'teacher' ? age : undefined, profileImage: req.file ? req.file.path : null  });
    await newUser.save();

    return res.status(201).json({ message: 'User registered successfully' });
  } catch (error) {
    console.error('Registration error:', error.message);
    return res.status(500).json({ message: 'Error creating user' });
  }
};
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1. Check if email & password are provided
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // 2. Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // 3. Compare password with hashed password
    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    if (!isPasswordCorrect) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // 4. Generate JWT Token
    const token = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET, // 🔐 Store in .env in real app
      { expiresIn: '1d' }
    );

    // 5. Respond with user data and token
    res.status(200).json({
      message: 'Login successful',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        profileImage: user.profileImage,
      },
      token,
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};



module.exports = { register ,  login};

