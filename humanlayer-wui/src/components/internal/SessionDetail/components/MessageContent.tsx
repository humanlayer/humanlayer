import React, { memo } from 'react'

interface MessageContentProps {
  subject: React.ReactNode
  body?: React.ReactNode
  toolResultContent?: React.ReactNode
  className?: string
}

export const MessageContent = memo(
  ({ subject, body, toolResultContent, className = '' }: MessageContentProps) => {
    return (
      <div className={className}>
        <span className="whitespace-pre-wrap text-foreground break-words">{subject}</span>

        {/* Tool Result Content */}
        {toolResultContent && (
          <div className="whitespace-pre-wrap text-foreground break-words mt-2">
            {toolResultContent}
          </div>
        )}

        {/* Body */}
        {body && <div className="whitespace-pre-wrap text-foreground break-words mt-2">{body}</div>}
      </div>
    )
  },
  (prevProps, nextProps) => {
    // Custom comparison to prevent re-renders when content hasn't changed
    return (
      prevProps.subject === nextProps.subject &&
      prevProps.body === nextProps.body &&
      prevProps.toolResultContent === nextProps.toolResultContent &&
      prevProps.className === nextProps.className
    )
  },
)

MessageContent.displayName = 'MessageContent'
