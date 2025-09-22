import { ConversationEvent } from '@/lib/daemon/types'
import { truncate } from '@/utils/formatting'
import { FilePenLine, Terminal, Wrench, Bot, User, UserCheck, Search, FileText } from 'lucide-react'

interface TaskPreviewProps {
  latestEvent: ConversationEvent
  toolCallCount: number
}

export function TaskPreview({ latestEvent, toolCallCount }: TaskPreviewProps) {
  // Extract preview logic from TaskGroup.tsx:123-175
  let previewText = ''
  let icon = null

  if (latestEvent.toolName) {
    previewText = latestEvent.toolName
    try {
      const toolInput = JSON.parse(latestEvent.toolInputJson || '{}')

      // Tool-specific preview generation
      switch (latestEvent.toolName) {
        case 'Write':
          if (toolInput.file_path) {
            previewText = `Write to ${toolInput.file_path}`
            icon = <FilePenLine className="w-3 h-3" />
          }
          break
        case 'Read':
          if (toolInput.file_path) {
            previewText = `Read ${toolInput.file_path}`
            icon = <FileText className="w-3 h-3" />
          }
          break
        case 'Bash':
          if (toolInput.command) {
            previewText = `$ ${truncate(toolInput.command, 50)}`
            icon = <Terminal className="w-3 h-3" />
          }
          break
        case 'Task':
          if (toolInput.description) {
            const taskName = toolInput.subagent_type ? `${toolInput.subagent_type}: ` : ''
            previewText = taskName + truncate(toolInput.description, 80 - taskName.length)
          }
          break
        case 'Grep':
        case 'Glob':
          previewText = `Search: ${truncate(toolInput.pattern || '', 40)}`
          icon = <Search className="w-3 h-3" />
          break
        default:
          break
      }
    } catch {
      // Keep default preview text if JSON parsing fails
    }

    if (!icon) icon = <Wrench className="w-3 h-3" />
  } else if (latestEvent.content) {
    previewText = truncate(latestEvent.content, 100)
    if (latestEvent.role === 'assistant') {
      icon = <Bot className="w-3 h-3" />
    } else if (latestEvent.role === 'user') {
      icon = <User className="w-3 h-3" />
    }
  } else if (latestEvent.approvalStatus) {
    previewText = `Approval (${latestEvent.approvalStatus})`
    icon = <UserCheck className="w-3 h-3" />
  }

  return (
    <div className="mt-2 opacity-70 text-sm">
      <div className="flex items-baseline gap-2">
        {icon && <span className="text-sm text-accent align-middle relative top-[1px]">{icon}</span>}
        <span className="whitespace-pre-wrap text-accent text-xs">{previewText}</span>
      </div>
      {toolCallCount > 1 && (
        <div className="text-xs text-muted-foreground mt-1">
          + {toolCallCount - 1} more tool {toolCallCount - 1 === 1 ? 'call' : 'calls'}
        </div>
      )}
    </div>
  )
}
