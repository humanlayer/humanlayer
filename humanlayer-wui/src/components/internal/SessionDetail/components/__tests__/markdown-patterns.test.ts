import { describe, it, expect } from 'vitest'

// Helper to extract matched ranges from a regex
function getMatches(regex: RegExp, text: string): Array<{start: number, end: number, content: string}> {
  const matches: Array<{start: number, end: number, content: string}> = []
  let match

  while ((match = regex.exec(text)) !== null) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      content: match[1] // The captured group
    })
  }

  return matches
}

describe('Markdown Italic Patterns', () => {
  // The fixed regex patterns
  const underscoreItalicRegex = /(?<=^|\s|[^\w])_(?!_)([^_]+)_(?!_)(?=\s|[^\w]|$)/g
  const asteriskItalicRegex = /(?<=^|\s|[^\w])\*(?!\*)([^*]+)\*(?!\*)(?=\s|[^\w]|$)/g

  describe('underscore italic pattern', () => {
    it('should NOT match programming identifiers', () => {
      const text = 'dept_id should have an eng_id'
      const matches = getMatches(underscoreItalicRegex, text)
      expect(matches).toHaveLength(0)
    })

    it('should match valid italic syntax with spaces', () => {
      const text = 'this is _italic_ text'
      const matches = getMatches(underscoreItalicRegex, text)
      expect(matches).toHaveLength(1)
      expect(matches[0].content).toBe('italic')
    })

    it('should match at start of line', () => {
      const text = '_italic_ at start'
      const matches = getMatches(underscoreItalicRegex, text)
      expect(matches).toHaveLength(1)
      expect(matches[0].content).toBe('italic')
    })

    it('should match at end of line', () => {
      const text = 'text ends with _italic_'
      const matches = getMatches(underscoreItalicRegex, text)
      expect(matches).toHaveLength(1)
      expect(matches[0].content).toBe('italic')
    })

    it('should match with punctuation', () => {
      const text = 'Hello, _world_!'
      const matches = getMatches(underscoreItalicRegex, text)
      expect(matches).toHaveLength(1)
      expect(matches[0].content).toBe('world')
    })

    it('should NOT match snake_case variables', () => {
      const cases = [
        'user_name',
        'API_KEY',
        'SECRET_TOKEN',
        'get_user_by_id',
        '__private_var__'
      ]

      cases.forEach(testCase => {
        const matches = getMatches(underscoreItalicRegex, testCase)
        expect(matches).toHaveLength(0)
      })
    })

    it('should handle mixed scenarios correctly', () => {
      const text = 'user_name, _emphasis_, and code_var'
      const matches = getMatches(underscoreItalicRegex, text)
      expect(matches).toHaveLength(1)
      expect(matches[0].content).toBe('emphasis')
    })
  })

  describe('asterisk italic pattern', () => {
    it('should match valid italic syntax', () => {
      const text = 'this is *italic* text'
      const matches = getMatches(asteriskItalicRegex, text)
      expect(matches).toHaveLength(1)
      expect(matches[0].content).toBe('italic')
    })

    it('should NOT match within identifiers', () => {
      const text = 'variable*name and other*thing'
      const matches = getMatches(asteriskItalicRegex, text)
      expect(matches).toHaveLength(0)
    })
  })
})