import { MarkdownRenderer } from '@/components/internal/SessionDetail/MarkdownRenderer'

export function UserMessageContent({
  eventContent,
  searchQuery,
  isCurrentSearchMatch,
}: {
  eventContent: string
  searchQuery?: string
  isCurrentSearchMatch?: boolean
}) {
  return (
    <div className="overflow-hidden">
      <div className="whitespace-pre-wrap text-foreground break-words hyphens-auto">
        <MarkdownRenderer
          content={eventContent}
          searchQuery={searchQuery}
          isCurrentSearchMatch={isCurrentSearchMatch}
        />
      </div>
    </div>
  )
}
