import type { Event, Message } from '@pocket/core'

export interface BuildConversationOptions {
  systemPrompt?: string
  nudgeText?: string
}

export function buildConversationFromEvents(
  events: Event[],
  options: BuildConversationOptions = {},
): Message[] {
  const messages: Message[] = []

  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt })
  }

  if (options.nudgeText) {
    messages.push({ role: 'user', content: options.nudgeText })
  }

  type AssistantGroup = {
    text: string | null
    toolCalls: Array<{
      id: string
      name: string
      args: Record<string, unknown>
    }>
    toolResults: Map<string, { result?: unknown; error?: string }>
  }

  const groups: AssistantGroup[] = []
  let currentGroup: AssistantGroup | null = null

  for (const event of events) {
    switch (event.type) {
      case 'user_message':
        if (currentGroup) {
          groups.push(currentGroup)
          currentGroup = null
        }
        messages.push({ role: 'user', content: event.payload.content })
        break

      case 'assistant_text_done':
        if (currentGroup) {
          groups.push(currentGroup)
        }
        currentGroup = {
          text: event.payload.text || null,
          toolCalls: [],
          toolResults: new Map(),
        }
        break

      case 'tool_call_start':
        if (currentGroup) {
          currentGroup.toolCalls.push({
            id: event.payload.toolCallId,
            name: event.payload.toolName,
            args: event.payload.args,
          })
        }
        break

      case 'tool_call_result':
        if (currentGroup) {
          currentGroup.toolResults.set(event.payload.toolCallId, {
            result: event.payload.result,
            error: event.payload.error,
          })
        }
        break
    }
  }

  if (currentGroup) {
    groups.push(currentGroup)
  }

  for (const group of groups) {
    const assistantMsg: Message = {
      role: 'assistant',
      content: group.text,
    }

    if (group.toolCalls.length > 0) {
      assistantMsg.tool_calls = group.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.args),
        },
      }))
    }

    messages.push(assistantMsg)

    for (const tc of group.toolCalls) {
      const resultData = group.toolResults.get(tc.id)
      if (resultData) {
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(
            resultData.error ? { error: resultData.error } : { result: resultData.result }
          ),
        })
      }
    }
  }

  return messages
}
