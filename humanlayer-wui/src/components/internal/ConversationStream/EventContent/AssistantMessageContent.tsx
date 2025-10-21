import { MarkdownRenderer } from '@/components/internal/SessionDetail/MarkdownRenderer'
import { HighlightableText } from '../../SessionDetail/components/HighlightableText'
import { useSearch } from '../../SessionDetail/contexts/SearchContext'

interface AssistantMessageContentProps {
  eventContent: string
  isThinking: boolean
  eventId?: string
}

export function AssistantMessageContent({
  eventContent,
  isThinking,
  eventId,
}: AssistantMessageContentProps) {
  const { searchQuery } = useSearch()

  if (isThinking && !eventContent) {
    return (
      <div>
        <span className="text-muted-foreground italic">Thinking...</span>
      </div>
    )
  }

  // If searching, render with highlighting
  if (searchQuery && eventId) {
    return (
      <div>
        <div
          className={`whitespace-pre-wrap text-foreground break-words hyphens-auto ${isThinking ? 'text-muted-foreground italic' : ''}`}
        >
          <HighlightableText
            text={eventContent}
            elementId={`assistant-${eventId}`}
            className={isThinking ? 'text-muted-foreground italic' : ''}
          />
        </div>
      </div>
    )
  }

  // Otherwise render normally with MarkdownRenderer
  return (
    <div>
      <div
        className={`whitespace-pre-wrap text-foreground break-words hyphens-auto ${isThinking ? 'text-muted-foreground italic' : ''}`}
      >
        <MarkdownRenderer content={eventContent} />
      </div>
    </div>
  )
}
