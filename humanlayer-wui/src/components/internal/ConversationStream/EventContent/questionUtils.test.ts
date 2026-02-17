import { describe, it, expect } from 'bun:test'
import { canSubmitQuestions, buildAnswersJson } from './questionUtils'
import type { QuestionItem } from './questionUtils'

// --- Test fixtures ---

const singleSelectQuestion: QuestionItem = {
  question: 'Which library?',
  header: 'Library',
  options: [
    { label: 'React', description: 'A UI library' },
    { label: 'Vue', description: 'Another UI library' },
  ],
  multiSelect: false,
}

const multiSelectQuestion: QuestionItem = {
  question: 'Which features?',
  header: 'Features',
  options: [
    { label: 'Auth', description: 'Authentication' },
    { label: 'DB', description: 'Database' },
    { label: 'API', description: 'REST API' },
  ],
  multiSelect: true,
}

// --- canSubmitQuestions tests ---

describe('canSubmitQuestions', () => {
  describe('single-select questions', () => {
    const questions = [singleSelectQuestion]

    it('returns false when no answer is selected', () => {
      expect(canSubmitQuestions(questions, {}, {}, {})).toBe(false)
    })

    it('returns true when a regular option is selected', () => {
      expect(canSubmitQuestions(questions, { 0: 'React' }, {}, {})).toBe(true)
    })

    it('returns false when answer is empty string', () => {
      expect(canSubmitQuestions(questions, { 0: '' }, {}, {})).toBe(false)
    })

    it('returns true when "Other" is selected with text', () => {
      expect(
        canSubmitQuestions(questions, {}, { 0: true }, { 0: 'Custom answer' }),
      ).toBe(true)
    })

    it('returns false when "Other" is selected without text', () => {
      expect(canSubmitQuestions(questions, {}, { 0: true }, {})).toBe(false)
    })

    it('returns false when "Other" is selected with empty text', () => {
      expect(canSubmitQuestions(questions, {}, { 0: true }, { 0: '' })).toBe(false)
    })

    it('returns false when "Other" is selected with whitespace-only text', () => {
      expect(
        canSubmitQuestions(questions, {}, { 0: true }, { 0: '   ' }),
      ).toBe(false)
    })
  })

  describe('multi-select questions', () => {
    const questions = [multiSelectQuestion]

    it('returns false when no options are selected', () => {
      expect(canSubmitQuestions(questions, {}, {}, {})).toBe(false)
    })

    it('returns false when answer is empty array', () => {
      expect(canSubmitQuestions(questions, { 0: [] }, {}, {})).toBe(false)
    })

    it('returns true when one option is selected', () => {
      expect(canSubmitQuestions(questions, { 0: ['Auth'] }, {}, {})).toBe(true)
    })

    it('returns true when multiple options are selected', () => {
      expect(
        canSubmitQuestions(questions, { 0: ['Auth', 'DB'] }, {}, {}),
      ).toBe(true)
    })

    it('returns true when "Other" is checked with text and no regular selections', () => {
      expect(
        canSubmitQuestions(questions, { 0: [] }, { 0: true }, { 0: 'Custom' }),
      ).toBe(true)
    })

    it('returns true when "Other" is checked without text but regular options are selected', () => {
      expect(
        canSubmitQuestions(questions, { 0: ['Auth'] }, { 0: true }, {}),
      ).toBe(true)
    })

    it('returns true when "Other" is checked with whitespace-only text but regular options are selected', () => {
      expect(
        canSubmitQuestions(questions, { 0: ['Auth'] }, { 0: true }, { 0: '   ' }),
      ).toBe(true)
    })

    it('returns false when "Other" is checked without text and no regular selections', () => {
      expect(canSubmitQuestions(questions, { 0: [] }, { 0: true }, {})).toBe(false)
    })

    it('returns false when "Other" is checked with whitespace-only text and no regular selections', () => {
      expect(
        canSubmitQuestions(questions, { 0: [] }, { 0: true }, { 0: '  \t  ' }),
      ).toBe(false)
    })
  })

  describe('multiple questions', () => {
    const questions = [singleSelectQuestion, multiSelectQuestion]

    it('returns true when all questions have valid answers', () => {
      expect(
        canSubmitQuestions(questions, { 0: 'React', 1: ['Auth'] }, {}, {}),
      ).toBe(true)
    })

    it('returns false when first question is unanswered', () => {
      expect(
        canSubmitQuestions(questions, { 1: ['Auth'] }, {}, {}),
      ).toBe(false)
    })

    it('returns false when second question is unanswered', () => {
      expect(
        canSubmitQuestions(questions, { 0: 'React' }, {}, {}),
      ).toBe(false)
    })

    it('returns false when both questions are unanswered', () => {
      expect(canSubmitQuestions(questions, {}, {}, {})).toBe(false)
    })

    it('returns true with mixed regular and "Other" answers across questions', () => {
      expect(
        canSubmitQuestions(
          questions,
          { 1: ['Auth', 'DB'] },
          { 0: true },
          { 0: 'Custom framework' },
        ),
      ).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('returns true for empty questions array', () => {
      expect(canSubmitQuestions([], {}, {}, {})).toBe(true)
    })

    it('handles undefined answer entries gracefully', () => {
      expect(
        canSubmitQuestions([singleSelectQuestion], { 0: undefined as any }, {}, {}),
      ).toBe(false)
    })
  })
})

// --- buildAnswersJson tests ---

describe('buildAnswersJson', () => {
  it('uses header as key for regular answers', () => {
    const questions = [singleSelectQuestion]
    const result = buildAnswersJson(questions, { 0: 'React' }, {}, {})
    expect(result).toEqual({ Library: 'React' })
  })

  it('falls back to question_N when header is empty', () => {
    const noHeaderQuestion: QuestionItem = {
      ...singleSelectQuestion,
      header: '',
    }
    const result = buildAnswersJson([noHeaderQuestion], { 0: 'React' }, {}, {})
    expect(result).toEqual({ question_0: 'React' })
  })

  it('uses "Other" text when "Other" is selected with text', () => {
    const questions = [singleSelectQuestion]
    const result = buildAnswersJson(
      questions,
      { 0: '' },
      { 0: true },
      { 0: 'My custom answer' },
    )
    expect(result).toEqual({ Library: 'My custom answer' })
  })

  it('uses regular answer when "Other" is selected but text is empty', () => {
    const questions = [singleSelectQuestion]
    const result = buildAnswersJson(
      questions,
      { 0: 'React' },
      { 0: true },
      { 0: '' },
    )
    // otherTexts[0] is empty string (falsy), so falls through to answers[0]
    expect(result).toEqual({ Library: 'React' })
  })

  it('builds multi-select answers as arrays', () => {
    const questions = [multiSelectQuestion]
    const result = buildAnswersJson(questions, { 0: ['Auth', 'DB'] }, {}, {})
    expect(result).toEqual({ Features: ['Auth', 'DB'] })
  })

  it('merges multi-select selections with "Other" text', () => {
    const questions = [multiSelectQuestion]
    const result = buildAnswersJson(
      questions,
      { 0: ['Auth', 'DB'] },
      { 0: true },
      { 0: 'Custom feature' },
    )
    expect(result).toEqual({ Features: ['Auth', 'DB', 'Custom feature'] })
  })

  it('uses only "Other" text for multi-select when no regular options selected', () => {
    const questions = [multiSelectQuestion]
    const result = buildAnswersJson(
      questions,
      { 0: [] },
      { 0: true },
      { 0: 'Custom feature' },
    )
    expect(result).toEqual({ Features: ['Custom feature'] })
  })

  it('ignores "Other" with whitespace-only text in multi-select', () => {
    const questions = [multiSelectQuestion]
    const result = buildAnswersJson(
      questions,
      { 0: ['Auth'] },
      { 0: true },
      { 0: '   ' },
    )
    expect(result).toEqual({ Features: ['Auth'] })
  })

  it('builds answers for multiple questions', () => {
    const questions = [singleSelectQuestion, multiSelectQuestion]
    const result = buildAnswersJson(
      questions,
      { 0: 'Vue', 1: ['API'] },
      {},
      {},
    )
    expect(result).toEqual({
      Library: 'Vue',
      Features: ['API'],
    })
  })
})
