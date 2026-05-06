import { createContext } from 'react'
import type { TokenUsage } from './events.js'

export interface SessionInfo {
  status: string
  tokenUsage: TokenUsage | null
  contextWindow: number
  sessionName: string
  isThinking: boolean
}

export const SessionInfoContext = createContext<SessionInfo | null>(null)
