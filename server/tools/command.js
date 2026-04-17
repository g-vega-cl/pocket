import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function runCommand(localPath, command) {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: localPath,
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
    });

    return {
      stdout: stdout || '',
      stderr: stderr || '',
      success: true,
    };
  } catch (error) {
    return {
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      success: false,
      error: error.message,
    };
  }
}

export {
  runCommand,
};
