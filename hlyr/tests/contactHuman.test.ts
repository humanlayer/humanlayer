import { describe, it, expect } from 'vitest'
import { formatMessage } from '../src/commands/contactHuman'

describe('contact_human command', () => {
  it('formats the message correctly', () => {
    const result = formatMessage('Test')
    expect(result).toBe('Hello world, you passed in Test')
  })

  it('handles empty message', () => {
    const result = formatMessage('')
    expect(result).toBe('Hello world, you passed in ')
  })

  it('handles special characters', () => {
    const result = formatMessage('Hello! @#$%')
    expect(result).toBe('Hello world, you passed in Hello! @#$%')
  })
})
