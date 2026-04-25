import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { createSession, getSession, getAllSessions, updateSession, addToHistory, updateLastHistoryMessage, loadSessionsFromDisk } from './sessions.js';
import { gitClone, gitInit, gitCreateBranch, gitCommit, gitPush, gitStatus } from './tools/git.js';
import { readFile, writeFile } from './tools/file.js';
import { runCommand } from './tools/command.js';
import { createPullRequest } from './tools/github.js';
import { buildSystemMessage, streamChat } from './llm.js';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5173;

const sessionEvents = new EventEmitter();
const pendingPermissions = new Map();

function send(sessionId, data) {
  sessionEvents.emit(`event:${sessionId}`, data);
  // Also emit a general event for session list updates if needed
  if (data.type === 'sessions_list' || data.type === 'session_created') {
    sessionEvents.emit('sessions_update', data);
  }
}

function broadcastSessionList() {
  const sessions = getAllSessions().map(s => ({
    id: s.id,
    repoUrl: s.repoUrl,
    task: s.task,
    createdAt: s.createdAt,
    status: s.status,
  }));
  sessionEvents.emit('sessions_update', { type: 'sessions_list', sessions });
}

// SSE Endpoint
app.get('/api/sessions/:sessionId/events', (req, res) => {
  const { sessionId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const onEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const onSessionsUpdate = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  sessionEvents.on(`event:${sessionId}`, onEvent);
  sessionEvents.on('sessions_update', onSessionsUpdate);

  // Heartbeat
  const heartbeat = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sessionEvents.removeListener(`event:${sessionId}`, onEvent);
    sessionEvents.removeListener('sessions_update', onSessionsUpdate);
  });
});

// GET /api/sessions
app.get('/api/sessions', (req, res) => {
  const sessions = getAllSessions().map(s => ({
    id: s.id,
    repoUrl: s.repoUrl,
    task: s.task,
    createdAt: s.createdAt,
    status: s.status,
  }));
  res.json({ type: 'sessions_list', sessions });
});

// POST /api/sessions
app.post('/api/sessions', (req, res) => {
  const { repoUrl, task, githubToken } = req.body;
  const session = createSession({ repoUrl, task, githubToken });
  console.log(`[Session] Created session ${session.id} for repo ${repoUrl}`);
  broadcastSessionList();
  res.json({ type: 'session_created', sessionId: session.id });
});

// POST /api/sessions/local
app.post('/api/sessions/local', async (req, res) => {
  const { task } = req.body;
  const session = createSession({ repoUrl: 'local', task, isLocal: true });
  console.log(`[Session] Created local session ${session.id}`);

  res.json({ type: 'session_created', sessionId: session.id });
  broadcastSessionList();

  // Automatically initialize local session in background
  try {
    const { localPath } = await gitInit();
    updateSession(session.id, { localPath, status: 'ready', branchName: 'main' });
    send(session.id, { type: 'status', status: 'ready', message: 'Local session ready', localPath, branchName: 'main' });
  } catch (error) {
    updateSession(session.id, { status: 'error' });
    send(session.id, { type: 'error', error: `Local initialization failed: ${error.message}` });
  }
});

// GET /api/sessions/:sessionId
app.get('/api/sessions/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json({ type: 'session_resumed', session });
});

// POST /api/sessions/:sessionId/clone
app.post('/api/sessions/:sessionId/clone', async (req, res) => {
  const { sessionId } = req.params;
  const session = getSession(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  updateSession(sessionId, { status: 'cloning' });
  send(sessionId, { type: 'status', status: 'cloning', message: 'Cloning repository...' });

  res.json({ status: 'started' });

  try {
    const { localPath } = await gitClone(session.repoUrl, session.githubToken);
    updateSession(sessionId, { localPath, status: 'cloned' });
    send(sessionId, { type: 'status', status: 'cloned', message: 'Repository cloned', localPath });
  } catch (error) {
    updateSession(sessionId, { status: 'error' });
    send(sessionId, { type: 'error', error: `Clone failed: ${error.message}` });
  }
});

// POST /api/sessions/:sessionId/create_branch
app.post('/api/sessions/:sessionId/create_branch', async (req, res) => {
  const { sessionId } = req.params;
  const session = getSession(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (!session.localPath) return res.status(400).json({ error: 'Repository not cloned yet' });

  updateSession(sessionId, { status: 'creating_branch' });
  send(sessionId, { type: 'status', status: 'creating_branch', message: 'Creating branch...' });

  res.json({ status: 'started' });

  try {
    const { branchName } = await gitCreateBranch(session.localPath, session.task);
    send(sessionId, { type: 'status', status: 'creating_branch', message: 'Pushing branch to origin...' });
    await gitPush(session.localPath, branchName, session.githubToken);
    updateSession(sessionId, { branchName, status: 'ready' });
    send(sessionId, { type: 'status', status: 'ready', message: 'Branch created and pushed', branchName });
  } catch (error) {
    updateSession(sessionId, { status: 'error' });
    send(sessionId, { type: 'error', error: `Branch creation failed: ${error.message}` });
  }
});

// POST /api/sessions/:sessionId/chat
app.post('/api/sessions/:sessionId/chat', async (req, res) => {
  const { sessionId } = req.params;
  const { content, model, isPreSetup } = req.body;
  const session = getSession(sessionId);

  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (!session.localPath || !session.branchName) {
    return res.status(400).json({ error: 'Repository not ready.' });
  }

  let chatContent = content;
  if (isPreSetup) {
    chatContent = "Please explore the repository, try to build it, and run tests. Report on what you find and if everything is working as expected.";
  }

  console.log(`[Chat] Message from session ${sessionId}: ${chatContent.substring(0, 100)}`);

  const userMessage = { role: 'user', content: chatContent };
  addToHistory(sessionId, userMessage);

  // Broadcast user message to other potential clients
  send(sessionId, { type: 'user_message', content: chatContent });

  // Respond immediately that we received it
  res.json({ status: 'processing' });

  // Then start background processing
  processChat(sessionId, chatContent, model);
});

async function processChat(sessionId, content, model) {
  const session = getSession(sessionId);
  const repoName = session.repoUrl.split('/').pop().replace('.git', '');
  const messages = [
    buildSystemMessage(session.branchName, session.task, repoName, session.localPath),
    ...session.history.map(m => {
      const msg = { role: m.role, content: m.content };
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      return msg;
    }),
  ];

  let fullResponse = '';
  let fullReasoning = '';

  addToHistory(sessionId, { role: 'assistant', content: '', reasoning: '' });

  try {
    await streamChat(
      messages,
      (chunk) => {
        fullResponse += chunk;
        updateLastHistoryMessage(sessionId, fullResponse, fullReasoning);
        send(sessionId, { type: 'token', content: chunk });
      },
      async (toolCall) => {
        if (toolCall.status === 'start') {
          updateSession(sessionId, { currentToolCall: { name: toolCall.name, args: toolCall.arguments }, isThinking: false });
          send(sessionId, { type: 'tool_start', tool: toolCall.name, args: toolCall.arguments });
        } else if (toolCall.status === 'complete') {
          updateLastHistoryMessage(sessionId, fullResponse, fullReasoning, [
             {
               id: toolCall.id || `call_${Date.now()}`,
               type: 'function',
               function: { name: toolCall.name, arguments: JSON.stringify(toolCall.arguments) }
             }
          ]);
        } else if (toolCall.status === 'result') {
          updateSession(sessionId, { currentToolCall: { name: toolCall.name, args: toolCall.arguments, result: toolCall.result }, isThinking: true });
          send(sessionId, { type: 'tool_result', tool: toolCall.name, result: toolCall.result });
          addToHistory(sessionId, {
            role: 'tool',
            content: JSON.stringify(toolCall.result),
            tool_call: toolCall.name,
            tool_args: toolCall.arguments,
            tool_result: toolCall.result,
            tool_call_id: toolCall.id || `call_${Date.now()}`
          });
        }
      },
      async (toolName, args) => {
        const requestPermission = async (reason) => {
          const requestId = Math.random().toString(36).substring(7);

          // Save pending permission to session state so it's persistent
          const pendingPermission = { requestId, tool: toolName, args, reason };
          updateSession(sessionId, { pendingPermission });

          send(sessionId, { type: 'permission_request', ...pendingPermission });

          return new Promise((resolve) => {
            pendingPermissions.set(requestId, resolve);
          });
        };
        return await executeTool(session.localPath, toolName, args, requestPermission, session.githubToken, session.branchName);
      },
      (raw) => send(sessionId, { type: 'debug', data: raw }),
      () => {
         updateSession(sessionId, { isThinking: true });
         send(sessionId, { type: 'thinking_start' });
      },
      (chunk) => {
        fullReasoning += chunk;
        updateLastHistoryMessage(sessionId, fullResponse, fullReasoning);
        send(sessionId, { type: 'reasoning', content: chunk });
      },
      model
    );

    updateSession(sessionId, { isThinking: false, currentToolCall: null });

    // Auto-commit/PR logic...
    let prUrl = null;
    try {
      const { dirty } = await gitStatus(session.localPath);
      if (dirty) {
        send(sessionId, { type: 'status', status: 'working', message: 'Committing changes...' });
        await gitCommit(session.localPath, `Pocket: ${session.task}`);

        if (!session.isLocal) {
          send(sessionId, { type: 'status', status: 'working', message: 'Pushing changes...' });
          await gitPush(session.localPath, session.branchName, session.githubToken);
          send(sessionId, { type: 'status', status: 'working', message: 'Creating pull request...' });
          const prResult = await createPullRequest(session.localPath, session.branchName, `Pocket: ${session.task}`, `Task: ${session.task}\n\n${fullResponse.slice(0, 500)}`, session.githubToken);
          prUrl = prResult.prUrl;
          if (prUrl) updateSession(sessionId, { prUrl });
        }
      }
    } catch (error) {
      console.error('Auto-push/PR/Commit failed:', error.message);
    }
    send(sessionId, { type: 'status', status: 'ready', message: 'Ready for more!', prUrl });
  } catch (error) {
    console.error('Chat processing failed:', error);
    updateSession(sessionId, { status: 'error', isThinking: false });
    send(sessionId, { type: 'error', error: error.message });
  }
}

// POST /api/sessions/:sessionId/commit
app.post('/api/sessions/:sessionId/commit', async (req, res) => {
  const { sessionId } = req.params;
  const session = getSession(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  res.json({ status: 'started' });

  try {
    const { dirty } = await gitStatus(session.localPath);
    if (!dirty) {
      send(sessionId, { type: 'status', status: 'ready', message: 'No changes to commit' });
      return;
    }

    send(sessionId, { type: 'status', status: 'working', message: 'Committing changes...' });
    await gitCommit(session.localPath, `Pocket: ${session.task}`);
    if (!session.isLocal) {
      send(sessionId, { type: 'status', status: 'working', message: 'Pushing changes...' });
      await gitPush(session.localPath, session.branchName, session.githubToken);
      send(sessionId, { type: 'status', status: 'ready', message: 'Committed and pushed!' });
    } else {
      send(sessionId, { type: 'status', status: 'ready', message: 'Committed locally!' });
    }
  } catch (error) {
    send(sessionId, { type: 'error', error: error.message });
  }
});

// POST /api/sessions/:sessionId/create_pr
app.post('/api/sessions/:sessionId/create_pr', async (req, res) => {
  const { sessionId } = req.params;
  const session = getSession(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  res.json({ status: 'started' });

  try {
    send(sessionId, { type: 'status', status: 'working', message: 'Creating pull request...' });
    const prResult = await createPullRequest(session.localPath, session.branchName, `Pocket: ${session.task}`, `Task: ${session.task}`, session.githubToken);
    if (prResult.prUrl) {
      updateSession(sessionId, { prUrl: prResult.prUrl });
      send(sessionId, { type: 'status', status: 'ready', message: 'PR created!', prUrl: prResult.prUrl });
    } else {
      send(sessionId, { type: 'status', status: 'ready', message: 'PR creation failed: ' + prResult.error });
    }
  } catch (error) {
    send(sessionId, { type: 'error', error: error.message });
  }
});

// POST /api/sessions/:sessionId/permission
app.post('/api/sessions/:sessionId/permission', (req, res) => {
  const { requestId, granted } = req.body;
  const { sessionId } = req.params;

  const resolver = pendingPermissions.get(requestId);
  if (resolver) {
    resolver(granted);
    pendingPermissions.delete(requestId);

    // Clear pending permission from session state
    updateSession(sessionId, { pendingPermission: null });
    res.json({ status: 'ok' });
  } else {
    res.status(404).json({ error: 'Permission request not found' });
  }
});

// No-op for old handleMessage logic
async function handleMessage() {}

async function executeTool(localPath, toolName, args, requestPermission, githubToken = null, branchName = null) {
  const isPathOutside = (targetPath) => {
    if (!targetPath) return false;
    const absoluteLocalPath = path.resolve(localPath);
    const absoluteTarget = path.resolve(localPath, targetPath);
    return !absoluteTarget.startsWith(absoluteLocalPath);
  };

  switch (toolName) {
    case 'read_file':
      if (isPathOutside(args.path)) {
        return { error: `Permission denied: Accessing file outside of sandbox is not allowed: ${args.path}` };
      }
      return readFile(localPath, args.path);

    case 'write_file': {
      if (isPathOutside(args.path)) {
        return { error: `Permission denied: Writing file outside of sandbox is not allowed: ${args.path}` };
      }
      return writeFile(localPath, args.path, args.content);
    }

    case 'run_command': {
      const command = args.command || '';
      // Block commands that attempt to escape the sandbox
      const targetsOutside = command.includes('..') || command.includes(' /') || command.startsWith('/');

      if (targetsOutside) {
         return { error: `Permission denied: Command attempts to access outside of sandbox: ${command}` };
      }
      return runCommand(localPath, command);
    }

    case 'git_commit':
      return gitCommit(localPath, args.message);

    case 'git_push':
      const pushResult = await gitPush(localPath, branchName, githubToken);
      return pushResult;

     case 'github_create_pr': {
        // Find session from localPath
        const sess = getAllSessions().find(s => s.localPath === localPath);
        if (sess) {
          const { createPullRequest: createPR } = await import('./tools/github.js');
          return createPR(localPath, sess.branchName, args.title, args.body, githubToken);
        }
      return { error: 'Could not determine repo info' };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/clone', async (req, res) => {
  try {
    const { repoUrl, sessionId } = req.body;
    const session = getSession(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({ status: 'cloning' });

    try {
      const { localPath } = await gitClone(repoUrl);
      updateSession(sessionId, { localPath, status: 'cloned' });
    } catch (error) {
      updateSession(sessionId, { status: 'error' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

loadSessionsFromDisk();

server.listen(PORT, () => {
  console.log(`Pocket server running on port ${PORT}`);
});
