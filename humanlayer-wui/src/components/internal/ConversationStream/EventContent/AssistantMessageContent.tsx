import { useState } from 'react'
import { Expand } from 'lucide-react'
import { MarkdownRenderer } from '@/components/internal/SessionDetail/MarkdownRenderer'
import { FocusViewModal } from '@/components/internal/SessionDetail/FocusViewModal'
import { Button } from '@/components/ui/button'

export const FOCUS_VIEW_CHARACTER_THRESHOLD = 1500

export function AssistantMessageContent({
  eventContent,
  isThinking,
}: {
  eventContent: string
  isThinking: boolean
}) {
  const [isFocusViewOpen, setIsFocusViewOpen] = useState(false)
  const showFocusButton = !isThinking && eventContent.length >= FOCUS_VIEW_CHARACTER_THRESHOLD

  if (isThinking && !eventContent) {
    return (
      <div>
        <span className="text-muted-foreground italic">Thinking...</span>
      </div>
    )
  }

  return (
    <div className="relative min-w-0 flex-1">
      {showFocusButton && (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-0 right-0 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
            onClick={e => {
              e.stopPropagation()
              setIsFocusViewOpen(true)
            }}
            aria-label="Open focus view"
            title="Open focus view"
          >
            <Expand className="h-3 w-3" />
          </Button>
          <FocusViewModal
            open={isFocusViewOpen}
            onOpenChange={setIsFocusViewOpen}
            content={eventContent}
          />
        </>
      )}
      <div
        className={`whitespace-pre-wrap text-foreground break-words hyphens-auto ${showFocusButton ? 'pr-8' : ''} ${isThinking ? 'text-muted-foreground italic' : ''}`}
      >
        <MarkdownRenderer content={eventContent} />
      </div>
    </div>
  )
}
