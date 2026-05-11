import type { LearningDB } from './learning-db.js'

export interface SystemPromptContext {
  /** The user's task/repo description */
  task: string
  /** The git branch name */
  branchName: string | null
  /** Bootstrap info from repo analysis */
  bootstrapInfo?: string
}

/**
 * Builds the full system prompt with injected memory, skills, and quality guidelines.
 */
export function buildSystemPrompt(
  ctx: SystemPromptContext,
  learningDB: LearningDB,
  userId: string = 'default',
): string {
  const parts: string[] = []

  // Base identity
  parts.push('You are Pocket, an autonomous coding agent.')

  // ─── User memory ────────────────────────────────────
  const memory = learningDB.getMemory(userId)
  if (memory.length > 0) {
    const facts = memory.map(m => `- ${m.content}`).join('\n')
    parts.push(`=== ABOUT THIS USER ===\n${facts}`)
  }

  // ─── Skills ─────────────────────────────────────────
  // Shared skills (cross-user technical patterns)
  const sharedSkills = learningDB.getSkills('shared')
  // User-specific skills
  const userSkills = learningDB.getSkills('user', userId)
  const allSkills = [...sharedSkills, ...userSkills]

  if (allSkills.length > 0) {
    const skillsText = allSkills.map(s => {
      const tagStr = s.tags.length > 0 ? ` [${s.tags.join(', ')}]` : ''
      return `## ${s.name}${tagStr}\n${s.content}`
    }).join('\n\n')
    parts.push(`=== LEARNED SKILLS ===\n${skillsText}`)
  }

  // ─── Session quality guidelines ─────────────────────
  const qualitySkills = allSkills.filter(s => s.type === 'session_quality')
  if (qualitySkills.length > 0) {
    const guidelines = qualitySkills.map(s => s.content).join('\n')
    parts.push(`=== SESSION GUIDELINES ===\n${guidelines}`)
  }

  // ─── Repo context ───────────────────────────────────
  const repoParts: string[] = []
  repoParts.push(`Repository: ${ctx.task}`)
  if (ctx.branchName) {
    repoParts.push(`Branch: ${ctx.branchName}`)
  }
  if (ctx.bootstrapInfo) {
    repoParts.push(ctx.bootstrapInfo)
  }
  parts.push(repoParts.join('\n'))

  // ─── Tool + workflow hints ──────────────────────────
  parts.push(`Use tools to explore and make changes as needed.

IMPORTANT: When you finish making changes, always use the git_commit tool to save them with a clear message, then use git_push to push your branch to origin. Do not just say you will commit or push — actually call the tools.

You can use the save_skill tool to persist reusable knowledge for future sessions. If you discover a project convention, debugging pattern, or workflow that would help in the future, save it as a skill.`)

  return parts.join('\n\n')
}
