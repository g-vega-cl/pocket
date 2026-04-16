const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'minimax/minimax-m2.5:free';

const SYSTEM_PROMPT = `You are Pocket, an autonomous coding agent.

The repository has been cloned and you're on branch: {branchName}

Your task: {taskDescription}

Rules:
- Read files to understand the codebase
- Make necessary changes
- Run tests with run_command
- When done: git_commit → git_push → github_create_pr

AVAILABLE TOOLS:
- read_file(path) - Read a file, returns content
- write_file(path, content) - Write/modify a file
- run_command(cmd) - Execute a shell command
- git_commit(message) - Commit staged changes
- git_push() - Push to remote
- github_create_pr(title, body) - Create PR to pocket branch

IMPORTANT: Always commit and push before creating PR. PR title should be concise and descriptive.

Do NOT clone or create branches. That is already done.
`;

function buildSystemMessage(branchName, taskDescription) {
  return {
    role: 'system',
    content: SYSTEM_PROMPT
      .replace('{branchName}', branchName)
      .replace('{taskDescription}', taskDescription),
  };
}

function buildToolDefinitions() {
  return [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read the contents of a file',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the file relative to repo root' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Write or modify a file',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the file relative to repo root' },
            content: { type: 'string', description: 'Full file content to write' },
          },
          required: ['path', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_command',
        description: 'Execute a shell command',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command to execute' },
          },
          required: ['command'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'git_commit',
        description: 'Commit staged changes',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Commit message' },
          },
          required: ['message'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'git_push',
        description: 'Push commits to remote',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'github_create_pr',
        description: 'Create a GitHub pull request',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'PR title' },
            body: { type: 'string', description: 'PR body/description' },
          },
          required: ['title', 'body'],
        },
      },
    },
  ];
}

async function streamChat(messages, onChunk, onToolCall) {
  const model = DEFAULT_MODEL;

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://pocket.local',
      'X-Title': 'Pocket',
    },
    body: JSON.stringify({
      model,
      messages,
      tools: buildToolDefinitions(),
      stream: true,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter error: ${response.status} - ${error}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentToolCall = null;
  let currentToolArgs = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta;

        if (delta?.content) {
          const content = delta.content[0];
          if (content.type === 'text') {
            onChunk(content.text);
          } else if (content.type === 'tool_use') {
            const tool = content.name;
            const args = content.input || {};

            if (currentToolCall !== tool) {
              if (currentToolCall) {
                onToolCall({
                  name: currentToolCall,
                  arguments: JSON.parse(currentToolArgs || '{}'),
                  status: 'complete',
                });
              }
              currentToolCall = tool;
              currentToolArgs = '';
              onToolCall({
                name: tool,
                arguments: args,
                status: 'start',
              });
            } else {
              currentToolArgs = JSON.stringify(args);
            }
          }
        }

        if (parsed.choices?.[0]?.finish_reason === 'tool_calls') {
          if (currentToolCall) {
            onToolCall({
              name: currentToolCall,
              arguments: JSON.parse(currentToolArgs || '{}'),
              status: 'complete',
            });
            currentToolCall = null;
            currentToolArgs = '';
          }
        }
      } catch (e) {
      }
    }
  }

  if (currentToolCall) {
    onToolCall({
      name: currentToolCall,
      arguments: JSON.parse(currentToolArgs || '{}'),
      status: 'complete',
    });
  }
}

export {
  buildSystemMessage,
  buildToolDefinitions,
  streamChat,
};
