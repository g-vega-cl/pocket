import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';

function readFile(localPath, filePath) {
  const fullPath = resolve(localPath, filePath);

  if (!existsSync(fullPath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = readFileSync(fullPath, 'utf-8');
  return { content };
}

function writeFile(localPath, filePath, content) {
  const fullPath = resolve(localPath, filePath);
  writeFileSync(fullPath, content, 'utf-8');
  return { success: true, path: filePath };
}

function listFiles(localPath, extension = null) {
  let cmd = `find ${localPath} -type f -name "*.${extension}" 2>/dev/null | head -100`;
  if (!extension) {
    cmd = `find ${localPath} -type f ! -path "*/.git/*" 2>/dev/null | head -100`;
  }
  const output = execSync(cmd).toString();
  return output.trim().split('\n').filter(Boolean);
}

export {
  readFile,
  writeFile,
  listFiles,
};
