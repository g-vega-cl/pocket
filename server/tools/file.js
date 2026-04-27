import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { execSync } from 'child_process';

function readFile(localPath, filePath) {
  try {
    const fullPath = resolve(localPath, filePath);

    if (!existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = readFileSync(fullPath, 'utf-8');
    return { content };
  } catch (error) {
    console.error(`[File] readFile error: ${error.message}`);
    throw error;
  }
}

function writeFile(localPath, filePath, content) {
  try {
    const fullPath = resolve(localPath, filePath);
    writeFileSync(fullPath, content, 'utf-8');
    return { success: true, path: filePath };
  } catch (error) {
    console.error(`[File] writeFile error: ${error.message}`);
    throw error;
  }
}

function listFiles(localPath, extension = null) {
  try {
    const safeLocalPath = localPath.replace(/"/g, '\\"');
    let cmd;
    
    if (extension) {
      const safeExt = extension.replace(/"/g, '\\"');
      cmd = `find "${safeLocalPath}" -type f -name "*.${safeExt}" 2>/dev/null | head -100`;
    } else {
      cmd = `find "${safeLocalPath}" -type f ! -path "*/.git/*" 2>/dev/null | head -100`;
    }
    
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 30000 });
    return output.trim().split('\n').filter(Boolean);
  } catch (error) {
    console.error(`[File] listFiles error: ${error.message}`);
    return [];
  }
}

export {
  readFile,
  writeFile,
  listFiles,
};