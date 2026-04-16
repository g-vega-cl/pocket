import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'fs';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

describe('File Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('readFile', () => {
    it('should read file contents successfully', async () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue('file contents');

      const { readFile } = await import('../tools/file.js');
      const result = readFile('/fake/local/path', 'test.txt');

      expect(result).toEqual({ content: 'file contents' });
      expect(readFileSync).toHaveBeenCalledWith(
        expect.stringContaining('test.txt'),
        'utf-8'
      );
    });

    it('should throw error for non-existent file', async () => {
      existsSync.mockReturnValue(false);

      const { readFile } = await import('../tools/file.js');

      expect(() => readFile('/fake/local/path', 'nonexistent.txt')).toThrow(
        'File not found: nonexistent.txt'
      );
    });
  });

  describe('writeFile', () => {
    it('should write content to file', async () => {
      const { writeFile } = await import('../tools/file.js');
      const result = writeFile('/fake/local/path', 'test.txt', 'new content');

      expect(result).toEqual({ success: true, path: 'test.txt' });
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('test.txt'),
        'new content',
        'utf-8'
      );
    });

    it('should return success with path', async () => {
      const { writeFile } = await import('../tools/file.js');
      const result = writeFile('/fake/local/path', 'subdir/test.txt', 'content');

      expect(result.success).toBe(true);
      expect(result.path).toBe('subdir/test.txt');
    });
  });
});
