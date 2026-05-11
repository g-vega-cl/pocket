// ─── Learning system (§v1.5) ──────────────────────────────

export interface SessionRating {
  sessionId: string
  userId: string
  stars: number           // 1-5
  categories: RatingCategory[]
  comment?: string
  createdAt: number
}

export type RatingCategory = 'task_completion' | 'code_quality' | 'communication' | 'speed'

export const RATING_CATEGORIES: { id: RatingCategory; label: string }[] = [
  { id: 'task_completion', label: 'Task completed successfully' },
  { id: 'code_quality', label: 'Code quality was solid' },
  { id: 'communication', label: 'Communication was clear' },
  { id: 'speed', label: 'Speed was good' },
]

export type SkillScope = 'shared' | 'user'
export type SkillType = 'technical_pattern' | 'session_quality' | 'user_preference'

export interface SkillEntry {
  id: number
  name: string
  content: string
  scope: SkillScope
  tags: string[]         // ['nodejs', 'debugging']
  /** Must be a user_id when scope='user' */
  userId?: string
  createdAt: number
  updatedAt: number
}

export interface MemoryEntry {
  id: number
  userId: string
  content: string
  category: string       // 'user_preference', 'approval_pattern', 'language', 'environment'
  createdAt: number
}

export interface LearningExtraction {
  memoryUpdates: Array<{
    content: string
    category: string
  }>
  skillUpdates: Array<{
    name: string
    content: string
    scope: SkillScope
    tags: string[]
  }>
}
