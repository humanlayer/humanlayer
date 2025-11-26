import { describe, it, expect } from 'bun:test'
import { render } from '@testing-library/react'
import { formatToolResult } from '../formatToolResult'
import { ConversationEvent } from '@/lib/daemon/types'

describe('formatToolResult - Write Tool', () => {
  it('should show success for empty content with isCompleted=true', () => {
    const toolResult: Partial<ConversationEvent> = {
      toolResultContent: '',
      isCompleted: true,
    }
    const result = formatToolResult('Write', toolResult as ConversationEvent)
    const { container } = render(<>{result}</>)
    expect(container.textContent).toContain('File written')
    expect(container.querySelector('.text-destructive')).toBeNull()
  })

  it('should show error for empty content with isCompleted=false', () => {
    const toolResult: Partial<ConversationEvent> = {
      toolResultContent: '',
      isCompleted: false,
    }
    const result = formatToolResult('Write', toolResult as ConversationEvent)
    const { container } = render(<>{result}</>)
    expect(container.textContent).toContain('Write failed')
  })

  it('should show specific error for "file has not been read yet"', () => {
    const toolResult: Partial<ConversationEvent> = {
      toolResultContent: 'Error: File has not been read yet',
      isCompleted: false,
    }
    const result = formatToolResult('Write', toolResult as ConversationEvent)
    const { container } = render(<>{result}</>)
    expect(container.textContent).toContain('File not read yet')
  })

  it('should detect error in content regardless of isCompleted', () => {
    const toolResult: Partial<ConversationEvent> = {
      toolResultContent: 'Error: Permission denied',
      isCompleted: true, // Even if marked completed
    }
    const result = formatToolResult('Write', toolResult as ConversationEvent)
    const { container } = render(<>{result}</>)
    expect(container.textContent).toContain('Permission denied')
  })

  it('should treat non-error content as success', () => {
    const toolResult: Partial<ConversationEvent> = {
      toolResultContent: 'Some informational message',
      isCompleted: true,
    }
    const result = formatToolResult('Write', toolResult as ConversationEvent)
    const { container } = render(<>{result}</>)
    expect(container.textContent).toContain('File written')
    expect(container.querySelector('.text-destructive')).toBeNull()
  })
})

describe('formatToolResult - Regression Tests for Other Tools', () => {
  describe('Edit Tool', () => {
    it('should show success for Edit with update pattern', () => {
      const toolResult: Partial<ConversationEvent> = {
        toolResultContent:
          "The file has been updated. Here's the result of running `cat -n` on a snippet of the edited file:",
        isCompleted: true,
      }
      const result = formatToolResult('Edit', toolResult as ConversationEvent)
      const { container } = render(<>{result}</>)
      expect(container.textContent).toContain('File updated')
      expect(container.querySelector('.text-destructive')).toBeNull()
    })

    it('should show error for Edit without read', () => {
      const toolResult: Partial<ConversationEvent> = {
        toolResultContent: 'Error: File has not been read yet',
        isCompleted: false,
      }
      const result = formatToolResult('Edit', toolResult as ConversationEvent)
      const { container } = render(<>{result}</>)
      expect(container.textContent).toContain('File not read yet')
    })
  })

  describe('Read Tool', () => {
    it('should show line count for Read tool', () => {
      const toolResult: Partial<ConversationEvent> = {
        toolResultContent:
          '     1→line one\n     2→line two\n     3→line three\n\n<system-reminder>\ntest\n</system-reminder>',
        isCompleted: true,
      }
      const result = formatToolResult('Read', toolResult as ConversationEvent)
      const { container } = render(<>{result}</>)
      // Should count only actual content lines (system reminder stripped)
      expect(container.textContent).toContain('Read 3 lines')
      expect(container.querySelector('.text-destructive')).toBeNull()
    })

    it('should count all lines when no system reminder is present', () => {
      const toolResult: Partial<ConversationEvent> = {
        toolResultContent: '     1→line one\n     2→line two\n     3→line three\n',
        isCompleted: true,
      }
      const result = formatToolResult('Read', toolResult as ConversationEvent)
      const { container } = render(<>{result}</>)
      expect(container.textContent).toContain('Read 3 lines')
    })

    it('should handle empty Read content', () => {
      const toolResult: Partial<ConversationEvent> = {
        toolResultContent: '',
        isCompleted: true,
      }
      const result = formatToolResult('Read', toolResult as ConversationEvent)
      const { container } = render(<>{result}</>)
      expect(container.textContent).toContain('No output')
    })
  })

  describe('Bash Tool', () => {
    it('should show command output for Bash', () => {
      const toolResult: Partial<ConversationEvent> = {
        toolResultContent: 'Hello World',
        isCompleted: true,
      }
      const result = formatToolResult('Bash', toolResult as ConversationEvent)
      const { container } = render(<>{result}</>)
      expect(container.textContent).toContain('Hello World')
      expect(container.querySelector('.text-destructive')).toBeNull()
    })

    it('should show command completed for empty Bash output', () => {
      const toolResult: Partial<ConversationEvent> = {
        toolResultContent: '',
        isCompleted: true,
      }
      const result = formatToolResult('Bash', toolResult as ConversationEvent)
      const { container } = render(<>{result}</>)
      expect(container.textContent).toContain('No output')
    })

    it('should show multiple lines count for Bash', () => {
      const toolResult: Partial<ConversationEvent> = {
        toolResultContent: 'line1\nline2\nline3',
        isCompleted: true,
      }
      const result = formatToolResult('Bash', toolResult as ConversationEvent)
      const { container } = render(<>{result}</>)
      expect(container.textContent).toContain('line1 ... (3 lines)')
    })
  })
})
