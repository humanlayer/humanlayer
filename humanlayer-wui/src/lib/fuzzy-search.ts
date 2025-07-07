/**
 * Fuzzy search utilities inspired by Superhuman and Linear
 * Provides fast, intuitive search with highlighting and scoring
 */

export interface FuzzyMatch {
  score: number
  indices: number[]
  item: any
  matches: Array<{ indices: number[]; key?: string }>
}

export interface FuzzySearchOptions {
  keys?: string[]
  threshold?: number
  includeScore?: boolean
  includeMatches?: boolean
  minMatchCharLength?: number
  ignoreLocation?: boolean
}

/**
 * Calculate fuzzy match score for a single string
 */
function fuzzyMatchString(pattern: string, text: string): { score: number; indices: number[] } {
  if (!pattern) return { score: 1, indices: [] }
  if (!text) return { score: 0, indices: [] }

  pattern = pattern.toLowerCase()
  text = text.toLowerCase()

  let patternIdx = 0
  let textIdx = 0
  const indices: number[] = []
  let score = 0
  let consecutiveMatches = 0

  while (patternIdx < pattern.length && textIdx < text.length) {
    if (pattern[patternIdx] === text[textIdx]) {
      indices.push(textIdx)
      consecutiveMatches++

      // Bonus for consecutive matches (like Superhuman)
      score += consecutiveMatches * 2

      // Bonus for start of word matches
      if (textIdx === 0 || text[textIdx - 1] === ' ' || text[textIdx - 1] === '/') {
        score += 5
      }

      patternIdx++
    } else {
      consecutiveMatches = 0
    }
    textIdx++
  }

  // Penalty for unmatched pattern characters
  if (patternIdx < pattern.length) {
    score = 0
  } else {
    // Bonus for shorter strings (exact matches rank higher)
    score += Math.max(0, 100 - text.length)

    // Bonus for match density
    score += (indices.length / text.length) * 50
  }

  return { score, indices }
}

/**
 * Search through an array of items with fuzzy matching
 */
export function fuzzySearch<T>(
  items: T[],
  pattern: string,
  options: FuzzySearchOptions = {},
): FuzzyMatch[] {
  const { keys = [], threshold = 0.1, minMatchCharLength = 1 } = options

  if (!pattern || pattern.length < minMatchCharLength) {
    return items.map(item => ({
      score: 1,
      indices: [],
      item,
      matches: [],
    }))
  }

  const results: FuzzyMatch[] = []

  for (const item of items) {
    let bestScore = 0
    let bestMatches: Array<{ indices: number[]; key?: string }> = []

    if (keys.length === 0) {
      // Search in the item itself (assume it's a string)
      const match = fuzzyMatchString(pattern, String(item))
      if (match.score > threshold) {
        results.push({
          score: match.score,
          indices: match.indices,
          item,
          matches: [{ indices: match.indices }],
        })
      }
    } else {
      // Search in specified keys
      for (const key of keys) {
        const value = (item as any)[key]
        if (typeof value === 'string') {
          const match = fuzzyMatchString(pattern, value)
          if (match.score > bestScore) {
            bestScore = match.score
            bestMatches = [{ indices: match.indices, key }]
          } else if (match.score === bestScore && match.score > threshold) {
            bestMatches.push({ indices: match.indices, key })
          }
        }
      }

      if (bestScore > threshold) {
        results.push({
          score: bestScore,
          indices: bestMatches[0]?.indices || [],
          item,
          matches: bestMatches,
        })
      }
    }
  }

  // Sort by score (descending)
  return results.sort((a, b) => b.score - a.score)
}

/**
 * Highlight matched characters in text (for rendering)
 */
export function highlightMatches(
  text: string,
  indices: number[],
): Array<{ text: string; highlighted: boolean }> {
  if (!indices.length) {
    return [{ text, highlighted: false }]
  }

  const result: Array<{ text: string; highlighted: boolean }> = []
  let lastIndex = 0
  let i = 0

  while (i < indices.length) {
    const startIndex = indices[i]

    // Add non-highlighted text before this match
    if (startIndex > lastIndex) {
      result.push({
        text: text.slice(lastIndex, startIndex),
        highlighted: false,
      })
    }

    // Find consecutive indices
    let endIndex = startIndex
    while (i < indices.length - 1 && indices[i + 1] === indices[i] + 1) {
      i++
      endIndex = indices[i]
    }

    // Add highlighted text (consecutive characters)
    result.push({
      text: text.slice(startIndex, endIndex + 1),
      highlighted: true,
    })

    lastIndex = endIndex + 1
    i++
  }

  // Add remaining non-highlighted text
  if (lastIndex < text.length) {
    result.push({
      text: text.slice(lastIndex),
      highlighted: false,
    })
  }

  return result
}

/**
 * Directory-specific fuzzy search with path intelligence
 */
export function fuzzySearchDirectories(directories: string[], pattern: string): FuzzyMatch[] {
  // Enhance pattern matching for directory paths
  const enhancedPattern = pattern.replace(
    /^~/,
    // eslint-disable-next-line no-undef
    (typeof process !== 'undefined' && process.env?.HOME) || '',
  )

  return fuzzySearch(directories, enhancedPattern, {
    threshold: 0.1,
    minMatchCharLength: 1,
  }).map(match => ({
    ...match,
    // Boost score for exact directory name matches
    score: match.item.endsWith('/' + pattern) ? match.score + 100 : match.score,
  }))
}
