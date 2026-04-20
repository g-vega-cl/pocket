import { describe, it, expect, beforeEach, vi } from 'vitest';
import { gitInit } from '../tools/git.js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

describe('gitInit', () => {
  it('should initialize a new git repository in a temp folder', async () => {
    const { localPath } = await gitInit();
    expect(localPath).toContain('/tmp/pocket/local-');
    expect(existsSync(join(localPath, '.git'))).toBe(true);

    // Check if user config is set
    const config = readFileSync(join(localPath, '.git/config'), 'utf-8');
    expect(config).toContain('pocket-agent@local');
  });
});
