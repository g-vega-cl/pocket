import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Tool Error Handling - Resilience', () => {
  describe('git.js', () => {
    it('gitStatus should return safe result on error instead of throwing', async () => {
      const { gitStatus } = await import('../tools/git.js');
      
      const result = await gitStatus('/nonexistent/path/to/repo');
      
      expect(result).toEqual({ dirty: false });
    });

    it('gitStatus should handle non-git directories gracefully', async () => {
      const { gitStatus } = await import('../tools/git.js');
      
      const result = await gitStatus('/tmp');
      
      expect(result).toEqual({ dirty: false });
    });
  });

  describe('file.js', () => {
    it('readFile should throw descriptive error for missing file', async () => {
      const { readFile } = await import('../tools/file.js');
      
      expect(() => readFile('/nonexistent', 'missing.txt')).toThrow('File not found');
    });

    it('writeFile should throw error for unwritable path', async () => {
      const { writeFile } = await import('../tools/file.js');
      
      expect(() => writeFile('/nonexistent', 'file.txt', 'content')).toThrow();
    });

    it('listFiles should return empty array on error instead of crashing', async () => {
      const { listFiles } = await import('../tools/file.js');
      
      const result = listFiles('/invalid/path/that/does/not/exist');
      
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual([]);
    });
  });

  describe('command.js', () => {
    it('runCommand should return error result instead of throwing', async () => {
      const { runCommand } = await import('../tools/command.js');
      
      const result = await runCommand('/nonexistent/path', 'invalid-command-xyz');
      
      expect(result).toHaveProperty('success', false);
      expect(result).toHaveProperty('error');
    });

    it('runCommand should handle invalid commands', async () => {
      const { runCommand } = await import('../tools/command.js');
      
      const result = await runCommand('/tmp', 'nonexistent-command-xyz-123');
      
      expect(result).toHaveProperty('success', false);
      expect(result).toHaveProperty('error');
    });
  });
});

describe('Error Handler Integration', () => {
  it('server index.js should be loadable without crashes', () => {
    // This verifies the global error handlers don't cause issues at startup
    expect(() => {
      // Just requiring should work - the handlers are registered at module load
      require('../index.js');
    }).not.toThrow();
  });
});