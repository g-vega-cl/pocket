import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockExistsSync = vi.fn();

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

vi.mock('fs', () => ({
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  existsSync: mockExistsSync,
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  rmSync: vi.fn(),
}));

describe('executeTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should pass branchName to gitPush for git_push tool', async () => {
    // We need to import index.js's executeTool, but it's not exported.
    // Instead, verify at the git.js boundary that a provided branchName is used.
    const { gitPush } = await import('../tools/git.js');

    mockExecSync.mockReturnValueOnce(Buffer.from('https://github.com/owner/repo.git'));

    await gitPush('/tmp/pocket/test', 'feature/my-branch');

    expect(mockExecSync).toHaveBeenCalledWith(
      'git -C /tmp/pocket/test push -u origin feature/my-branch',
      { stdio: 'inherit' }
    );
  });

  it('should fall back to current branch when gitPush receives null', async () => {
    const { gitPush } = await import('../tools/git.js');

    // Call order: rev-parse (fallback) → remote get-url origin → push
    mockExecSync
      .mockReturnValueOnce(Buffer.from('pocket/123-auto-branch\n'))
      .mockReturnValueOnce(Buffer.from('https://github.com/owner/repo.git'));

    await gitPush('/tmp/pocket/test', null);

    expect(mockExecSync).toHaveBeenCalledWith(
      'git -C /tmp/pocket/test rev-parse --abbrev-ref HEAD'
    );
    expect(mockExecSync).toHaveBeenCalledWith(
      'git -C /tmp/pocket/test push -u origin pocket/123-auto-branch',
      { stdio: 'inherit' }
    );
  });
});
