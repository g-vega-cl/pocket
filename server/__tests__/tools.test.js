import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(true),
}));

describe('Tool Execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('read_file', () => {
    it('should read file contents', async () => {
      const fs = await import('fs');
      fs.readFileSync.mockReturnValue('file content');

      const { readFile } = await import('../tools/file.js');
      const result = readFile('/fake/path', 'test.txt');

      expect(result).toEqual({ content: 'file content' });
    });

    it('should throw error for non-existent file', async () => {
      const fs = await import('fs');
      fs.existsSync.mockReturnValue(false);

      const { readFile } = await import('../tools/file.js');

      expect(() => readFile('/fake/path', 'nonexistent.txt')).toThrow(
        'File not found: nonexistent.txt'
      );
    });
  });

  describe('write_file', () => {
    it('should write content to file', async () => {
      const fs = await import('fs');

      const { writeFile } = await import('../tools/file.js');
      const result = writeFile('/fake/path', 'test.txt', 'new content');

      expect(result).toEqual({ success: true, path: 'test.txt' });
      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('run_command', () => {
    it('should execute commands', async () => {
      const { runCommand } = await import('../tools/command.js');
      expect(typeof runCommand).toBe('function');
    });
  });

  describe('git operations', () => {
    it('should have gitClone function', async () => {
      const { gitClone } = await import('../tools/git.js');
      expect(typeof gitClone).toBe('function');
    });

    it('should have gitCreateBranch function', async () => {
      const { gitCreateBranch } = await import('../tools/git.js');
      expect(typeof gitCreateBranch).toBe('function');
    });

    it('should have gitCommit function', async () => {
      const { gitCommit } = await import('../tools/git.js');
      expect(typeof gitCommit).toBe('function');
    });

    it('should have gitPush function', async () => {
      const { gitPush } = await import('../tools/git.js');
      expect(typeof gitPush).toBe('function');
    });
  });
});
