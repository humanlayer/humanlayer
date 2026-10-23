import { MarkdownRenderer } from '@humanlayer/ui/components/markdown-renderer'
import type { FC } from 'react'

export interface AssistantMessageContentProps {
  content: string
  isThinking?: boolean
}

export const AssistantMessageContent: FC<AssistantMessageContentProps> = ({ content, isThinking }) => {
  // Strip thinking tags if present
  let displayContent = content
  if (content.startsWith('<thinking>')) {
    const endTag = content.indexOf('</thinking>')
    if (endTag !== -1) {
      displayContent = content.slice(endTag + 11).trim()
    }
  }

  return (
    <div className={`text-sm [&_p]:mb-0 [&_ul]:mb-2 [&_ol]:mb-2 [&_pre]:mb-2 ${isThinking ? 'text-muted-foreground italic' : ''}`}>
      <MarkdownRenderer content={displayContent} preserveSingleLineBreaks />
    </div>
  )
}
