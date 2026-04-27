import { useEffect, useRef, useState, useCallback } from 'react'
import type { Event } from '#/state/events.js'

interface UseSessionStreamOptions {
  sessionId: string
  onEvents?: (events: Event[]) => void
  enabled?: boolean
}

export function useSessionStream({ sessionId, onEvents, enabled = true }: UseSessionStreamOptions) {
  const [connected, setConnected] = useState(false)
  const [lastSeq, setLastSeq] = useState(0)
  const sourceRef = useRef<EventSource | null>(null)
  const eventBufferRef = useRef<Event[]>([])
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(() => {
    if (eventBufferRef.current.length > 0 && onEvents) {
      const events = eventBufferRef.current
      eventBufferRef.current = []
      onEvents(events)
    }
  }, [onEvents])

  // Flush buffered events every 50ms for smooth UI updates
  useEffect(() => {
    flushTimerRef.current = setInterval(flush, 50)
    return () => {
      if (flushTimerRef.current) clearInterval(flushTimerRef.current)
    }
  }, [flush])

  useEffect(() => {
    if (!enabled || !sessionId) return

    const url = `/api/sessions/${sessionId}/events`
    const source = new EventSource(url)
    sourceRef.current = source

    source.onopen = () => {
      setConnected(true)
    }

    source.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as Event
        eventBufferRef.current.push(event)
        setLastSeq(event.seq)
      } catch {
        // skip malformed events
      }
    }

    source.onerror = () => {
      setConnected(false)
      // EventSource auto-reconnects with Last-Event-ID
    }

    return () => {
      source.close()
      sourceRef.current = null
      flush() // flush any remaining events
    }
  }, [sessionId, enabled, flush])

  return { connected, lastSeq }
}
