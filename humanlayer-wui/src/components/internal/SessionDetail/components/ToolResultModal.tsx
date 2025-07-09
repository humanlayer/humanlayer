import { useRef } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ConversationEvent } from '@/lib/daemon/types'
import { truncate } from '@/utils/formatting'
import { useStealHotkeyScope } from '@/hooks/useStealHotkeyScope'

// TODO(3): Add keyboard navigation hints in the UI
// TODO(2): Consider adding copy-to-clipboard functionality for tool results

const ToolResultModalHotkeysScope = 'tool-result-modal'

// Minimalist modal for showing full tool results
export function ToolResultModal({
  toolCall,
  toolResult,
  onClose,
}: {
  toolCall: ConversationEvent | null
  toolResult: ConversationEvent | null
  onClose: () => void
}) {
  const contentRef = useRef<HTMLDivElement>(null)

  // Handle j/k navigation - using priority to override background hotkeys
  useHotkeys(
    'j',
    e => {
      e.preventDefault()
      e.stopPropagation()
      if (toolResult && contentRef.current) {
        contentRef.current.scrollTop += 100
      }
    },
    {
      enabled: !!toolResult,
      enableOnFormTags: true,
      preventDefault: true,
      scopes: ToolResultModalHotkeysScope,
    },
  )

  useHotkeys(
    'k',
    e => {
      e.preventDefault()
      e.stopPropagation()
      if (toolResult && contentRef.current) {
        contentRef.current.scrollTop -= 100
      }
    },
    {
      enabled: !!toolResult,
      enableOnFormTags: true,
      preventDefault: true,
      scopes: ToolResultModalHotkeysScope,
    },
  )

  // Handle escape to close
  useHotkeys(
    'escape',
    ev => {
      ev.stopPropagation()
      if (toolResult) {
        onClose()
      }
    },
    { enabled: !!toolResult, scopes: ToolResultModalHotkeysScope },
  )

  useStealHotkeyScope(ToolResultModalHotkeysScope)

  if (!toolResult) return null

  return (
    <Dialog
      open={!!toolResult}
      onOpenChange={open => {
        !open && onClose()
      }}
    >
      <DialogContent className="w-[90vw] max-w-[90vw] max-h-[80vh] p-0 sm:max-w-[90vw]">
        <DialogHeader className="px-6 py-4 border-b">
          <DialogTitle className="font-mono text-sm flex items-center justify-between">
            <span>
              {toolCall?.tool_name || 'Tool Result'}
              {toolCall?.tool_input_json && (
                <span className="ml-2 text-xs text-muted-foreground">
                  {(() => {
                    try {
                      const args = JSON.parse(toolCall.tool_input_json)
                      // Show the most relevant argument based on tool name
                      if (toolCall.tool_name === 'Read' && args.file_path) {
                        return args.file_path
                      } else if (toolCall.tool_name === 'Bash' && args.command) {
                        return truncate(args.command, 60)
                      } else if (toolCall.tool_name === 'Edit' && args.file_path) {
                        return args.file_path
                      } else if (toolCall.tool_name === 'Write' && args.file_path) {
                        return args.file_path
                      } else if (toolCall.tool_name === 'Grep' && args.pattern) {
                        return args.pattern
                      }
                      // For other tools, show the first string value
                      const firstValue = Object.values(args).find(v => typeof v === 'string')
                      return firstValue ? truncate(String(firstValue), 60) : ''
                    } catch {
                      return ''
                    }
                  })()}
                </span>
              )}
            </span>
          </DialogTitle>
        </DialogHeader>
        <div
          ref={contentRef}
          className="overflow-y-auto px-6 py-4 font-mono text-sm whitespace-pre-wrap"
          style={{ maxHeight: 'calc(80vh - 80px)' }}
        >
          {toolResult.tool_result_content || 'No content'}
        </div>
        <div className="mt-2 px-4 py-2 text-xs text-muted-foreground bg-muted/30 border-t border-border/50 flex justify-end">
          <span className="flex items-center gap-1">
            <kbd className="font-mono">ESC</kbd> to close
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
