import path from 'node:path'
import type { Tool, PermissionLevel, PermissionResolution } from '@pocket/core'
import type { BashRuleConfig } from '@pocket/core'

interface PermissionCheckInput {
  tool: Tool
  toolName: string
  args: Record<string, unknown>
  sessionId: string
  workspaceRoot: string
}

interface PermissionResult {
  resolution: 'allow' | 'ask' | 'deny'
  reason?: string
}

export class PermissionGate {
  private config: BashRuleConfig & { protectedBranches: string[] }
  private sessionRules: Map<string, Map<string, PermissionLevel>> = new Map()

  constructor(config: BashRuleConfig & { protectedBranches: string[] }) {
    this.config = config
  }

  setSessionRule(sessionId: string, toolName: string, level: PermissionLevel): void {
    if (!this.sessionRules.has(sessionId)) {
      this.sessionRules.set(sessionId, new Map())
    }
    this.sessionRules.get(sessionId)!.set(toolName, level)
  }

  clearSessionRules(sessionId: string): void {
    this.sessionRules.delete(sessionId)
  }

  getSessionRules(sessionId: string): Record<string, PermissionLevel> {
    const rules = this.sessionRules.get(sessionId)
    if (!rules) return {}
    return Object.fromEntries(rules)
  }

  checkPermission(input: PermissionCheckInput): PermissionResult {
    const { tool, toolName, args, sessionId, workspaceRoot } = input

    // 1. Session-scoped allow rules
    const sessionRule = this.sessionRules.get(sessionId)?.get(toolName)
    if (sessionRule === 'allow') {
      return { resolution: 'allow' }
    }

    // 2. Static defaults
    const defaultPerm = tool.defaultPermission

    if (defaultPerm === 'allow') {
      return this.applySafetyChecks(toolName, args, workspaceRoot)
    }

    // 3. Per-tool safety checks for conditional tools
    if (defaultPerm === 'conditional') {
      return this.checkConditional(toolName, args, workspaceRoot)
    }

    // 4. Rule-matched (bash) — handled elsewhere
    if (defaultPerm === 'rule-matched') {
      return { resolution: 'ask' }
    }

    // 5. Everything else — ask
    if (defaultPerm === 'ask') {
      return { resolution: 'ask' }
    }

    return { resolution: 'ask' }
  }

  private applySafetyChecks(toolName: string, args: Record<string, unknown>, workspaceRoot: string): PermissionResult {
    // For write_file and edit_file: if path is outside workspace, ask
    if (toolName === 'write_file' || toolName === 'edit_file') {
      const filePath = args.path as string | undefined
      if (filePath) {
        const resolved = path.resolve(workspaceRoot, filePath)
        if (!resolved.startsWith(workspaceRoot)) {
          return { resolution: 'ask', reason: 'File is outside the workspace' }
        }
      }
    }
    return { resolution: 'allow' }
  }

  private checkConditional(toolName: string, args: Record<string, unknown>, workspaceRoot: string): PermissionResult {
    // write_file / edit_file: allow inside workspace, ask outside
    if (toolName === 'write_file' || toolName === 'edit_file') {
      const filePath = args.path as string | undefined
      if (filePath) {
        const resolved = path.resolve(workspaceRoot, filePath)
        if (resolved.startsWith(workspaceRoot)) {
          return { resolution: 'allow' }
        }
        return { resolution: 'ask', reason: 'File is outside the workspace' }
      }
    }

    // git_push: check protected branches
    if (toolName === 'git_push') {
      // Protected branch check needs to be done at runtime by the tool
      // For now, allow (the tool will enforce)
      return { resolution: 'allow' }
    }

    return { resolution: 'ask' }
  }

  checkBashCommand(command: string, sessionId: string, sandboxImage?: string): PermissionResult {
    // 1. Check bashDeny — hard deny (always enforced, even in sandbox)
    for (const denyPattern of this.config.bashDeny) {
      try {
        if (new RegExp(denyPattern).test(command)) {
          return { resolution: 'deny', reason: `Command matches deny pattern: ${denyPattern}` }
        }
      } catch {
        // invalid regex, skip
      }
    }

    // 2. If sandbox is active, auto-allow all non-denied commands
    if (sandboxImage) {
      return { resolution: 'allow' }
    }

    // 3. Check session rules for bash
    const sessionRule = this.sessionRules.get(sessionId)?.get('bash')
    if (sessionRule === 'allow') {
      return { resolution: 'allow' }
    }

    // 4. Check bashAllow patterns
    for (const allowPattern of this.config.bashAllow) {
      try {
        if (new RegExp(allowPattern).test(command)) {
          return { resolution: 'allow' }
        }
      } catch {
        // invalid regex, skip
      }
    }

    // 5. Default: ask
    return { resolution: 'ask' }
  }
}
