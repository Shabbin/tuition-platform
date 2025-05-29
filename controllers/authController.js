const User = require('../models/user');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const handleError = require('../utils/handleError');

exports.register = async (req, res, next) => {
  try {
    const { name, email, password, role, age } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) return next(handleError(400, 'Email already exists'));

    const hashedPassword = await bcrypt.hash(password, 10);
    const profileImage = req.file ? req.file.filename : null;

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      role,
      age: role === 'teacher' ? age : undefined,
      profileImage,
    });

    const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1d' });

    res.status(201).json({ token, user });
  } catch (err) {
    next(err);
  }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return next(handleError(404, 'User not found'));

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return next(handleError(401, 'Invalid credentials'));

    const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1d' });

    res.status(200).json({ token, user });
  } catch (err) {
    next(err);
  }
};
