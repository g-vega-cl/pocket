import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';

const mockExecSync = vi.fn();
const mockExistsSync = vi.fn();
const mockReaddirSync = vi.fn();
const mockStatSync = vi.fn();
const mockRmSync = vi.fn();

vi.mock('os', () => ({
  tmpdir: () => '/mock-tmpdir',
}));

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: vi.fn(),
  readdirSync: mockReaddirSync,
  statSync: mockStatSync,
  rmSync: mockRmSync,
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

  describe('getTempDir', () => {
    it('should return a path containing pocket', async () => {
      const { getTempDir } = await import('../tools/git.js');

      const result = getTempDir();

      expect(result).toContain('pocket');
    });

    it('should use system tmpdir', async () => {
      const { getTempDir } = await import('../tools/git.js');

      const result = getTempDir();

      expect(result).toContain(tmpdir());
    });

    it('should join tmpdir with pocket', async () => {
      const { getTempDir } = await import('../tools/git.js');

      const result = getTempDir();
      const expected = join(tmpdir(), 'pocket');

      expect(result).toBe(expected);
    });
  });

  describe('cleanupTempDirs', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockExistsSync.mockReturnValue(true);
    });

    it('should not throw if temp dir does not exist', async () => {
      mockExistsSync.mockReturnValue(false);
      const { cleanupTempDirs } = await import('../tools/git.js');

      await expect(cleanupTempDirs()).resolves.not.toThrow();
    });

    it('should remove directories older than 7 days by default', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([{ name: 'old-repo', isDirectory: () => true }]);
      mockStatSync.mockReturnValue({ isDirectory: () => true, mtimeMs: Date.now() - 8 * 24 * 60 * 60 * 1000 });

      const { cleanupTempDirs } = await import('../tools/git.js');

      await cleanupTempDirs();

      expect(mockRmSync).toHaveBeenCalled();
    });

    it('should not remove directories newer than 7 days', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([{ name: 'new-repo', isDirectory: () => true }]);
      mockStatSync.mockReturnValue({ isDirectory: () => true, mtimeMs: Date.now() });

      const { cleanupTempDirs } = await import('../tools/git.js');

      await cleanupTempDirs();

      expect(mockRmSync).not.toHaveBeenCalled();
    });

    it('should use custom maxAgeMs when provided', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([{ name: 'old-repo', isDirectory: () => true }]);
      mockStatSync.mockReturnValue({ isDirectory: () => true, mtimeMs: Date.now() - 2 * 24 * 60 * 60 * 1000 });

      const { cleanupTempDirs } = await import('../tools/git.js');

      await cleanupTempDirs(24 * 60 * 60 * 1000);

      expect(mockRmSync).toHaveBeenCalled();
    });

    it('should skip non-directory entries', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([{ name: 'file.txt', isDirectory: () => false }]);
      mockStatSync.mockReturnValue({ isDirectory: () => false });

      const { cleanupTempDirs } = await import('../tools/git.js');

      await cleanupTempDirs();

      expect(mockRmSync).not.toHaveBeenCalled();
    });
  });
});
