export class RingBuffer {
  private buffer: string[] = []
  private currentSize = 0
  private maxSize: number
  private readOffset = 0
  private totalDropped = 0

  constructor(maxSize: number) {
    this.maxSize = maxSize
  }

  write(data: string): void {
    this.buffer.push(data)
    this.currentSize += data.length

    // Drop oldest complete lines if over capacity
    while (this.currentSize > this.maxSize && this.buffer.length > 0) {
      const oldest = this.buffer[0]
      this.buffer.shift()
      this.currentSize -= oldest.length
      this.readOffset = Math.max(0, this.readOffset - oldest.length)
      this.totalDropped++
    }
  }

  read(): string {
    const all = this.buffer.join('')
    const newData = all.substring(this.readOffset)
    this.readOffset = all.length
    return newData
  }

  readAll(): string {
    return this.buffer.join('')
  }

  readTail(lines: number): string {
    const all = this.buffer.join('')
    const allLines = all.split('\n').filter(Boolean)
    return allLines.slice(-lines).join('\n')
  }

  getDroppedLines(): number {
    return this.totalDropped
  }

  clear(): void {
    this.buffer = []
    this.currentSize = 0
    this.readOffset = 0
    this.totalDropped = 0
  }
}
