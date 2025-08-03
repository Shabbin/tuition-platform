let lastOnlineUserIds = [];
function emitOnlineUsers() {
  const onlineUserIds = Array.from(userSocketsMap.keys());

  const hasChanged = onlineUserIds.length !== lastOnlineUserIds.length ||
    onlineUserIds.some((id, i) => id !== lastOnlineUserIds[i]);

  if (hasChanged) {
    lastOnlineUserIds = [...onlineUserIds];
    io.emit('online_users', onlineUserIds);
    console.log('[emitOnlineUsers] Emitted online_users:', onlineUserIds);
  } else {
    console.log('[emitOnlineUsers] Skipped emission (no change)');
  }
}
module.exports = emitOnlineUsers;