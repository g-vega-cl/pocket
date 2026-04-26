import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'xiaomi/mimo-v2-flash';

// Helper: Validate JSON string
function isValidJSON(str) {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

// Helper: Fallback extraction using safe regex
function extractArgumentsFallback(str) {
  const keyRegex = /"([^"\\]*(?:\\.[^"\\]*)*)"/g;
  const matches = [...str.matchAll(keyRegex)];
  
  if (matches.length >= 4) {
    let pathIdx = -1;
    let contentIdx = -1;
    
    for (let i = 0; i < matches.length; i++) {
      if (matches[i][1] === 'path') pathIdx = i + 1;
      if (matches[i][1] === 'content') contentIdx = i + 1;
    }
    
    if (pathIdx > 0 && pathIdx < matches.length && 
        contentIdx > 0 && contentIdx < matches.length) {
      return {
        path: matches[pathIdx][1],
        content: matches[contentIdx][1]
      };
    }
  }
  return null;
}

// Helper: Log malformed JSON to file with auto-cleanup
function logMalformedJSON(data) {
  const logDir = path.join(__dirname, 'logs');
  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    // Auto-cleanup: Delete logs older than 7 days
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    
    fs.readdirSync(logDir).forEach(file => {
      const filePath = path.join(logDir, file);
      try {
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > sevenDaysMs) {
          fs.unlinkSync(filePath);
        }
      } catch (e) {
        // Ignore errors when reading file stats
      }
    });
    
    // Create new log file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(logDir, `malformed-json-${timestamp}.log`);
    
    const logData = {
      timestamp: new Date().toISOString(),
      toolCall: data.toolCall,
      rawArguments: data.arguments,
      error: data.error,
    };
    
    fs.writeFileSync(logFile, JSON.stringify(logData, null, 2));
    console.log(`[LLM] Malformed JSON logged to ${logFile}`);
  } catch (e) {
    console.error('[LLM] Failed to log malformed JSON:', e);
  }
}

const SYSTEM_PROMPT = `You are Pocket, an autonomous coding agent.

Repository "{repoName}" has been cloned to: {localPath}
You're on branch: {branchName}

Your task: {taskDescription}

# Interaction Rules
1. For greetings/conversation: Respond naturally without using tools
2. For repository questions: Explore using tools ONCE, then answer based on results
3. Do NOT loop - after exploring, answer the user's question directly
4. Read files to understand the codebase before making changes
5. Make necessary changes, run tests with run_command
6. When done: git_commit → git_push → github_create_pr

# Available Tools
- read_file(path) - Read a file, returns content (use absolute path: {localPath}/<path>)
- write_file(path, content) - Write/modify a file
- run_command(cmd) - Execute a shell command
- git_commit(message) - Commit staged changes
- git_push() - Push to remote
- github_create_pr(title, body) - Create a GitHub pull request

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
    console.log(`[LLM] Making request to ${model}...`);
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
      console.error(`[LLM] Error: ${response.status} - ${error}`);
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

          // DEBUG: Log delta structure to both server console and client
          if (delta?.content || delta?.tool_calls) {
            const logMsg = {
              type: 'debug',
              data: {
                source: 'llm_delta',
                hasContent: !!delta.content,
                hasToolCalls: !!delta.tool_calls,
                contentLength: delta.content?.length || 0,
                toolCallsCount: delta.tool_calls?.length || 0,
                finishReason: finishReason
              }
            };
            console.log('[LLM] Delta:', logMsg.data);
            if (onRaw) onRaw(logMsg);
          }

          if (delta?.content && typeof delta.content === 'string' && delta.content) {
            assistantMessage += delta.content;
            onChunk(delta.content);
          }

          if (delta?.reasoning_content || delta?.reasoning) {
            const r = delta?.reasoning_content || delta?.reasoning;
            // Defensive coding: only call onReasoning with valid string values
            if (r !== undefined && r !== null && r !== '') {
              onReasoning(r);
            }
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

        } catch (e) {
          console.error('[LLM] Error parsing delta:', e);
        }
      }
    }

    // Finalize any pending tool call after stream ends
    const MAX_RETRIES = 3;
    let retryCount = 0;
    
    if (currentToolCall) {
      try {
        let parsedArgs;
        
        if (isValidJSON(currentToolArgs)) {
          parsedArgs = JSON.parse(currentToolArgs);
        } else {
          // Attempt fallback extraction
          console.warn('[LLM] Malformed JSON, attempting fallback extraction');
          parsedArgs = extractArgumentsFallback(currentToolArgs);
          
          if (!parsedArgs) {
            throw new Error('Fallback extraction failed');
          }
        }
        
        onToolCall({
          id: currentToolCallId,
          name: currentToolCall,
          arguments: parsedArgs,
          status: 'complete',
        });
      } catch (e) {
        console.error('[LLM] Error finalizing tool call:', e);
        
        // Log malformed JSON for debugging
        logMalformedJSON({
          toolCall: currentToolCall,
          arguments: currentToolArgs,
          error: e.message,
        });
        
        // Handle retry logic
        if (retryCount < MAX_RETRIES) {
          retryCount++;
          console.warn(`[LLM] Retry ${retryCount}/${MAX_RETRIES} for tool call`);
          // Return status to trigger retry
          onToolCall({
            id: currentToolCallId,
            name: currentToolCall,
            arguments: {},
            status: 'retry',
            error: e.message,
          });
        } else {
          // Max retries reached, return error
          onToolCall({
            id: currentToolCallId,
            name: currentToolCall,
            arguments: {},
            status: 'error',
            error: `Max retries (${MAX_RETRIES}) exceeded: ${e.message}`,
          });
        }
      }
    }

    return { finishReason, assistantMessage, toolCall: currentToolCall, toolArgs: currentToolArgs, toolCallId: currentToolCallId };
  }

  while (true) {
    const { finishReason, assistantMessage, toolCall, toolArgs, toolCallId } = await makeRequest(allMessages);

    // DEBUG: Log what the LLM returned
    const debugMsg = {
      type: 'debug',
      data: {
        source: 'llm_complete',
        finishReason,
        assistantMessageLength: assistantMessage.length,
        hasToolCall: !!toolCall,
        toolCallName: toolCall || null
      }
    };
    console.log('[LLM] Complete:', debugMsg.data);
    if (onRaw) onRaw(debugMsg);

    // Some models might not use 'tool_calls' as finishReason but still provide tool calls
    if (!toolCall && finishReason !== 'tool_calls') {
      break;
    }

    if (toolCall) {
      console.log(`[Tool] Executing ${toolCall}...`);
      let parsedArgs = {};
      
      try {
        if (isValidJSON(toolArgs)) {
          parsedArgs = JSON.parse(toolArgs);
        } else {
          console.warn('[LLM] Malformed JSON in tool execution, attempting fallback');
          parsedArgs = extractArgumentsFallback(toolArgs);
          if (!parsedArgs) {
            throw new Error('Could not extract arguments from malformed JSON');
          }
        }
      } catch (e) {
        console.error(`[Tool] Error parsing arguments for ${toolCall}:`, e);
        
        // Log malformed JSON
        logMalformedJSON({
          toolCall: toolCall,
          arguments: toolArgs,
          error: e.message,
        });
        
        // Return error result instead of executing tool
        const errorResult = { error: e.message };
        onToolCall({
          id: toolCallId,
          name: toolCall,
          arguments: {},
          result: errorResult,
          status: 'result',
        });
        
        // Add tool call and error result to allMessages so LLM receives it in next request
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
          content: JSON.stringify(errorResult),
        });
        
        continue; // Skip to next iteration
      }
      
      // Validate arguments before execution
      if (!parsedArgs || Object.keys(parsedArgs).length === 0) {
        console.error(`[Tool] No valid arguments for ${toolCall}`);
        const errorResult = { error: 'No valid arguments provided' };
        onToolCall({
          id: toolCallId,
          name: toolCall,
          arguments: {},
          result: errorResult,
          status: 'result',
        });
        
        // Add tool call and error result to allMessages so LLM receives it in next request
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
          content: JSON.stringify(errorResult),
        });
        
        continue;
      }
      
      const toolResult = await executeTool(toolCall, parsedArgs);
      console.log(`[Tool] ${toolCall} completed.`);
      onToolCall({
        id: toolCallId,
        name: toolCall,
        arguments: parsedArgs,
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