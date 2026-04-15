import { useEffect, useRef } from 'react'
import { useLiveQuery } from '@tanstack/react-db'

import { messagesCollection } from '#/db-collections'

import type { Collection, Message } from '@tanstack/react-db'

function useStreamConnection(
  url: string,
  collection: Collection<any, any, any>,
) {
  const loadedRef = useRef(false)

  useEffect(() => {
    const fetchData = async () => {
      if (loadedRef.current) return
      loadedRef.current = true

      const response = await fetch(url)
      const reader = response.body?.getReader()
      if (!reader) {
        return
      }

      const decoder = new TextDecoder()
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const decoded = decoder.decode(value, { stream: true })
        for (const line of decoded.split('\n')) {
          collection.insert(JSON.parse(line))
        }
      }
    }
    fetchData()
  }, [])
}

export function useChat() {
  useStreamConnection('/demo/db-chat-api', messagesCollection)

  const sendMessage = (message: string, user: string) => {
    fetch('/demo/db-chat-api', {
      method: 'POST',
      body: JSON.stringify({ text: message.trim(), user: user.trim() }),
    })
  }

  return { sendMessage }
}

export function useMessages() {
  const { data: messages } = useLiveQuery((q) =>
    q.from({ message: messagesCollection }).select(({ message }) => ({
      ...message,
    })),
  )

  return messages as Message[]
}
