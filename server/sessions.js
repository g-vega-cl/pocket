const sessions = new Map();

function generateId() {
  return 'sess_' + Math.random().toString(36).substring(2, 15);
}

function createSession({ repoUrl, task, isLocal = false }) {
  const id = generateId();
  const session = {
    id,
    repoUrl,
    task,
    isLocal,
    localPath: null,
    branchName: null,
    history: [],
    status: 'created', // created | cloning | cloned | working | done | error
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };
  sessions.set(id, session);
  return session;
}

function getSession(id) {
  return sessions.get(id);
}

function updateSession(id, updates) {
  const session = sessions.get(id);
  if (!session) return null;
  Object.assign(session, updates, { lastActivity: Date.now() });
  return session;
}

function getAllSessions() {
  return Array.from(sessions.values()).sort((a, b) => b.createdAt - a.createdAt);
}

function addToHistory(id, message) {
  const session = sessions.get(id);
  if (!session) return null;
  session.history.push(message);
  session.lastActivity = Date.now();
  return session;
}

function cleanupOldSessions(maxAgeMs = 24 * 60 * 60 * 1000) {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > maxAgeMs) {
      sessions.delete(id);
    }
  }
}

setInterval(cleanupOldSessions, 60 * 60 * 1000);

export {
  createSession,
  getSession,
  getAllSessions,
  updateSession,
  addToHistory,
};
