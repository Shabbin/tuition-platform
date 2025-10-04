// services/video/index.js
const DailyProvider = require('./dailyProvider');
const JitsiProvider = require('./jitsiProvider');

const VIDEO_PROVIDER = (process.env.VIDEO_PROVIDER || 'daily').toLowerCase();

let provider;

if (VIDEO_PROVIDER === 'jitsi') {
  console.log('[video] Using JITSI provider (meet.jit.si)');
  provider = new JitsiProvider({});
} else {
  if (!process.env.DAILY_API_KEY) {
    console.error('[video] DAILY_API_KEY is missing – Daily calls will fail.');
  }
  console.log('[video] Using DAILY provider');
  provider = new DailyProvider({
    apiKey: process.env.DAILY_API_KEY,
    subdomain: process.env.DAILY_SUBDOMAIN || null,
  });
}

module.exports = { provider };
