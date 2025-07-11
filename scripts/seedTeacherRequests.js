// scripts/seedTeacherRequests.js

const mongoose = require('mongoose');
const TeacherRequest = require('../models/teacherRequest');
require('dotenv').config(); // Ensure MONGO_URI is loaded

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connected to MongoDB');

    const sampleRequests = [
      { studentName: 'Alice', topic: 'Math: Algebra' },
      { studentName: 'Bob', topic: 'Physics: Motion' },
      { studentName: 'Charlie', topic: 'Chemistry: Mole Concept' },
    ];

    await TeacherRequest.deleteMany(); // Optional: clear old test data
    await TeacherRequest.insertMany(sampleRequests);

    console.log('Seeded teacher requests!');
    process.exit(0);
  } catch (err) {
    console.error('Error seeding:', err);
    process.exit(1);
  }
}

seed();
