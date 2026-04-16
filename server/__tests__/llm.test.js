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

      const message = buildSystemMessage('pocket/123-fix-bug', 'Fix the login bug');
      const content = message.content;

      expect(content).toContain('pocket/123-fix-bug');
      expect(content).toContain('Fix the login bug');
    });

    it('should include tool descriptions', async () => {
      const { buildSystemMessage } = await import('../llm.js');

      const message = buildSystemMessage('pocket/test', 'Test task');

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
        () => {}
      );

      expect(global.fetch).toHaveBeenCalled();
    });
  });
});
