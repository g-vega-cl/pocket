import type { EventLog } from './event-log.js'
import type { LearningDB } from './learning-db.js'
import type { LLMProvider, Message, LearningExtraction } from '@pocket/core'
import { buildConversationFromEvents } from './conversation-builder.js'

export interface PipelineInput {
  sessionId: string
  userId: string
  stars: number
  categories: string[]
  comment?: string
}

/**
 * Runs post-session analysis: reads the session transcript, calls an LLM to
 * extract lessons, and writes them to the learning database.
 */
export async function runLearningPipeline(
  input: PipelineInput,
  eventLog: EventLog,
  learningDB: LearningDB,
  provider: LLMProvider,
  model: string,
): Promise<{ memoryCount: number; skillCount: number }> {
  // 1. Load the session transcript
  const events = eventLog.replaySync(input.sessionId)
  if (events.length === 0) {
    console.warn(`[Pocket] LearningPipeline: no events for session ${input.sessionId}`)
    return { memoryCount: 0, skillCount: 0 }
  }

  // 2. Build conversation context
  const sessionMsgs = buildConversationFromEvents(events)
  const contextText = sessionMsgs
    .map(m => {
      if (m.role === 'system') return null
      if (m.tool_calls && m.tool_calls.length > 0) {
        const toolNames = m.tool_calls.map(tc => tc.function.name).join(', ')
        return `Agent (used tools: ${toolNames}): ${m.content || ''}`
      }
      if (m.tool_call_id && m.content) {
        const truncated = m.content.length > 1000 ? m.content.slice(0, 1000) + '...' : m.content
        return `[Tool result]: ${truncated}`
      }
      return `${m.role === 'user' ? 'User' : 'Agent'}: ${m.content || ''}`
    })
    .filter(Boolean)
    .join('\n\n')

  // 3. Load existing knowledge to avoid duplication
  const existingMemory = learningDB.getMemory(input.userId)
  const existingSkills = learningDB.getSkills()
  const existingKnowledge = [
    ...existingMemory.map(m => `[Memory] ${m.content}`),
    ...existingSkills.map(s => `[Skill:${s.name}] ${s.content.slice(0, 200)}`),
  ].join('\n')

  const categoriesText = input.categories.length > 0
    ? `Categories rated good: ${input.categories.join(', ')}`
    : 'No specific categories rated'
  const commentText = input.comment ? `\nUser comment: "${input.comment}"` : ''

  // 4. Build analysis prompt
  const analysisPrompt = `You are analyzing a Pocket coding agent session to extract lessons for future improvement.

RATING: ${input.stars}/5 stars
${categoriesText}${commentText}

SESSION TRANSCRIPT:
${contextText.slice(0, 8000)}

EXISTING KNOWLEDGE (do not duplicate):
${existingKnowledge.slice(0, 2000)}

Extract lessons from this session as JSON. Be concise and specific:

{
  "memoryUpdates": [
    // Facts about this user to remember (preferences, habits, environment)
    {"content": "User prefers concise git commit messages", "category": "user_preference"}
  ],
  "skillUpdates": [
    // Reusable patterns — create ONE unified skill per category
    {"name": "beautiful-code", "content": "Key principles: ...", "scope": "shared", "tags": ["nodejs"]}
  ]
}

Rules:
- Only extract if you found real, specific patterns. Empty arrays are fine.
- Do not duplicate anything in EXISTING KNOWLEDGE.
- Keep memory entries to 1 sentence each. Keep skills focused and actionable.
- If nothing new was learned, return empty arrays.

Respond with ONLY the JSON object, no other text.`

  // 5. Call LLM (non-streaming by collecting the full stream)
  const messages: Message[] = [
    { role: 'system', content: 'You are a learning extraction system. Output only valid JSON.' },
    { role: 'user', content: analysisPrompt },
  ]

  let fullResponse = ''
  try {
    const stream = provider.streamChat({
      model,
      messages,
      maxTokens: 2000,
    })

    let result = await stream.next()
    while (!result.done) {
      const chunk = result.value
      if (chunk.type === 'text' && chunk.text) {
        fullResponse += chunk.text
      }
      result = await stream.next()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[Pocket] LearningPipeline: LLM call failed for session ${input.sessionId}: ${message}`)
    return { memoryCount: 0, skillCount: 0 }
  }

  // 6. Parse the response
  let extraction: LearningExtraction
  try {
    // Strip markdown code fences if present
    const cleaned = fullResponse
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim()
    extraction = JSON.parse(cleaned)

    if (!extraction.memoryUpdates) extraction.memoryUpdates = []
    if (!extraction.skillUpdates) extraction.skillUpdates = []
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[Pocket] LearningPipeline: failed to parse LLM response for session ${input.sessionId}: ${message}`)
    console.error(`[Pocket] LearningPipeline: raw response: ${fullResponse.slice(0, 500)}`)
    return { memoryCount: 0, skillCount: 0 }
  }

  // 7. Write to database
  let memoryCount = 0
  let skillCount = 0

  for (const mem of extraction.memoryUpdates) {
    if (mem.content && mem.category) {
      learningDB.addMemory(input.userId, mem.content, mem.category)
      memoryCount++
    }
  }

  for (const skill of extraction.skillUpdates) {
    if (skill.name && skill.content) {
      learningDB.upsertSkill({
        name: skill.name,
        content: skill.content,
        scope: skill.scope || 'shared',
        type: 'technical_pattern',
        tags: skill.tags || [],
      })
      skillCount++
    }
  }

  console.log(`[Pocket] LearningPipeline: saved ${memoryCount} memory entries, ${skillCount} skills for session ${input.sessionId}`)
  return { memoryCount, skillCount }
}
