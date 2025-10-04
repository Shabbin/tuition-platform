// services/video/jitsiProvider.js
class JitsiProvider {
  constructor({ subdomain }) {
    // subdomain not used in meet.jit.si, but kept for API parity
    this.base = 'https://meet.jit.si';
  }

  // We don't actually create a room on Jitsi — room is created on first join.
  async createRoom({ name }) {
    return {
      roomName: name,
      providerRoomId: null,
      joinUrl: `${this.base}/${encodeURIComponent(name)}`,
    };
  }

  // Jitsi doesn't need a token for public meet.jit.si.
  async createToken() {
    return { token: null };
  }

  buildRoomUrl(roomName) {
    return `${this.base}/${encodeURIComponent(roomName)}`;
  }
}

module.exports = JitsiProvider;
