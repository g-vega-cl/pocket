import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecSync = vi.fn();
const mockExistsSync = vi.fn();

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: vi.fn(),
}));

describe('Git Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  describe('parseRepoInfo', () => {
    it('should parse github.com URLs correctly', async () => {
      const { parseRepoInfo } = await import('../tools/git.js');

      const result = parseRepoInfo('https://github.com/owner/repo');
      expect(result).toEqual({ owner: 'owner', repo: 'repo' });
    });

    it('should parse github.com URLs with .git suffix', async () => {
      const { parseRepoInfo } = await import('../tools/git.js');

      const result = parseRepoInfo('https://github.com/owner/repo.git');
      expect(result).toEqual({ owner: 'owner', repo: 'repo' });
    });

    it('should parse SSH URLs', async () => {
      const { parseRepoInfo } = await import('../tools/git.js');

      const result = parseRepoInfo('git@github.com:owner/repo.git');
      expect(result).toEqual({ owner: 'owner', repo: 'repo' });
    });

    it('should throw on invalid URLs', async () => {
      const { parseRepoInfo } = await import('../tools/git.js');

      expect(() => parseRepoInfo('invalid-url')).toThrow('Invalid GitHub URL');
    });
  });

  describe('slugify', () => {
    it('should convert text to lowercase slug', async () => {
      const { slugify } = await import('../tools/git.js');

      expect(slugify('Hello World')).toBe('hello-world');
    });

    it('should remove special characters', async () => {
      const { slugify } = await import('../tools/git.js');

      expect(slugify('Fix #123 Bug!')).toBe('fix-123-bug');
    });

    it('should limit slug length to 50 characters', async () => {
      const { slugify } = await import('../tools/git.js');

      const longText = 'a'.repeat(60);
      expect(slugify(longText).length).toBeLessThanOrEqual(50);
    });

    it('should trim leading/trailing dashes', async () => {
      const { slugify } = await import('../tools/git.js');

      expect(slugify('---hello---')).toBe('hello');
    });
  });

  describe('gitPush', () => {
    it('should call execSync with correct git push command', async () => {
      const { gitPush } = await import('../tools/git.js');

      await gitPush('/tmp/pocket/test', 'pocket/123-test-branch');

      expect(mockExecSync).toHaveBeenCalledWith(
        'git -C /tmp/pocket/test push -u origin pocket/123-test-branch',
        { stdio: 'inherit' }
      );
    });
  });

  describe('gitStatus', () => {
    it('should return dirty: true when there are changes', async () => {
      const { gitStatus } = await import('../tools/git.js');

      mockExecSync.mockReturnValue(' M file1.js\n?? file2.js\n');

      const result = await gitStatus('/tmp/pocket/test');

      expect(result).toEqual({ dirty: true });
    });

    it('should return dirty: false when there are no changes', async () => {
      const { gitStatus } = await import('../tools/git.js');

      mockExecSync.mockReturnValue('');

      const result = await gitStatus('/tmp/pocket/test');

      expect(result).toEqual({ dirty: false });
    });
  });
});
