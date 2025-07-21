import React from 'react'
import { ConversationEvent } from '@/lib/daemon/types'
import { truncate } from '@/utils/formatting'

// TODO(2): Consider creating tool-specific formatters in separate files
// TODO(2): Add unit tests for each tool formatter
// TODO(3): Extract magic numbers to constants (e.g., truncate lengths, line limits)

// Format tool result content into abbreviated display
export function formatToolResult(toolName: string, toolResult: ConversationEvent): React.ReactNode {
  const content = toolResult.tool_result_content || ''

  // Handle empty content
  if (!content.trim()) {
    return <span className="text-muted-foreground italic">No output</span>
  }

  // More specific error detection to avoid false positives
  // TODO(2): Extract error detection logic into a separate utility
  let isError = false

  if (toolName === 'Edit') {
    // For Edit tool, check for success pattern
    const successPattern =
      "has been updated. Here's the result of running `cat -n` on a snippet of the edited file:"
    isError = !content.includes(successPattern)
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

  let abbreviated: string

  switch (toolName) {
    case 'Read': {
      // Count lines with the arrow format (e.g., "     1→content")
      // Subtract 5 for the system reminder message appended at the end
      const lineCount = Math.max(0, content.split('\n').length - 5)
      abbreviated = `Read ${lineCount} lines`
      break
    }

    case 'Bash': {
      const lines = content.split('\n').filter(l => l.trim())
      if (!content || lines.length === 0) {
        abbreviated = 'Command completed'
      } else if (lines.length === 1) {
        abbreviated = truncate(lines[0], 80)
      } else {
        abbreviated = `${truncate(lines[0], 60)} ... (${lines.length} lines)`
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
        if (content.toLowerCase().includes('file has not been read yet')) {
          abbreviated = 'File not read yet'
        } else {
          abbreviated = 'Write failed'
        }
      } else if (content.includes('successfully')) {
        abbreviated = 'File written'
      } else {
        // Only assume success if we didn't detect an error
        abbreviated = 'File written'
      }
      break
    }

    case 'Glob': {
      if (content === 'No files found') {
        abbreviated = 'No files found'
      } else {
        const fileCount = content.split('\n').filter(l => l.trim()).length
        abbreviated = `Found ${fileCount} files`
      }
      break
    }

    case 'Grep': {
      // Extract the count from "Found X files" at the start
      const grepCountMatch = content.match(/Found (\d+) files?/)
      if (grepCountMatch) {
        abbreviated = `Found ${grepCountMatch[1]} files`
      } else if (content.includes('No matches found')) {
        abbreviated = 'No matches found'
      } else {
        // Fallback: count lines
        const fileCount = content
          .split('\n')
          .filter(l => l.trim() && !l.includes('(Results are truncated')).length
        abbreviated = `Found ${fileCount} files`
      }
      break
    }

    case 'LS': {
      // Count items in the tree structure (lines starting with " - ")
      const lsItems = content.split('\n').filter(l => l.trim().startsWith('-')).length
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

    case 'exit_plan_mode': {
      abbreviated = 'Exited plan mode'
      break
    }

    default: {
      // MCP tool result formatting
      if (toolName.startsWith('mcp__')) {
        const parts = toolName.split('__')
        const service = parts[1] || 'unknown'
        const method = parts.slice(2).join('__') || 'unknown'

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
          const lines = content.split('\n').filter(l => l.trim())
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
  if (toolName === 'MultiEdit' && abbreviated.includes('replace_all needed')) {
    return <span className="text-destructive">{abbreviated}</span>
  }

  return abbreviated
}
