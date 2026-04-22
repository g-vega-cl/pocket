const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'openrouter/elephant-alpha';

const SYSTEM_PROMPT = `You are Pocket, an autonomous coding agent.

Repository "{repoName}" has been cloned to: {localPath}
You're on branch: {branchName}

Your task: {taskDescription}

CRITICAL RULE: When asked about the repository or its contents, you MUST call run_command("ls -la") and read_file("README.md") FIRST before answering. Do not describe the repo from memory - you must explore it using these tools.

Rules:
- Read files to understand the codebase
- Make necessary changes
- Run tests with run_command
- When done: git_commit → git_push → github_create_pr

AVAILABLE TOOLS:
- read_file(path) - Read a file, returns content (use absolute path: {localPath}/<path>)
- write_file(path, content) - Write/modify a file
- run_command(cmd) - Execute a shell command
- git_commit(message) - Commit staged changes
- git_push() - Push to remote
- github_create_pr(title, body) - Create PR to pocket branch

IMPORTANT: Always commit and push before creating PR. PR title should be concise and descriptive.

Do NOT clone or create branches. That is already done.
`;

function buildSystemMessage(branchName, taskDescription, repoName, localPath) {
  return {
    role: 'system',
    content: SYSTEM_PROMPT
      .replace('{branchName}', branchName)
      .replace('{taskDescription}', taskDescription)
      .replace('{repoName}', repoName)
      .replace('{localPath}', localPath),
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

async function streamChat(messages, onChunk, onToolCall, executeTool, onRaw, onStartTurn, onReasoning, model = DEFAULT_MODEL) {
  const allMessages = [...messages];

  async function makeRequest(reqMessages) {
    if (onStartTurn) onStartTurn();
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
        messages: reqMessages,
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
    let currentToolCallId = null;
    let assistantMessage = '';
    let finishReason = null;

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
          finishReason = parsed.choices?.[0]?.finish_reason;

          if (onRaw) onRaw(parsed);

          if (delta?.content && typeof delta.content === 'string' && delta.content) {
            assistantMessage += delta.content;
            onChunk(delta.content);
          }

          const reasoning = delta?.reasoning || delta?.reasoning_content;
          if (reasoning && typeof reasoning === 'string' && onReasoning) {
            onReasoning(reasoning);
          }

          if (delta?.tool_calls && delta.tool_calls.length > 0) {
            const toolCallDelta = delta.tool_calls[0];
            if (toolCallDelta?.function?.name) {
              if (currentToolCall && currentToolCall !== toolCallDelta.function.name) {
                onToolCall({
                  name: currentToolCall,
                  arguments: JSON.parse(currentToolArgs || '{}'),
                  status: 'complete',
                });
              }
              if (!currentToolCall || currentToolCall !== toolCallDelta.function.name) {
                currentToolCall = toolCallDelta.function.name;
                currentToolCallId = toolCallDelta.id;
                currentToolArgs = '';
                onToolCall({
                  name: toolCallDelta.function.name,
                  arguments: {},
                  status: 'start',
                });
              }
            }
            if (toolCallDelta?.function?.arguments) {
              currentToolArgs += toolCallDelta.function.arguments;
            }
          }

          if (finishReason === 'tool_calls') {
            if (currentToolCall) {
              onToolCall({
                name: currentToolCall,
                arguments: JSON.parse(currentToolArgs || '{}'),
                status: 'complete',
              });
            }
          }
        } catch (e) {
        }
      }
    }

    return { finishReason, assistantMessage, toolCall: currentToolCall, toolArgs: currentToolArgs, toolCallId: currentToolCallId };
  }

  while (true) {
    const { finishReason, assistantMessage, toolCall, toolArgs, toolCallId } = await makeRequest(allMessages);

    if (finishReason !== 'tool_calls') {
      break;
    }

    if (toolCall) {
      const toolResult = await executeTool(toolCall, JSON.parse(toolArgs || '{}'));
      onToolCall({
        name: toolCall,
        arguments: JSON.parse(toolArgs || '{}'),
        result: toolResult,
        status: 'result',
      });

      allMessages.push({
        role: 'assistant',
        content: assistantMessage,
        tool_calls: [{
          id: toolCallId || `call_${Date.now()}`,
          type: 'function',
          function: {
            name: toolCall,
            arguments: toolArgs,
          },
        }],
      });

      allMessages.push({
        role: 'tool',
        tool_call_id: toolCallId || `call_${Date.now()}`,
        content: JSON.stringify(toolResult),
      });
    }
  }
}

export {
  buildSystemMessage,
  buildToolDefinitions,
  streamChat,
};
