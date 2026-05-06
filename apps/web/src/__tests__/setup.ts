import '@testing-library/jest-dom'
import { vi } from 'vitest'

let mockEventSourceInstance: any = null

class MockEventSource {
  onopen: (() => void) | null = null
  onerror: ((e: any) => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  close = vi.fn()
}

global.EventSource = vi.fn(() => {
  mockEventSourceInstance = new MockEventSource()
  // Simulate async connection open
  setTimeout(() => {
    mockEventSourceInstance?.onopen?.()
  }, 0)
  return mockEventSourceInstance
}) as any

global.mockEventSource = {
  getInstance: () => mockEventSourceInstance,
  triggerMessage: (data: any) => {
    if (mockEventSourceInstance?.onmessage) {
      mockEventSourceInstance.onmessage({ data: JSON.stringify(data) })
    }
  },
  triggerError: (e: any) => {
    if (mockEventSourceInstance?.onerror) {
      mockEventSourceInstance.onerror(e)
    }
  },
}
