import { useState } from 'react'
import { api } from '#/shared/api/client.js'

const CATEGORIES = [
  { id: 'task_completion', label: 'Task completed successfully' },
  { id: 'code_quality', label: 'Code quality was solid' },
  { id: 'communication', label: 'Communication was clear' },
  { id: 'speed', label: 'Speed was good' },
] as const

interface RatingCardProps {
  sessionId: string
  /** Show this when session is done/idle and user hasn't rated yet */
  visible: boolean
}

export function RatingCard({ sessionId, visible }: RatingCardProps) {
  const [stars, setStars] = useState(0)
  const [hoveredStar, setHoveredStar] = useState(0)
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [comment, setComment] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [sending, setSending] = useState(false)

  if (!visible || dismissed || submitted) return null

  async function handleSubmit() {
    if (stars === 0) return
    setSending(true)
    try {
      await api.rateSession(sessionId, stars, selectedCategories, comment || undefined)
      setSubmitted(true)
    } catch {
      // Silently fail — user can retry
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800 my-3">
      <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
        Rate this session
      </p>

      {/* Stars */}
      <div className="flex gap-1 mb-3" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            type="button"
            onClick={() => setStars(n)}
            onMouseEnter={() => setHoveredStar(n)}
            onMouseLeave={() => setHoveredStar(0)}
            className="text-2xl transition-colors"
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
          >
            {n <= (hoveredStar || stars) ? '★' : '☆'}
          </button>
        ))}
        {stars > 0 && (
          <span className="text-sm text-gray-400 dark:text-gray-500 ml-1 self-center">
            {stars}/5
          </span>
        )}
      </div>

      {/* Categories */}
      {stars > 0 && (
        <div className="space-y-1.5 mb-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">What was good?</p>
          {CATEGORIES.map(cat => (
            <label key={cat.id} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedCategories.includes(cat.id)}
                onChange={e => {
                  if (e.target.checked) {
                    setSelectedCategories([...selectedCategories, cat.id])
                  } else {
                    setSelectedCategories(selectedCategories.filter(c => c !== cat.id))
                  }
                }}
                className="rounded border-gray-300 dark:border-gray-600 text-[#4FB8B2] focus:ring-[#4FB8B2]"
              />
              <span className="text-xs text-gray-600 dark:text-gray-400">{cat.label}</span>
            </label>
          ))}
        </div>
      )}

      {/* Comment */}
      {stars > 0 && (
        <div className="mb-3">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Anything else?</p>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="What worked well? What could be better?"
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-xs focus:ring-2 focus:ring-[#4FB8B2] focus:border-transparent outline-none resize-none"
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={stars === 0 || sending}
          className="px-4 py-1.5 bg-[#4FB8B2] hover:bg-[#3da39d] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg transition-colors"
        >
          {sending ? 'Sending...' : 'Submit'}
        </button>
      </div>
    </div>
  )
}
