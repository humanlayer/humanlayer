import React, { memo } from 'react'
import { DataTransformErrorBoundary } from '@/components/ui/DataTransformErrorBoundary'

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
        <DataTransformErrorBoundary
          dataContext="message subject rendering"
          expectedDataType="ReactNode"
          fallback={() => <span className="text-destructive text-sm">[Failed to render subject]</span>}
        >
          <span className="whitespace-pre-wrap text-foreground break-words">{subject}</span>
        </DataTransformErrorBoundary>

        {/* Tool Result Content */}
        {toolResultContent && (
          <DataTransformErrorBoundary
            dataContext="tool result content rendering"
            expectedDataType="ReactNode"
            fallback={() => (
              <div className="text-destructive text-sm">[Failed to render tool result content]</div>
            )}
          >
            <div className="whitespace-pre-wrap text-foreground break-words">{toolResultContent}</div>
          </DataTransformErrorBoundary>
        )}

        {/* Body */}
        {body && (
          <DataTransformErrorBoundary
            dataContext="message body rendering"
            expectedDataType="ReactNode"
            fallback={() => (
              <div className="text-destructive text-sm">[Failed to render message body]</div>
            )}
          >
            <div className="whitespace-pre-wrap text-foreground break-words">{body}</div>
          </DataTransformErrorBoundary>
        )}
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
