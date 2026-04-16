import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('GitHub Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createPullRequest', () => {
    it('should be a function', async () => {
      const { createPullRequest } = await import('../tools/github.js');
      expect(typeof createPullRequest).toBe('function');
    });

    it('should require localPath, branchName, title, and body', async () => {
      const { createPullRequest } = await import('../tools/github.js');
      expect(createPullRequest.length).toBe(4);
    });
  });

  describe('ensurePocketBranch', () => {
    it('should be a function', async () => {
      const { ensurePocketBranch } = await import('../tools/github.js');
      expect(typeof ensurePocketBranch).toBe('function');
    });
  });
});
