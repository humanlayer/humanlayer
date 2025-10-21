import { MarkdownRenderer } from '@/components/internal/SessionDetail/MarkdownRenderer'
import { HighlightableText } from '../../SessionDetail/components/HighlightableText'
import { useSearch } from '../../SessionDetail/contexts/SearchContext'

interface UserMessageContentProps {
  eventContent: string
  eventId?: string
}

export function UserMessageContent({ eventContent, eventId }: UserMessageContentProps) {
  const { searchQuery } = useSearch()

  // If searching, render with highlighting
  if (searchQuery && eventId) {
    return (
      <div className="overflow-hidden">
        <div className="whitespace-pre-wrap text-foreground break-words hyphens-auto">
          <HighlightableText text={eventContent} elementId={`user-${eventId}`} />
        </div>
      </div>
    )
  }

  // Otherwise render normally with MarkdownRenderer
  return (
    <div className="overflow-hidden">
      <div className="whitespace-pre-wrap text-foreground break-words hyphens-auto">
        <MarkdownRenderer content={eventContent} />
      </div>
    </div>
  )
}
