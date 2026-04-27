import { execSync, exec, spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';

function getTempDir() {
  return join(tmpdir(), 'pocket');
}

async function cleanupTempDirs(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  const tempDir = getTempDir();
  if (!existsSync(tempDir)) return;

  try {
    const entries = readdirSync(tempDir, { withFileTypes: true });
    const now = Date.now();

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = join(tempDir, entry.name);
      try {
        const stats = statSync(fullPath);
        if (now - stats.mtimeMs > maxAgeMs) {
          rmSync(fullPath, { recursive: true, force: true });
        }
      } catch (e) {
        // Ignore errors reading individual entries
      }
    }
  } catch (e) {
    console.error('[Git] Error cleaning up temp dirs:', e.message);
  }
}

cleanupTempDirs().catch(() => {});

function ensureTempDir() {
  const tempDir = getTempDir();
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }
}

function parseRepoInfo(repoUrl) {
  const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (!match) {
    throw new Error('Invalid GitHub URL');
  }
  return { owner: match[1], repo: match[2] };
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

async function gitClone(repoUrl, token = process.env.GITHUB_TOKEN, timeoutMs = 300000) {
  ensureTempDir();
  
  try {
    const { owner, repo } = parseRepoInfo(repoUrl);
    const destName = `${owner}-${repo}-${randomUUID().substring(0, 8)}`;
    const localPath = join(getTempDir(), destName);

    if (existsSync(localPath)) {
      try {
        rmSync(localPath, { recursive: true, force: true });
      } catch (e) {
        // Ignore cleanup errors
      }
    }

    const effectiveToken = token || process.env.GITHUB_TOKEN;
    let authenticatedUrl = repoUrl;
    if (effectiveToken && repoUrl.includes('github.com')) {
      authenticatedUrl = repoUrl.replace('https://github.com', `https://${effectiveToken}@github.com`);
    }

    return new Promise((resolve, reject) => {
      const git = spawn('git', ['clone', authenticatedUrl, localPath], { 
        stdio: 'inherit',
      });

      const timeout = setTimeout(() => {
        git.kill();
        reject(new Error(`Clone timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);

      git.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve({ localPath, owner, repo });
        } else {
          reject(new Error(`git clone exited with code ${code}`));
        }
      });

      git.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  } catch (error) {
    console.error('[Git] Clone failed:', error.message);
    throw error;
  }
}

async function gitInit() {
  ensureTempDir();
  
  try {
    const destName = `local-${randomUUID().substring(0, 8)}`;
    const localPath = join(getTempDir(), destName);

    if (existsSync(localPath)) {
      try {
        rmSync(localPath, { recursive: true, force: true });
      } catch (e) {
        // Ignore cleanup errors
      }
    }

    mkdirSync(localPath, { recursive: true });
    execSync(`git -C ${localPath} init`, { stdio: 'inherit' });
    execSync(`git -C ${localPath} config user.email "pocket-agent@local"`, { stdio: 'inherit' });
    execSync(`git -C ${localPath} config user.name "Pocket Agent"`, { stdio: 'inherit' });

    return { localPath };
  } catch (error) {
    console.error('[Git] Init failed:', error.message);
    throw error;
  }
}

async function gitCreateBranch(localPath, taskDescription) {
  try {
    const slug = slugify(taskDescription);
    const timestamp = Math.floor(Date.now() / 1000);
    const branchName = `pocket/${timestamp}-${slug}`;

    execSync(`git -C ${localPath} checkout -b ${branchName}`, { stdio: 'inherit' });

    return { branchName };
  } catch (error) {
    console.error('[Git] Create branch failed:', error.message);
    throw error;
  }
}

async function gitCommit(localPath, message) {
  try {
    execSync(`git -C ${localPath} add -A`, { stdio: 'inherit' });
    
    const safeMessage = message.replace(/"/g, '\\"');
    try {
      execSync(`git -C ${localPath} commit -m "${safeMessage}"`, { stdio: 'inherit' });
    } catch (e) {
      const stderr = e.stderr?.toString() || e.message || '';
      if (stderr.includes('nothing to commit') || stderr.includes('no changes added')) {
        return { message: 'No changes to commit' };
      }
      throw e;
    }
    return { success: true };
  } catch (error) {
    console.error('[Git] Commit failed:', error.message);
    throw error;
  }
}

async function gitPush(localPath, branchName, token = process.env.GITHUB_TOKEN) {
  try {
    const effectiveBranch = branchName || execSync(`git -C ${localPath} rev-parse --abbrev-ref HEAD`).toString().trim();

    let remoteUrl = execSync(`git -C ${localPath} remote get-url origin`).toString().trim();

    const effectiveToken = token || process.env.GITHUB_TOKEN;
    if (effectiveToken && remoteUrl.includes('github.com') && !remoteUrl.includes(`://${effectiveToken}@`)) {
      const authenticatedUrl = remoteUrl.replace('https://github.com', `https://${effectiveToken}@github.com`);
      execSync(`git -C ${localPath} remote set-url origin ${authenticatedUrl}`);
    }

    execSync(`git -C ${localPath} push -u origin ${effectiveBranch}`, { stdio: 'inherit' });
    return { success: true };
  } catch (error) {
    console.error('[Git] Push failed:', error.message);
    throw error;
  }
}

async function gitStatus(localPath) {
  try {
    const output = execSync(`git -C ${localPath} status --porcelain`, { stdio: 'pipe', encoding: 'utf-8' });
    return { dirty: output.trim().length > 0 };
  } catch (error) {
    console.error('[Git] Status failed:', error.message);
    return { dirty: false };
  }
}

export {
  gitClone,
  gitInit,
  gitCreateBranch,
  gitCommit,
  gitPush,
  gitStatus,
  parseRepoInfo,
  slugify,
  getTempDir,
  cleanupTempDirs,
};