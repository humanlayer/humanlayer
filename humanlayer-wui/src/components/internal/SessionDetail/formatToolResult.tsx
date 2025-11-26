import React from 'react'
import { ConversationEvent } from '@/lib/daemon/types'
import { truncate, parseMcpToolName } from '@/utils/formatting'
import { stripSystemReminder } from '@/components/internal/ConversationStream/EventContent/utils/formatters'
import { hasAnsiCodes, AnsiText } from '@/utils/ansiParser'

// TODO(2): Consider creating tool-specific formatters in separate files
// TODO(2): Add unit tests for each tool formatter
// TODO(3): Extract magic numbers to constants (e.g., truncate lengths, line limits)

// Format tool result content into abbreviated display
export function formatToolResult(
  toolName: string,
  toolResult: ConversationEvent,
  toolCall?: ConversationEvent,
): React.ReactNode {
  const content = toolResult.toolResultContent || ''

  // Handle empty content
  if (!content.trim()) {
    // Special handling for Write tool - empty content is normal
    if (toolName === 'Write') {
      // Don't return early - let the formatter handle this case
      // The switch statement below will show "File written" or "Write failed" based on isCompleted
    } else {
      return <span className="text-muted-foreground italic">No output</span>
    }
  }

  // More specific error detection to avoid false positives
  // TODO(2): Extract error detection logic into a separate utility
  let isError = false

  if (toolName === 'Edit') {
    // For Edit tool, check for success pattern
    const successPattern =
      "has been updated. Here's the result of running `cat -n` on a snippet of the edited file:"
    isError = !content.includes(successPattern)
  } else if (toolName === 'Write') {
    // Write tool success detection based on DB analysis of 622 operations:
    // - Successful writes have empty content and isCompleted=true
    // - Failed writes have error messages in content
    if (content.trim() === '') {
      // Empty content: check isCompleted field (98.6% accuracy from DB analysis)
      isError = !toolResult.isCompleted
    } else {
      // Non-empty content: check for error indicators
      const lowerContent = content.toLowerCase()
      isError =
        lowerContent.includes('error') ||
        lowerContent.includes('failed') ||
        lowerContent.includes('file has not been read')
      // If content exists but no error indicators, assume success
      // (though DB shows successful writes always have empty content)
    }
  } else if (toolName === 'Grep') {
    // For Grep tool, only mark as error if it's a real grep error
    // The grep tool is built-in and rarely fails
    const lowerContent = content.toLowerCase()

    // Only check for actual grep command errors (not content containing "error")
    const hasGrepError =
      lowerContent.startsWith('grep:') || // Real grep errors start with "grep:"
      lowerContent.includes('invalid regex') ||
      lowerContent.includes('invalid regular expression')

    isError = hasGrepError
  } else {
    // For other tools, use existing keyword detection
    const lowerContent = content.toLowerCase()

    // Check for error patterns
    const hasErrorKeyword =
      lowerContent.includes('error:') ||
      lowerContent.includes('failed:') ||
      lowerContent.includes('failed to') ||
      lowerContent.includes('exception:') ||
      lowerContent.includes('traceback') ||
      lowerContent.includes('was blocked') ||
      lowerContent.includes('permission denied') ||
      lowerContent.includes('access denied') ||
      lowerContent.includes('not allowed') ||
      lowerContent.includes('forbidden') ||
      lowerContent.includes('file has not been read yet') ||
      lowerContent.includes('read it first') ||
      lowerContent.includes('file not found') ||
      lowerContent.includes('no such file') ||
      (lowerContent.includes('matches of the string to replace') &&
        lowerContent.includes('but replace_all is false'))

    // Exclude false positives
    const isFalsePositive =
      lowerContent.includes('no error') ||
      lowerContent.includes('error: 0') ||
      lowerContent.includes('error code 0') ||
      lowerContent.includes('error code: 0') ||
      lowerContent.includes('(0 errors') ||
      lowerContent.includes('0 errors)') ||
      lowerContent.includes('0 error(s)')

    isError = hasErrorKeyword && !isFalsePositive
  }

  let abbreviated: string | React.ReactNode

  switch (toolName) {
    case 'Read': {
      const cleanedContent = stripSystemReminder(content)
      const lineCount = cleanedContent
        ? cleanedContent
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean).length
        : 0
      abbreviated = `Read ${lineCount} lines`
      break
    }

    case 'Bash': {
      const lines = content.split('\n').filter((l: string) => l.trim())
      if (!content || lines.length === 0) {
        abbreviated = 'Command completed'
      } else if (lines.length === 1) {
        // For single line, show with ANSI colors if present
        const firstLine = lines[0]
        if (hasAnsiCodes(firstLine)) {
          // Always return colored version, let CSS handle truncation
          return (
            <span className="inline-block max-w-[60ch] overflow-hidden text-ellipsis whitespace-nowrap">
              <AnsiText content={firstLine} />
            </span>
          )
        } else {
          abbreviated = truncate(firstLine, 80)
        }
      } else {
        // Multiple lines - show first line with colors
        const firstLine = lines[0]
        if (hasAnsiCodes(firstLine)) {
          // Return colored first line with line count, CSS handles truncation
          return (
            <>
              <span className="inline-block max-w-[45ch] overflow-hidden text-ellipsis whitespace-nowrap align-bottom">
                <AnsiText content={firstLine} />
              </span>
              <span> ... ({lines.length} lines)</span>
            </>
          )
        } else {
          abbreviated = `${truncate(firstLine, 60)} ... (${lines.length} lines)`
        }
      }
      break
    }

    case 'Edit': {
      if (isError) {
        // Extract specific error message if available
        if (content.toLowerCase().includes('file has not been read yet')) {
          abbreviated = 'File not read yet'
        } else {
          abbreviated = 'Edit failed'
        }
      } else if (content.includes('has been updated')) {
        abbreviated = 'File updated'
      } else if (content.includes('No changes made')) {
        abbreviated = 'No changes made'
      } else {
        // Only assume success if we didn't detect an error
        abbreviated = 'File updated'
      }
      break
    }

    case 'MultiEdit': {
      // Check for specific MultiEdit errors
      if (
        content.includes('Found') &&
        content.includes('matches of the string to replace, but replace_all is false')
      ) {
        const matchCount = content.match(/Found (\d+) matches/)
        abbreviated = matchCount
          ? `Found ${matchCount[1]} matches - replace_all needed`
          : 'Multiple matches found'
      } else if (isError) {
        // Extract specific error message if available
        if (content.toLowerCase().includes('file has not been read yet')) {
          abbreviated = 'File not read yet'
        } else {
          abbreviated = 'MultiEdit failed'
        }
      } else {
        const editMatch = content.match(/Applied (\d+) edits?/)
        if (editMatch) {
          abbreviated = `Applied ${editMatch[1]} edits`
        } else {
          // Only assume success if we didn't detect an error
          abbreviated = 'Edits applied'
        }
      }
      break
    }

    case 'Write': {
      if (isError) {
        // Extract specific error message if available
        const lowerContent = content.toLowerCase()
        if (lowerContent.includes('file has not been read yet')) {
          abbreviated = 'File not read yet'
        } else if (content.trim() && !lowerContent.includes('write failed')) {
          // Show actual error content if present
          abbreviated = truncate(content, 50)
        } else {
          abbreviated = 'Write failed'
        }
      } else {
        // Success case - empty content is normal for successful writes
        abbreviated = 'File written'
      }
      break
    }

    case 'Glob': {
      if (content === 'No files found') {
        abbreviated = 'No files found'
      } else {
        const fileCount = content.split('\n').filter((l: string) => l.trim()).length
        abbreviated = `Found ${fileCount} files`
      }
      break
    }

    case 'Grep': {
      // Try to get the grep mode from the tool call parameters
      let mode = 'files_with_matches' // default
      if (toolCall?.toolInputJson) {
        try {
          const params = JSON.parse(toolCall.toolInputJson)
          mode = params.output_mode || mode
        } catch {
          // Fall back to default if parsing fails
        }
      }

      // Extract count from Claude's output if available
      const grepCountMatch = content.match(
        /Found (\d+) (?:total )?(files?|lines?|matches?|occurrences?)/,
      )
      if (grepCountMatch) {
        // Check if there's also file count info (e.g., "across 11 files")
        const fileCountMatch = content.match(/across (\d+) files/)
        if (fileCountMatch && grepCountMatch[2].includes('occurrence')) {
          abbreviated = `Found ${grepCountMatch[1]} ${grepCountMatch[2]} in ${fileCountMatch[1]} files`
        } else {
          abbreviated = `Found ${grepCountMatch[1]} ${grepCountMatch[2]}`
        }
      } else if (content.includes('No matches found')) {
        abbreviated = 'No matches found'
      } else {
        // Fallback: count based on mode
        const lineCount = content
          .split('\n')
          .filter(l => l.trim() && !l.includes('(Results are truncated')).length

        if (mode === 'content') {
          abbreviated = `Found ${lineCount} lines`
        } else if (mode === 'count') {
          // For count mode, parse file:count format (e.g., "/path/file.go:14")
          const lines = content.split('\n').filter(l => l.trim())
          const counts = lines
            .map(l => parseInt(l.match(/:(\d+)$/)?.[1] || '0'))
            .filter(n => !isNaN(n) && n > 0)
          const total = counts.reduce((sum, n) => sum + n, 0)

          // Count unique files
          const uniqueFiles = new Set(
            lines.filter(l => l.includes(':')).map(l => l.substring(0, l.lastIndexOf(':'))),
          ).size

          abbreviated = `Found ${total} matches in ${uniqueFiles} files`
        } else {
          // files_with_matches mode (default)
          abbreviated = `Found ${lineCount} files`
        }
      }
      break
    }

    case 'LS': {
      // Count items in the tree structure (lines starting with " - ")
      const lsItems = content.split('\n').filter((l: string) => l.trim().startsWith('-')).length
      abbreviated = `${lsItems} items`
      break
    }

    case 'Task': {
      // Task outputs are typically longer summaries
      const firstLine = content.split('\n')[0]
      abbreviated = truncate(firstLine, 100) || 'Task completed'
      break
    }

    case 'TodoRead': {
      // Extract todo count from the message
      const todoArrayMatch = content.match(/\[([^\]]*)\]/)
      if (todoArrayMatch) {
        const todos = todoArrayMatch[1]
        if (!todos) {
          abbreviated = '0 todos'
        } else {
          const todoCount = todos.split('},').length
          abbreviated = `${todoCount} todo${todoCount !== 1 ? 's' : ''}`
        }
      } else {
        abbreviated = 'Todo list read'
      }
      break
    }

    case 'TodoWrite': {
      abbreviated = 'Todos updated'
      break
    }

    case 'WebFetch': {
      if (content.includes('Failed to fetch') || isError) {
        abbreviated = 'Fetch failed'
      } else {
        // Show character count
        const charCount = content.length
        if (charCount > 1024) {
          abbreviated = `Fetched ${(charCount / 1024).toFixed(1)}kb`
        } else {
          abbreviated = `Fetched ${charCount} chars`
        }
      }
      break
    }

    case 'WebSearch': {
      // Count "Links:" occurrences to estimate result batches
      const linkMatches = content.match(/Links: \[/g)
      const linkCount = linkMatches ? linkMatches.length : 0
      // Estimate ~10 results per batch
      const estimatedResults = linkCount * 10
      abbreviated = estimatedResults > 0 ? `Found ~${estimatedResults} results` : 'Search completed'
      break
    }

    case 'NotebookRead': {
      const cellMatch = content.match(/(\d+) cells?/i)
      abbreviated = cellMatch ? `Read ${cellMatch[1]} cells` : 'Notebook read'
      break
    }

    case 'NotebookEdit': {
      abbreviated = 'Notebook updated'
      break
    }

    case 'ExitPlanMode': {
      abbreviated = 'Exited plan mode'
      break
    }

    default: {
      // MCP tool result formatting
      if (toolName.startsWith('mcp__')) {
        const { service, method } = parseMcpToolName(toolName)

        // Generic MCP result formatting
        if (isError) {
          abbreviated = `${service} ${method} failed`
        } else if (
          content.includes('successfully') ||
          content.includes('created') ||
          content.includes('updated')
        ) {
          abbreviated = `${service} ${method} completed`
        } else {
          // Show first line or character count for longer responses
          const lines = content.split('\n').filter((l: string) => l.trim())
          if (lines.length === 1 && lines[0].length < 80) {
            abbreviated = lines[0]
          } else if (content.length > 200) {
            abbreviated = `${service} response (${(content.length / 1024).toFixed(1)}kb)`
          } else {
            abbreviated = `${service} ${method} completed`
          }
        }
        break
      }

      // Unknown tools: show first line or truncate
      const defaultFirstLine = content.split('\n')[0]
      abbreviated = truncate(defaultFirstLine, 80) || 'Completed'
      break
    }
  }

  // Apply error styling if needed (but not for Read tool which just shows file content)
  if (isError && toolName !== 'Read') {
    return <span className="text-destructive">{abbreviated}</span>
  }

  // Also apply error styling for specific MultiEdit errors
  if (
    toolName === 'MultiEdit' &&
    typeof abbreviated === 'string' &&
    abbreviated.includes('replace_all needed')
  ) {
    return <span className="text-destructive">{abbreviated}</span>
  }

  return abbreviated
}
