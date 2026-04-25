import fs from 'fs';
import path from 'path';

const sessions = new Map();
const SESSIONS_DIR = path.join(process.cwd(), 'server', 'sessions');

if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function saveSessionToDisk(session) {
  const filePath = path.join(SESSIONS_DIR, `${session.id}.json`);
  const sessionToSave = { ...session };
  delete sessionToSave.githubToken;
  fs.writeFileSync(filePath, JSON.stringify(sessionToSave, null, 2));
}

function loadSessionsFromDisk() {
  if (!fs.existsSync(SESSIONS_DIR)) return;

  const files = fs.readdirSync(SESSIONS_DIR);
  for (const file of files) {
    if (file.endsWith('.json')) {
      try {
        const data = fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf8');
        const session = JSON.parse(data);
        sessions.set(session.id, session);
      } catch (error) {
        console.error(`Failed to load session ${file}:`, error);
      }
    }
  }
  console.log(`Loaded ${sessions.size} sessions from disk.`);
}

function generateId() {
  return 'sess_' + Math.random().toString(36).substring(2, 15);
}

function createSession({ repoUrl, task, isLocal = false, githubToken = null }) {
  const id = generateId();
  const session = {
    id,
    repoUrl,
    task,
    isLocal,
    githubToken,
    localPath: null,
    branchName: null,
    history: [],
    status: 'created', // created | cloning | cloned | working | done | error
    isThinking: false,
    currentToolCall: null,
    pendingPermission: null,
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };
  sessions.set(id, session);
  saveSessionToDisk(session);
  return session;
}

function updateLastHistoryMessage(id, content, reasoning = null, tool_calls = null) {
  const session = sessions.get(id);
  if (!session || session.history.length === 0) return null;
  const last = session.history[session.history.length - 1];
  if (last.role === 'assistant') {
    last.content = content;
    // Defensive coding: only update reasoning if it's a valid non-empty string
    if (reasoning !== null && reasoning !== undefined && reasoning !== '') {
      last.reasoning = reasoning;
    }
    if (tool_calls !== null) last.tool_calls = tool_calls;
    session.lastActivity = Date.now();
    saveSessionToDisk(session);
  }
  return session;
}

function getSession(id) {
  return sessions.get(id);
}

function updateSession(id, updates) {
  const session = sessions.get(id);
  if (!session) return null;
  Object.assign(session, updates, { lastActivity: Date.now() });
  saveSessionToDisk(session);
  return session;
}

function getAllSessions() {
  return Array.from(sessions.values()).sort((a, b) => b.createdAt - a.createdAt);
}

function addToHistory(id, message) {
  const session = sessions.get(id);
  if (!session) return null;
  message.timestamp = Date.now();
  session.history.push(message);
  session.lastActivity = Date.now();
  saveSessionToDisk(session);
  return session;
}

function cleanupOldSessions(maxAgeMs = 24 * 60 * 60 * 1000) {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > maxAgeMs) {
      sessions.delete(id);
      try {
        const filePath = path.join(SESSIONS_DIR, `${id}.json`);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (error) {
        console.error(`Failed to delete session file ${id}:`, error);
      }
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
  updateLastHistoryMessage,
  loadSessionsFromDisk,
};
