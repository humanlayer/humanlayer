import { describe, it, expect } from 'bun:test'
import { parseAnsiToSegments, hasAnsiCodes } from './ansiParser'

describe('ANSI Parser', () => {
  it('parses basic color codes', () => {
    const input = '\x1b[31mRed text\x1b[0m Normal text'
    const segments = parseAnsiToSegments(input)

    expect(segments).toHaveLength(2)
    expect(segments[0].text).toBe('Red text')
    expect(segments[0].style?.color).toBe('var(--terminal-color-1)')
    expect(segments[1].text).toBe(' Normal text')
    expect(segments[1].style).toBeUndefined()
  })

  it('detects ANSI codes correctly', () => {
    expect(hasAnsiCodes('\x1b[31mRed\x1b[0m')).toBe(true)
    expect(hasAnsiCodes('Plain text')).toBe(false)
    expect(hasAnsiCodes('Text with \x1b[32mgreen\x1b[0m inside')).toBe(true)
  })

  it('handles multiple color changes', () => {
    const input = '\x1b[32mGreen\x1b[34mBlue\x1b[0mNormal'
    const segments = parseAnsiToSegments(input)

    expect(segments).toHaveLength(3)
    expect(segments[0].style?.color).toBe('var(--terminal-color-2)')
    expect(segments[1].style?.color).toBe('var(--terminal-color-4)')
    expect(segments[2].style).toBeUndefined()
  })

  it('handles bright colors', () => {
    const input = '\x1b[91mBright Red\x1b[0m'
    const segments = parseAnsiToSegments(input)

    expect(segments[0].style?.color).toBe('var(--terminal-color-9)')
  })

  it('handles text without ANSI codes', () => {
    const input = 'Plain text without colors'
    const segments = parseAnsiToSegments(input)

    expect(segments).toHaveLength(1)
    expect(segments[0].text).toBe(input)
    expect(segments[0].style).toBeUndefined()
  })
})
