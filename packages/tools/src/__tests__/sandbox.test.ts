import { describe, it, expect, vi, afterEach } from 'vitest'

describe('sandbox module', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('isPodmanAvailable', () => {
    it('returns boolean', async () => {
      // Module state is cached; the first call determines the cached value.
      // Since we don't mock, it depends on whether podman is installed.
      // We can't predict the value, but we know it's a boolean.
      const { isPodmanAvailable } = await import('../sandbox.js')
      const result = isPodmanAvailable()
      expect(typeof result).toBe('boolean')
    })

    it('returns false when podman is not found', async () => {
      vi.mock('node:child_process', () => ({
        execSync: vi.fn(() => { throw new Error('not found') }),
        exec: vi.fn(),
        spawn: vi.fn(),
      }))

      const { isPodmanAvailable } = await import('../sandbox.js?nocache=1')
      const result = isPodmanAvailable()
      expect(result).toBe(false)
    })
  })

  describe('runInSandbox', () => {
    it('throws when podman is not available', async () => {
      vi.mock('node:child_process', () => ({
        execSync: vi.fn(() => { throw new Error('not found') }),
        exec: vi.fn(),
        spawn: vi.fn(),
      }))

      const mod = await import('../sandbox.js?nocache=2')
      await expect(mod.runInSandbox('echo test', {
        image: 'node:22-alpine',
        workspaceRoot: '/tmp/ws',
      })).rejects.toThrow(/Podman is not available/)
    })

    it('is a function', async () => {
      const { runInSandbox } = await import('../sandbox.js')
      expect(typeof runInSandbox).toBe('function')
    })
  })

  describe('spawnInSandbox', () => {
    it('is a function', async () => {
      const { spawnInSandbox } = await import('../sandbox.js')
      expect(typeof spawnInSandbox).toBe('function')
    })

    it('throws when podman is not available', async () => {
      vi.mock('node:child_process', () => ({
        execSync: vi.fn(() => { throw new Error('not found') }),
        exec: vi.fn(),
        spawn: vi.fn(),
      }))

      const mod = await import('../sandbox.js?nocache=3')
      expect(() => mod.spawnInSandbox('echo test', {
        image: 'node:22-alpine',
        workspaceRoot: '/tmp/ws',
      })).toThrow(/Podman is not available/)
    })
  })
})
