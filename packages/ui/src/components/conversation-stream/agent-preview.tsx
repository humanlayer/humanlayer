import { Bot, FilePenLine, FileText, Search, Terminal, User, Wrench } from 'lucide-react'
import type { FC } from 'react'
import type { ConversationEvent } from './types'
import { truncateText } from './utils/formatters'

export interface AgentPreviewProps {
  latestEvent: ConversationEvent
  toolCallCount: number
}

export const AgentPreview: FC<AgentPreviewProps> = ({ latestEvent, toolCallCount }) => {
  let previewIcon = null
  let previewText = ''

  if (latestEvent.toolName) {
    previewText = latestEvent.toolName
    // Normalize tool name for case-insensitive, underscore-insensitive matching
    const normalizedToolName = latestEvent.toolName.toLowerCase().replace(/_/g, '')
    try {
      const input = JSON.parse(latestEvent.toolInputJson || '{}')

      switch (normalizedToolName) {
        case 'write':
          previewIcon = <FilePenLine className="w-3 h-3" />
          previewText = `Write to ${input.file_path || 'file'}`
          break
        case 'read':
          previewIcon = <FileText className="w-3 h-3" />
          previewText = `Read ${input.file_path || 'file'}`
          break
        case 'bash':
          previewIcon = <Terminal className="w-3 h-3" />
          previewText = `$ ${truncateText(input.command || '', 50)}`
          break
        case 'task':
        case 'agent':
          previewText = truncateText(
            `${input.subagent_type || 'Agent'}: ${input.description || ''}`,
            80
          )
          break
        case 'grep':
        case 'glob':
          previewIcon = <Search className="w-3 h-3" />
          previewText = `${latestEvent.toolName}: ${truncateText(input.pattern || '', 40)}`
          break
        default:
          break
      }
    } catch {
      // Keep default preview text if JSON parsing fails
    }

    if (!previewIcon) previewIcon = <Wrench className="w-3 h-3" />
  } else if (latestEvent.role === 'assistant' && latestEvent.content) {
    previewIcon = <Bot className="w-3 h-3" />
    previewText = truncateText(latestEvent.content, 100)
  } else if (latestEvent.role === 'user' && latestEvent.content) {
    previewIcon = <User className="w-3 h-3" />
    previewText = truncateText(latestEvent.content, 100)
  }

  return (
    <div className="mt-1 space-y-1">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {previewIcon && <span>{previewIcon}</span>}
        <span className="truncate">{previewText}</span>
      </div>
      {toolCallCount > 1 && (
        <div className="text-sm text-muted-foreground">
          + {toolCallCount - 1} more tool {toolCallCount - 1 === 1 ? 'call' : 'calls'}
        </div>
      )}
    </div>
  )
}
