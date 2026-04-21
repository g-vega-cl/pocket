import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSession,
  getSession,
  getAllSessions,
  updateSession,
  addToHistory,
} from '../sessions.js';

describe('Session Management', () => {
  describe('getAllSessions', () => {
    it('should return all created sessions', () => {
      const s1 = createSession({ repoUrl: 'repo1', task: 'task1' });
      const s2 = createSession({ repoUrl: 'repo2', task: 'task2' });

      const all = getAllSessions();
      expect(all.length).toBeGreaterThanOrEqual(2);
      expect(all.some(s => s.id === s1.id)).toBe(true);
      expect(all.some(s => s.id === s2.id)).toBe(true);
    });

    it('should return sessions sorted by createdAt desc', async () => {
        const s1 = createSession({ repoUrl: 'repo1', task: 'task1' });
        await new Promise(r => setTimeout(r, 10));
        const s2 = createSession({ repoUrl: 'repo2', task: 'task2' });

        const all = getAllSessions();
        const index1 = all.findIndex(s => s.id === s1.id);
        const index2 = all.findIndex(s => s.id === s2.id);

        expect(index2).toBeLessThan(index1);
    });
  });
});
