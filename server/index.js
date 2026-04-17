import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createSession, getSession, updateSession, addToHistory } from './sessions.js';
import { gitClone, gitCreateBranch, gitCommit, gitPush, gitStatus } from './tools/git.js';
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

async function handleMessage(ws, message) {
  const { type, sessionId, payload } = message;

  switch (type) {
    case 'create_session': {
      const { repoUrl, task } = payload;
      const session = createSession({ repoUrl, task });
      clients.set(session.id, ws);
      send(ws, { type: 'session_created', sessionId: session.id });
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
        const { localPath } = await gitClone(session.repoUrl);
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
        await gitPush(session.localPath, branchName);
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
          return await executeTool(session.localPath, toolName, args);
        },
        (raw) => send(ws, { type: 'debug', data: raw }),
        model
      );

      addToHistory(sessionId, { role: 'assistant', content: fullResponse });

      let prUrl = null;
      try {
        const { dirty } = await gitStatus(session.localPath);
        if (dirty) {
          send(ws, { type: 'status', status: 'working', message: 'Committing changes...' });
          await gitCommit(session.localPath, `Pocket: ${session.task}`);
          send(ws, { type: 'status', status: 'working', message: 'Pushing changes...' });
          await gitPush(session.localPath, session.branchName);
          send(ws, { type: 'status', status: 'working', message: 'Creating pull request...' });
          const prResult = await createPullRequest(session.localPath, session.branchName, `Pocket: ${session.task}`, `Task: ${session.task}\n\n${fullResponse.slice(0, 500)}`);
          prUrl = prResult.prUrl;
          if (prUrl) {
            updateSession(sessionId, { prUrl });
          }
        }
      } catch (error) {
        console.error('Auto-push/PR failed:', error.message);
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
        send(ws, { type: 'status', status: 'working', message: 'Pushing changes...' });
        await gitPush(session.localPath, session.branchName);
        send(ws, { type: 'status', status: 'ready', message: 'Committed and pushed!' });
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
        const prResult = await createPullRequest(session.localPath, session.branchName, `Pocket: ${session.task}`, `Task: ${session.task}`);
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
  }
}

async function executeTool(localPath, toolName, args) {
  switch (toolName) {
    case 'read_file':
      return readFile(localPath, args.path);

    case 'write_file':
      return writeFile(localPath, args.path, args.content);

    case 'run_command':
      return runCommand(localPath, args.command);

    case 'git_commit':
      return gitCommit(localPath, args.message);

    case 'git_push':
      const pushResult = await gitPush(localPath, null);
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
          return createPR(localPath, sess.branchName, args.title, args.body);
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
