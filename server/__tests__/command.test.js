import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

describe('Command Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runCommand', () => {
    it('should return stdout on successful command', async () => {
      exec.mockImplementation((cmd, opts, callback) => {
        callback(null, { stdout: 'command output', stderr: '' });
      });

      const { runCommand } = await import('../tools/command.js');
      const result = await runCommand('/fake/path', 'echo hello');

      expect(result.success).toBe(true);
      expect(result.stdout).toBe('command output');
      expect(result.stderr).toBe('');
    });

    it('should return stderr on failed command', async () => {
      exec.mockImplementation((cmd, opts, callback) => {
        callback({ stderr: 'error message' }, { stdout: '', stderr: 'error message' });
      });

      const { runCommand } = await import('../tools/command.js');
      const result = await runCommand('/fake/path', 'invalid-command');

      expect(result.success).toBe(false);
      expect(result.stderr).toContain('error message');
    });

    it('should handle commands with no output', async () => {
      exec.mockImplementation((cmd, opts, callback) => {
        callback(null, { stdout: '', stderr: '' });
      });

      const { runCommand } = await import('../tools/command.js');
      const result = await runCommand('/fake/path', 'true');

      expect(result.success).toBe(true);
      expect(result.stdout).toBe('');
    });
  });
});
