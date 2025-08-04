const axios = require('axios');
const { faker } = require('@faker-js/faker');
require('dotenv').config();

const API = 'http://localhost:5000/api';

const NUM_TEACHERS = 3;
const NUM_STUDENTS = 3;

const teachers = [];
const students = [];

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

async function registerUser(role) {
  const user = {
    name: faker.person.fullName(),
    email: faker.internet.email(),
    password: 'Test@123',
    role,
    age: role === 'teacher' ? 25 + Math.floor(Math.random() * 10) : undefined,
    isEligible: role === 'teacher' ? true : undefined,  // Set eligibility true for teachers
  };

  const res = await axios.post(`${API}/auth/register`, user);
  console.log('Registered user:', res.data.user);
  return {
    token: res.data.token,
    user: res.data.user,
  };
}

async function sendRequest(studentToken, studentId, teacherId) {
  const payload = {
    studentId,
    teacherId,
    topic: faker.lorem.words(3),
    studentName: faker.person.firstName(),
    message: faker.lorem.sentence(), // Required field
  };

  console.log(`Sending request from student: ${studentId} to teacher: ${teacherId}`);
  const res = await axios.post(`${API}/teacher-requests`, payload, {
    headers: {
      Authorization: `Bearer ${studentToken}`,
    },
  });

  console.log('Request created with ID:', res.data._id);
  return res.data._id;
}

async function approveRequest(teacherToken, requestId) {
  if (!requestId) throw new Error('approveRequest called without requestId');
  console.log('Approving request:', requestId);
  const res = await axios.post(`${API}/teacher-requests/${requestId}/approve`, {}, {
    headers: {
      Authorization: `Bearer ${teacherToken}`,
    },
  });
  return res.data;
}

async function getThread(requestId, token) {
  if (!requestId) {
    throw new Error('getThread called without requestId');
  }
  const res = await axios.get(`${API}/chat/thread/${requestId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log(`Got threadId for request ${requestId}:`, res.data.threadId);
  return res.data.threadId;
}

async function sendMessage(threadId, message, token) {
  if (!threadId) {
    throw new Error('sendMessage called without threadId');
  }
  await axios.post(
    `${API}/chat/messages`,
    { threadId, message },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  console.log(`Sent message to thread ${threadId}`);
}

async function deleteUser(token) {
  await axios.delete(`${API}/user/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function runSimulation() {
  console.log('Registering users...');
  for (let i = 0; i < NUM_TEACHERS; i++) {
    teachers.push(await registerUser('teacher'));
  }
  for (let i = 0; i < NUM_STUDENTS; i++) {
    students.push(await registerUser('student'));
  }

  await delay(1000);

  console.log('Sending requests...');
  const requests = [];
  for (const student of students) {
    const teacher = teachers[Math.floor(Math.random() * teachers.length)];
    const reqId = await sendRequest(student.token, student.user.id, teacher.user.id);
    requests.push({ requestId: reqId, student, teacher });
  }

  await delay(1000);

  console.log('Approving requests...');
  for (const { requestId, teacher } of requests) {
    if (!requestId) {
      console.error('Missing requestId, skipping approval');
      continue;
    }
    await approveRequest(teacher.token, requestId);
  }

  await delay(1000);

  console.log('Starting chat...');
  for (const { requestId, student, teacher } of requests) {
    try {
      const threadId = await getThread(requestId, student.token);
      await sendMessage(threadId, faker.lorem.sentence(), student.token);
      await sendMessage(threadId, faker.lorem.sentence(), teacher.token);
    } catch (error) {
      console.error(`Error during chat for request ${requestId}:`, error.message);
    }
  }

  await delay(1000);

  console.log('Cleaning up users...');
  for (const user of [...teachers, ...students]) {
    try {
      await deleteUser(user.token);
    } catch (err) {
      console.error('Cleanup failed:', err.response?.data || err.message);
    }
  }

  console.log('✅ Simulation complete');
}

runSimulation().catch((err) => {
  console.error('Simulation error:', err.response?.data || err.message);
});
