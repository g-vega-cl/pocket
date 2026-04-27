import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { readFileTool } from '../read-file.js'
import type { ToolContext } from '@pocket/core'

describe('readFile tool', () => {
  let tmpDir: string
  let ctx: ToolContext

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `pocket-tool-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    fs.mkdirSync(tmpDir, { recursive: true })
    ctx = {
      sessionId: 'test-session',
      workspaceRoot: tmpDir,
      resolvePath: (inputPath: string) => {
        const resolved = path.resolve(tmpDir, inputPath)
        if (!resolved.startsWith(tmpDir)) {
          throw new Error(`Path escapes workspace: ${inputPath}`)
        }
        return resolved
      },
    }
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should have the correct name', () => {
    expect(readFileTool.name).toBe('read_file')
  })

  it('should be read-only', () => {
    expect(readFileTool.isReadOnly).toBe(true)
  })

  it('should have default permission allow', () => {
    expect(readFileTool.defaultPermission).toBe('allow')
  })

  it('should read file contents', async () => {
    fs.writeFileSync(path.join(tmpDir, 'test.txt'), 'Hello, world!')

    const gen = readFileTool.call({ path: 'test.txt' }, ctx)
    let lastResult = await gen.next()
    while (!lastResult.done) {
      lastResult = await gen.next()
    }

    expect(lastResult.value).toBe('Hello, world!')
  })

  it('should throw for file outside workspace', async () => {
    await expect(async () => {
      for await (const _ of readFileTool.call({ path: '../outside.txt' }, ctx)) {
        // should throw
      }
    }).rejects.toThrow(/escapes workspace/)
  })

  it('should throw for non-existent file', async () => {
    await expect(async () => {
      for await (const _ of readFileTool.call({ path: 'nonexistent.txt' }, ctx)) {
        // should throw
      }
    }).rejects.toThrow()
  })

  it('should yield progress then return content', async () => {
    fs.writeFileSync(path.join(tmpDir, 'data.txt'), 'some data')

    const yielded: Array<{ type: string }> = []
    const gen = readFileTool.call({ path: 'data.txt' }, ctx)
    let lastResult = await gen.next()
    while (!lastResult.done) {
      yielded.push(lastResult.value as { type: string })
      lastResult = await gen.next()
    }

    expect(yielded.length).toBeGreaterThan(0)
    expect(yielded[0].type).toBe('progress')
    expect(lastResult.value).toBe('some data')
  })

  it('should validate schema — reject missing path', () => {
    const result = readFileTool.inputSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('should validate schema — accept valid path', () => {
    const result = readFileTool.inputSchema.safeParse({ path: 'foo.txt' })
    expect(result.success).toBe(true)
  })
})
