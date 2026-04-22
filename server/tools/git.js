import { execSync, exec } from 'child_process';
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

  const entries = readdirSync(tempDir, { withFileTypes: true });
  const now = Date.now();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = join(tempDir, entry.name);
    const stats = statSync(fullPath);
    if (now - stats.mtimeMs > maxAgeMs) {
      rmSync(fullPath, { recursive: true, force: true });
    }
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

async function gitClone(repoUrl, token = process.env.GITHUB_TOKEN) {
  ensureTempDir();
  const { owner, repo } = parseRepoInfo(repoUrl);
  const destName = `${owner}-${repo}-${randomUUID().substring(0, 8)}`;
  const localPath = join(getTempDir(), destName);

  if (existsSync(localPath)) {
    execSync(`rm -rf ${localPath}`);
  }

  const effectiveToken = token || process.env.GITHUB_TOKEN;
  let authenticatedUrl = repoUrl;
  if (effectiveToken && repoUrl.includes('github.com')) {
    authenticatedUrl = repoUrl.replace('https://github.com', `https://${effectiveToken}@github.com`);
  }

  execSync(`git clone ${authenticatedUrl} ${localPath}`, { stdio: 'inherit' });

  return { localPath, owner, repo };
}

async function gitInit() {
  ensureTempDir();
  const destName = `local-${randomUUID().substring(0, 8)}`;
  const localPath = join(getTempDir(), destName);

  if (existsSync(localPath)) {
    execSync(`rm -rf ${localPath}`);
  }

  mkdirSync(localPath, { recursive: true });
  execSync(`git -C ${localPath} init`, { stdio: 'inherit' });
  execSync(`git -C ${localPath} config user.email "pocket-agent@local"`, { stdio: 'inherit' });
  execSync(`git -C ${localPath} config user.name "Pocket Agent"`, { stdio: 'inherit' });

  return { localPath };
}

async function gitCreateBranch(localPath, taskDescription) {
  const slug = slugify(taskDescription);
  const timestamp = Math.floor(Date.now() / 1000);
  const branchName = `pocket/${timestamp}-${slug}`;

  execSync(`git -C ${localPath} checkout -b ${branchName}`, { stdio: 'inherit' });

  return { branchName };
}

async function gitCommit(localPath, message) {
  execSync(`git -C ${localPath} add -A`, { stdio: 'inherit' });
  try {
    execSync(`git -C ${localPath} commit -m "${message.replace(/"/g, '\\"')}"`, { stdio: 'inherit' });
  } catch (e) {
    if (e.stderr?.toString().includes('nothing to commit')) {
      return { message: 'No changes to commit' };
    }
    throw e;
  }
  return { success: true };
}

async function gitPush(localPath, branchName, token = process.env.GITHUB_TOKEN) {
  let remoteUrl = execSync(`git -C ${localPath} remote get-url origin`).toString().trim();

  const effectiveToken = token || process.env.GITHUB_TOKEN;
  if (effectiveToken && remoteUrl.includes('github.com') && !remoteUrl.includes(`://${effectiveToken}@`)) {
    // Inject token if not already present
    const authenticatedUrl = remoteUrl.replace('https://github.com', `https://${effectiveToken}@github.com`);
    execSync(`git -C ${localPath} remote set-url origin ${authenticatedUrl}`);
  }

  execSync(`git -C ${localPath} push -u origin ${branchName}`, { stdio: 'inherit' });
  return { success: true };
}

async function gitStatus(localPath) {
  const output = execSync(`git -C ${localPath} status --porcelain`).toString();
  return { dirty: output.trim().length > 0 };
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
