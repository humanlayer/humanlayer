import { describe, it, expect } from 'bun:test'
import { render } from '@testing-library/react'
import { formatToolResult } from '../formatToolResult'
import type { ConversationEvent } from '@/lib/daemon/types'

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
      // Should count lines properly (total lines - 5 for system reminder)
      expect(container.textContent).toContain('Read 2 lines')
      expect(container.querySelector('.text-destructive')).toBeNull()
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

describe('formatToolResult - MCP Error Detection', () => {
  describe('WebSearch Tool', () => {
    it('should show error for WebSearch with MCP error code and text-destructive class', () => {
      const toolResult: Partial<ConversationEvent> = {
        toolResultContent: 'MCP error -32603: Internal error occurred during search',
        isCompleted: true,
      }
      const result = formatToolResult('WebSearch', toolResult as ConversationEvent)
      const { container } = render(<>{result}</>)
      expect(container.textContent).toContain('Search failed')
      expect(container.querySelector('.text-destructive')).not.toBeNull()
    })

    it('should show error for WebSearch with tool_use_error pattern', () => {
      const toolResult: Partial<ConversationEvent> = {
        toolResultContent: 'tool_use_error: Search request failed',
        isCompleted: true,
      }
      const result = formatToolResult('WebSearch', toolResult as ConversationEvent)
      const { container } = render(<>{result}</>)
      expect(container.textContent).toContain('Search failed')
      expect(container.querySelector('.text-destructive')).not.toBeNull()
    })

    it('should NOT show error for successful WebSearch', () => {
      const toolResult: Partial<ConversationEvent> = {
        toolResultContent: `
          Title: Example Result
          URL: https://example.com
          Snippet: This is a test result
          Links: [Example](https://example.com)
        `,
        isCompleted: true,
      }
      const result = formatToolResult('WebSearch', toolResult as ConversationEvent)
      const { container } = render(<>{result}</>)
      expect(container.textContent).toContain('results')
      expect(container.querySelector('.text-destructive')).toBeNull()
    })

    it('should NOT flag content containing "error" word as failure', () => {
      const toolResult: Partial<ConversationEvent> = {
        toolResultContent: `
          Title: JavaScript Error Handling Best Practices
          URL: https://example.com/error-handling
          Snippet: Learn how to handle errors in your code
          Links: [Guide](https://example.com)
        `,
        isCompleted: true,
      }
      const result = formatToolResult('WebSearch', toolResult as ConversationEvent)
      const { container } = render(<>{result}</>)
      expect(container.querySelector('.text-destructive')).toBeNull()
    })
  })

  describe('MCP Tools (mcp__* prefix)', () => {
    it('should show error for mcp__ tool with tool_use_error', () => {
      const toolResult: Partial<ConversationEvent> = {
        toolResultContent: 'tool_use_error: Request to SearXNG failed',
        isCompleted: true,
      }
      const result = formatToolResult('mcp__searxng__search', toolResult as ConversationEvent)
      const { container } = render(<>{result}</>)
      expect(container.textContent).toContain('searxng')
      expect(container.textContent).toContain('failed')
      expect(container.querySelector('.text-destructive')).not.toBeNull()
    })

    it('should show MCP error message for known error code', () => {
      const toolResult: Partial<ConversationEvent> = {
        toolResultContent: 'MCP error -32603: Something went wrong',
        isCompleted: true,
      }
      const result = formatToolResult('mcp__linear__create_issue', toolResult as ConversationEvent)
      const { container } = render(<>{result}</>)
      expect(container.textContent).toContain('linear')
      expect(container.textContent).toContain('failed')
      expect(container.querySelector('.text-destructive')).not.toBeNull()
    })

    it('should NOT show error for successful MCP tool call', () => {
      const toolResult: Partial<ConversationEvent> = {
        toolResultContent: 'Issue created successfully with ID: LIN-123',
        isCompleted: true,
      }
      const result = formatToolResult('mcp__linear__create_issue', toolResult as ConversationEvent)
      const { container } = render(<>{result}</>)
      expect(container.textContent).toContain('completed')
      expect(container.querySelector('.text-destructive')).toBeNull()
    })
  })

  describe('WebFetch Tool', () => {
    it('should show error for WebFetch with MCP error', () => {
      const toolResult: Partial<ConversationEvent> = {
        toolResultContent: 'MCP error -32603: Failed to fetch URL',
        isCompleted: true,
      }
      const result = formatToolResult('WebFetch', toolResult as ConversationEvent)
      const { container } = render(<>{result}</>)
      expect(container.textContent).toContain('Fetch failed')
      expect(container.querySelector('.text-destructive')).not.toBeNull()
    })

    it('should show error for WebFetch with connection error', () => {
      const toolResult: Partial<ConversationEvent> = {
        toolResultContent: 'Connection timed out while fetching resource',
        isCompleted: true,
      }
      const result = formatToolResult('WebFetch', toolResult as ConversationEvent)
      const { container } = render(<>{result}</>)
      expect(container.textContent).toContain('Fetch failed')
      expect(container.querySelector('.text-destructive')).not.toBeNull()
    })

    it('should NOT show error for successful WebFetch', () => {
      const toolResult: Partial<ConversationEvent> = {
        toolResultContent: 'This is the content of the fetched page with lots of text...',
        isCompleted: true,
      }
      const result = formatToolResult('WebFetch', toolResult as ConversationEvent)
      const { container } = render(<>{result}</>)
      expect(container.textContent).toContain('Fetched')
      expect(container.querySelector('.text-destructive')).toBeNull()
    })
  })
})
