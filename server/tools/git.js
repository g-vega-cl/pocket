import { execSync, exec } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const TEMP_DIR = '/tmp/pocket';

function ensureTempDir() {
  if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true });
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

async function gitClone(repoUrl) {
  ensureTempDir();
  const { owner, repo } = parseRepoInfo(repoUrl);
  const destName = `${owner}-${repo}-${randomUUID().substring(0, 8)}`;
  const localPath = join(TEMP_DIR, destName);

  if (existsSync(localPath)) {
    execSync(`rm -rf ${localPath}`);
  }

  execSync(`git clone ${repoUrl} ${localPath}`, { stdio: 'inherit' });

  return { localPath, owner, repo };
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

async function gitPush(localPath, branchName) {
  execSync(`git -C ${localPath} push -u origin ${branchName}`, { stdio: 'inherit' });
  return { success: true };
}

async function gitStatus(localPath) {
  const output = execSync(`git -C ${localPath} status --porcelain`).toString();
  return { dirty: output.trim().length > 0 };
}

export {
  gitClone,
  gitCreateBranch,
  gitCommit,
  gitPush,
  gitStatus,
  parseRepoInfo,
  slugify,
};
