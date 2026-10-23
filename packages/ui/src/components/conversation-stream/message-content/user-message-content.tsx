import { MarkdownRenderer } from '@humanlayer/ui/components/markdown-renderer'
import type { FC } from 'react'

export interface UserMessageContentProps {
  content: string
}

export const UserMessageContent: FC<UserMessageContentProps> = ({ content }) => {
  return (
    <div className="text-sm whitespace-pre-wrap break-words">
      <MarkdownRenderer content={content} preserveSingleLineBreaks />
    </div>
  )
}
