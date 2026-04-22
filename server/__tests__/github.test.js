import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

describe('GitHub Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createPullRequest', () => {
    it('should be a function', async () => {
      const { createPullRequest } = await import('../tools/github.js');
      expect(typeof createPullRequest).toBe('function');
    });

    it('should take localPath, branchName, title, body, and optional token', async () => {
      const { createPullRequest } = await import('../tools/github.js');
      expect(createPullRequest.length).toBe(4); // Only positional arguments are counted
    });
  });

  describe('ensurePocketBranch', () => {
    it('should be a function', async () => {
      const { ensurePocketBranch } = await import('../tools/github.js');
      expect(typeof ensurePocketBranch).toBe('function');
    });
  });
});
