import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
}));

describe('Git Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
