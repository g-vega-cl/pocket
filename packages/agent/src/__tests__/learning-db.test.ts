import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { LearningDB } from '../learning-db.js'

describe('LearningDB', () => {
  let tmpDir: string
  let db: LearningDB

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `pocket-learning-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    fs.mkdirSync(tmpDir, { recursive: true })
    db = new LearningDB(tmpDir)
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ─── Ratings ──────────────────────────────────────────

  describe('ratings', () => {
    it('should save and retrieve a rating', () => {
      db.saveRating({
        sessionId: 'sess-1',
        userId: 'default',
        stars: 4,
        categories: ['task_completion', 'code_quality'],
        comment: 'Good work',
        createdAt: Date.now(),
      })

      const rating = db.getRating('sess-1', 'default')
      expect(rating).not.toBeNull()
      expect(rating!.stars).toBe(4)
      expect(rating!.categories).toEqual(['task_completion', 'code_quality'])
      expect(rating!.comment).toBe('Good work')
    })

    it('should return null for non-existent rating', () => {
      expect(db.getRating('nonexistent', 'default')).toBeNull()
    })

    it('should overwrite existing rating (upsert)', () => {
      db.saveRating({
        sessionId: 'sess-1', userId: 'default', stars: 3,
        categories: [], createdAt: Date.now(),
      })
      db.saveRating({
        sessionId: 'sess-1', userId: 'default', stars: 5,
        categories: ['speed'], createdAt: Date.now(),
      })

      const rating = db.getRating('sess-1', 'default')
      expect(rating!.stars).toBe(5)
      expect(rating!.categories).toEqual(['speed'])
    })
  })

  // ─── Memory ───────────────────────────────────────────

  describe('memory', () => {
    it('should add and retrieve memory entries', () => {
      db.addMemory('default', 'User prefers concise commit messages', 'user_preference')
      db.addMemory('default', 'Project uses pnpm', 'project_fact')

      const memory = db.getMemory('default')
      expect(memory).toHaveLength(2)
      expect(memory[0].content).toBe('Project uses pnpm') // newest first
      expect(memory[0].category).toBe('project_fact')
      expect(memory[1].content).toBe('User prefers concise commit messages')
      expect(memory[1].userId).toBe('default')
    })

    it('should clear memory for a user', () => {
      db.addMemory('default', 'Fact 1', 'user_preference')
      db.clearMemory('default')
      expect(db.getMemory('default')).toHaveLength(0)
    })

    it('should isolate memory by user', () => {
      db.addMemory('user-a', 'Fact for A', 'user_preference')
      db.addMemory('user-b', 'Fact for B', 'project_fact')

      expect(db.getMemory('user-a')).toHaveLength(1)
      expect(db.getMemory('user-a')[0].content).toBe('Fact for A')
      expect(db.getMemory('user-b')).toHaveLength(1)
      expect(db.getMemory('user-b')[0].content).toBe('Fact for B')
    })
  })

  // ─── Skills ───────────────────────────────────────────

  describe('skills', () => {
    it('should upsert and retrieve skills by scope', () => {
      db.upsertSkill({
        name: 'nodejs-debugging',
        content: '# Debugging\n\nCheck async first',
        scope: 'shared',
        type: 'technical_pattern',
        tags: ['nodejs', 'debugging'],
      })

      db.upsertSkill({
        name: 'my-style',
        content: 'User likes plans before code',
        scope: 'user',
        type: 'user_preference',
        tags: ['communication'],
        userId: 'default',
      })

      const shared = db.getSkills('shared')
      expect(shared).toHaveLength(1)
      expect(shared[0].name).toBe('nodejs-debugging')
      expect(shared[0].tags).toEqual(['nodejs', 'debugging'])

      const userSkills = db.getSkills('user', 'default')
      expect(userSkills).toHaveLength(1)
      expect(userSkills[0].name).toBe('my-style')
    })

    it('should update existing skill on upsert', () => {
      db.upsertSkill({
        name: 'nodejs-debugging',
        content: 'Original content',
        scope: 'shared',
        type: 'technical_pattern',
        tags: [],
      })

      db.upsertSkill({
        name: 'nodejs-debugging',
        content: 'Updated content',
        scope: 'shared',
        type: 'technical_pattern',
        tags: ['updated'],
      })

      const skills = db.getSkills('shared')
      expect(skills).toHaveLength(1)
      expect(skills[0].content).toBe('Updated content')
      expect(skills[0].tags).toEqual(['updated'])
    })

    it('should delete a skill', () => {
      db.upsertSkill({
        name: 'temp-skill', content: 'temp', scope: 'shared',
        type: 'technical_pattern', tags: [],
      })
      expect(db.getSkills('shared')).toHaveLength(1)

      db.deleteSkill('temp-skill', 'shared')
      expect(db.getSkills('shared')).toHaveLength(0)
    })

    it('should return empty array when no skills', () => {
      expect(db.getSkills('shared')).toHaveLength(0)
      expect(db.getSkills('user', 'default')).toHaveLength(0)
    })
  })

  // ─── Edge cases ───────────────────────────────────────

  describe('edge cases', () => {
    it('should create database file on construction', () => {
      const dbPath = path.join(tmpDir, 'learning.db')
      expect(fs.existsSync(dbPath)).toBe(true)
    })

    it('should handle special characters in content', () => {
      db.addMemory('default', 'User\'s "preferences" include: émojis & \'quotes\'', 'user_preference')
      const memory = db.getMemory('default')
      expect(memory).toHaveLength(1)
      expect(memory[0].content).toContain('émojis')
    })

    it('should handle empty tags array', () => {
      db.upsertSkill({
        name: 'plain-skill', content: 'No tags', scope: 'shared',
        type: 'technical_pattern', tags: [],
      })
      const skills = db.getSkills('shared')
      expect(skills[0].tags).toEqual([])
    })
  })
})
