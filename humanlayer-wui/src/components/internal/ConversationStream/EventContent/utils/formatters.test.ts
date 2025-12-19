import { describe, it, expect } from 'bun:test'
import {
  detectToolError,
  hasMcpError,
  extractMcpError,
  formatToolResultPreview,
} from './formatters'

describe('MCP Error Detection', () => {
  describe('hasMcpError', () => {
    it('should detect MCP error code -32603', () => {
      const content = 'MCP error -32603: Internal error occurred'
      expect(hasMcpError(content)).toBe(true)
    })

    it('should detect MCP error with various codes', () => {
      expect(hasMcpError('MCP error -32700')).toBe(true)
      expect(hasMcpError('MCP error -32600')).toBe(true)
      expect(hasMcpError('MCP error -32601')).toBe(true)
      expect(hasMcpError('MCP error -32602')).toBe(true)
    })

    it('should detect tool_use_error pattern', () => {
      const content = 'Response contained tool_use_error: something went wrong'
      expect(hasMcpError(content)).toBe(true)
    })

    it('should detect "Failed to process" pattern', () => {
      const content = 'Failed to process WebSearch request'
      expect(hasMcpError(content)).toBe(true)
    })

    it('should detect JSON-RPC error format', () => {
      const content = '{"error": {"code": -32603, "message": "Internal error"}}'
      expect(hasMcpError(content)).toBe(true)
    })

    it('should detect MCP protocol error', () => {
      const content = 'MCP protocol error during communication'
      expect(hasMcpError(content)).toBe(true)
    })

    it('should detect tool execution failed', () => {
      const content = 'Tool execution failed: timeout'
      expect(hasMcpError(content)).toBe(true)
    })

    it('should detect connection errors', () => {
      expect(hasMcpError('Connection refused by server')).toBe(true)
      expect(hasMcpError('Connection reset during request')).toBe(true)
      expect(hasMcpError('Connection timed out')).toBe(true)
    })

    it('should NOT flag successful WebSearch results as errors', () => {
      const successContent = `
        Title: Example Result
        URL: https://example.com
        Snippet: This is a successful search result
        Links: [Example](https://example.com)
      `
      expect(hasMcpError(successContent)).toBe(false)
    })

    it('should NOT flag results containing "error" in content (false positive prevention)', () => {
      // Content that mentions "error" but is not an MCP error
      const falsePositiveContent = 'Search results for "common javascript error handling patterns"'
      expect(hasMcpError(falsePositiveContent)).toBe(false)

      // Another false positive case
      const tutorialContent = 'How to handle error cases in your application'
      expect(hasMcpError(tutorialContent)).toBe(false)
    })

    it('should NOT flag normal content with numbers', () => {
      const content = 'Found 32603 results for your query'
      expect(hasMcpError(content)).toBe(false)
    })
  })

  describe('extractMcpError', () => {
    it('should extract error code from MCP error message', () => {
      const content = 'MCP error -32603: Internal error'
      const result = extractMcpError(content)

      expect(result).not.toBeNull()
      expect(result!.code).toBe(-32603)
      expect(result!.message).toBe('Internal error')
      expect(result!.suggestion).toBeTruthy()
    })

    it('should extract error code from JSON-RPC format', () => {
      const content = '{"error": {"code": -32601, "message": "Method not found"}}'
      const result = extractMcpError(content)

      expect(result).not.toBeNull()
      expect(result!.code).toBe(-32601)
      expect(result!.message).toBe('Method not found')
    })

    it('should return null for non-MCP error content', () => {
      const content = 'Search completed successfully with 10 results'
      const result = extractMcpError(content)

      expect(result).toBeNull()
    })

    it('should handle unknown error codes', () => {
      const content = 'MCP error -99999: Unknown error type'
      const result = extractMcpError(content)

      expect(result).not.toBeNull()
      expect(result!.code).toBe(-99999)
      expect(result!.message).toBe('MCP error -99999')
      expect(result!.suggestion).toBeTruthy()
    })

    it('should handle MCP errors without numeric code', () => {
      const content = 'tool_use_error: Something went wrong'
      const result = extractMcpError(content)

      expect(result).not.toBeNull()
      expect(result!.code).toBeNull()
      expect(result!.message).toBe('MCP tool error')
    })

    it('should provide appropriate suggestions for known error codes', () => {
      const testCases = [
        { code: -32700, expectedSubstring: 'invalid JSON' },
        { code: -32600, expectedSubstring: 'format is invalid' },
        { code: -32601, expectedSubstring: 'not available' },
        { code: -32602, expectedSubstring: 'parameters' },
        { code: -32603, expectedSubstring: 'internal error' },
      ]

      for (const { code, expectedSubstring } of testCases) {
        const content = `MCP error ${code}: Test error`
        const result = extractMcpError(content)

        expect(result).not.toBeNull()
        expect(result!.suggestion?.toLowerCase()).toContain(expectedSubstring.toLowerCase())
      }
    })
  })

  describe('detectToolError', () => {
    it('should detect MCP error code -32603', () => {
      const result = detectToolError('WebSearch', 'MCP error -32603: Internal error')
      expect(result).toBe(true)
    })

    it('should detect tool_use_error pattern', () => {
      const result = detectToolError('mcp__searxng__search', 'tool_use_error: Request failed')
      expect(result).toBe(true)
    })

    it('should detect "Failed to process" pattern', () => {
      const result = detectToolError('WebSearch', 'Failed to process search request')
      expect(result).toBe(true)
    })

    it('should NOT flag successful WebSearch results as errors', () => {
      const successContent = `
        Title: Example
        URL: https://example.com
        Snippet: Search results found
        Links: [Link](https://example.com)
      `
      const result = detectToolError('WebSearch', successContent)
      expect(result).toBe(false)
    })

    it('should NOT flag results containing "error" in content (false positive prevention)', () => {
      // Content that discusses errors but is not itself an error
      const content = 'Search results for "javascript error handling best practices"'
      const result = detectToolError('WebSearch', content)
      expect(result).toBe(false)
    })

    it('should still detect generic errors for non-MCP tools', () => {
      const result = detectToolError('Bash', 'error: command not found')
      expect(result).toBe(true)
    })

    it('should detect Edit tool failures', () => {
      const result = detectToolError('Edit', 'Error: File has not been read yet')
      expect(result).toBe(true)
    })

    it('should recognize successful Edit operations', () => {
      const successContent = "The file has been updated. Here's the result of running `cat -n` on a snippet of the edited file:"
      const result = detectToolError('Edit', successContent)
      expect(result).toBe(false)
    })

    it('should handle Write tool success (empty content)', () => {
      const result = detectToolError('Write', '')
      expect(result).toBe(false)
    })

    it('should detect Write tool errors', () => {
      const result = detectToolError('Write', 'Error: File has not been read')
      expect(result).toBe(true)
    })

    it('should detect Grep errors', () => {
      const result = detectToolError('Grep', 'grep: Invalid regular expression')
      expect(result).toBe(true)
    })

    it('should not flag Grep results as errors', () => {
      const result = detectToolError('Grep', '/path/to/file.ts:10:const error = new Error()')
      expect(result).toBe(false)
    })

    it('should handle false positives with "0 errors"', () => {
      const result = detectToolError('Bash', 'Build completed with 0 errors')
      expect(result).toBe(false)
    })
  })
})

describe('formatToolResultPreview', () => {
  it('should return null for empty content', () => {
    expect(formatToolResultPreview('')).toBeNull()
    expect(formatToolResultPreview('   ')).toBeNull()
  })

  it('should truncate long single lines', () => {
    const longLine = 'a'.repeat(100)
    const result = formatToolResultPreview(longLine)
    expect(result).not.toBeNull()
    expect(result!.length).toBeLessThanOrEqual(80)
    expect(result!.endsWith('...')).toBe(true)
  })

  it('should show line count for multiple lines', () => {
    const content = 'line1\nline2\nline3'
    const result = formatToolResultPreview(content)
    expect(result).toContain('(3 lines)')
  })

  it('should respect custom truncate length', () => {
    const content = 'a'.repeat(50)
    const result = formatToolResultPreview(content, { truncateLength: 30 })
    expect(result).not.toBeNull()
    expect(result!.length).toBeLessThanOrEqual(30)
  })
})
