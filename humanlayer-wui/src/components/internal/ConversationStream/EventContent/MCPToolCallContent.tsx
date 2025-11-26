import React from 'react'
import { ToolHeader } from './ToolHeader'
import type { ToolCallContentProps } from './types'
import { getApprovalStatusColor, detectToolError, extractMcpError } from './utils/formatters'
import { parseMcpToolName } from '@/utils/formatting'
import { KeyboardShortcut } from '@/components/ui/keyboard-shortcut'
import { MCPToolCallParamPreview } from './MCPToolCallParamPreview'

interface MCPToolInput {
  [key: string]: any
}

interface MCPToolCallContentProps extends ToolCallContentProps<MCPToolInput> {
  toolName: string
  isGroupItem?: boolean
}

export function MCPToolCallContent({
  toolName,
  toolInput,
  approvalStatus,
  isCompleted,
  toolResultContent,
  isFocused,
  isGroupItem,
}: MCPToolCallContentProps) {
  const { service, method } = parseMcpToolName(toolName)
  const formattedMethod = method.replace(/_/g, ' ')
  const displayName = `${service} - ${formattedMethod}`

  // Format result preview for completed MCP calls
  const resultPreview = React.useMemo((): { text: string; isError: boolean; suggestion?: string | null } | null => {
    if (!isCompleted || !toolResultContent) return null

    // Check for errors FIRST using centralized detection
    if (detectToolError(toolName, toolResultContent)) {
      const mcpError = extractMcpError(toolResultContent)
      if (mcpError) {
        return {
          text: `${service} failed: ${mcpError.message}`,
          suggestion: mcpError.suggestion,
          isError: true,
        }
      }
      return {
        text: `${service} ${formattedMethod} failed`,
        isError: true,
      }
    }

    // Check for common success indicators
    if (
      toolResultContent.includes('successfully') ||
      toolResultContent.includes('created') ||
      toolResultContent.includes('updated') ||
      toolResultContent.includes('completed')
    ) {
      return { text: 'Success', isError: false }
    }

    // Return first line of result for preview
    const firstLine = toolResultContent.split('\n')[0]
    if (firstLine.length > 50) {
      return { text: firstLine.substring(0, 50) + '...', isError: false }
    }
    return { text: firstLine, isError: false }
  }, [isCompleted, toolResultContent, toolName, service, formattedMethod])

  const approvalStatusColor = getApprovalStatusColor(approvalStatus)
  let statusColor =
    isGroupItem && !approvalStatusColor ? 'text-[var(--terminal-accent)]' : approvalStatusColor

  return (
    <div>
      <ToolHeader
        name={displayName}
        nameColor={resultPreview?.isError ? undefined : (approvalStatus ? statusColor : undefined)}
        nameStyle={resultPreview?.isError ? { color: 'var(--terminal-error)' } : undefined}
      />
      {toolInput && Object.keys(toolInput).length > 0 && (
        <MCPToolCallParamPreview toolInput={toolInput} isDim={isCompleted && !isFocused} />
      )}
      {isCompleted && resultPreview && (
        <div>
          <div className={`text-sm mt-1 ${resultPreview.isError ? 'text-destructive' : 'text-muted-foreground'}`}>
            {resultPreview.text}
          </div>
          {resultPreview.isError && resultPreview.suggestion && (
            <div className="text-xs text-muted-foreground mt-1">
              {resultPreview.suggestion}
            </div>
          )}
        </div>
      )}
      <div
        className={`text-xs text-muted-foreground/70 mt-1 ${isFocused && !isCompleted && toolInput ? 'visible' : 'invisible'}`}
      >
        Press <KeyboardShortcut>i</KeyboardShortcut> or click to view full parameters
      </div>
    </div>
  )
}
