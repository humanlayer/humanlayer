import { MarkdownRenderer } from '@/components/internal/SessionDetail/MarkdownRenderer'

export function AssistantMessageContent({
  eventContent,
  isThinking,
  searchQuery,
  isCurrentSearchMatch,
}: {
  eventContent: string
  isThinking: boolean
  searchQuery?: string
  isCurrentSearchMatch?: boolean
}) {
  if (isThinking && !eventContent) {
    return (
      <div>
        <span className="text-muted-foreground italic">Thinking...</span>
      </div>
    )
  }

  return (
    <div>
      <div
        className={`whitespace-pre-wrap text-foreground break-words hyphens-auto ${isThinking ? 'text-muted-foreground italic' : ''}`}
      >
        <MarkdownRenderer
          content={eventContent}
          searchQuery={searchQuery}
          isCurrentSearchMatch={isCurrentSearchMatch}
        />
      </div>
    </div>
  )
}
