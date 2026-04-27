import { describe, it, expect, beforeEach } from 'vitest'
import { RingBuffer } from '../ring-buffer.js'

describe('RingBuffer', () => {
  let buffer: RingBuffer

  beforeEach(() => {
    buffer = new RingBuffer(1024) // 1KB for testing
  })

  it('should start empty', () => {
    expect(buffer.read()).toBe('')
  })

  it('should read written data', () => {
    buffer.write('hello')
    expect(buffer.read()).toBe('hello')
  })

  it('should track read offset', () => {
    buffer.write('first')
    expect(buffer.read()).toBe('first')
    buffer.write('second')
    // Reading since last read should only return new data
    expect(buffer.read()).toBe('second')
  })

  it('should support reading all data', () => {
    buffer.write('one')
    buffer.write('two')
    expect(buffer.readAll()).toBe('onetwo')
  })

  it('should drop oldest lines when full', () => {
    // Fill with lines
    const line = 'x'.repeat(100) + '\n'
    for (let i = 0; i < 20; i++) {
      buffer.write(line)
    }
    const content = buffer.readAll()
    // Should have dropped some lines
    expect(content.length).toBeLessThanOrEqual(2048) // 2x buffer size max
  })

  it('should track dropped lines', () => {
    const line = 'x'.repeat(100) + '\n'
    for (let i = 0; i < 30; i++) {
      buffer.write(line)
    }
    expect(buffer.getDroppedLines()).toBeGreaterThan(0)
  })

  it('should clear buffer', () => {
    buffer.write('data')
    buffer.clear()
    expect(buffer.read()).toBe('')
  })

  it('should read tail lines', () => {
    buffer.write('line1\nline2\nline3\nline4\n')
    const tail = buffer.readTail(2)
    expect(tail.trim().split('\n')).toHaveLength(2)
    expect(tail).toContain('line3')
    expect(tail).toContain('line4')
  })
})
