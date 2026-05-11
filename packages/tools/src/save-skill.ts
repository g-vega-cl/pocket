import { z } from 'zod'
import type { Tool, Progress } from '@pocket/core'
import type { SkillScope, SkillType } from '@pocket/core'
import type { LearningDB } from '@pocket/agent'

const saveSkillInput = z.object({
  name: z.string().describe('Short name for this skill (lowercase, hyphens, e.g. "nodejs-debugging")'),
  content: z.string().describe('The skill content in markdown — include steps, pitfalls, and examples'),
  type: z.enum(['technical_pattern', 'session_quality', 'user_preference']).describe(
    'Type of skill: technical_pattern (how to solve a class of problems), session_quality (what makes sessions succeed/fail), user_preference (personal preference to remember)'
  ),
  scope: z.enum(['shared', 'user']).default('shared').describe(
    'Scope: shared (benefits all users of this Pocket install) or user (specific to current user)'
  ),
  tags: z.array(z.string()).default([]).describe('Tags for categorization, e.g. ["nodejs", "debugging"]'),
})

type SaveSkillInput = z.infer<typeof saveSkillInput>

export function createSaveSkillTool(getDB: () => LearningDB): Tool<SaveSkillInput, { success: boolean; name: string }> {
  return {
    name: 'save_skill',
    description: 'Save a reusable skill, pattern, or preference for future Pocket sessions. Use this when you discover a workflow, debugging approach, project convention, or user preference that would help in future tasks. Skills are loaded into every new session automatically.',
    inputSchema: saveSkillInput,
    isReadOnly: false,
    defaultPermission: 'allow',

    async *call(input: SaveSkillInput): AsyncGenerator<Progress, { success: boolean; name: string }> {
      const db = getDB()

      yield { type: 'progress', message: `Saving skill: ${input.name}` }

      const type: SkillType = input.type
      const scope: SkillScope = input.scope

      db.upsertSkill({
        name: input.name,
        content: input.content,
        scope,
        type,
        tags: input.tags,
      })

      return { success: true, name: input.name }
    },
  }
}
