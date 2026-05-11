import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
  bootstrapRepoTool,
  createSaveSkillTool,
} from '../index.js'
import { LearningDB } from '@pocket/agent'

describe('Tool interface compliance', () => {
  // Create a temp LearningDB for the save_skill tool
  const tmpDir = import.meta.url.includes('test') ? undefined : undefined
  // Use a lazy factory pattern — the DB won't be used in interface checks
  const saveSkillTool = createSaveSkillTool(() => {
    // This is a test stub — the DB is never actually called during interface checks
    const stub = {} as LearningDB
    return stub
  })

  const tools = [
    readFileTool, listFilesTool, writeFileTool, editFileTool,
    bashTool, grepTool, globTool,
    gitStatusTool, gitLogTool, gitDiffTool,
    planTool, todosWriteTool, webFetchTool, webSearchTool,
    bootstrapRepoTool,
    saveSkillTool as any,
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

describe('Bash sandbox routing', () => {
  let tmpDir: string
  let ctx: ToolContext

  beforeEach(() => {
    vi.resetModules()
    tmpDir = path.join(os.tmpdir(), `pocket-sandbox-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    fs.mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should fall back to direct exec when ctx.sandboxImage is not set (default behavior)', async () => {
    ctx = {
      sessionId: 'test-direct',
      workspaceRoot: tmpDir,
      resolvePath: (inputPath: string) => {
        const resolved = path.resolve(tmpDir, inputPath)
        if (!resolved.startsWith(tmpDir)) throw new Error(`Path escapes workspace: ${inputPath}`)
        return resolved
      },
    }

    const gen = bashTool.call({ command: 'echo "host"' }, ctx)
    let result = await gen.next()
    while (!result.done) result = await gen.next()
    const out = result.value as any

    expect(out.success).toBe(true)
    expect(out.stdout).toContain('host')
  })

  it('should attempt sandbox when ctx.sandboxImage is set (persistent container)', async () => {
    ctx = {
      sessionId: 'test-sandbox-persistent',
      workspaceRoot: tmpDir,
      sandboxImage: 'nikolaik/python-nodejs:python3.12-nodejs22',
      resolvePath: (inputPath: string) => {
        const resolved = path.resolve(tmpDir, inputPath)
        if (!resolved.startsWith(tmpDir)) throw new Error(`Path escapes workspace: ${inputPath}`)
        return resolved
      },
    }

    // On machines with podman, persistent container should work
    // On machines without podman, it should return an error via the bash tool
    const gen = bashTool.call({ command: 'echo "hello from container"' }, ctx)
    let result = await gen.next()
    while (!result.done) result = await gen.next()
    const out = result.value as any

    if (out.success) {
      expect(out.stdout).toContain('hello from container')
    } else {
      expect(out.stderr).toMatch(/podman|sandbox|container/i)
    }
  })
})

describe('Bootstrap tool', () => {
  let tmpDir: string
  let ctx: ToolContext

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `pocket-bootstrap-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    fs.mkdirSync(tmpDir, { recursive: true })
    ctx = {
      sessionId: 'test-bootstrap',
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

  it('should detect Node.js project with npm', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'test-project',
      scripts: {
        dev: 'vite',
        build: 'vite build',
        test: 'vitest',
      },
      dependencies: { react: '^18.0.0' },
      devDependencies: { vite: '^5.0.0' },
    }))
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}')

    const gen = bootstrapRepoTool.call({}, ctx)
    let result = await gen.next()
    while (!result.done) result = await gen.next()
    const out = result.value as any

    expect(out.detected.projectType).toBe('node')
    expect(out.detected.packageManager).toBe('npm')
    expect(out.scripts.dev).toBe('vite')
    expect(out.scripts.build).toBe('vite build')
    expect(out.configFiles.hasVite).toBe(true)
    expect(out.configFiles.hasReact).toBe(true)
  })

  it('should detect Node.js project with pnpm', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'test-project',
      scripts: { dev: 'next dev' },
      dependencies: { next: '^14.0.0' },
    }))
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), 'lockfileVersion: 5.1')

    const gen = bootstrapRepoTool.call({}, ctx)
    let result = await gen.next()
    while (!result.done) result = await gen.next()
    const out = result.value as any

    expect(out.detected.projectType).toBe('node')
    expect(out.detected.packageManager).toBe('pnpm')
    expect(out.configFiles.hasNextjs).toBe(true)
  }, 30000)

  it('should detect Python project with requirements.txt', async () => {
    fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), 'fastapi\nuvicorn\n')
    fs.writeFileSync(path.join(tmpDir, 'main.py'), 'from fastapi import FastAPI\n')

    const gen = bootstrapRepoTool.call({}, ctx)
    let result = await gen.next()
    while (!result.done) result = await gen.next()
    const out = result.value as any

    expect(out.detected.projectType).toBe('python')
    expect(out.detected.packageManager).toBe('pip')
    expect(out.configFiles.hasFastapi).toBe(true)
  })

  it('should detect Python project with pyproject.toml', async () => {
    fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), `
[project]
name = "test"
dependencies = ["flask"]

[project.optional-dependencies]
dev = ["pytest"]
`)

    const gen = bootstrapRepoTool.call({}, ctx)
    let result = await gen.next()
    while (!result.done) result = await gen.next()
    const out = result.value as any

    expect(out.detected.projectType).toBe('python')
    expect(out.configFiles.hasFlask).toBe(true)
  })

  it('should detect Express backend', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'api',
      scripts: { start: 'node index.js' },
      dependencies: { express: '^4.18.0' },
    }))
    fs.writeFileSync(path.join(tmpDir, 'index.js'), "const express = require('express')\n")

    const gen = bootstrapRepoTool.call({}, ctx)
    let result = await gen.next()
    while (!result.done) result = await gen.next()
    const out = result.value as any

    expect(out.configFiles.hasExpress).toBe(true)
    expect(out.ports.dev).toBe(3000)
  })

  it('should detect unknown project type for empty directory', async () => {
    const gen = bootstrapRepoTool.call({}, ctx)
    let result = await gen.next()
    while (!result.done) result = await gen.next()
    const out = result.value as any

    expect(out.detected.projectType).toBe('unknown')
    expect(out.detected.packageManager).toBeNull()
  })

  it('should detect FastAPI port 8000', async () => {
    fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), 'fastapi\n')
    fs.writeFileSync(path.join(tmpDir, 'main.py'), 'from fastapi import FastAPI\n')

    const gen = bootstrapRepoTool.call({}, ctx)
    let result = await gen.next()
    while (!result.done) result = await gen.next()
    const out = result.value as any

    expect(out.ports.dev).toBe(8000)
  })

  it('should use port from PORT env in scripts', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'test',
      scripts: {
        dev: 'PORT=3001 vite',
      },
    }))

    const gen = bootstrapRepoTool.call({}, ctx)
    let result = await gen.next()
    while (!result.done) result = await gen.next()
    const out = result.value as any

    expect(out.ports.dev).toBe(3001)
  })
})
