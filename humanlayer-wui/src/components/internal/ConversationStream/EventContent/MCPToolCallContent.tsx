import React from 'react'
import { ToolHeader } from './ToolHeader'
import type { ToolCallContentProps } from './types'
import { getApprovalStatusColor } from './utils/formatters'
import { parseMcpToolName } from '@/utils/formatting'
import { KeyboardShortcut } from '@/components/ui/keyboard-shortcut'

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

  // Format parameters for display - show first 2 simple parameters
  const paramPreview = React.useMemo(() => {
    if (!toolInput || typeof toolInput !== 'object') return null
    const entries = Object.entries(toolInput)
    if (entries.length === 0) return null

    const params = entries
      .slice(0, 2)
      .map(([key, value]) => {
        if (typeof value === 'string' || typeof value === 'number') {
          return `${key}: "${value}"`
        }
        return `${key}: ...`
      })
      .join(', ')

    const hasMore = entries.length > 2
    return `(${params}${hasMore ? ', ...' : ''})`
  }, [toolInput])

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
      <ToolHeader
        name={displayName}
        primaryParam={paramPreview || undefined}
        nameColor={approvalStatus ? statusColor : undefined}
      />
      {isCompleted && resultPreview && (
        <div className="text-sm text-muted-foreground mt-1">{resultPreview}</div>
      )}
      <div
        className={`text-xs text-muted-foreground/70 mt-1 ${isFocused && !isCompleted && paramPreview ? 'visible' : 'invisible'}`}
      >
        Press <KeyboardShortcut>i</KeyboardShortcut> or click to view full parameters
      </div>
    </div>
  )
}
