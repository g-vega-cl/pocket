import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { ToolContext } from '@pocket/core'
import {
  readFileTool,
  listFilesTool,
  writeFileTool,
  editFileTool,
  bashTool,
  grepTool,
  globTool,
  gitStatusTool,
  gitLogTool,
  gitDiffTool,
  planTool,
  todosWriteTool,
  webFetchTool,
  webSearchTool,
} from '../index.js'

describe('Tool interface compliance', () => {
  const tools = [
    readFileTool, listFilesTool, writeFileTool, editFileTool,
    bashTool, grepTool, globTool,
    gitStatusTool, gitLogTool, gitDiffTool,
    planTool, todosWriteTool, webFetchTool, webSearchTool,
  ]

  for (const tool of tools) {
    it(`${tool.name} should have required fields`, () => {
      expect(tool.name).toBeTruthy()
      expect(typeof tool.name).toBe('string')
      expect(tool.description).toBeTruthy()
      expect(typeof tool.description).toBe('string')
      expect(tool.inputSchema).toBeTruthy()
      expect(typeof tool.isReadOnly).toBe('boolean')
      expect(tool.defaultPermission).toBeTruthy()
      expect(typeof tool.call).toBe('function')
    })

    it(`${tool.name} should have unique name`, () => {
      const names = tools.map(t => t.name)
      const unique = new Set(names)
      expect(unique.size).toBe(names.length)
    })
  }

  it('should have correct read-only flags', () => {
    expect(readFileTool.isReadOnly).toBe(true)
    expect(listFilesTool.isReadOnly).toBe(true)
    expect(grepTool.isReadOnly).toBe(true)
    expect(globTool.isReadOnly).toBe(true)
    expect(gitStatusTool.isReadOnly).toBe(true)
    expect(gitLogTool.isReadOnly).toBe(true)
    expect(gitDiffTool.isReadOnly).toBe(true)
    expect(webFetchTool.isReadOnly).toBe(true)
    expect(webSearchTool.isReadOnly).toBe(true)

    expect(writeFileTool.isReadOnly).toBe(false)
    expect(editFileTool.isReadOnly).toBe(false)
    expect(bashTool.isReadOnly).toBe(false)
    expect(planTool.isReadOnly).toBe(false)
    expect(todosWriteTool.isReadOnly).toBe(false)
  })

  it('should have correct default permissions', () => {
    expect(readFileTool.defaultPermission).toBe('allow')
    expect(writeFileTool.defaultPermission).toBe('conditional')
    expect(editFileTool.defaultPermission).toBe('conditional')
    expect(bashTool.defaultPermission).toBe('rule-matched')
  })
})

describe('File tools integration', () => {
  let tmpDir: string
  let ctx: ToolContext

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `pocket-tool-it-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    fs.mkdirSync(tmpDir, { recursive: true })
    ctx = {
      sessionId: 'test',
      workspaceRoot: tmpDir,
      resolvePath: (inputPath: string) => {
        const resolved = path.resolve(tmpDir, inputPath)
        if (!resolved.startsWith(tmpDir)) throw new Error(`Path escapes workspace: ${inputPath}`)
        return resolved
      },
    }
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should read a file', async () => {
    fs.writeFileSync(path.join(tmpDir, 'hello.txt'), 'Hello, World!')
    const gen = readFileTool.call({ path: 'hello.txt' }, ctx)
    let result = await gen.next()
    while (!result.done) result = await gen.next()
    expect(result.value).toBe('Hello, World!')
  })

  it('should write a file', async () => {
    const gen = writeFileTool.call({ path: 'new.txt', content: 'New content' }, ctx)
    let result = await gen.next()
    while (!result.done) result = await gen.next()
    expect(result.value).toEqual({ success: true, path: 'new.txt' })
    expect(fs.readFileSync(path.join(tmpDir, 'new.txt'), 'utf-8')).toBe('New content')
  })

  it('should edit a file', async () => {
    fs.writeFileSync(path.join(tmpDir, 'data.txt'), 'Hello, World!')
    const gen = editFileTool.call({ path: 'data.txt', oldString: 'World', newString: 'Universe' }, ctx)
    let result = await gen.next()
    while (!result.done) result = await gen.next()
    expect(result.value).toEqual({ success: true, path: 'data.txt' })
    expect(fs.readFileSync(path.join(tmpDir, 'data.txt'), 'utf-8')).toBe('Hello, Universe!')
  })

  it('should throw on duplicate oldString in edit', async () => {
    fs.writeFileSync(path.join(tmpDir, 'dup.txt'), 'foo foo foo')
    await expect(async () => {
      const gen = editFileTool.call({ path: 'dup.txt', oldString: 'foo', newString: 'bar' }, ctx)
      let result = await gen.next()
      while (!result.done) result = await gen.next()
    }).rejects.toThrow(/Found 3 matches/)
  })

  it('should throw on missing oldString in edit', async () => {
    fs.writeFileSync(path.join(tmpDir, 'data.txt'), 'Hello')
    await expect(async () => {
      const gen = editFileTool.call({ path: 'data.txt', oldString: 'nonexistent', newString: 'x' }, ctx)
      let result = await gen.next()
      while (!result.done) result = await gen.next()
    }).rejects.toThrow(/oldString not found/)
  })

  it('should list files', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.ts'), '')
    fs.writeFileSync(path.join(tmpDir, 'b.ts'), '')
    fs.writeFileSync(path.join(tmpDir, 'c.js'), '')

    const gen = listFilesTool.call({}, ctx)
    let result = await gen.next()
    while (!result.done) result = await gen.next()
    const files = result.value as string[]
    expect(files.length).toBeGreaterThanOrEqual(3)
  })

  it('should list files with extension filter', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.ts'), '')
    fs.writeFileSync(path.join(tmpDir, 'b.ts'), '')
    fs.writeFileSync(path.join(tmpDir, 'c.js'), '')

    const gen = listFilesTool.call({ extension: 'ts' }, ctx)
    let result = await gen.next()
    while (!result.done) result = await gen.next()
    const files = result.value as string[]
    // All returned files should end with .ts
    for (const f of files) {
      expect(f.endsWith('.ts')).toBe(true)
    }
  })

  it('should run a bash command', async () => {
    const gen = bashTool.call({ command: 'echo "hello from bash"' }, ctx)
    let result = await gen.next()
    while (!result.done) result = await gen.next()
    const out = result.value as any
    expect(out.success).toBe(true)
    expect(out.stdout).toContain('hello from bash')
  })

  it('should return error for failed bash command', async () => {
    const gen = bashTool.call({ command: 'exit 1' }, ctx)
    let result = await gen.next()
    while (!result.done) result = await gen.next()
    const out = result.value as any
    expect(out.success).toBe(false)
  })

  it('should validate read_file schema', () => {
    expect(readFileTool.inputSchema.safeParse({ path: 'test.txt' }).success).toBe(true)
    expect(readFileTool.inputSchema.safeParse({}).success).toBe(false)
  })

  it('should validate write_file schema', () => {
    expect(writeFileTool.inputSchema.safeParse({ path: 'f.txt', content: 'x' }).success).toBe(true)
    expect(writeFileTool.inputSchema.safeParse({ path: 'f.txt' }).success).toBe(false)
    expect(writeFileTool.inputSchema.safeParse({ content: 'x' }).success).toBe(false)
  })

  it('should validate edit_file schema', () => {
    expect(editFileTool.inputSchema.safeParse({ path: 'f.txt', oldString: 'a', newString: 'b' }).success).toBe(true)
  })

  it('should validate bash schema', () => {
    expect(bashTool.inputSchema.safeParse({ command: 'ls' }).success).toBe(true)
    expect(bashTool.inputSchema.safeParse({}).success).toBe(false)
  })
})
