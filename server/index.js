import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createSession, getSession, getAllSessions, updateSession, addToHistory } from './sessions.js';
import { gitClone, gitInit, gitCreateBranch, gitCommit, gitPush, gitStatus } from './tools/git.js';
import { readFile, writeFile } from './tools/file.js';
import { runCommand } from './tools/command.js';
import { createPullRequest } from './tools/github.js';
import { buildSystemMessage, streamChat } from './llm.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5173;

const clients = new Map();
const pendingPermissions = new Map();

wss.on('connection', (ws) => {
  console.log('Client connected');
  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      await handleMessage(ws, message);
    } catch (error) {
      console.error('Error handling message:', error);
      send(ws, { type: 'error', error: error.message });
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    for (const [sessionId, clientWs] of clients) {
      if (clientWs === ws) {
        clients.delete(sessionId);

          // Cleanup local session temp folder
          const session = getSession(sessionId);
          if (session && session.isLocal && session.localPath) {
            import('fs').then(fs => {
              if (fs.existsSync(session.localPath)) {
                console.log(`Cleaning up local session: ${session.localPath}`);
                import('child_process').then(cp => {
                  cp.exec(`rm -rf ${session.localPath}`);
                });
              }
            });
          }
        break;
      }
    }
  });
});

const pingInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(pingInterval);
});

function broadcastSessionList() {
  const sessions = getAllSessions().map(s => ({
    id: s.id,
    repoUrl: s.repoUrl,
    task: s.task,
    createdAt: s.createdAt,
    status: s.status,
  }));
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      send(client, { type: 'sessions_list', sessions });
    }
  });
}

async function handleMessage(ws, message) {
  const { type, sessionId, payload } = message;

  switch (type) {
    case 'list_sessions': {
      const sessions = getAllSessions().map(s => ({
        id: s.id,
        repoUrl: s.repoUrl,
        task: s.task,
        createdAt: s.createdAt,
        status: s.status,
      }));
      send(ws, { type: 'sessions_list', sessions });
      break;
    }

    case 'create_session': {
      const { repoUrl, task, githubToken } = payload;
      const session = createSession({ repoUrl, task, githubToken });
      clients.set(session.id, ws);
      send(ws, { type: 'session_created', sessionId: session.id });
      broadcastSessionList();
      break;
    }

    case 'create_local_session': {
      const { task } = payload;
      const session = createSession({ repoUrl: 'local', task, isLocal: true });
      clients.set(session.id, ws);
      send(ws, { type: 'session_created', sessionId: session.id });
      broadcastSessionList();

      // Automatically initialize local session
      try {
        const { localPath } = await gitInit();
        updateSession(session.id, { localPath, status: 'ready', branchName: 'main' });
        send(ws, { type: 'status', status: 'ready', message: 'Local session ready', localPath, branchName: 'main' });
      } catch (error) {
        updateSession(session.id, { status: 'error' });
        send(ws, { type: 'error', error: `Local initialization failed: ${error.message}` });
      }
      break;
    }

    case 'resume_session': {
      const session = getSession(sessionId);
      if (!session) {
        send(ws, { type: 'error', error: 'Session not found' });
        return;
      }
      clients.set(session.id, ws);
      send(ws, { type: 'session_resumed', session });
      break;
    }

    case 'get_session': {
      const session = getSession(sessionId);
      if (!session) {
        send(ws, { type: 'error', error: 'Session not found' });
        return;
      }
      send(ws, { type: 'session_data', session });
      break;
    }

    case 'clone': {
      const session = getSession(sessionId);
      if (!session) {
        send(ws, { type: 'error', error: 'Session not found' });
        return;
      }

      updateSession(sessionId, { status: 'cloning' });
      send(ws, { type: 'status', status: 'cloning', message: 'Cloning repository...' });

      try {
        const { localPath } = await gitClone(session.repoUrl, session.githubToken);
        updateSession(sessionId, { localPath, status: 'cloned' });
        send(ws, { type: 'status', status: 'cloned', message: 'Repository cloned', localPath });
      } catch (error) {
        updateSession(sessionId, { status: 'error' });
        send(ws, { type: 'error', error: `Clone failed: ${error.message}` });
      }
      break;
    }

    case 'create_branch': {
      const session = getSession(sessionId);
      if (!session) {
        send(ws, { type: 'error', error: 'Session not found' });
        return;
      }

      if (!session.localPath) {
        send(ws, { type: 'error', error: 'Repository not cloned yet' });
        return;
      }

      updateSession(sessionId, { status: 'creating_branch' });
      send(ws, { type: 'status', status: 'creating_branch', message: 'Creating branch...' });

      try {
        const { branchName } = await gitCreateBranch(session.localPath, session.task);
        send(ws, { type: 'status', status: 'creating_branch', message: 'Pushing branch to origin...' });
        await gitPush(session.localPath, branchName, session.githubToken);
        updateSession(sessionId, { branchName, status: 'ready' });
        send(ws, { type: 'status', status: 'ready', message: 'Branch created and pushed', branchName });
      } catch (error) {
        updateSession(sessionId, { status: 'error' });
        send(ws, { type: 'error', error: `Branch creation failed: ${error.message}` });
      }
      break;
    }

    case 'chat': {
      const session = getSession(sessionId);
      if (!session) {
        send(ws, { type: 'error', error: 'Session not found' });
        return;
      }

      if (!session.localPath || !session.branchName) {
        send(ws, { type: 'error', error: 'Repository not ready. Please clone and create branch first.' });
        return;
      }

      const { content, model } = payload;

      addToHistory(sessionId, { role: 'user', content });
      send(ws, { type: 'user_message', content });

const repoName = session.repoUrl.split('/').pop().replace('.git', '');
      const messages = [
        buildSystemMessage(session.branchName, session.task, repoName, session.localPath),
        ...session.history.map(m => ({ role: m.role, content: m.content })),
      ];

      let fullResponse = '';

      await streamChat(
        messages,
        (chunk) => {
          fullResponse += chunk;
          send(ws, { type: 'token', content: chunk });
        },
        async (toolCall) => {
          if (toolCall.status === 'start') {
            send(ws, { type: 'tool_start', tool: toolCall.name, args: toolCall.arguments });
          } else if (toolCall.status === 'complete') {
            // Tool call streaming complete - waiting for execution
          } else if (toolCall.status === 'result') {
            // Tool execution result from llm.js
            send(ws, { type: 'tool_result', tool: toolCall.name, result: toolCall.result });
          }
        },
        async (toolName, args) => {
          const requestPermission = async (reason) => {
            const requestId = Math.random().toString(36).substring(7);
            send(ws, { type: 'permission_request', requestId, tool: toolName, args, reason });
            return new Promise((resolve) => {
              pendingPermissions.set(requestId, resolve);
            });
          };
          return await executeTool(session.localPath, toolName, args, requestPermission, session.githubToken, session.branchName);
        },
        (raw) => send(ws, { type: 'debug', data: raw }),
        () => send(ws, { type: 'thinking_start' }),
        (chunk) => send(ws, { type: 'reasoning', content: chunk }),
        model
      );

      addToHistory(sessionId, { role: 'assistant', content: fullResponse });

      let prUrl = null;
      try {
        const { dirty } = await gitStatus(session.localPath);
        if (dirty) {
          send(ws, { type: 'status', status: 'working', message: 'Committing changes...' });
          await gitCommit(session.localPath, `Pocket: ${session.task}`);

          if (!session.isLocal) {
            send(ws, { type: 'status', status: 'working', message: 'Pushing changes...' });
            await gitPush(session.localPath, session.branchName, session.githubToken);
            send(ws, { type: 'status', status: 'working', message: 'Creating pull request...' });
            const prResult = await createPullRequest(session.localPath, session.branchName, `Pocket: ${session.task}`, `Task: ${session.task}\n\n${fullResponse.slice(0, 500)}`, session.githubToken);
            prUrl = prResult.prUrl;
            if (prUrl) {
              updateSession(sessionId, { prUrl });
            }
          } else {
            send(ws, { type: 'status', status: 'working', message: 'Changes committed locally.' });
          }
        }
      } catch (error) {
        console.error('Auto-push/PR/Commit failed:', error.message);
      }

      send(ws, { type: 'status', status: 'ready', message: 'Ready for more!', prUrl });
      break;
    }

    case 'commit': {
      const session = getSession(sessionId);
      if (!session) {
        send(ws, { type: 'error', error: 'Session not found' });
        return;
      }

      if (!session.localPath || !session.branchName) {
        send(ws, { type: 'error', error: 'Repository not ready' });
        return;
      }

      try {
        const { dirty } = await gitStatus(session.localPath);
        if (!dirty) {
          send(ws, { type: 'status', status: 'ready', message: 'No changes to commit' });
          return;
        }

        send(ws, { type: 'status', status: 'working', message: 'Committing changes...' });
        await gitCommit(session.localPath, `Pocket: ${session.task}`);
        if (!session.isLocal) {
          send(ws, { type: 'status', status: 'working', message: 'Pushing changes...' });
          await gitPush(session.localPath, session.branchName, session.githubToken);
          send(ws, { type: 'status', status: 'ready', message: 'Committed and pushed!' });
        } else {
          send(ws, { type: 'status', status: 'ready', message: 'Committed locally!' });
        }
      } catch (error) {
        send(ws, { type: 'error', error: error.message });
      }
      break;
    }

    case 'create_pr': {
      const session = getSession(sessionId);
      if (!session) {
        send(ws, { type: 'error', error: 'Session not found' });
        return;
      }

      if (!session.localPath || !session.branchName) {
        send(ws, { type: 'error', error: 'Repository not ready' });
        return;
      }

      try {
        send(ws, { type: 'status', status: 'working', message: 'Creating pull request...' });
        const prResult = await createPullRequest(session.localPath, session.branchName, `Pocket: ${session.task}`, `Task: ${session.task}`, session.githubToken);
        if (prResult.prUrl) {
          updateSession(sessionId, { prUrl: prResult.prUrl });
          send(ws, { type: 'status', status: 'ready', message: 'PR created!', prUrl: prResult.prUrl });
        } else {
          send(ws, { type: 'status', status: 'ready', message: 'PR creation failed: ' + prResult.error });
        }
      } catch (error) {
        send(ws, { type: 'error', error: error.message });
      }
      break;
    }

    case 'abort': {
      send(ws, { type: 'aborted' });
      break;
    }

    case 'permission_response': {
      const { requestId, granted } = payload;
      const resolver = pendingPermissions.get(requestId);
      if (resolver) {
        resolver(granted);
        pendingPermissions.delete(requestId);
      }
      break;
    }
  }
}

async function executeTool(localPath, toolName, args, requestPermission, githubToken = null, branchName = null) {
  const isPathOutside = (targetPath) => {
    if (!targetPath) return false;
    const absoluteTarget = path.isAbsolute(targetPath) ? targetPath : path.join(localPath, targetPath);
    const relative = path.relative(localPath, absoluteTarget);
    return relative.startsWith('..') || path.isAbsolute(relative);
  };

  switch (toolName) {
    case 'read_file':
      return readFile(localPath, args.path);

    case 'write_file': {
      if (isPathOutside(args.path)) {
        const granted = await requestPermission(`Action attempts to write file outside of temporary folder: ${args.path}`);
        if (!granted) return { error: 'Permission denied' };
      }
      return writeFile(localPath, args.path, args.content);
    }

    case 'run_command': {
      const command = args.command || '';
      const destructiveKeywords = ['rm ', 'mv ', 'chmod ', 'chown '];
      const isDestructive = destructiveKeywords.some(kw => command.includes(kw));
      const targetsOutside = command.includes('..') || command.includes(' /');

      if (isDestructive || targetsOutside) {
        const granted = await requestPermission(`Action attempts to run a potentially destructive command or access outside of temporary folder: ${command}`);
        if (!granted) return { error: 'Permission denied' };
      }
      return runCommand(localPath, command);
    }

    case 'git_commit':
      return gitCommit(localPath, args.message);

    case 'git_push':
      const pushResult = await gitPush(localPath, branchName, githubToken);
      return pushResult;

    case 'github_create_pr': {
      const session = Array.from(clients.entries()).find(([, ws]) => ws.readyState === 1)?.[0];
      const sess = session ? getSession(session) : null;
      if (sess) {
        const { execSync } = require('child_process');
        const remoteUrl = execSync(`git -C ${localPath} remote get-url origin`).toString().trim();
        const match = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
        if (match) {
          const { createPullRequest: createPR } = await import('./tools/github.js');
          return createPR(localPath, sess.branchName, args.title, args.body, githubToken);
        }
      }
      return { error: 'Could not determine repo info' };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

function send(ws, data) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(data));
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

server.listen(PORT, () => {
  console.log(`Pocket server running on port ${PORT}`);
  console.log(`WebSocket available at ws://localhost:${PORT}/ws`);
});
