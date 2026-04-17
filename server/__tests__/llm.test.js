import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('LLM Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('OPENROUTER_API_KEY', 'test-api-key');
    vi.stubEnv('OPENROUTER_MODEL', 'anthropic/claude-3.5-sonnet');
  });

  describe('buildSystemMessage', () => {
    it('should include branch name in system prompt', async () => {
      const { buildSystemMessage } = await import('../llm.js');

      const message = buildSystemMessage('pocket/123-fix-bug', 'Fix the login bug', 'my-repo', '/tmp/pocket/test');
      const content = message.content;

      expect(content).toContain('pocket/123-fix-bug');
      expect(content).toContain('Fix the login bug');
      expect(content).toContain('my-repo');
      expect(content).toContain('/tmp/pocket/test');
    });

    it('should include tool descriptions', async () => {
      const { buildSystemMessage } = await import('../llm.js');

      const message = buildSystemMessage('pocket/test', 'Test task', 'repo', '/tmp/repo');

      expect(message.role).toBe('system');
      expect(message.content).toContain('read_file');
      expect(message.content).toContain('write_file');
      expect(message.content).toContain('git_commit');
      expect(message.content).toContain('github_create_pr');
    });
  });

  describe('buildToolDefinitions', () => {
    it('should return all tool definitions', async () => {
      const { buildToolDefinitions } = await import('../llm.js');

      const tools = buildToolDefinitions();

      expect(tools).toHaveLength(6);
      expect(tools.map(t => t.function.name)).toEqual([
        'read_file',
        'write_file',
        'run_command',
        'git_commit',
        'git_push',
        'github_create_pr',
      ]);
    });

    it('should have correct parameter schemas', async () => {
      const { buildToolDefinitions } = await import('../llm.js');

      const tools = buildToolDefinitions();
      const readFileTool = tools.find(t => t.function.name === 'read_file');

      expect(readFileTool.function.parameters.properties.path.type).toBe('string');
      expect(readFileTool.function.parameters.required).toContain('path');
    });
  });

  describe('streamChat', () => {
    it('should use default model when not specified', async () => {
      vi.stubEnv('OPENROUTER_MODEL', undefined);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: {
          getReader: () => ({
            read: vi.fn().mockResolvedValue({ done: true, value: new Uint8Array() }),
          }),
        },
      });

      const { streamChat } = await import('../llm.js');

      const chunks = [];
      await streamChat(
        [{ role: 'user', content: 'Hello' }],
        (chunk) => chunks.push(chunk),
        () => {},
        async () => ({ success: true })
      );

      expect(global.fetch).toHaveBeenCalled();
    });

    it('should handle delta.content as a plain string', async () => {
      const { streamChat } = await import('../llm.js');

      const chunks = [];
      let callCount = 0;
      const mockRead = () => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            done: false,
            value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello world"}}]}\n'),
          });
        }
        return Promise.resolve({ done: true, value: new Uint8Array() });
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: {
          getReader: () => ({ read: mockRead }),
        },
      });

      await streamChat(
        [{ role: 'user', content: 'Hi' }],
        (chunk) => chunks.push(chunk),
        () => {},
        async () => ({ success: true })
      );

      expect(chunks.join('')).toContain('Hello world');
    });

    it('should handle delta.content as a string', async () => {
      const { streamChat } = await import('../llm.js');

      const chunks = [];
      let callCount = 0;
      const mockRead = () => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            done: false,
            value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello world"}}]}\n'),
          });
        }
        return Promise.resolve({ done: true, value: new Uint8Array() });
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: {
          getReader: () => ({ read: mockRead }),
        },
      });

      await streamChat(
        [{ role: 'user', content: 'Hi' }],
        (chunk) => chunks.push(chunk),
        () => {},
        async () => ({ success: true })
      );

      expect(chunks.join('')).toContain('Hello world');
    });

    it('should handle delta.tool_calls for tool calls', async () => {
      const { streamChat } = await import('../llm.js');

      const toolCalls = [];
      let callCount = 0;
      const mockRead = () => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            done: false,
            value: new TextEncoder().encode('data: {"choices":[{"delta":{"tool_calls":[{"function":{"name":"read_file","arguments":"{\\"path\\":\\"test.js\\"}"},"id":"call_123"}]}}]}\n'),
          });
        }
        return Promise.resolve({ done: true, value: new Uint8Array() });
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: {
          getReader: () => ({ read: mockRead }),
        },
      });

      await streamChat(
        [{ role: 'user', content: 'Read the file' }],
        () => {},
        (toolCall) => toolCalls.push(toolCall),
        async () => ({ success: true })
      );

      expect(toolCalls.some(t => t.name === 'read_file' && t.status === 'start')).toBe(true);
    });

    it('should handle finish_reason tool_calls with multi-turn', async () => {
      const { streamChat } = await import('../llm.js');

      const toolCalls = [];
      let fetchCallCount = 0;

      global.fetch = vi.fn().mockImplementation(() => {
        const currentFetch = fetchCallCount++;
        const mockGetReader = () => {
          let readCount = 0;
          return {
            read: async () => {
              readCount++;
              if (currentFetch === 0) {
                if (readCount === 1) {
                  return {
                    done: false,
                    value: new TextEncoder().encode('data: {"choices":[{"delta":{"tool_calls":[{"function":{"name":"read_file","arguments":"{\\"path\\":\\"test.js\\"}"},"id":"call_123"}]}}]}\n'),
                  };
                }
                if (readCount === 2) {
                  return {
                    done: false,
                    value: new TextEncoder().encode('data: {"choices":[{"finish_reason":"tool_calls"}]}\n'),
                  };
                }
              } else {
                if (readCount === 1) {
                  return {
                    done: false,
                    value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"File contents here"}}]}\n'),
                  };
                }
              }
              return { done: true, value: new Uint8Array() };
            },
          };
        };
        return Promise.resolve({
          ok: true,
          body: {
            getReader: mockGetReader,
          },
        });
      });

      await streamChat(
        [{ role: 'user', content: 'Read the file' }],
        () => {},
        (toolCall) => toolCalls.push(toolCall),
        async () => ({ success: true })
      );

      const startCall = toolCalls.find(t => t.status === 'start');
      expect(startCall?.name).toBe('read_file');
      expect(startCall?.status).toBe('start');
      expect(fetchCallCount).toBe(2);
    });
  });
});
