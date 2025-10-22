import React from 'react'
import { ToolHeader } from './ToolHeader'
import type { ToolCallContentProps } from './types'
import { getApprovalStatusColor } from './utils/formatters'
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
  const resultPreview = React.useMemo(() => {
    if (!isCompleted || !toolResultContent) return null

    // Check for common success indicators
    if (
      toolResultContent.includes('successfully') ||
      toolResultContent.includes('created') ||
      toolResultContent.includes('updated') ||
      toolResultContent.includes('completed')
    ) {
      return '✓ Success'
    }

    // Check for error indicators
    if (toolResultContent.includes('error') || toolResultContent.includes('failed')) {
      return `✗ ${service} ${formattedMethod} failed`
    }

    // Return first line of result for preview
    const firstLine = toolResultContent.split('\n')[0]
    if (firstLine.length > 50) {
      return firstLine.substring(0, 50) + '...'
    }
    return firstLine
  }, [isCompleted, toolResultContent, service, formattedMethod])

  const approvalStatusColor = getApprovalStatusColor(approvalStatus)
  let statusColor =
    isGroupItem && !approvalStatusColor ? 'text-[var(--terminal-accent)]' : approvalStatusColor

  return (
    <div>
      <ToolHeader name={displayName} nameColor={approvalStatus ? statusColor : undefined} />
      {toolInput && Object.keys(toolInput).length > 0 && (
        <MCPToolCallParamPreview toolInput={toolInput} isDim={isCompleted && !isFocused} />
      )}
      {isCompleted && resultPreview && (
        <div className="text-sm text-muted-foreground mt-1">{resultPreview}</div>
      )}
      <div
        className={`text-xs text-muted-foreground/70 mt-1 ${isFocused && !isCompleted && toolInput ? 'visible' : 'invisible'}`}
      >
        Press <KeyboardShortcut>i</KeyboardShortcut> or click to view full parameters
      </div>
    </div>
  )
}
