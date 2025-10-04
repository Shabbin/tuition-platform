// services/video/dailyProvider.js
const axios = require('axios');

class DailyProvider {
  constructor({ apiKey, subdomain }) {
    this.apiKey = (apiKey || '').trim();
    this.subdomain = subdomain ? String(subdomain).trim() : null;
    this.base = 'https://api.daily.co/v1';
    this.auth = { headers: { Authorization: `Bearer ${this.apiKey}` } };
  }

  async createRoom({ name }) {
    const body = {
      name,
      privacy: 'private',
      properties: {
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24, // 24h
      },
    };
    try {
      const res = await axios.post(`${this.base}/rooms`, body, this.auth);
      return {
        roomName: res.data.name,
        providerRoomId: res.data.id,
        joinUrl: res.data.url,
      };
    } catch (e) {
      const s = e?.response?.status;
      const d = e?.response?.data;
      console.error(
        '[dailyProvider.createRoom] HTTP', s,
        'msg=', d?.name || d?.error || e.message,
        'detail=', d
      );

      // If the room already exists, fetch it instead of failing.
      if (s === 409) {
        const res2 = await axios.get(
          `${this.base}/rooms/${encodeURIComponent(name)}`,
          this.auth
        );
        return {
          roomName: res2.data.name,
          providerRoomId: res2.data.id,
          joinUrl: res2.data.url,
        };
      }

      // Pass through 401/403 etc. (bad key/missing perms)
      throw e;
    }
  }

  async createToken({ roomName, isOwner, userName }) {
    const body = {
      properties: {
        room_name: roomName,
        is_owner: !!isOwner,
        user_name: userName || 'User',
      },
    };
    try {
      const res = await axios.post(`${this.base}/meeting-tokens`, body, this.auth);
      return { token: res.data.token };
    } catch (e) {
      const s = e?.response?.status;
      const d = e?.response?.data;
      console.error(
        '[dailyProvider.createToken] HTTP', s,
        'msg=', d?.name || d?.error || e.message,
        'detail=', d
      );
      throw e;
    }
  }

  // Optional helper to construct room URL if you use a Daily subdomain
  buildRoomUrl(roomName) {
    if (this.subdomain) return `https://${this.subdomain}.daily.co/${roomName}`;
    return `https://meet.daily.co/${roomName}`;
  }

  // Lightweight “self test” to verify API key at boot
  async selfTest() {
    try {
      const res = await axios.get(`${this.base}/users/me`, this.auth);
      return { ok: true, account: res?.data?.domain_name || 'unknown' };
    } catch (e) {
      const s = e?.response?.status;
      const d = e?.response?.data;
      console.error('[dailyProvider.selfTest] HTTP', s, 'detail=', d || e.message);
      return { ok: false, status: s, detail: d || e.message };
    }
  }
}

module.exports = DailyProvider;
