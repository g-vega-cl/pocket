import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSession,
  getSession,
  updateSession,
  addToHistory,
} from '../sessions.js';

describe('Session Management', () => {
  beforeEach(() => {
  });

  describe('createSession', () => {
    it('should create a new session with correct properties', () => {
      const session = createSession({
        repoUrl: 'https://github.com/test/repo',
        task: 'Fix a bug',
      });

      expect(session).toMatchObject({
        repoUrl: 'https://github.com/test/repo',
        task: 'Fix a bug',
        githubToken: null,
        localPath: null,
        branchName: null,
        status: 'created',
        history: [],
      });
      expect(session.id).toMatch(/^sess_/);
      expect(session.createdAt).toBeDefined();
      expect(session.lastActivity).toBeDefined();
    });

    it('should generate unique IDs for each session', () => {
      const session1 = createSession({ repoUrl: 'https://github.com/a/repo', task: 't1' });
      const session2 = createSession({ repoUrl: 'https://github.com/b/repo', task: 't2' });

      expect(session1.id).not.toBe(session2.id);
    });

    it('should store an optional githubToken', () => {
      const session = createSession({
        repoUrl: 'https://github.com/test/repo',
        task: 'Fix a bug',
        githubToken: 'ghp_test_token',
      });

      expect(session.githubToken).toBe('ghp_test_token');
    });
  });

  describe('getSession', () => {
    it('should retrieve an existing session by ID', () => {
      const created = createSession({
        repoUrl: 'https://github.com/test/repo',
        task: 'Test task',
      });

      const retrieved = getSession(created.id);

      expect(retrieved).toEqual(created);
    });

    it('should return undefined for non-existent session', () => {
      const result = getSession('non_existent_id');
      expect(result).toBeUndefined();
    });
  });

  describe('updateSession', () => {
    it('should update session properties', () => {
      const session = createSession({
        repoUrl: 'https://github.com/test/repo',
        task: 'Test task',
      });

      const updated = updateSession(session.id, {
        localPath: '/tmp/test',
        branchName: 'pocket/test-branch',
        status: 'ready',
      });

      expect(updated).toMatchObject({
        localPath: '/tmp/test',
        branchName: 'pocket/test-branch',
        status: 'ready',
      });
    });

    it('should return null for non-existent session', () => {
      const result = updateSession('non_existent_id', { status: 'ready' });
      expect(result).toBeNull();
    });

    it('should update lastActivity timestamp', () => {
      const session = createSession({
        repoUrl: 'https://github.com/test/repo',
        task: 'Test task',
      });
      const originalLastActivity = session.lastActivity;

      const updated = updateSession(session.id, { status: 'cloning' });

      expect(updated.lastActivity).toBeGreaterThanOrEqual(originalLastActivity);
    });
  });

  describe('addToHistory', () => {
    it('should add a message to session history', () => {
      const session = createSession({
        repoUrl: 'https://github.com/test/repo',
        task: 'Test task',
      });

      const updated = addToHistory(session.id, {
        role: 'user',
        content: 'Hello agent',
      });

      expect(updated.history).toHaveLength(1);
      expect(updated.history[0]).toMatchObject({
        role: 'user',
        content: 'Hello agent',
      });
      expect(updated.history[0].timestamp).toBeDefined();
    });

    it('should append to existing history', () => {
      const session = createSession({
        repoUrl: 'https://github.com/test/repo',
        task: 'Test task',
      });

      addToHistory(session.id, { role: 'user', content: 'First message' });
      const updated = addToHistory(session.id, { role: 'assistant', content: 'Response' });

      expect(updated.history).toHaveLength(2);
    });

    it('should return null for non-existent session', () => {
      const result = addToHistory('non_existent_id', {
        role: 'user',
        content: 'test',
      });
      expect(result).toBeNull();
    });
  });
});
