import '@testing-library/jest-dom';
import { vi } from 'vitest';

global.WebSocket = vi.fn(() => ({
  readyState: 1,
  send: vi.fn(),
  close: vi.fn(),
  onopen: null,
  onclose: null,
  onmessage: null,
  onerror: null,
})) as any;

Element.prototype.scrollIntoView = vi.fn();
