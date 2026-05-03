import { describe, it, expect, vi, afterEach } from 'vitest'

describe('sandbox module', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('isPodmanAvailable', () => {
    it('returns boolean', async () => {
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

  describe('persistent container (ensureContainer / execInContainer)', () => {
    it('ensureContainer throws when podman is not available', async () => {
      vi.mock('node:child_process', () => ({
        execSync: vi.fn(() => { throw new Error('not found') }),
        exec: vi.fn(),
        spawn: vi.fn(),
      }))

      const mod = await import('../sandbox.js?nocache=5')
      await expect(mod.ensureContainer('test-session', 'node:22-alpine', '/tmp/ws'))
        .rejects.toThrow(/Podman is not available/)
    })

    it('ensureContainer is a function', async () => {
      const { ensureContainer } = await import('../sandbox.js')
      expect(typeof ensureContainer).toBe('function')
    })

    it('execInContainer is a function', async () => {
      const { execInContainer } = await import('../sandbox.js')
      expect(typeof execInContainer).toBe('function')
    })

    it('stopSandboxContainer is a function', async () => {
      const { stopSandboxContainer } = await import('../sandbox.js')
      expect(typeof stopSandboxContainer).toBe('function')
    })

    it('killAllContainers is a function', async () => {
      const { killAllContainers } = await import('../sandbox.js')
      expect(typeof killAllContainers).toBe('function')
    })

    it('listActiveContainers is a function', async () => {
      const { listActiveContainers } = await import('../sandbox.js')
      expect(typeof listActiveContainers).toBe('function')
    })
  })

  describe('runInSandbox (legacy ephemeral)', () => {
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
