import { MarkdownRenderer } from '@/components/internal/SessionDetail/MarkdownRenderer'

export function UserMessageContent({ eventContent }: { eventContent: string }) {
  const firstLine = eventContent?.split('\n')[0] || ''
  const restLines = eventContent?.split('\n').slice(1).join('\n') || ''

  return (
    <div className="overflow-hidden">
      <span className="whitespace-pre-wrap text-foreground break-words hyphens-auto">
        <MarkdownRenderer content={firstLine} />
      </span>

      {/* Body */}
      <div className="whitespace-pre-wrap text-foreground break-words hyphens-auto">
        <MarkdownRenderer content={restLines} />
      </div>
    </div>
  )
}
