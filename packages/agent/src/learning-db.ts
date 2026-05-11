import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import fs from 'node:fs'
import type { MemoryEntry, SkillEntry, SkillScope, SkillType } from '@pocket/core'

export class LearningDB {
  private db: DatabaseSync

  constructor(pocketHome: string) {
    const dbPath = path.join(pocketHome, 'learning.db')
    const dir = path.dirname(dbPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    this.db = new DatabaseSync(dbPath)
    this.db.exec('PRAGMA journal_mode=WAL')
    this.db.exec('PRAGMA foreign_keys=ON')
    this.createTables()
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ratings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        user_id TEXT NOT NULL DEFAULT 'default',
        stars INTEGER NOT NULL CHECK(stars >= 1 AND stars <= 5),
        categories TEXT NOT NULL DEFAULT '[]',
        comment TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(session_id, user_id)
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL DEFAULT 'default',
        content TEXT NOT NULL,
        category TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS skills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'shared' CHECK(scope IN ('shared', 'user')),
        type TEXT NOT NULL DEFAULT 'technical_pattern',
        tags TEXT NOT NULL DEFAULT '[]',
        user_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
  }

  // ─── Ratings ────────────────────────────────────────────

  saveRating(rating: {
    sessionId: string
    userId: string
    stars: number
    categories: string[]
    comment?: string
    createdAt: number
  }): void {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO ratings (session_id, user_id, stars, categories, comment, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    stmt.run(
      rating.sessionId,
      rating.userId,
      rating.stars,
      JSON.stringify(rating.categories),
      rating.comment ?? null,
      rating.createdAt,
    )
  }

  getRating(sessionId: string, userId: string): {
    stars: number
    categories: string[]
    comment: string | null
    createdAt: number
  } | null {
    const stmt = this.db.prepare(
      'SELECT stars, categories, comment, created_at FROM ratings WHERE session_id = ? AND user_id = ?'
    )
    const row = stmt.get(sessionId, userId) as any
    if (!row) return null
    return {
      stars: row.stars,
      categories: JSON.parse(row.categories ?? '[]'),
      comment: row.comment,
      createdAt: row.created_at,
    }
  }

  // ─── Memory ─────────────────────────────────────────────

  getMemory(userId: string): MemoryEntry[] {
    const stmt = this.db.prepare(
      'SELECT id, user_id, content, category, created_at FROM memory WHERE user_id = ? ORDER BY created_at DESC'
    )
    const rows = stmt.all(userId) as any[]
    return rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      content: r.content,
      category: r.category,
      createdAt: r.created_at,
    }))
  }

  addMemory(userId: string, content: string, category: string): void {
    const stmt = this.db.prepare(
      'INSERT INTO memory (user_id, content, category, created_at) VALUES (?, ?, ?, ?)'
    )
    stmt.run(userId, content, category, Date.now())
  }

  clearMemory(userId: string): void {
    const stmt = this.db.prepare('DELETE FROM memory WHERE user_id = ?')
    stmt.run(userId)
  }

  // ─── Skills ─────────────────────────────────────────────

  getSkills(scope?: SkillScope, userId?: string): SkillEntry[] {
    let sql = 'SELECT id, name, content, scope, type, tags, user_id, created_at, updated_at FROM skills'
    const params: (string | undefined)[] = []

    if (scope) {
      sql += ' WHERE scope = ?'
      params.push(scope)
      if (scope === 'user' && userId) {
        sql += ' AND user_id = ?'
        params.push(userId)
      }
    }

    sql += ' ORDER BY updated_at DESC LIMIT 50'

    const stmt = this.db.prepare(sql)
    const rows = stmt.all(...params) as any[]
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      content: r.content,
      scope: r.scope as SkillScope,
      type: r.type as SkillType,
      tags: JSON.parse(r.tags ?? '[]'),
      userId: r.user_id ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))
  }

  upsertSkill(skill: {
    name: string
    content: string
    scope: SkillScope
    type: SkillType
    tags: string[]
    userId?: string
  }): void {
    const now = Date.now()
    // Try update first (by name + scope)
    const existing = this.db.prepare(
      'SELECT id FROM skills WHERE name = ? AND scope = ?'
    ).get(skill.name, skill.scope) as any

    if (existing) {
      const stmt = this.db.prepare(
        `UPDATE skills SET content = ?, type = ?, tags = ?, user_id = ?, updated_at = ?
         WHERE id = ?`
      )
      stmt.run(
        skill.content,
        skill.type,
        JSON.stringify(skill.tags),
        skill.userId ?? null,
        now,
        existing.id,
      )
    } else {
      const stmt = this.db.prepare(
        `INSERT INTO skills (name, content, scope, type, tags, user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      stmt.run(
        skill.name,
        skill.content,
        skill.scope,
        skill.type,
        JSON.stringify(skill.tags),
        skill.userId ?? null,
        now,
        now,
      )
    }
  }

  deleteSkill(name: string, scope: SkillScope): void {
    const stmt = this.db.prepare('DELETE FROM skills WHERE name = ? AND scope = ?')
    stmt.run(name, scope)
  }

  // ─── Close ──────────────────────────────────────────────

  close(): void {
    this.db.close()
  }
}
