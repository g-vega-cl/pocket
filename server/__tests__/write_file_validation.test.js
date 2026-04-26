import { describe, it, expect } from 'vitest';

describe('write_file argument validation', () => {
  // Test the validation logic directly
  const validateWriteFileArgs = (args) => {
    if (!args.path) {
      return { error: 'Missing required argument: path' };
    }
    if (args.content === undefined || args.content === null) {
      return { error: 'Missing required argument: content' };
    }
    return null;
  };

  it('should return error when path is missing', () => {
    const result = validateWriteFileArgs({ content: 'some content' });
    expect(result).toEqual({ error: 'Missing required argument: path' });
  });

  it('should return error when content is undefined', () => {
    const result = validateWriteFileArgs({ path: 'test.txt' });
    expect(result).toEqual({ error: 'Missing required argument: content' });
  });

  it('should return error when content is null', () => {
    const result = validateWriteFileArgs({ path: 'test.txt', content: null });
    expect(result).toEqual({ error: 'Missing required argument: content' });
  });

  it('should return null when both path and content are provided', () => {
    const result = validateWriteFileArgs({ path: 'test.txt', content: 'some content' });
    expect(result).toBe(null);
  });

  it('should return null when content is empty string', () => {
    const result = validateWriteFileArgs({ path: 'test.txt', content: '' });
    expect(result).toBe(null);
  });

  it('should handle edge case with empty path', () => {
    const result = validateWriteFileArgs({ path: '', content: 'some content' });
    // Empty string is falsy with ! operator, so it should return error
    expect(result).toEqual({ error: 'Missing required argument: path' });
  });
});
